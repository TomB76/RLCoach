/**
 * RL Coach - serveur local.
 *
 * - expose une API REST + un WebSocket `/live` pour le front
 * - se connecte à l'API Stats locale de Rocket League (127.0.0.1:49123)
 * - analyse chaque match et le confronte à la cohorte pro (ballchasing)
 * - peut simuler un match complet (mode démo) sans lancer le jeu
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';

import {
  BALLCHASING_MIN_INTERVAL_MS,
  DIST_DIR,
  PLAYLISTS,
  SERVER_PORT,
  isDemoOnStart,
  DATA_DIR,
} from './config.js';
import {
  deleteAllMatches,
  deleteMatch,
  getAiConfig,
  getBallchasingToken,
  getMatch,
  getPublicSettings,
  getSettings,
  listMatches,
  saveMatch,
  summaryOf,
  updateSettings,
} from './store.js';
import { StatsApiClient } from './rl/statsApiClient.js';
import { MatchTracker } from './rl/matchTracker.js';
import { playSimulatedMatch } from './rl/simulator.js';
import { coachMatch, coachOverview } from './coach/engine.js';
import {
  checkToken,
  getCohort,
  listKnownPlayers,
  refreshCohort,
  refreshState,
  replayToMatch,
} from './ballchasing/cohort.js';
import { suggestedPlayersFor } from './ballchasing/knownPlayers.js';
import { BallchasingClient } from './ballchasing/client.js';
import {
  AI_PROVIDERS,
  generateMatchNarrative,
  generateOverviewNarrative,
  publicAiStatus,
  testAi,
} from './coach/ai.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/live' });

app.use(express.json({ limit: '12mb' }));

// Les données changent (réanalyse, génération IA) : jamais de cache navigateur
// sur l'API, sinon un rechargement peut servir une version périmée.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ---------------------------------------------------------------------------
// État applicatif
// ---------------------------------------------------------------------------

const settings = getSettings();

const rlClient = new StatsApiClient({
  host: settings.host,
  port: settings.port,
  transport: settings.transport,
});

const tracker = new MatchTracker({
  playerName: settings.playerName,
  mode: 'live',
  onMatchEnded: (match) => handleMatchCompleted(match),
});

const state = {
  lastSnapshot: null,
  lastEmittedAt: 0,
  demo: { running: false, progress: 0, total: 0, aborted: false, profile: null },
  lastError: null,
};

/**
 * Référence de coaching active : cohorte globale de tous les pros, ou un seul
 * joueur pro (calculé uniquement sur ses propres replays).
 */
function currentReference() {
  const s = getSettings();
  const player = String(s.referencePlayer || '').trim();
  if (s.referenceMode === 'player' && player) return { mode: 'player', player };
  return { mode: 'global', player: null };
}

/** Cohorte correspondant à la référence active, pour un mode de jeu donné. */
function cohortFor(playlist) {
  return getCohort(playlist, currentReference());
}

// ---------------------------------------------------------------------------
// WebSocket : diffusion d'état
// ---------------------------------------------------------------------------

function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload, at: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

wss.on('connection', (socket) => {
  socket.send(
    JSON.stringify({
      type: 'hello',
      payload: { status: buildStatus(), live: tracker.snapshot() },
      at: new Date().toISOString(),
    }),
  );
});

/** Snapshot live throttlé (4/s) : évite de saturer le navigateur. */
function emitLive(force = false) {
  const now = Date.now();
  if (!force && now - state.lastEmittedAt < 250) return;
  state.lastEmittedAt = now;
  const snapshot = tracker.snapshot();
  state.lastSnapshot = snapshot;
  broadcast('snapshot', { snapshot, rl: rlClient.getStatus() });
}

rlClient.on('status', (status) => {
  broadcast('status', { rl: status, status: buildStatus() });
});

rlClient.on('message', (message) => {
  try {
    tracker.ingest(message);
    emitLive();
  } catch (err) {
    state.lastError = err.message;
    console.error('[tracker] message ignoré :', err.message);
  }
});

// ---------------------------------------------------------------------------
// Complétion d'un match : coaching + persistance
// ---------------------------------------------------------------------------

