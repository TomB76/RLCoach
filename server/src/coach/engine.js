/**
 * Moteur de coaching : compare les statistiques d'un joueur à la cohorte pro,
 * calcule un score, et génère des recommandations priorisées par impact.
 */

import { PLAYLISTS } from '../config.js';
import {
  METRICS,
  METRICS_BY_KEY,
  metricValue,
  percentileFromSummary,
  performanceScore,
  roundTo,
  summarize,
} from './metrics.js';
import { RULES, RULES_BY_METRIC, targetFor } from './rules.js';

const MAX_RECOMMENDATIONS = 5;

export function playlistLabel(playlist) {
  return PLAYLISTS[playlist]?.label || playlist || 'Mode inconnu';
}

function gradeOf(score) {
  if (score >= 90) return 'S+';
  if (score >= 82) return 'S';
  if (score >= 74) return 'A';
  if (score >= 66) return 'B';
  if (score >= 58) return 'C';
  if (score >= 50) return 'D';
  return 'E';
}

function levelOf(score) {
  if (score >= 82) return 'niveau pro';
  if (score >= 70) return 'très solide';
  if (score >= 58) return 'intermédiaire';
  if (score >= 46) return 'en progression';
  return 'à consolider';
}

/** Métriques qui n'ont pas de sens sans coéquipier (1v1). */
function isApplicable(metricKey, context) {
  if (context.teamSize === 1 && metricKey === 'positioning.avgDistanceToTeammates') return false;
  if (context.teamSize === 1 && metricKey === 'core.assistsPerMinute') return false;
  return true;
}

/**
 * Compare les stats d'un joueur à la cohorte pro.
 *
 * @param {object} params
 * @param {object} params.stats statistiques ballchasing-like du joueur
 * @param {number} params.durationSeconds durée du match (secondes)
 * @param {object} params.cohort cohorte pro (voir cohort.js)
 * @param {string} params.playlist playlist ballchasing
 * @param {number} [params.teamSize]
 */
export function compareToCohort({ stats, durationSeconds, cohort, playlist, teamSize = 2, minValueConfidence = 0 }) {
  const context = { teamSize };
  const rows = [];
  let weightSum = 0;
  let scoreSum = 0;

  for (const metric of METRICS) {
    const reference = cohort?.metrics?.[metric.key];
    if (!reference) continue;
    if (!isApplicable(metric.key, context)) continue;

    const value = metricValue(metric, stats, durationSeconds);
    if (value === null) continue;
    const percentile = percentileFromSummary(reference, value);
    const performance = performanceScore(percentile, metric.higherIsBetter);

    if (metric.higherIsBetter === null) {
      rows.push({
        key: metric.key,
        group: metric.group,
        label: metric.label,
        short: metric.short,
        unit: metric.unit,
        decimals: metric.decimals,
        higherIsBetter: null,
        weight: metric.weight,
        value: roundTo(value, metric.decimals),
        reference,
        percentile,
        performance: 50,
        status: 'neutral',
        target: targetFor(reference, value),
        delta: roundTo(value - (reference.p50 ?? 0), metric.decimals),
      });
      continue;
    }

    const status = performance >= 70 ? 'strength' : performance <= 45 ? 'weak' : 'neutral';
    weightSum += metric.weight;
    scoreSum += performance * metric.weight;

    rows.push({
      key: metric.key,
      group: metric.group,
      label: metric.label,
      short: metric.short,
      unit: metric.unit,
      decimals: metric.decimals,
      higherIsBetter: metric.higherIsBetter,
      weight: metric.weight,
      value: roundTo(value, metric.decimals),
      reference,
      percentile,
      performance,
      status,
      target: targetFor(reference, value),
      delta: roundTo(value - (reference.p50 ?? 0), metric.decimals),
    });
  }

  const score = weightSum > 0 ? roundTo(scoreSum / weightSum, 1) : 50;
  const referenceLabel = cohort?.label || 'Pros';
  return {
    playlist,
    playlistLabel: playlistLabel(playlist),
    referenceLabel,
    cohort: {
      source: cohort?.source || 'unknown',
      mode: cohort?.mode || 'global',
      player: cohort?.player || null,
      label: referenceLabel,
      playerAvailable: cohort?.playerAvailable ?? null,
      isDemo: Boolean(cohort?.isDemo),
      updatedAt: cohort?.updatedAt || null,
      sampleSize: cohort?.sampleSize || 0,
      playersAnalyzed: cohort?.playersAnalyzed || 0,
      replaysAnalyzed: cohort?.replaysAnalyzed || 0,
      note: cohort?.note || null,
    },
    metrics: rows,
    score,
    grade: gradeOf(score),
    level: levelOf(score),
    minValueConfidence,
  };
}

