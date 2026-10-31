/**
 * Miroir du catalogue de métriques du serveur (labels, unités, regroupements).
 * Nécessaire pour afficher les distributions p10→p90, que le serveur renvoie
 * sous forme de dictionnaire indexé par clé.
 */

export const METRIC_GROUPS = {
  core: { label: 'Production', color: '#f59e0b' },
  boost: { label: 'Boost', color: '#38bdf8' },
  movement: { label: 'Mouvement', color: '#a78bfa' },
  positioning: { label: 'Positionnement', color: '#34d399' },
  demo: { label: 'Physique', color: '#f87171' },
  custom: { label: 'Touches', color: '#fbbf24' },
};

export const METRICS = [
  { key: 'core.goalsPerMinute', group: 'core', label: 'Buts / min', short: 'Buts', unit: '/min', decimals: 2, higherIsBetter: true },
  { key: 'core.assistsPerMinute', group: 'core', label: 'Passes décisives / min', short: 'Passes', unit: '/min', decimals: 2, higherIsBetter: true },
  { key: 'core.savesPerMinute', group: 'core', label: 'Arrêts / min', short: 'Arrêts', unit: '/min', decimals: 2, higherIsBetter: true },
  { key: 'core.shotsPerMinute', group: 'core', label: 'Tirs / min', short: 'Tirs', unit: '/min', decimals: 2, higherIsBetter: true },
  { key: 'core.shootingPercentage', group: 'core', label: 'Précision de tir', short: 'Précision', unit: '%', decimals: 1, higherIsBetter: true },
  { key: 'boost.bpm', group: 'boost', label: 'Boost collecté / min', short: 'BPM', unit: '/min', decimals: 0, higherIsBetter: true },
  { key: 'boost.percentZeroBoost', group: 'boost', label: 'Temps à 0 boost', short: '0 boost', unit: '%', decimals: 1, higherIsBetter: false },
  { key: 'boost.avgAmount', group: 'boost', label: 'Boost moyen en réservoir', short: 'Boost moyen', unit: '', decimals: 1, higherIsBetter: true },
  { key: 'boost.stolenPerMinute', group: 'boost', label: 'Boost volé / min', short: 'Boost volé', unit: '/min', decimals: 0, higherIsBetter: true },
  { key: 'movement.avgSpeed', group: 'movement', label: 'Vitesse moyenne', short: 'Vitesse moy.', unit: 'uu/s', decimals: 0, higherIsBetter: true },
  { key: 'movement.percentSupersonicSpeed', group: 'movement', label: 'Temps supersonique', short: 'Supersonique', unit: '%', decimals: 1, higherIsBetter: true },
  { key: 'movement.percentSlowSpeed', group: 'movement', label: 'Temps à vitesse lente', short: 'Temps lent', unit: '%', decimals: 1, higherIsBetter: false },
  { key: 'movement.percentHighAir', group: 'movement', label: 'Temps en jeu aérien', short: 'Jeu aérien', unit: '%', decimals: 1, higherIsBetter: true },
  { key: 'positioning.avgDistanceToBall', group: 'positioning', label: 'Distance moyenne à la balle', short: 'Distance balle', unit: 'uu', decimals: 0, higherIsBetter: false },
  { key: 'positioning.percentOffensiveThird', group: 'positioning', label: 'Temps dans le tiers offensif', short: 'Tiers offensif', unit: '%', decimals: 1, higherIsBetter: true },
  { key: 'positioning.percentDefensiveThird', group: 'positioning', label: 'Temps dans le tiers défensif', short: 'Tiers défensif', unit: '%', decimals: 1, higherIsBetter: null },
  { key: 'positioning.avgDistanceToTeammates', group: 'positioning', label: 'Distance aux coéquipiers', short: 'Distance équipe', unit: 'uu', decimals: 0, higherIsBetter: null },
  { key: 'demo.inflictedPerMinute', group: 'demo', label: 'Démolitions infligées / min', short: 'Démos', unit: '/min', decimals: 2, higherIsBetter: true },
  { key: 'demo.takenPerMinute', group: 'demo', label: 'Démolitions subies / min', short: 'Démos subies', unit: '/min', decimals: 2, higherIsBetter: false },
  { key: 'custom.touchesPerMinute', group: 'custom', label: 'Touches / min', short: 'Touches', unit: '/min', decimals: 1, higherIsBetter: true },
  { key: 'custom.aerialHitPercent', group: 'custom', label: 'Part de touches aériennes', short: 'Touches aériennes', unit: '%', decimals: 1, higherIsBetter: true },
];

export const METRIC_BY_KEY = new Map(METRICS.map((item) => [item.key, item]));

export const METRIC_GROUP_ORDER = ['core', 'boost', 'movement', 'positioning', 'demo', 'custom'];

export const PLAYLIST_FALLBACK = {
  'ranked-duels': { label: '1v1 (Duel)', short: '1v1' },
  'ranked-doubles': { label: '2v2 (Doubles)', short: '2v2' },
  'ranked-standard': { label: '3v3 (Standard)', short: '3v3' },
  'ranked-hoops': { label: 'Hoops', short: 'Hoops' },
  'ranked-dropshot': { label: 'Dropshot', short: 'Dropshot' },
  'ranked-snowday': { label: 'Rumble', short: 'Rumble' },
};

export function metricLabel(key) {
  return METRIC_BY_KEY.get(key)?.label || key;
}

export function groupOf(key) {
  return METRIC_BY_KEY.get(key)?.group || '';
}

export function groupLabel(group) {
  return METRIC_GROUPS[group]?.label || group;
}

export function playlistLabel(playlists, key, short = false) {
  if (!key) return 'Mode inconnu';
  const entry = playlists?.[key] || PLAYLIST_FALLBACK[key];
  if (entry) return short ? entry.short || entry.label : entry.label;
  return key;
}

export const DEMO_PROFILES = [
  { id: 'casual', label: 'Casual', hint: 'Joueur détendu, erreurs fréquentes' },
  { id: 'ranked', label: 'Ranked', hint: 'Niveau classé, irrégulier' },
  { id: 'pro', label: 'Pro', hint: 'Rythme pro, peu d’erreurs' },
];