function handleMatchCompleted(match) {
  const minSeconds = getSettings().minMatchSeconds || 60;
  if (match.durationSeconds < minSeconds) {
    console.log(`[match] ignoré (${match.durationSeconds}s < ${minSeconds}s)`);
    return;
  }

  const playlist = match.playlist || getSettings().targetPlaylist || 'ranked-doubles';
  const cohort = cohortFor(playlist);
  const { comparison, coaching } = coachMatch({ match, cohort });
  match.comparison = comparison;
  match.coaching = coaching;

  const local = match.players.find((p) => p.isLocal);
  if (local) {
    local.rlCoachScore = coaching.score;
    local.grade = coaching.grade;
  }

  saveMatch(match);
  console.log(
    `[match] ${match.playlist} ${match.teamScores[0]}-${match.teamScores[1]} | score coach ${coaching.score} (${coaching.grade}) | ref ${comparison?.referenceLabel || 'aucune (joueur local non identifié)'}`,
  );
  broadcast('match-completed', { match, summary: summaryOf(match), status: buildStatus() });
  emitLive(true);

  // Coach IA optionnel : jamais bloquant, et seulement si explicitement activé.
  if (getAiConfig().auto) {
    generateMatchNarrative({ match, comparison, coaching, config: getAiConfig() })
      .then((result) => {
        if (!result.ok) {
          console.warn(`[ai] match ${match.id} : ${result.error}`);
          return;
        }
        match.ai = {
          narrative: result.narrative,
          provider: result.provider,
          model: result.model,
          generatedAt: result.generatedAt,
          promptVersion: result.promptVersion,
          referenceLabel: comparison?.referenceLabel || null,
        };
        saveMatch(match);
        broadcast('match-ai', { id: match.id, ai: match.ai });
      })
      .catch((err) => console.warn(`[ai] échec : ${err.message}`));
  }
}

function reanalyzeMatches({ playlist = null } = {}) {
  const rows = listMatches({ limit: 400 });
  let updated = 0;
  for (const summary of rows) {
    if (playlist && summary.playlist !== playlist) continue;
    const match = getMatch(summary.id);
    if (!match) continue;
    const cohort = cohortFor(match.playlist || 'ranked-doubles');
    const { comparison, coaching } = coachMatch({ match, cohort });
    match.comparison = comparison;
    match.coaching = coaching;
    const local = match.players.find((p) => p.isLocal);
    if (local) {
      local.rlCoachScore = coaching.score;
      local.grade = coaching.grade;
    }
    saveMatch(match);
    updated += 1;
  }
  return updated;
}

function publicDemo() {
  const { controller, ...rest } = state.demo;
  return rest;
}

// ---------------------------------------------------------------------------
// Statut
// ---------------------------------------------------------------------------

function buildStatus() {
  const current = getSettings();
  const playlist = current.targetPlaylist || 'ranked-doubles';
  const cohort = cohortFor(playlist);
  const matches = listMatches({ limit: 500 });
  const snapshot = tracker.snapshot();
  return {
    ok: true,
    version: '1.0.0',
    time: new Date().toISOString(),
    rl: rlClient.getStatus(),
    tracker: {
      tracking: snapshot.active,
      freeplay: snapshot.freeplay === true,
      gameTimeSeconds: snapshot.gameTimeSeconds,
      teamScores: snapshot.teamScores,
      playlist: snapshot.playlist,
      localPlayer: snapshot.localPlayer?.name ?? null,
      players: snapshot.players.length,
    },
    demo: publicDemo(),
    storage: {
      matchCount: matches.length,
      lastMatchAt: matches[0]?.date || null,
      dataDir: DATA_DIR,
    },
    ballchasing: {
      tokenSet: Boolean(getBallchasingToken()),
      reference: {
        mode: cohort.mode || 'global',
        player: cohort.player || null,
        label: cohort.label || 'Pros',
        active: currentReference(),
      },
      cohort: {
        playlist,
        mode: cohort.mode || 'global',
        player: cohort.player || null,
        label: cohort.label || 'Pros',
        playerAvailable: cohort.playerAvailable ?? null,
        source: cohort.source,
        isDemo: cohort.isDemo,
        sampleSize: cohort.sampleSize,
        replaysAnalyzed: cohort.replaysAnalyzed || 0,
        updatedAt: cohort.updatedAt,
        stale: cohort.isDemo || !cohort.updatedAt,
      },
      refresh: { ...refreshState },
    },
    ai: publicAiStatus(getAiConfig()),
    settings: getPublicSettings(),
    lastError: state.lastError,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '1.0.0', time: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json(buildStatus());
});