/** Génère les recommandations priorisées à partir d'une comparaison. */
export function buildRecommendations(comparison, { limit = MAX_RECOMMENDATIONS } = {}) {
  const candidates = [];

  for (const row of comparison.metrics) {
    if (row.higherIsBetter === null) continue;
    const rule = RULES_BY_METRIC.get(row.key);
    if (!rule) continue;
    const threshold = rule.threshold ?? 45;
    if (row.performance >= threshold) continue;

    const gap = (threshold - row.performance) / 100;
    const impact = row.weight * gap;
    candidates.push({
      rule,
      row,
      impact,
      deficitRatio: row.reference?.p50 ? (row.reference.p50 - row.value) / Math.abs(row.reference.p50 || 1) : 0,
    });
  }

  candidates.sort((a, b) => b.impact - a.impact);
  const maxImpact = candidates.length ? candidates[0].impact : 1;
  const picked = candidates.slice(0, limit);

  return picked.map((candidate, index) => {
    const { rule, row } = candidate;
    const priority = Math.round((candidate.impact / (maxImpact || 1)) * 100);
    return {
      id: rule.id,
      rank: index + 1,
      category: rule.category,
      title: rule.title,
      priority,
      impact: roundTo(candidate.impact, 3),
      diagnosis: rule.diagnosis({
        value: row.value,
        unit: row.unit,
        reference: row.reference,
        percentile: row.percentile,
        performance: row.performance,
        playlistLabel: comparison.playlistLabel,
        benchmarkLabel: comparison.referenceLabel || comparison.cohort?.label || 'Pros',
      }),
      why: rule.why,
      cue: rule.cue,
      drills: rule.drills,
      target: {
        metricKey: row.key,
        label: row.label,
        unit: row.unit,
        current: row.value,
        goal: row.target,
        proMedian: row.reference?.p50 ?? null,
        performance: row.performance,
        percentile: row.percentile,
      },
    };
  });
}

/** Analyse complète d'un match : comparaison + diagnostic + recommandations. */
export function coachMatch({ match, cohort }) {
  const local = match.players?.find((p) => p.isLocal) || null;
  if (!local) {
    return {
      comparison: null,
      coaching: {
        score: null,
        grade: null,
        headline: 'Aucun joueur local identifié dans ce match : renseigne ton pseudo in-game dans les réglages.',
        recommendations: [],
        strengths: [],
        weaknesses: [],
      },
    };
  }

  const teamSize = match.players ? Math.max(1, Math.round(match.players.length / 2)) : 2;
  const comparison = compareToCohort({
    stats: local.stats,
    durationSeconds: match.durationSeconds || 300,
    cohort,
    playlist: match.playlist || cohort?.playlist || 'ranked-doubles',
    teamSize,
  });

  const recommendations = buildRecommendations(comparison);
  const strengths = comparison.metrics
    .filter((m) => m.status === 'strength')
    .sort((a, b) => b.performance - a.performance)
    .slice(0, 3);
  const weaknesses = comparison.metrics
    .filter((m) => m.status === 'weak')
    .sort((a, b) => a.performance - b.performance)
    .slice(0, 3);

  const score = comparison.score;
  const headline = buildHeadline(match, comparison, recommendations, local);

  return {
    comparison,
    coaching: {
      score,
      grade: gradeOf(score),
      level: levelOf(score),
      headline,
      recommendations,
      strengths: strengths.map(slimMetric),
      weaknesses: weaknesses.map(slimMetric),
      playerName: local.name,
      summary: buildSummary(comparison, recommendations, strengths, weaknesses),
      generatedAt: new Date().toISOString(),
    },
  };
}

