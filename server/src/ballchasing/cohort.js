/**
 * Construction et cache des références pro.
 *
 * Deux modes de référence :
 *  - « global »  : cohorte agrégée de tous les joueurs pros analysés (coach global) ;
 *  - « player »  : cohorte mono-joueur, calculée uniquement sur ses propres replays.
 *
 * Dans les deux cas on stocke des distributions (p10 → p90) par métrique, ce qui
 * permet de comparer un match exactement de la même façon.
 *
 * Les clés de métriques suivent ballchasing (`boost.percentZeroBoost`…).
 */

import { BALLCHASING_MIN_INTERVAL_MS, PLAYLISTS } from '../config.js';
import { getProCache, listProCacheEntries, setProCache } from '../store.js';
import { BallchasingClient } from './client.js';
import { METRICS, metricValue, summarize } from '../coach/metrics.js';
import { buildSeedCohort } from '../coach/seedBenchmarks.js';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const MAX_REPLAYS_PER_REFRESH = 60;

/** État du rafraîchissement en cours (exposé à l'UI). */
export const refreshState = {
  running: false,
  playlist: null,
  mode: 'global',
  player: null,
  done: 0,
  total: 0,
  error: null,
  startedAt: null,
  finishedAt: null,
  source: null,
};

/** Identifiant de cache stable pour un nom de joueur. */
export function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

/** Identifiant stable d'un joueur ballchasing (`{platform, id}` -> `platform:id`). */
export function playerKey(id) {
  if (!id) return null;
  if (typeof id === 'string') return id;
  if (typeof id === 'object' && id.id) return `${id.platform || 'unknown'}:${id.id}`;
  return null;
}

/**
 * Extrait les joueurs d'un replay ballchasing.
 *
 * L'API ne renvoie PAS de tableau `players` a la racine : les rosters sont dans
 * `replay.blue.players` et `replay.orange.players` (chacun avec ses `stats`,
 * `mvp` et `id {platform,id}`). C'est la cause du bug « aucun replay exploitable ».
 */
export function extractPlayers(replay) {
  const rows = [];
  for (const [side, team] of [
    ['blue', 0],
    ['orange', 1],
  ]) {
    const roster = replay?.[side]?.players;
    if (!Array.isArray(roster)) continue;
    for (const player of roster) {
      if (!player) continue;
      const name = String(player.name || '').trim() || 'Inconnu';
      rows.push({
        name,
        key: playerKey(player.id) || `name:${normalizeName(name)}`,
        team,
        stats: player.stats || null,
        mvp: Boolean(player.mvp || player.stats?.core?.mvp),
      });
    }
  }
  return rows;
}

/** Buts d'une equipe dans un replay ballchasing (blue/orange). */
export function teamGoals(replay, side) {
  const core = replay?.[side]?.stats?.core;
  if (!core) return 0;
  if (Number.isFinite(core.goals_for)) return core.goals_for;
  if (Number.isFinite(core.goals)) return core.goals;
  return 0;
}

/** Similarite de pseudos par jetons communs (0 -> 1). */
export function nameSimilarity(a, b) {
  const tokenize = (value) =>
    normalizeName(value)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
  const left = tokenize(a);
  const right = tokenize(b);
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const common = left.filter((token) => rightSet.has(token)).length;
  return common / Math.max(left.length, right.length);
}

/** Seuil de similarite en dessous duquel on refuse d'attribuer un pseudo. */
export const ALIAS_THRESHOLD = 0.5;

/**
 * Identifie le joueur cible dans les rosters.
 *
 * Ballchasing associe un joueur a plusieurs noms de compte (« M0nkey M00n »
 * apparait par exemple comme « L4rpey M00n » ou « SH33PY M00N »). On resout :
 *  1. par nom exact ;
 *  2. sinon par alias : tous les ids dont un nom atteint le seuil de similarite ;
 *  3. sinon echec explicite (`method: 'none'`) en listant les pseudos rencontres.
 */