app.get('/api/settings', (req, res) => {
  res.json({
    settings: getPublicSettings(),
    playlists: PLAYLISTS,
    aiProviders: Object.entries(AI_PROVIDERS).map(([id, meta]) => ({
      id,
      label: meta.label,
      requiresKey: meta.requiresKey,
      defaultBaseUrl: meta.defaultBaseUrl,
      defaultModel: meta.defaultModel,
    })),
    reference: currentReference(),
  });
});

app.patch('/api/settings', (req, res) => {
  const patch = req.body || {};
  const before = getSettings();
  const updated = updateSettings(patch);
  const after = getSettings();

  if (patch.playerName !== undefined) tracker.setPlayerName(after.playerName);
  if (patch.host !== undefined || patch.port !== undefined || patch.transport !== undefined) {
    rlClient.configure({ host: after.host, port: after.port, transport: after.transport });
  }

  // Changer de référence pro change tous les diagnostics : on réanalyse.
  const referenceChanged =
    before.referenceMode !== after.referenceMode ||
    String(before.referencePlayer) !== String(after.referencePlayer) ||
    before.targetPlaylist !== after.targetPlaylist;
  let reanalyzed = 0;
  if (referenceChanged) {
    reanalyzed = reanalyzeMatches();
  }

  broadcast('status', { status: buildStatus() });
  res.json({ settings: updated, status: buildStatus(), reanalyzed, reference: currentReference() });
});

app.post('/api/settings/test-token', async (req, res) => {
  const token = (req.body?.token || getBallchasingToken() || '').trim();
  if (!token) {
    res.status(400).json({ ok: false, error: 'Aucun token fourni.' });
    return;
  }
  const result = await checkToken(token);
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/rl/connect', (req, res) => {
  const s = getSettings();
  rlClient.configure({ host: s.host, port: s.port, transport: s.transport });
  rlClient.connect();
  res.json({ ok: true, rl: rlClient.getStatus() });
});

app.post('/api/rl/disconnect', (req, res) => {
  rlClient.disconnect();
  res.json({ ok: true, rl: rlClient.getStatus() });
});

app.get('/api/live', (req, res) => {
  res.json({
    snapshot: tracker.snapshot(),
    rl: rlClient.getStatus(),
    demo: publicDemo(),
  });
});

// ------------------------------- démo --------------------------------------

app.post('/api/demo/start', async (req, res) => {
  if (state.demo.running) {
    res.status(409).json({ ok: false, error: 'Une démonstration est déjà en cours.' });
    return;
  }
  const {
    playlist = getSettings().targetPlaylist || 'ranked-doubles',
    durationSeconds = 240,
    profile = 'ranked',
    speed = 8,
    count = 1,
    seed = Math.floor(Math.random() * 100000),
  } = req.body || {};

  const localName = getSettings().playerName || 'Toi';
  const controller = new AbortController();
  state.demo = {
    running: true,
    progress: 0,
    total: count,
    aborted: false,
    profile,
    controller,
  };

  res.json({ ok: true, demo: { running: true, total: count, profile, playlist } });

  (async () => {
    try {
      for (let i = 0; i < count; i += 1) {
        if (controller.signal.aborted) break;
        tracker.mode = 'demo';
        const result = await playSimulatedMatch({
          playlist,
          durationSeconds,
          localName,
          profile,
          seed: seed + i,
          speed,
          signal: controller.signal,
          onMessage: (message) => {
            try {
              tracker.ingest(message);
              // la démo est une source comme une autre : on diffuse le live
              emitLive();
            } catch (err) {
              console.warn('[demo] message ignoré :', err.message);
            }
          },
        });
        if (result.aborted) break;
        state.demo.progress = i + 1;
        emitLive(true);
        if (i < count - 1) await new Promise((resolve) => setTimeout(resolve, 800));
      }
    } catch (err) {
      console.error('[demo] erreur :', err.message);
      state.lastError = `Démo : ${err.message}`;
    } finally {
      tracker.mode = 'live';
      state.demo = { running: false, progress: state.demo.progress, total: count, aborted: false, profile };
      emitLive(true);
      broadcast('status', { status: buildStatus() });
    }
  })();
});

