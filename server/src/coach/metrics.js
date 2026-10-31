/**
 * Catalogue des métriques utilisées pour comparer un joueur à la cohorte pro.
 *
 * Les clés suivent la nomenclature ballchasing (`boost.percentZeroBoost`,
 * `movement.avgSpeed`…) pour que les données réelles récupérées via l'API
 * ballchasing et les données calculées en direct par le tracker soient
 * directement comparables.
 *
 * `read(stats, minutes)` renvoie la valeur comparable du joueur.
 */

export const METRIC_GROUPS = {
  core: { label: 'Production', color: '#f59e0b' },
  boost: { label: 'Boost', color: '#38bdf8' },
  movement: { label: 'Mouvement', color: '#a78bfa' },
  positioning: { label: 'Positionnement', color: '#34d399' },
  demo: { label: 'Physique', color: '#f87171' },
  custom: { label: 'Touches', color: '#fbbf24' },
};

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
/** Comme `num`, mais préserve l'absence de donnée (`null`). */
const optNum = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const METRICS = [
  {
    key: 'core.goalsPerMinute',
    group: 'core',
    label: 'Buts / min',
    short: 'Buts',
    unit: '/min',
    decimals: 2,
    higherIsBetter: true,
    weight: 2,
    read: (s, m) => num(s.core?.goals) / m,
  },
  {
    key: 'core.assistsPerMinute',
    group: 'core',
    label: 'Passes décisives / min',
    short: 'Passes',
    unit: '/min',
    decimals: 2,
    higherIsBetter: true,
    weight: 2,
    read: (s, m) => num(s.core?.assists) / m,
  },
  {
    key: 'core.savesPerMinute',
    group: 'core',
    label: 'Arrêts / min',
    short: 'Arrêts',
    unit: '/min',
    decimals: 2,
    higherIsBetter: true,
    weight: 2,
    read: (s, m) => num(s.core?.saves) / m,
  },
  {
    key: 'core.shotsPerMinute',
    group: 'core',
    label: 'Tirs / min',
    short: 'Tirs',
    unit: '/min',
    decimals: 2,
    higherIsBetter: true,
    weight: 2.5,
    read: (s, m) => num(s.core?.shots) / m,
  },
  {
    key: 'core.shootingPercentage',
    group: 'core',
    label: 'Précision de tir',
    short: 'Précision',
    unit: '%',
    decimals: 1,
    higherIsBetter: true,
    weight: 2,
    read: (s) => num(s.core?.shootingPercentage),
  },
  {
    key: 'boost.bpm',
    group: 'boost',
    label: 'Boost collecté / min',
    short: 'BPM',
    unit: '/min',
    decimals: 0,
    higherIsBetter: true,
    weight: 3,
    read: (s) => num(s.boost?.bpm),
  },
  {
    key: 'boost.percentZeroBoost',
    group: 'boost',
    label: 'Temps à 0 boost',
    short: '0 boost',
    unit: '%',
    decimals: 1,
    higherIsBetter: false,
    weight: 3.5,
    read: (s) => num(s.boost?.percentZeroBoost),
  },
  {
    key: 'boost.avgAmount',
    group: 'boost',
    label: 'Boost moyen en réservoir',
    short: 'Boost moyen',
    unit: '',
    decimals: 1,
    higherIsBetter: true,
    weight: 2,
    read: (s) => num(s.boost?.avgAmount),
  },
  {
    key: 'boost.stolenPerMinute',
    group: 'boost',
    label: 'Boost volé / min',
    short: 'Boost volé',
    unit: '/min',
    decimals: 0,
    higherIsBetter: true,
    weight: 2,
    read: (s, m) => num(s.boost?.amountStolen) / m,
  },
  {
    key: 'movement.avgSpeed',
    group: 'movement',
    label: 'Vitesse moyenne',
    short: 'Vitesse moy.',
    unit: 'uu/s',
    decimals: 0,
    higherIsBetter: true,
    weight: 3,
    read: (s) => num(s.movement?.avgSpeed),
  },
  {
    key: 'movement.percentSupersonicSpeed',
    group: 'movement',
    label: 'Temps supersonique',
    short: 'Supersonique',
    unit: '%',
    decimals: 1,
    higherIsBetter: true,
    weight: 3.5,
    read: (s) => num(s.movement?.percentSupersonicSpeed),
  },
  {
    key: 'movement.percentSlowSpeed',
    group: 'movement',
    label: 'Temps à vitesse lente',
    short: 'Temps lent',
    unit: '%',
    decimals: 1,
    higherIsBetter: false,
    weight: 2.5,
    read: (s) => num(s.movement?.percentSlowSpeed),
  },
  {
    key: 'movement.percentHighAir',
    group: 'movement',
    label: 'Temps en jeu aérien',
    short: 'Jeu aérien',
    unit: '%',
    decimals: 1,
    higherIsBetter: true,
    weight: 2,
    read: (s) => num(s.movement?.percentHighAir),
  },
  {
    key: 'positioning.avgDistanceToBall',
    group: 'positioning',
    label: 'Distance moyenne à la balle',
    short: 'Distance balle',
    unit: 'uu',
    decimals: 0,
    higherIsBetter: false,
    weight: 2.5,
    read: (s) => num(s.positioning?.avgDistanceToBall),
  },
  {
    key: 'positioning.percentOffensiveThird',
    group: 'positioning',
    label: 'Temps dans le tiers offensif',
    short: 'Tiers offensif',
    unit: '%',
    decimals: 1,
    higherIsBetter: true,
    weight: 2,
    read: (s) => num(s.positioning?.percentOffensiveThird),
  },
  {
    key: 'positioning.percentDefensiveThird',
    group: 'positioning',
    label: 'Temps dans le tiers défensif',
    short: 'Tiers défensif',
    unit: '%',
    decimals: 1,
    higherIsBetter: null, // neutre : dépend du style
    weight: 1,
    read: (s) => num(s.positioning?.percentDefensiveThird),
  },
  {
    key: 'positioning.avgDistanceToTeammates',
    group: 'positioning',
    label: 'Distance aux coéquipiers',
    short: 'Distance équipe',
    unit: 'uu',
    decimals: 0,
    higherIsBetter: null,
    weight: 1,
    read: (s) => num(s.positioning?.avgDistanceToTeammates),
  },
  {
    key: 'demo.inflictedPerMinute',
    group: 'demo',
    label: 'Démolitions infligées / min',
    short: 'Démos',
    unit: '/min',
    decimals: 2,
    higherIsBetter: true,
    weight: 1.5,
    read: (s, m) => num(s.demo?.inflicted) / m,
  },
  {
    key: 'demo.takenPerMinute',
    group: 'demo',
    label: 'Démolitions subies / min',
    short: 'Démos subies',
    unit: '/min',
    decimals: 2,
    higherIsBetter: false,
    weight: 1.5,
    read: (s, m) => num(s.demo?.taken) / m,
  },
  {
    key: 'custom.touchesPerMinute',
    group: 'custom',
    label: 'Touches / min',
    short: 'Touches',
    unit: '/min',
    decimals: 1,
    higherIsBetter: true,
    weight: 3,
    read: (s) => optNum(s.custom?.touchesPerMinute),
  },
  {
    key: 'custom.aerialHitPercent',
    group: 'custom',
    label: 'Part de touches aériennes',
    short: 'Touches aériennes',
    unit: '%',
    decimals: 1,
    higherIsBetter: true,
    weight: 2,
    read: (s) => optNum(s.custom?.aerialHitPercent),
  },
];

