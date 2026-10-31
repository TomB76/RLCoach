import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DEFAULT_SETTINGS } from './config.js';

const FILES = {
  settings: path.join(DATA_DIR, 'settings.json'),
  matches: path.join(DATA_DIR, 'matches.json'),
  proCache: path.join(DATA_DIR, 'pro-cache.json'),
  state: path.join(DATA_DIR, 'state.json'),
};

const MAX_MATCHES = 400;

let cache = {
  settings: null,
  matches: null,
  proCache: null,
  state: null,
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[store] ${path.basename(file)} illisible (${err.message}) — réinitialisé`);
    return fallback;
  }
}

/** Écriture atomique : tmp + rename, pour ne jamais corrompre le fichier. */
function writeJson(file, value) {
  ensureDataDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------

export function getSettings() {
  if (!cache.settings) {
    const stored = readJson(FILES.settings, {});
    cache.settings = { ...DEFAULT_SETTINGS, ...stored };
    if (typeof cache.settings.port === 'string') cache.settings.port = Number(cache.settings.port);
  }
  return { ...cache.settings };
}

/** Version expédiable au navigateur : le token est remplacé par un booléen. */
export function getPublicSettings() {
  const s = getSettings();
  const { ballchasingToken, aiApiKey, ...rest } = s;
  return {
    ...rest,
    ballchasingToken: '',
    ballchasingTokenSet: Boolean(ballchasingToken && ballchasingToken.trim()),
    aiApiKey: '',
    aiApiKeySet: Boolean(aiApiKey && aiApiKey.trim()),
  };
}

export function updateSettings(patch = {}) {
  const current = getSettings();
  const next = { ...current };
  const allowedKeys = Object.keys(DEFAULT_SETTINGS);
  for (const key of allowedKeys) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (key === 'port') {
      const port = Number(value);
      if (Number.isInteger(port) && port > 0 && port < 65536) next.port = port;
      continue;
    }
    if (key === 'proCohortSize' || key === 'minMatchSeconds' || key === 'matchesPerCycle') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) next[key] = n;
      continue;
    }
    if (key === 'transport') {
      next.transport = value === 'tcp' ? 'tcp' : 'ws';
      continue;
    }
    if (key === 'autoConnect' || key === 'aiAuto') {
      next[key] = value === true || value === 'true';
      continue;
    }
    if (key === 'referenceMode') {
      next.referenceMode = value === 'player' ? 'player' : 'global';
      continue;
    }
    if (key === 'aiProvider') {
      next.aiProvider = ['openai', 'ollama', 'custom'].includes(value) ? value : 'none';
      continue;
    }
    if (value === null || value === undefined) continue;
    next[key] = typeof value === 'string' ? value.trim() : value;
  }
  cache.settings = next;
  writeJson(FILES.settings, next);
  return getPublicSettings();
}

export function getBallchasingToken() {
  const token = getSettings().ballchasingToken;
  return token && token.trim() ? token.trim() : '';
}

export function getAiKey() {
  const key = getSettings().aiApiKey;
  return key && key.trim() ? key.trim() : '';
}

/** Configuration IA effective (clé incluse) — usage serveur uniquement. */
export function getAiConfig() {
  const s = getSettings();
  return {
    provider: s.aiProvider || 'none',
    baseUrl: (s.aiBaseUrl || '').trim(),
    model: (s.aiModel || '').trim(),
    apiKey: getAiKey(),
    auto: Boolean(s.aiAuto),
  };
}

// ---------------------------------------------------------------------------
// Matchs
// ---------------------------------------------------------------------------

function allMatches() {
  if (!cache.matches) {
    const stored = readJson(FILES.matches, []);
    cache.matches = Array.isArray(stored) ? stored : [];
  }
  return cache.matches;
}

export function summaryOf(match) {
  const local = match.players?.find((p) => p.isLocal) || match.players?.[0] || null;
  return {
    id: match.id,
    date: match.date,
    playlist: match.playlist,
    playlistLabel: match.playlistLabel,
    mode: match.mode,
    arena: match.arena,
    durationSeconds: match.durationSeconds,
    result: match.result,
    teamScores: match.teamScores,
    localPlayer: local?.name || match.localPlayer || null,
    localTeam: local?.team ?? null,
    rlCoachScore: local?.rlCoachScore ?? null,
    grade: local?.grade ?? null,
    goals: local?.stats?.core?.goals ?? 0,
    saves: local?.stats?.core?.saves ?? 0,
    shots: local?.stats?.core?.shots ?? 0,
    assists: local?.stats?.core?.assists ?? 0,
    touches: local?.stats?.custom?.touches ?? 0,
    topRecommendation: match.coaching?.recommendations?.[0]?.title ?? null,
  };
}

export function listMatches({ limit = 100, playlist } = {}) {
  let rows = allMatches();
  if (playlist) rows = rows.filter((m) => m.playlist === playlist);
  return rows
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, limit)
    .map(summaryOf);
}

export function getMatch(id) {
  return allMatches().find((m) => m.id === id) || null;
}

export function saveMatch(match) {
  const rows = allMatches();
  const index = rows.findIndex((m) => m.id === match.id);
  if (index >= 0) rows[index] = match;
  else rows.unshift(match);
  if (rows.length > MAX_MATCHES) {
    const removed = rows.splice(MAX_MATCHES);
    for (const r of removed) console.log(`[store] match ${r.id} purgé (limite ${MAX_MATCHES})`);
  }
  writeJson(FILES.matches, rows);
  return match;
}

export function deleteMatch(id) {
  const rows = allMatches();
  const next = rows.filter((m) => m.id !== id);
  const removed = next.length !== rows.length;
  if (removed) {
    cache.matches = next;
    writeJson(FILES.matches, next);
  }
  return removed;
}

export function deleteAllMatches() {
  cache.matches = [];
  writeJson(FILES.matches, []);
}

// ---------------------------------------------------------------------------
// Cache des données pro (ballchasing)
// ---------------------------------------------------------------------------

function proCache() {
  if (!cache.proCache) {
    const stored = readJson(FILES.proCache, {});
    cache.proCache = stored && typeof stored === 'object' ? stored : {};
  }
  return cache.proCache;
}

export function getProCache(key) {
  return proCache()[key] || null;
}

export function setProCache(key, value) {
  const store = proCache();
  store[key] = value;
  writeJson(FILES.proCache, store);
  return value;
}

// ---------------------------------------------------------------------------
// État du tracker (persisté pour survivre à un redémarrage)
// ---------------------------------------------------------------------------

export function saveTrackerState(state) {
  cache.state = state;
  writeJson(FILES.state, state);
}

export function getTrackerState() {
  if (!cache.state) cache.state = readJson(FILES.state, null);
  return cache.state;
}

export const DATA_FILES = FILES;