app.post('/api/demo/stop', (req, res) => {
  if (!state.demo.running) {
    res.json({ ok: true, demo: publicDemo() });
    return;
  }
  state.demo.controller?.abort();
  state.demo.aborted = true;
  res.json({ ok: true, demo: publicDemo() });
});

// ------------------------------ matchs -------------------------------------

app.get('/api/matches', (req, res) => {
  const limit = Math.min(400, Number(req.query.limit) || 100);
  const playlist = req.query.playlist || undefined;
  res.json({ matches: listMatches({ limit, playlist }) });
});

app.get('/api/matches/:id', (req, res) => {
  const match = getMatch(req.params.id);
  if (!match) {
    res.status(404).json({ error: 'Match introuvable.' });
    return;
  }
  res.json({ match });
});

/**
 * Déclare quel joueur du match est le joueur local (« c'est moi »), mémorise le
 * pseudo dans les réglages et réanalyse le match avec le bon profil.
 */
app.post('/api/matches/:id/set-local', (req, res) => {
  const match = getMatch(req.params.id);
  if (!match) {
    res.status(404).json({ error: 'Match introuvable.' });
    return;
  }
  const name = String(req.body?.name || '').trim();
  if (!name) {
    res.status(400).json({ error: 'Nom de joueur manquant.' });
    return;
  }
  const target = match.players.find((p) => p.name === name);
  if (!target) {
    res.status(400).json({ error: `Aucun joueur nommé « ${name} » dans ce match.` });
    return;
  }

  for (const player of match.players) player.isLocal = player === target;
  match.localPlayer = name;
  if (match.winner !== null && match.winner !== undefined) {
    match.result = target.team === match.winner ? 'win' : 'loss';
  }
  match.warnings = (match.warnings || []).filter((warning) => !warning.includes('pseudo'));

  updateSettings({ playerName: name });
  tracker.setPlayerName(name);

  const cohort = cohortFor(match.playlist || 'ranked-doubles');
  const { comparison, coaching } = coachMatch({ match, cohort });
  match.comparison = comparison;
  match.coaching = coaching;
  target.rlCoachScore = coaching.score;
  target.grade = coaching.grade;
  saveMatch(match);
  broadcast('status', { status: buildStatus() });
  res.json({ ok: true, match, summary: summaryOf(match) });
});

app.delete('/api/matches/:id', (req, res) => {
  const removed = deleteMatch(req.params.id);
  res.json({ ok: removed, status: buildStatus() });
});

app.delete('/api/matches', (req, res) => {
  deleteAllMatches();
  res.json({ ok: true, status: buildStatus() });
});

// ------------------------------ coaching -----------------------------------

app.get('/api/coach/overview', (req, res) => {
  const limit = Math.min(50, Number(req.query.limit) || 15);
  const playlist = req.query.playlist || getSettings().targetPlaylist || 'ranked-doubles';
  const rows = listMatches({ limit: 400 })
    .filter((m) => m.playlist === playlist)
    .map((m) => getMatch(m.id))
    .filter(Boolean);
  const cohort = cohortFor(playlist);
  res.json({ overview: coachOverview({ matches: rows, cohort, playlist, limit }) });
});

// ------------------------------- coach IA -----------------------------------

app.get('/api/ai/status', (req, res) => {
  res.json({
    ai: publicAiStatus(getAiConfig()),
    providers: Object.entries(AI_PROVIDERS).map(([id, meta]) => ({
      id,
      label: meta.label,
      requiresKey: meta.requiresKey,
      defaultBaseUrl: meta.defaultBaseUrl,
      defaultModel: meta.defaultModel,
    })),
  });
});