export const METRICS_BY_KEY = new Map(METRICS.map((metric) => [metric.key, metric]));
/**
 * Valeur comparable d'une métrique. `null` = donnée non mesurée pour ce match
 * (ex. les « touches » absentes d'un replay ballchasing) : la métrique est
 * alors ignorée au lieu d'être comptée comme un zéro.
 */
export function metricValue(metric, stats, durationSeconds) {
  const minutes = Math.max(durationSeconds / 60, 0.2);
  const value = metric.read(stats || {}, minutes);
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Statistiques de distribution (cohorte pro)
// ---------------------------------------------------------------------------

export function quantile(sorted, p) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

export function summarize(values) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const variance = clean.reduce((acc, v) => acc + (v - mean) ** 2, 0) / clean.length;
  return {
    count: clean.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: roundTo(mean, 2),
    std: roundTo(Math.sqrt(variance), 2),
    p10: roundTo(quantile(sorted, 0.1), 2),
    p25: roundTo(quantile(sorted, 0.25), 2),
    p50: roundTo(quantile(sorted, 0.5), 2),
    p75: roundTo(quantile(sorted, 0.75), 2),
    p90: roundTo(quantile(sorted, 0.9), 2),
  };
}

export function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

/**
 * Rang percentile d'une valeur dans une distribution décrite par ses quantiles.
 * Interpolation linéaire par morceaux (0, 10, 25, 50, 75, 90, 100).
 */
export function percentileFromSummary(summary, value) {
  if (!summary) return 50;
  const points = [
    [0, summary.min],
    [10, summary.p10],
    [25, summary.p25],
    [50, summary.p50],
    [75, summary.p75],
    [90, summary.p90],
    [100, summary.max],
  ].filter(([p, v]) => Number.isFinite(v));

  if (points.length < 2) return 50;
  if (value <= points[0][1]) return 0;
  if (value >= points[points.length - 1][1]) return 100;

  for (let i = 1; i < points.length; i += 1) {
    const [p1, v1] = points[i];
    const [p0, v0] = points[i - 1];
    if (value <= v1) {
      if (v1 === v0) return p1;
      const t = (value - v0) / (v1 - v0);
      return roundTo(p0 + t * (p1 - p0), 1);
    }
  }
  return 100;
}

/**
 * Performance normalisée 0–100 : 100 = au niveau du p90 des pros (ou mieux),
 * quelle que soit la direction de la métrique.
 */
export function performanceScore(percentile, higherIsBetter) {
  if (higherIsBetter === null || higherIsBetter === undefined) return 50;
  return roundTo(higherIsBetter ? percentile : 100 - percentile, 1);
}
