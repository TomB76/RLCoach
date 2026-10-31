/**
 * Repères pros de démarrage.
 *
 * ⚠️ Ces valeurs sont des ORDRES DE GRANDEUR par mode, embarqués pour que
 * l'application soit utilisable avant le premier appel à ballchasing. Elles ne
 * sont pas calculées sur une cohorte : l'interface les marque explicitement
 * comme « repères de démarrage ». Dès que tu renseignes un token ballchasing et
 * lances une actualisation, les vraies distributions (p10 → p90) remplacent ces
 * valeurs pour chaque joueur pro analysé.
 */

import { METRICS } from './metrics.js';

/** Médianes « par joueur et par match » pour un pro, par mode. */
const MEDIANS = {
  'ranked-doubles': {
    'core.goalsPerMinute': 0.42,
    'core.assistsPerMinute': 0.27,
    'core.savesPerMinute': 0.33,
    'core.shotsPerMinute': 1.15,
    'core.shootingPercentage': 27,
    'boost.bpm': 430,
    'boost.percentZeroBoost': 3.5,
    'boost.avgAmount': 33,
    'boost.stolenPerMinute': 65,
    'movement.avgSpeed': 1620,
    'movement.percentSupersonicSpeed': 19,
    'movement.percentSlowSpeed': 21,
    'movement.percentHighAir': 14,
    'positioning.avgDistanceToBall': 2050,
    'positioning.percentOffensiveThird': 35,
    'positioning.percentDefensiveThird': 30,
    'positioning.avgDistanceToTeammates': 2350,
    'demo.inflictedPerMinute': 0.42,
    'demo.takenPerMinute': 0.4,
    'custom.touchesPerMinute': 22,
    'custom.aerialHitPercent': 21,
  },
  'ranked-standard': {
    'core.goalsPerMinute': 0.33,
    'core.assistsPerMinute': 0.26,
    'core.savesPerMinute': 0.36,
    'core.shotsPerMinute': 0.95,
    'core.shootingPercentage': 26,
    'boost.bpm': 405,
    'boost.percentZeroBoost': 4.2,
    'boost.avgAmount': 31,
    'boost.stolenPerMinute': 58,
    'movement.avgSpeed': 1570,
    'movement.percentSupersonicSpeed': 17,
    'movement.percentSlowSpeed': 23,
    'movement.percentHighAir': 13,
    'positioning.avgDistanceToBall': 2300,
    'positioning.percentOffensiveThird': 33,
    'positioning.percentDefensiveThird': 31,
    'positioning.avgDistanceToTeammates': 2750,
    'demo.inflictedPerMinute': 0.72,
    'demo.takenPerMinute': 0.78,
    'custom.touchesPerMinute': 18,
    'custom.aerialHitPercent': 19,
  },
  'ranked-duels': {
    'core.goalsPerMinute': 0.5,
    'core.assistsPerMinute': 0.04,
    'core.savesPerMinute': 0.52,
    'core.shotsPerMinute': 1.3,
    'core.shootingPercentage': 30,
    'boost.bpm': 470,
    'boost.percentZeroBoost': 3,
    'boost.avgAmount': 36,
    'boost.stolenPerMinute': 85,
    'movement.avgSpeed': 1700,
    'movement.percentSupersonicSpeed': 22,
    'movement.percentSlowSpeed': 18,
    'movement.percentHighAir': 16,
    'positioning.avgDistanceToBall': 1800,
    'positioning.percentOffensiveThird': 48,
    'positioning.percentDefensiveThird': 25,
    'positioning.avgDistanceToTeammates': 0,
    'demo.inflictedPerMinute': 0.3,
    'demo.takenPerMinute': 0.3,
    'custom.touchesPerMinute': 28,
    'custom.aerialHitPercent': 24,
  },
};

/** Multiplicateurs p10 / p90 par métrique (asymétrie de la distribution). */
const SPREAD = {
  'boost.percentZeroBoost': [0.35, 3.0],
  'core.shootingPercentage': [0.5, 1.6],
  'core.goalsPerMinute': [0.5, 1.8],
  'core.assistsPerMinute': [0.4, 1.9],
  'core.savesPerMinute': [0.55, 1.7],
  'core.shotsPerMinute': [0.6, 1.5],
  'positioning.avgDistanceToBall': [0.75, 1.28],
  'movement.percentSlowSpeed': [0.6, 1.6],
  'demo.inflictedPerMinute': [0.2, 2.4],
  'demo.takenPerMinute': [0.2, 2.4],
  'custom.aerialHitPercent': [0.45, 1.7],
  'boost.stolenPerMinute': [0.55, 1.6],
  'movement.percentHighAir': [0.55, 1.55],
};

const DEFAULT_SPREAD = [0.78, 1.24];

export const SEED_PLAYLISTS = Object.keys(MEDIANS);

/** Construit une pseudo-cohorte à partir des repères, au format des cohortes réelles. */
export function buildSeedCohort(playlist = 'ranked-doubles') {
  const medians = MEDIANS[playlist] || MEDIANS['ranked-doubles'];
  const metrics = {};
  for (const metric of METRICS) {
    const p50 = medians[metric.key];
    if (!Number.isFinite(p50)) continue;
    const [low, high] = SPREAD[metric.key] || DEFAULT_SPREAD;
    const p10 = round(p50 * low);
    const p90 = round(p50 * high);
    const p25 = round(p10 + (p50 - p10) * 0.5);
    const p75 = round(p50 + (p90 - p50) * 0.5);
    metrics[metric.key] = {
      count: 0,
      min: round(Math.max(0, p10 - (p90 - p10) * 0.35)),
      max: round(p90 + (p90 - p10) * 0.4),
      mean: round(p50),
      std: round((p90 - p10) / 2.56),
      p10,
      p25,
      p50,
      p75,
      p90,
    };
  }
  return {
    playlist,
    source: 'seed',
    isDemo: true,
    updatedAt: null,
    sampleSize: 0,
    playersAnalyzed: 0,
    replaysAnalyzed: 0,
    metrics,
    note: 'Repères de démarrage par mode (ordres de grandeur pros). Lance une actualisation ballchasing pour obtenir les vraies distributions.',
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/** Liste des modèles disponibles en mode repères. */
export function seedPlaylistOptions() {
  return SEED_PLAYLISTS;
}