app.post('/api/ai/test', async (req, res) => {
  // Permet de tester une configuration non encore enregistrée.
  const config = { ...getAiConfig(), ...(req.body || {}) };
  const result = await testAi({ config });
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/matches/:id/ai', async (req, res) => {
  const match = getMatch(req.params.id);
  if (!match) {
    res.status(404).json({ ok: false, error: 'Match introuvable.' });
    return;
  }
  if (!match.comparison || !match.coaching) {
    res.status(409).json({ ok: false, error: "Ce match n'a pas encore de diagnostic : réanalyse-le d'abord." });
    return;
  }

  const result = await generateMatchNarrative({
    match,
    comparison: match.comparison,
    coaching: match.coaching,
    config: getAiConfig(),
  });
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error, provider: result.provider, model: result.model });
    return;
  }

  match.ai = {
    narrative: result.narrative,
    provider: result.provider,
    model: result.model,
    generatedAt: result.generatedAt,
    promptVersion: result.promptVersion,
    referenceLabel: match.comparison.referenceLabel || null,
  };
  saveMatch(match);
  broadcast('match-ai', { id: match.id, ai: match.ai });
  res.json({ ok: true, ai: match.ai, match, summary: summaryOf(match) });
});

app.post('/api/coach/ai/overview', async (req, res) => {
  const playlist = req.body?.playlist || getSettings().targetPlaylist || 'ranked-doubles';
  const limit = Math.min(50, Number(req.body?.limit) || 15);
  const rows = listMatches({ limit: 400 })
    .filter((m) => m.playlist === playlist)
    .map((m) => getMatch(m.id))
    .filter(Boolean);
  const overview = coachOverview({ matches: rows, cohort: cohortFor(playlist), playlist, limit });

  const result = await generateOverviewNarrative({ overview, config: getAiConfig() });
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error, provider: result.provider, model: result.model });
    return;
  }
  res.json({
    ok: true,
    ai: {
      narrative: result.narrative,
      provider: result.provider,
      model: result.model,
      generatedAt: result.generatedAt,
      promptVersion: result.promptVersion,
      referenceLabel: overview.referenceLabel || null,
    },
    overview,
  });
});

// --------------------------- référence pro ---------------------------------

app.get('/api/pro/players', (req, res) => {
  const playlist = req.query.playlist || getSettings().targetPlaylist || 'ranked-doubles';
  const known = listKnownPlayers(playlist);
  res.json({
    ...known,
    suggestions: suggestedPlayersFor(),
    reference: currentReference(),
  });
});

app.get('/api/pro/reference', (req, res) => {
  const playlist = req.query.playlist || getSettings().targetPlaylist || 'ranked-doubles';
  const active = currentReference();
  const mode = req.query.mode === 'player' ? 'player' : req.query.mode === 'global' ? 'global' : active.mode;
  const player = mode === 'player' ? String(req.query.player || active.player || '').trim() : null;
  const cohort = getCohort(playlist, { mode, player });
  res.json({
    cohort,
    reference: { mode, player, active, label: cohort.label },
    refresh: { ...refreshState },
  });
});

app.post('/api/pro/refresh', (req, res) => {
  const token = getBallchasingToken();
  if (!token) {
    res.status(400).json({
      ok: false,
      error:
        "Ajoute d'abord ton token API ballchasing dans les réglages (compte gratuit sur ballchasing.com).",
    });
    return;
  }
  const playlist = req.body?.playlist || getSettings().targetPlaylist || 'ranked-doubles';
  const mode = req.body?.mode === 'player' ? 'player' : 'global';
  const player = mode === 'player' ? String(req.body?.player || '').trim() : null;
  if (mode === 'player' && !player) {
    res.status(400).json({ ok: false, error: 'Indique le nom du joueur pro à analyser.' });
    return;
  }
  const size = Number(req.body?.size) || Math.min(40, getSettings().proCohortSize || 30);

  // Lancement en tâche de fond : progression diffusée sur le WebSocket.
  res.json({ ok: true, started: true, playlist, mode, player, size, refresh: { ...refreshState } });
  refreshCohort({
    token,
    playlist,
    size,
    mode,
    player,
    onProgress: (progress) => broadcast('pro-refresh', progress),
  }).then((result) => {
    if (result.ok) {
      // On ne réanalyse que si la référence active vient d'être actualisée.
      const active = currentReference();
      const isActive =
        active.mode === mode &&
        (mode === 'global' || String(active.player).toLowerCase() === String(player).toLowerCase());
      const updated = isActive ? reanalyzeMatches({ playlist }) : 0;
      console.log(
        `[cohort] ${playlist}/${mode}${player ? `:${player}` : ''} -> ${result.cohort.replaysAnalyzed} replays, ${updated} matchs réanalysés`,
      );
      broadcast('pro-refresh', { ...refreshState, ok: true, reanalyzed: updated });
    } else {
      broadcast('pro-refresh', { ...refreshState, ok: false });
    }
    broadcast('status', { status: buildStatus() });
  });
});