function slimMetric(row) {
  return {
    key: row.key,
    label: row.label,
    unit: row.unit,
    value: row.value,
    reference: row.reference?.p50 ?? null,
    percentile: row.percentile,
    performance: row.performance,
    target: row.target,
  };
}

function buildHeadline(match, comparison, recommendations, local) {
  const score = comparison.score;
  const first = recommendations[0];
  const resultLabel =
    match.result === 'win'
      ? `Victoire ${match.teamScores?.[local.team]}–${match.teamScores?.[local.team === 0 ? 1 : 0]}`
      : match.result === 'loss'
        ? `Défaite ${match.teamScores?.[local.team]}–${match.teamScores?.[local.team === 0 ? 1 : 0]}`
        : 'Match analysé';

  if (!first) {
    return `${resultLabel} — niveau ${comparison.level} : aucune faiblesse majeure face aux pros sur ce match. Continue sur ce rythme.`;
  }
  return `${resultLabel} — niveau ${comparison.level} (${score}/100). Priorité n°1 : ${first.title.toLowerCase()}.`;
}

function buildSummary(comparison, recommendations, strengths, weaknesses) {
  const parts = [];
  const reference = comparison.referenceLabel || comparison.cohort?.label || 'Pros';
  parts.push(
    `Score global ${comparison.score}/100 face à ${reference} en ${comparison.playlistLabel} (${
      comparison.cohort.isDemo
        ? 'repères de démarrage'
        : comparison.cohort.mode === 'player'
          ? `${comparison.cohort.replaysAnalyzed} replay(s) analysé(s)`
          : `cohorte de ${comparison.cohort.sampleSize} performances pro`
    }).`,
  );
  if (strengths.length) {
    parts.push(
      `Points forts : ${strengths.map((s) => `${s.label.toLowerCase()} (${fmtShort(s.value, s.unit)})`).join(', ')}.`,
    );
  }
  if (weaknesses.length) {
    parts.push(
      `Points à travailler : ${weaknesses.map((w) => `${w.label.toLowerCase()} (${fmtShort(w.value, w.unit)})`).join(', ')}.`,
    );
  }
  if (recommendations.length) {
    parts.push(
      `Plan d'action : ${recommendations
        .slice(0, 3)
        .map((r) => r.title.toLowerCase())
        .join(' · ')}.`,
    );
  }
  return parts.join(' ');
}

function fmtShort(value, unit) {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  if (unit === '%') return `${rounded} %`;
  if (unit === '/min') return `${rounded}/min`;
  if (unit === 'uu') return `${rounded} uu`;
  if (unit === 'uu/s') return `${rounded} uu/s`;
  return `${rounded}`;
}

/**
 * Vue d'ensemble multi-matchs : moyennes par métrique, priorités récurrentes et
 * plan d'entraînement.
 */