export function resolveTargetPlayer(rosters, playerName) {
  const wanted = normalizeName(playerName);
  const candidates = new Map();

  for (const roster of rosters) {
    for (const player of roster) {
      if (!candidates.has(player.key)) {
        candidates.set(player.key, { key: player.key, names: new Set(), replays: 0 });
      }
      const entry = candidates.get(player.key);
      entry.names.add(player.name);
      entry.replays += 1;
    }
  }

  const seenNames = [...new Set([...candidates.values()].flatMap((entry) => [...entry.names]))];

  const exact = [...candidates.values()].filter((entry) =>
    [...entry.names].some((name) => normalizeName(name) === wanted),
  );
  if (exact.length) {
    return {
      method: 'exact',
      keys: new Set(exact.map((entry) => entry.key)),
      matchedNames: [...new Set(exact.flatMap((entry) => [...entry.names]))],
      seenNames,
      similarity: 1,
    };
  }

  const scored = [...candidates.values()]
    .map((entry) => ({
      ...entry,
      similarity: Math.max(...[...entry.names].map((name) => nameSimilarity(name, playerName))),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  const best = scored[0]?.similarity ?? 0;
  if (best >= ALIAS_THRESHOLD) {
    const retained = scored.filter((entry) => entry.similarity >= ALIAS_THRESHOLD);
    return {
      method: 'alias',
      keys: new Set(retained.map((entry) => entry.key)),
      matchedNames: [...new Set(retained.flatMap((entry) => [...entry.names]))],
      seenNames,
      similarity: Math.round(best * 100) / 100,
    };
  }

  return {
    method: 'none',
    keys: new Set(),
    matchedNames: [],
    seenNames,
    similarity: Math.round(best * 100) / 100,
  };
}

/**
 * Clé de cache d'une référence.
 * - global  → `cohort:<playlist>`
 * - joueur  → `cohort:<playlist>:player:<slug>`
 */
export function cohortKey(playlist, mode = 'global', player = null) {
  if (mode === 'player' && player) return `cohort:${playlist}:player:${slugify(player)}`;
  return `cohort:${playlist}`;
}

/** Référence de secours : repères de démarrage, marqués comme tels. */
export function fallbackCohort(playlist, { mode = 'global', player = null } = {}) {
  const seed = buildSeedCohort(playlist || 'ranked-doubles');
  return {
    ...seed,
    mode,
    player: mode === 'player' ? player : null,
    label: mode === 'player' ? `${player} (aucun replay analysé)` : 'Pros — repères de démarrage',
    playerAvailable: mode === 'player' ? false : null,
  };
}

/**
 * Retourne la référence active : cache valide, sinon repères de démarrage.
 */
export function getCohort(playlist = 'ranked-doubles', { mode = 'global', player = null, allowStale = true } = {}) {
  const key = cohortKey(playlist, mode, player);
  const cached = getProCache(key);
  if (cached && (allowStale || !isStale(cached))) {
    return { ...cached, mode, player: mode === 'player' ? player : null };
  }
  return fallbackCohort(playlist, { mode, player });
}

/** Indique si une cohorte est absente ou trop ancienne. */
export function isStale(cohort) {
  if (!cohort?.updatedAt) return true;
  return Date.now() - new Date(cohort.updatedAt).getTime() > CACHE_TTL_MS;
}

/**
 * Agrège une liste de replays ballchasing en une cohorte de distributions.
 *
 * @param {object[]} replays replays ballchasing (avec `players[].stats`)
 * @param {object} options
 * @param {string} options.playlist
 * @param {string} [options.source]
 * @param {'global'|'player'} [options.mode]
 * @param {string|null} [options.playerName] si fourni, on ne garde que ce joueur
 */
export function buildCohortFromReplays(
  replays,
  { playlist, source = 'ballchasing', mode = 'global', playerName = null } = {},
) {
  // 1) Ne garder que les replays exploitables (rosters lus dans blue/orange).
  const usable = [];
  for (const replay of replays) {
    if (!replay || replay.status === 'pending') continue;
    const duration = Number(replay.duration) || 0;
    if (duration < 45) continue;
    const roster = extractPlayers(replay);
    if (roster.length < 2) continue;
    usable.push({
      replay,
      duration,
      teamSize: Number(replay.team_size) || Math.max(1, Math.floor(roster.length / 2)),
      roster,
    });
  }

  // 2) En mode mono-joueur, identifier le joueur (nom exact ou alias connus).
  const isPlayerMode = mode === 'player';
  const resolution = isPlayerMode
    ? resolveTargetPlayer(usable.map((entry) => entry.roster), playerName)
    : { method: 'global', keys: null, matchedNames: [], seenNames: [], similarity: null };

  const buckets = new Map(METRICS.map((metric) => [metric.key, []]));
  const players = new Map();
  let usableReplays = 0;
  const replayIndex = [];

  for (const { replay, duration, teamSize, roster } of usable) {
    let counted = false;
    for (const player of roster) {
      if (!players.has(player.key)) {
        players.set(player.key, { name: player.name, id: player.key, replays: new Set(), matches: 0, lastSeen: null });
      }
      const entry = players.get(player.key);
      entry.replays.add(replay.id);
      if (!entry.lastSeen || String(replay.date) > String(entry.lastSeen)) entry.lastSeen = replay.date;

      const isTarget = !isPlayerMode || (resolution.keys && resolution.keys.has(player.key));
      if (!isTarget) continue;

      const stats = player.stats;
      if (!stats?.core || !stats?.movement || !stats?.positioning) continue;

      const normalized = normalizeBallchasingStats(stats, duration);
      for (const metric of METRICS) {
        if (teamSize === 1 && metric.key === 'positioning.avgDistanceToTeammates') continue;
        if (teamSize === 1 && metric.key === 'core.assistsPerMinute') continue;
        const value = metricValue(metric, normalized, duration);
        if (Number.isFinite(value)) buckets.get(metric.key).push(value);
      }
      entry.matches += 1;
      counted = true;
    }

    if (counted) {
      usableReplays += 1;
      replayIndex.push({
        id: replay.id,
        date: replay.date,
        playlist: replay.playlist,
        duration,
        teamSize,
      });
    }
  }

  const metrics = {};
  for (const metric of METRICS) {
    const summary = summarize(buckets.get(metric.key) || []);
    if (summary) metrics[metric.key] = summary;
  }
  const totalSamples = Object.values(metrics).reduce((acc, item) => acc + (item.count || 0), 0);
  const performances = [...players.values()].reduce((acc, entry) => acc + entry.matches, 0);

  const quality = usableReplays >= 15 ? 'good' : usableReplays >= 5 ? 'fair' : 'low';
  const qualityNote =
    quality === 'good'
      ? ''
      : quality === 'fair'
        ? ' Échantillon modéré : les percentiles restent indicatifs.'
        : ' Échantillon faible : interprète les percentiles avec prudence (idéalement 15 replays ou plus).';

  const aliasNote =
    isPlayerMode && resolution.method === 'alias'
      ? ` Pseudos rencontrés pour ce joueur : ${resolution.matchedNames.join(', ')} (alias du même compte ballchasing).`
      : '';

  const note =
    (isPlayerMode
      ? `Référence mono-joueur : ${usableReplays} replay(s) pour ${playerName} (${performances} performance(s) mesurée(s)).`
      : `Cohorte globale construite sur ${usableReplays} replays pro (${players.size} joueurs).`) +
    aliasNote +
    qualityNote;

  const playerIndex = [...players.values()]
    .map((entry) => ({
      name: entry.name,
      id: entry.id,
      replays: entry.replays.size,
      matches: entry.matches,
      lastSeen: entry.lastSeen,
    }))
    .sort((a, b) => b.replays - a.replays);

  return {
    playlist,
    playlistLabel: PLAYLISTS[playlist]?.label || playlist,
    source,
    mode,
    player: isPlayerMode ? playerName : null,
    label: isPlayerMode ? playerName : 'Pros (cohorte globale)',
    quality,
    playerAvailable: isPlayerMode ? usableReplays > 0 : null,
    isDemo: false,
    updatedAt: new Date().toISOString(),
    sampleSize: totalSamples,
    playersAnalyzed: isPlayerMode ? (resolution.keys?.size ?? 0) : players.size,
    replaysAnalyzed: usableReplays,
    replays: replayIndex,
    playerIndex,
    resolution: {
      method: resolution.method,
      similarity: resolution.similarity,
      matchedNames: resolution.matchedNames,
      seenNames: resolution.seenNames.slice(0, 12),
      unresolved: isPlayerMode && resolution.method === 'none',
    },
    metrics,
    note,
  };
}

/**
 * Rafraîchit une référence depuis ballchasing (tâche appelée par l'API).
 *
 * @param {object} params
 * @param {string} params.token token API ballchasing
 * @param {string} params.playlist
 * @param {number} params.size nombre de replays à analyser
 * @param {'global'|'player'} [params.mode]
 * @param {string|null} [params.player]
 * @param {(progress: object) => void} [params.onProgress]
 */
export async function refreshCohort({
  token = '',
  playlist = 'ranked-doubles',
  size = 30,
  mode = 'global',
  player = null,
  onProgress = null,
} = {}) {
  if (refreshState.running) {
    return { ok: false, error: 'Une actualisation est déjà en cours.' };
  }
  const isPlayerMode = mode === 'player';
  if (isPlayerMode && !String(player || '').trim()) {
    return { ok: false, error: 'Indique le nom du joueur pro à analyser.' };
  }
  const count = Math.max(5, Math.min(MAX_REPLAYS_PER_REFRESH, Number(size) || 30));

  Object.assign(refreshState, {
    running: true,
    playlist,
    mode,
    player: isPlayerMode ? player : null,
    done: 0,
    total: count,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    source: null,
  });

  const client = new BallchasingClient({ token, minIntervalMs: BALLCHASING_MIN_INTERVAL_MS });

  try {
    const notify = () => onProgress?.({ ...refreshState });

    let list;
    let source;
    if (isPlayerMode) {
      list = await client.listPlayerReplays({ playlist, count, playerName: player, pro: true });
      source = 'ballchasing:player-pro';
      if (!list.length) {
        list = await client.listPlayerReplays({ playlist, count, playerName: player, pro: false });
        source = 'ballchasing:player-any';
      }
      if (!list.length) {
        throw new Error(
          `Aucun replay trouvé pour « ${player} » en ${PLAYLISTS[playlist]?.label || playlist}. Vérifie l'orthographe exacte du pseudo (tel qu'il apparaît sur ballchasing).`,
        );
      }
    } else {
      list = await client.listProReplays({ playlist, count });
      source = 'ballchasing:pro';
      if (!list.length) {
        // Repli : pas de matchs étiquetés pro → on prend les plus hauts rangs.
        list = await client.listProReplays({ playlist, count, pro: false, minRank: 'grand-champion' });
        source = 'ballchasing:grand-champion';
      }
      if (!list.length) {
        throw new Error("Aucun replay trouvé sur ballchasing pour ce mode. Vérifie le token et le mode sélectionné.");
      }
    }

    refreshState.total = Math.min(count, list.length);
    notify();

    const replays = [];
    for (const entry of list.slice(0, refreshState.total)) {
      try {
        const replay = await client.getReplay(entry.id);
        replays.push(replay);
      } catch (err) {
        // Un replay indisponible ne doit pas bloquer toute la cohorte.
        console.warn(`[cohort] replay ${entry.id} ignoré : ${err.message}`);
      }
      refreshState.done += 1;
      notify();
    }

    const cohort = buildCohortFromReplays(replays, {
      playlist,
      source,
      mode,
      playerName: isPlayerMode ? player : null,
    });

    if (!cohort.replaysAnalyzed) {
      throw new Error(buildEmptyCohortMessage({ isPlayerMode, player, replays, list, cohort }));
    }

    setProCache(cohortKey(playlist, mode, player), cohort);
    Object.assign(refreshState, {
      running: false,
      finishedAt: new Date().toISOString(),
      source,
      done: refreshState.done,
    });
    notify();
    return { ok: true, cohort, state: { ...refreshState } };
  } catch (err) {
    Object.assign(refreshState, {
      running: false,
      error: err.message,
      finishedAt: new Date().toISOString(),
    });
    onProgress?.({ ...refreshState });
    return { ok: false, error: err.message, state: { ...refreshState } };
  }
}

/** Vérifie qu'un token ballchasing est valide (GET /replays, 1 résultat). */
export async function checkToken(token) {
  const client = new BallchasingClient({ token, minIntervalMs: 0 });
  try {
    await client.request('/replays?count=1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message, status: err.status ?? null };
  }
}

/**
 * Joueurs pros connus pour un mode, d'après la cohorte globale en cache.
 * Sert de source au sélecteur « prendre X comme coach ».
 */
export function listKnownPlayers(playlist = 'ranked-doubles') {
  const global = getProCache(cohortKey(playlist, 'global', null));
  const players = mergeKnownPlayers(playlist, global?.playerIndex || [], listProCacheEntries());
  return {
    playlist,
    playlistLabel: PLAYLISTS[playlist]?.label || playlist,
    source: global ? 'cohorte globale' : 'aucune cohorte globale en cache',
    updatedAt: global?.updatedAt || null,
    players,
  };
}

/**
 * Fusionne l'index de la cohorte globale et les cohortes mono-joueur en cache.
 *
 * L'index global ne contient que les joueurs des replays agrégés : un joueur
 * dont on a demandé la cohorte (recherche par nom) peut en être absent. Les
 * deux sources sont donc réunies, et seules les cohortes réellement mesurées
 * sont marquées `hasCohort` — le reste de l'index n'est pas une liste de pros.
 */
export function mergeKnownPlayers(playlist, index = [], entries = []) {
  const prefix = `cohort:${playlist}:player:`;
  const cachedBySlug = new Map();
  for (const { key, value } of entries) {
    if (!key || !key.startsWith(prefix) || !value) continue;
    cachedBySlug.set(key.slice(prefix.length), value);
  }

  const byName = new Map();
  for (const entry of index) {
    if (!entry?.name) continue;
    byName.set(entry.name, { ...entry, hasCohort: false, cohortReplays: 0, cohortUpdatedAt: null });
  }

  // 1) cohortes correspondant à un joueur de l'index global (résolution par slug)
  for (const entry of byName.values()) {
    const cached = cachedBySlug.get(slugify(entry.name));
    if (!cached) continue;
    entry.hasCohort = true;
    entry.cohortReplays = Number(cached.replaysAnalyzed) || 0;
    entry.cohortUpdatedAt = cached.updatedAt || null;
  }

  // 2) cohortes isolées : le joueur n'apparaît pas dans l'échantillon global
  for (const cached of cachedBySlug.values()) {
    const name = String(cached.player || '').trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, {
      name,
      id: null,
      replays: 0,
      matches: 0,
      lastSeen: cached.updatedAt || null,
      hasCohort: true,
      cohortReplays: Number(cached.replaysAnalyzed) || 0,
      cohortUpdatedAt: cached.updatedAt || null,
    });
  }

  return [...byName.values()].sort(
    (a, b) => (b.cohortReplays || 0) - (a.cohortReplays || 0) || (b.replays || 0) - (a.replays || 0),
  );
}

/**
 * Convertit un replay ballchasing (uploadé ou récupéré) en match analysable
 * par le moteur de coaching.
 */
export function replayToMatch(replay, { playerName = '', playlistHint = null } = {}) {
  const duration = Number(replay.duration) || 0;
  const blueGoals = teamGoals(replay, 'blue');
  const orangeGoals = teamGoals(replay, 'orange');
  const winner = blueGoals === orangeGoals ? null : blueGoals > orangeGoals ? 0 : 1;
  const roster = extractPlayers(replay);

  // Joueur local : nom exact, sinon alias le plus proche (même seuil que la cohorte).
  const wanted = normalizeName(playerName);
  let localKey = null;
  if (playerName) {
    const exact = roster.find((player) => normalizeName(player.name) === wanted);
    if (exact) {
      localKey = exact.key;
    } else {
      const best = roster
        .map((player) => ({ player, score: nameSimilarity(player.name, playerName) }))
        .sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= ALIAS_THRESHOLD) localKey = best.player.key;
    }
  }

  const players = roster.map((player) => ({
    id: player.key,
    name: player.name,
    team: player.team,
    isLocal: player.key === localKey,
    stats: normalizeBallchasingStats(player.stats || {}, duration),
    rlCoachScore: null,
    grade: null,
  }));

  const local = players.find((player) => player.isLocal) || null;
  const result = winner === null || !local ? 'unknown' : local.team === winner ? 'win' : 'loss';

  return {
    id: `bc-${replay.id}`,
    guid: replay.id,
    date: replay.date || new Date().toISOString(),
    mode: 'ballchasing',
    playlist: replay.playlist || playlistHint || 'ranked-doubles',
    playlistLabel: PLAYLISTS[replay.playlist]?.label || replay.playlist,
    arena: replay.map_name || replay.map_code || null,
    durationSeconds: duration,
    teamScores: { 0: blueGoals, 1: orangeGoals },
    winner,
    result,
    localPlayer: local?.name || playerName || null,
    players,
    goals: [],
    events: [],
    source: 'ballchasing',
    externalId: replay.id,
    ballchasingUrl: `https://ballchasing.com/replay/${replay.id}`,
    warnings: local ? [] : ['Aucun joueur ne correspond à ton pseudo : renseigne-le dans les réglages.'],
    comparison: null,
    coaching: null,
  };
}

/** Normalise les stats ballchasing (snake_case) au format interne. */
function normalizeBallchasingStats(stats = {}, duration = 0) {
  return {
    core: {
      shots: stats.core?.shots ?? 0,
      goals: stats.core?.goals ?? 0,
      saves: stats.core?.saves ?? 0,
      assists: stats.core?.assists ?? 0,
      score: stats.core?.score ?? 0,
      shootingPercentage: stats.core?.shooting_percentage ?? 0,
      mvp: Boolean(stats.core?.mvp),
    },
    boost: {
      bpm: stats.boost?.bpm ?? 0,
      avgAmount: stats.boost?.avg_amount ?? 0,
      amountCollected: stats.boost?.amount_collected ?? 0,
      amountStolen: stats.boost?.amount_stolen ?? 0,
      amountCollectedBig: stats.boost?.amount_collected_big ?? 0,
      amountCollectedSmall: stats.boost?.amount_collected_small ?? 0,
      countCollectedBig: stats.boost?.count_collected_big ?? 0,
      countCollectedSmall: stats.boost?.count_collected_small ?? 0,
      timeZeroBoost: stats.boost?.time_zero_boost ?? 0,
      timeFullBoost: stats.boost?.time_full_boost ?? 0,
      percentZeroBoost: stats.boost?.percent_zero_boost ?? 0,
      percentFullBoost: stats.boost?.percent_full_boost ?? 0,
      percentBoosting: stats.boost?.percent_boost_0_25 ?? 0,
    },
    movement: {
      avgSpeed: stats.movement?.avg_speed ?? 0,
      totalDistance: stats.movement?.total_distance ?? 0,
      timeSupersonicSpeed: stats.movement?.time_supersonic_speed ?? 0,
      percentSupersonicSpeed: stats.movement?.percent_supersonic_speed ?? 0,
      timeSlowSpeed: stats.movement?.time_slow_speed ?? 0,
      percentSlowSpeed: stats.movement?.percent_slow_speed ?? 0,
      timeBoostSpeed: stats.movement?.time_boost_speed ?? 0,
      percentBoostSpeed: stats.movement?.percent_boost_speed ?? 0,
      timeFastSpeed: stats.movement?.time_fast_speed ?? 0,
      percentFastSpeed: stats.movement?.percent_fast_speed ?? 0,
      timeGround: stats.movement?.time_ground ?? 0,
      percentGround: stats.movement?.percent_ground ?? 0,
      timeLowAir: stats.movement?.time_low_air ?? 0,
      percentLowAir: stats.movement?.percent_low_air ?? 0,
      timeHighAir: stats.movement?.time_high_air ?? 0,
      percentHighAir: stats.movement?.percent_high_air ?? 0,
      avgSpeedPerMinute: 0,
    },
    positioning: {
      avgDistanceToBall: stats.positioning?.avg_distance_to_ball ?? 0,
      avgDistanceToBallPossession: stats.positioning?.avg_distance_to_ball_possession ?? 0,
      avgDistanceToBallNoPossession: stats.positioning?.avg_distance_to_ball_no_possession ?? 0,
      avgDistanceToTeammates: stats.positioning?.avg_distance_to_mates ?? 0,
      percentDefensiveHalf: stats.positioning?.percent_defensive_half ?? 0,
      percentOffensiveHalf: stats.positioning?.percent_offensive_half ?? 0,
      percentDefensiveThird: stats.positioning?.percent_defensive_third ?? 0,
      percentNeutralThird: stats.positioning?.percent_neutral_third ?? 0,
      percentOffensiveThird: stats.positioning?.percent_offensive_third ?? 0,
      percentBehindBall: stats.positioning?.percent_behind_ball ?? 0,
      percentAheadOfBall: 0,
      percentLastMan: 0,
    },
    demo: {
      inflicted: stats.demo?.inflicted ?? 0,
      taken: stats.demo?.taken ?? 0,
    },
    custom: {
      // ballchasing n'expose pas les touches : on laisse `null` pour que le
      // moteur ignore ces métriques au lieu de les compter comme nulles.
      touches: null,
      carTouches: null,
      touchesPerMinute: null,
      ballHits: null,
      aerialHits: null,
      aerialHitPercent: null,
      ballCarryPercent: null,
      kickoffFirstTouches: null,
      crossbarHits: null,
      timeDemolished: null,
      boostStolenShare: null,
    },
    meta: {
      activeSeconds: duration || null,
      minutes: null,
      samples: 0,
    },
  };
}

/**
 * Message d'erreur explicite quand aucun replay n'est exploitable.
 *
 * On distingue les causes pour ne pas laisser l'utilisateur devant un message
 * muet : replays illisibles, stats absentes, ou joueur introuvable dans les
 * rosters (on liste alors les pseudos réellement rencontrés).
 */
function buildEmptyCohortMessage({ isPlayerMode, player, replays, list, cohort }) {
  const read = replays.length;
  const total = Array.isArray(list) ? list.length : read;
  if (!isPlayerMode) {
    return `Les replays récupérés ne contiennent pas assez de statistiques exploitables (${read} replay(s) lu(s) sur ${total}). Réessaie dans un instant ou choisis un autre mode.`;
  }
  const seen = cohort?.resolution?.seenNames || [];
  const seenText = seen.length
    ? ` Pseudos rencontrés : ${seen.slice(0, 8).join(', ')}.`
    : '';
  return `Aucun replay exploitable pour « ${player} » (${read} replay(s) lu(s) sur ${total}).${seenText} Vérifie l'orthographe exacte du pseudo tel qu'il apparaît sur ballchasing.`;
}
