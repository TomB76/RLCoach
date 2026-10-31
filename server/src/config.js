import fs from 'node:fs';
import path from 'node:path';

/** Racine du projet. */
export const ROOT = path.resolve(import.meta.dirname, '../..');

// .env optionnel (Node >= 20.12 : process.loadEnvFile)
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (err) {
    console.warn(`[config] .env illisible : ${err.message}`);
  }
}

export const DATA_DIR = process.env.RL_COACH_DATA_DIR
  ? path.resolve(process.env.RL_COACH_DATA_DIR)
  : path.join(ROOT, 'data');

export const DIST_DIR = path.join(ROOT, 'dist');

export const SERVER_PORT = Number(process.env.PORT || 4317);

export const BALLCHASING_MIN_INTERVAL_MS = Number(process.env.BALLCHASING_MIN_INTERVAL_MS || 550);

export const PLAYLISTS = {
  'ranked-duels': { label: '1v1 (Duel)', teamSize: 1, short: '1v1' },
  'ranked-doubles': { label: '2v2 (Doubles)', teamSize: 2, short: '2v2' },
  'ranked-standard': { label: '3v3 (Standard)', teamSize: 3, short: '3v3' },
  'ranked-hoops': { label: 'Hoops', teamSize: 2, short: 'Hoops' },
  'ranked-dropshot': { label: 'Dropshot', teamSize: 3, short: 'Dropshot' },
  'ranked-snowday': { label: 'Rumble', teamSize: 3, short: 'Rumble' },
};

/**
 * Paramètres par défaut. Ils peuvent être écrasés par .env au premier lancement,
 * puis par data/settings.json (modifiable depuis l'UI).
 */
export const DEFAULT_SETTINGS = {
  /** Pseudo in-game du joueur à analyser (ex. "Tom"). */
  playerName: '',
  /** Token API ballchasing.com (jamais renvoyé au client en clair). */
  ballchasingToken: process.env.BALLCHASING_TOKEN || '',
  /** API Stats locale de Rocket League. */
  host: process.env.RL_STATS_HOST || '127.0.0.1',
  port: Number(process.env.RL_STATS_PORT || 49123),
  transport: process.env.RL_STATS_TRANSPORT === 'tcp' ? 'tcp' : 'ws',
  autoConnect: String(process.env.RL_AUTO_CONNECT ?? 'true') !== 'false',
  /** Mode de jeu de référence pour la comparaison pro. */
  targetPlaylist: 'ranked-doubles',
  /** Nombre de replays pros agrégés par mode pour construire la cohorte. */
  proCohortSize: Number(process.env.PRO_COHORT_SIZE || 120),
  /** Durée minimale (s) pour qu'un match soit enregistré. */
  minMatchSeconds: 60,
  /** Objectif : nombre de matchs à analyser pour un cycle de coaching. */
  matchesPerCycle: 10,
};

export function envDefaults() {
  return { ...DEFAULT_SETTINGS };
}

export function isDemoOnStart() {
  return String(process.env.DEMO_ON_START ?? 'false') === 'true';
}