// ------------------------- import d'un replay ------------------------------

app.post('/api/replays/import', async (req, res) => {
  const token = getBallchasingToken();
  if (!token) {
    res.status(400).json({
      ok: false,
      error: "Un token ballchasing est nécessaire pour analyser des fichiers .replay.",
    });
    return;
  }
  const { fileName, dataBase64 } = req.body || {};
  if (!fileName || !dataBase64) {
    res.status(400).json({ ok: false, error: 'Fichier manquant (fileName + dataBase64).' });
    return;
  }
  try {
    const buffer = Buffer.from(String(dataBase64).split(',').pop(), 'base64');
    const client = new BallchasingClient({ token, minIntervalMs: BALLCHASING_MIN_INTERVAL_MS });
    const upload = await client.uploadReplay(buffer, path.basename(fileName), { visibility: 'unlisted' });
    if (!upload?.id) throw new Error("ballchasing n'a pas renvoyé d'identifiant de replay.");
    const replay = await client.waitForReplay(upload.id);
    const match = replayToMatch(replay, {
      playerName: getSettings().playerName,
      playlistHint: getSettings().targetPlaylist,
    });
    const cohort = cohortFor(match.playlist || 'ranked-doubles');
    const { comparison, coaching } = coachMatch({ match, cohort });
    match.comparison = comparison;
    match.coaching = coaching;
    const local = match.players.find((p) => p.isLocal);
    if (local) {
      local.rlCoachScore = coaching.score;
      local.grade = coaching.grade;
    }
    saveMatch(match);
    broadcast('match-completed', { match, summary: summaryOf(match), status: buildStatus() });
    res.json({ ok: true, match, summary: summaryOf(match) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// --------------------------- fichiers statiques ----------------------------

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^\/(?!api|live).*/, (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Route inconnue.' });
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

server.listen(SERVER_PORT, '127.0.0.1', () => {
  console.log(`\n  RL Coach - http://localhost:${SERVER_PORT}`);
  console.log(`   API Stats RL attendue sur ${getSettings().host}:${getSettings().port} (${getSettings().transport})`);
  const cohort = cohortFor(getSettings().targetPlaylist || 'ranked-doubles');
  console.log(
    `   Référence pro : ${cohort.isDemo ? 'repères de démarrage (aucune cohorte ballchasing en cache)' : `${cohort.replaysAnalyzed} replays pro`}\n`,
  );


  // Réanalyse l'historique au démarrage : garantit que les matchs enregistrés
  // utilisent la cohorte et les règles courantes.
  try {
    const updated = reanalyzeMatches();
    if (updated) console.log(`   ${updated} match(s) réanalysé(s) avec la référence courante.`);
  } catch (err) {
    console.warn(`   Réanalyse impossible : ${err.message}`);
  }
  if (getSettings().autoConnect) {
    rlClient.connect();
  }
  if (isDemoOnStart()) {
    console.log('   Mode demo : lance un match simule...');
    fetch(`http://127.0.0.1:${SERVER_PORT}/api/demo/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationSeconds: 180, profile: 'ranked', speed: 12 }),
    }).catch(() => {});
  }
});

process.on('SIGINT', () => {
  console.log('\nArrêt⬦');
  rlClient.disconnect();
  server.close(() => process.exit(0));
});