export function coachOverview({ matches, cohort, playlist, limit = 15 }) {
  const sorted = [...(matches || [])]
    .filter((m) => m.players?.some((p) => p.isLocal))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-limit);

  const referenceLabel = cohort?.label || 'Pros';
  const cohortPayload = {
    source: cohort?.source || 'seed',
    mode: cohort?.mode || 'global',
    player: cohort?.player || null,
    label: referenceLabel,
    playerAvailable: cohort?.playerAvailable ?? null,
    isDemo: Boolean(cohort?.isDemo),
    updatedAt: cohort?.updatedAt || null,
    sampleSize: cohort?.sampleSize || 0,
    replaysAnalyzed: cohort?.replaysAnalyzed || 0,
    playersAnalyzed: cohort?.playersAnalyzed || 0,
    note: cohort?.note || null,
  };

  if (!sorted.length) {
    return {
      scope: { matchCount: 0, playlist, playlistLabel: playlistLabel(playlist), minutes: 0 },
      referenceLabel,
      cohort: cohortPayload,
      score: null,
      grade: null,
      metrics: [],
      priorities: [],
      plan: null,
      trend: null,
      strengths: [],
      weaknesses: [],
      headline: 'Aucun match analysé pour le moment. Joue une partie (ou lance une démo) pour démarrer le coaching.',
    };
  }

  const comparisons = sorted.map((match) => {
    const local = match.players.find((p) => p.isLocal);
    const teamSize = match.players?.length ? Math.max(1, Math.round(match.players.length / 2)) : 2;
    return {
      match,
      local,
      comparison: compareToCohort({
        stats: local.stats,
        durationSeconds: match.durationSeconds || 300,
        cohort,
        playlist: match.playlist || playlist || 'ranked-doubles',
        teamSize,
      }),
    };
  });

  const byKey = new Map();
  for (const entry of comparisons) {
    for (const row of entry.comparison.metrics) {
      if (!byKey.has(row.key)) byKey.set(row.key, []);
      byKey.get(row.key).push(row);
    }
  }

  const metrics = [];
  let weightSum = 0;
  let scoreSum = 0;

  for (const metric of METRICS) {
    const rows = byKey.get(metric.key);
    if (!rows?.length) continue;
    const comparable = rows.filter((r) => r.higherIsBetter !== null);
    const values = rows.map((r) => r.value);
    const avgPerformance = comparable.length
      ? roundTo(comparable.reduce((acc, r) => acc + r.performance, 0) / comparable.length, 1)
      : 50;
    const weakCount = comparable.filter((r) => r.performance <= 45).length;
    const avgValue = roundTo(values.reduce((a, b) => a + b, 0) / values.length, metric.decimals);

    if (comparable.length) {
      weightSum += metric.weight * comparable.length;
      scoreSum += avgPerformance * metric.weight * comparable.length;
    }

    metrics.push({
      key: metric.key,
      group: metric.group,
      label: metric.label,
      short: metric.short,
      unit: metric.unit,
      decimals: metric.decimals,
      higherIsBetter: metric.higherIsBetter,
      weight: metric.weight,
      value: avgValue,
      values,
      reference: rows[0].reference,
      avgPerformance,
      performance: avgPerformance,
      status: avgPerformance >= 70 ? 'strength' : avgPerformance <= 45 ? 'weak' : 'neutral',
      weakCount,
      matchCount: rows.length,
      // objectif recalculé à partir de la valeur agrégée (pas celle du 1er match)
      target: targetFor(rows[0].reference, avgValue),
      spread: summarize(values),
    });
  }

  const score = weightSum > 0 ? roundTo(scoreSum / weightSum, 1) : 50;
  const totalMinutes = roundTo(
    comparisons.reduce((acc, c) => acc + (c.match.durationSeconds || 0), 0) / 60,
    1,
  );

  // Priorités : faiblesses récurrentes, pondérées par le poids de la métrique et la fréquence
  const priorityCandidates = metrics
    .filter((m) => m.higherIsBetter !== null && m.avgPerformance < 55)
    .map((m) => {
      const rule = RULES_BY_METRIC.get(m.key);
      if (!rule) return null;
      const frequency = m.weakCount / Math.max(1, m.matchCount);
      const gap = (100 - m.avgPerformance) / 100;
      return { metric: m, rule, score: m.weight * gap * (0.4 + 0.6 * frequency), frequency };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const maxPriority = priorityCandidates.length ? priorityCandidates[0].score : 1;
  const priorities = priorityCandidates.slice(0, MAX_RECOMMENDATIONS).map((candidate, index) => ({
    id: candidate.rule.id,
    rank: index + 1,
    category: candidate.rule.category,
    title: candidate.rule.title,
    priority: Math.round((candidate.score / (maxPriority || 1)) * 100),
    frequency: roundTo(candidate.frequency * 100, 0),
    matchesAffected: candidate.metric.weakCount,
    diagnosis: candidate.rule.diagnosis({
      value: candidate.metric.value,
      unit: candidate.metric.unit,
      reference: candidate.metric.reference,
      performance: candidate.metric.avgPerformance,
      playlistLabel: playlistLabel(playlist),
      benchmarkLabel: cohort?.label || 'Pros',
    }),
    why: candidate.rule.why,
    cue: candidate.rule.cue,
    drills: candidate.rule.drills,
    target: {
      metricKey: candidate.metric.key,
      label: candidate.metric.label,
      unit: candidate.metric.unit,
      current: candidate.metric.value,
      goal: candidate.metric.target,
      proMedian: candidate.metric.reference?.p50 ?? null,
    },
  }));

  const scores = comparisons.map((c) => c.comparison.score);
  const trend = buildTrend(scores, comparisons.map((c) => c.match.date));
  const strengths = metrics
    .filter((m) => m.status === 'strength')
    .sort((a, b) => b.avgPerformance - a.avgPerformance)
    .slice(0, 3);
  const weaknesses = metrics
    .filter((m) => m.status === 'weak')
    .sort((a, b) => a.avgPerformance - b.avgPerformance)
    .slice(0, 3);

  const plan = priorities.length
    ? {
        focus: priorities.slice(0, 2).map((p) => p.title),
        cue: priorities[0].cue,
        weekly: priorities.slice(0, 3).map((p) => ({
          id: p.id,
          title: p.title,
          metric: p.target.label,
          current: p.target.current,
          goal: p.target.goal,
          unit: p.target.unit,
          drills: p.drills,
        })),
        milestone:
          'Objectif : atteindre le palier p25 des pros sur la priorité n°1 sur les 10 prochains matchs.',
      }
    : null;

  return {
    scope: {
      matchCount: comparisons.length,
      playlist,
      playlistLabel: playlistLabel(playlist),
      minutes: totalMinutes,
      since: comparisons[0]?.match.date || null,
      until: comparisons.at(-1)?.match.date || null,
      wins: comparisons.filter((c) => c.match.result === 'win').length,
      losses: comparisons.filter((c) => c.match.result === 'loss').length,
    },
    referenceLabel,
    cohort: cohortPayload,
    score,
    grade: gradeOf(score),
    level: levelOf(score),
    metrics,
    priorities,
    plan,
    trend,
    strengths,
    weaknesses,
    headline: priorities.length
      ? `Niveau ${levelOf(score)} face aux pros : travaille en priorité « ${priorities[0].title.toLowerCase()} ».`
      : `Niveau ${levelOf(score)} : ton profil est équilibré face aux pros, cherche maintenant la régularité.`,
  };
}

function buildTrend(scores, dates) {
  if (!scores.length) return null;
  const recent = scores.slice(-3);
  const previous = scores.slice(0, Math.max(0, scores.length - 3));
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const delta = previous.length ? roundTo(avg(recent) - avg(previous), 1) : 0;
  return {
    scores,
    dates,
    recentAverage: roundTo(avg(recent), 1),
    previousAverage: previous.length ? roundTo(avg(previous), 1) : null,
    delta,
    direction: delta > 1.5 ? 'up' : delta < -1.5 ? 'down' : 'flat',
  };
}

/** Recommandation par défaut quand on n'a pas encore de match. */
export function emptyOverview(playlist = 'ranked-doubles') {
  return coachOverview({ matches: [], cohort: null, playlist });
}
