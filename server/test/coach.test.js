import test from 'node:test';
import assert from 'node:assert/strict';

import { METRICS, percentileFromSummary, performanceScore, summarize } from '../src/coach/metrics.js';
import { buildSeedCohort } from '../src/coach/seedBenchmarks.js';
import { coachMatch, coachOverview, compareToCohort } from '../src/coach/engine.js';
import { RULES } from '../src/coach/rules.js';
import { buildCohortFromReplays } from '../src/ballchasing/cohort.js';
import { buildSimulatedMatch } from '../src/rl/simulator.js';
import { MatchTracker } from '../src/rl/matchTracker.js';

function fakeStats(overrides = {}) {
  return {
    core: { shots: 4, goals: 2, saves: 3, assists: 1, score: 420, shootingPercentage: 50, mvp: false },
    boost: {
      bpm: 600,
      avgAmount: 40,
      amountCollected: 2400,
      amountStolen: 400,
      countCollectedBig: 20,
      countCollectedSmall: 30,
      timeZeroBoost: 30,
      timeFullBoost: 30,
      percentZeroBoost: 5,
      percentFullBoost: 5,
      ...overrides.boost,
    },
    movement: {
      avgSpeed: 1700,
      totalDistance: 500000,
      percentSupersonicSpeed: 22,
      percentSlowSpeed: 18,
      percentBoostSpeed: 60,
      percentFastSpeed: 22,
      percentGround: 70,
      percentLowAir: 20,
      percentHighAir: 10,
      ...overrides.movement,
    },
    positioning: {
      avgDistanceToBall: 1800,
      avgDistanceToTeammates: 2400,
      percentDefensiveHalf: 45,
      percentOffensiveHalf: 55,
      percentDefensiveThird: 28,
      percentNeutralThird: 36,
      percentOffensiveThird: 36,
      percentBehindBall: 60,
      percentAheadOfBall: 40,
      ...overrides.positioning,
    },
    demo: { inflicted: 3, taken: 2, ...overrides.demo },
    custom: {
      touches: 110,
      carTouches: 110,
      touchesPerMinute: 24,
      aerialHits: 20,
      aerialHitPercent: 18,
      ballCarryPercent: 8,
      ...overrides.custom,
    },
    meta: { activeSeconds: 290, minutes: 4.8, samples: 290 },
  };
}

test('metrics : summarize + percentile interpolé', () => {
  const summary = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(summary.count, 10);
  assert.equal(summary.p50, 5.5);
  assert.ok(summary.p10 < summary.p25 && summary.p25 < summary.p75);
  assert.equal(percentileFromSummary(summary, -100), 0);
  assert.equal(percentileFromSummary(summary, 999), 100);
  const mid = percentileFromSummary(summary, 5.5);
  assert.ok(Math.abs(mid - 50) < 3, `percentile médian ${mid}`);
  assert.equal(performanceScore(90, true), 90);
  assert.equal(performanceScore(90, false), 10);
  assert.equal(performanceScore(90, null), 50);
});

test('seed : la cohorte de démarrage couvre les métriques principales', () => {
  const cohort = buildSeedCohort('ranked-doubles');
  assert.equal(cohort.isDemo, true);
  assert.ok(Object.keys(cohort.metrics).length >= 15);
  for (const metric of METRICS) {
    const ref = cohort.metrics[metric.key];
    if (!ref) continue;
    assert.ok(ref.p10 <= ref.p25 && ref.p25 <= ref.p50 && ref.p50 <= ref.p75 && ref.p75 <= ref.p90);
  }
});

test('rules : chaque règle cible une métrique connue et contient des drills', () => {
  const keys = new Set(METRICS.map((m) => m.key));
  for (const rule of RULES) {
    assert.ok(keys.has(rule.metricKey), `métrique inconnue : ${rule.metricKey}`);
    assert.ok(rule.title && rule.why && rule.cue);
    assert.ok(Array.isArray(rule.drills) && rule.drills.length > 0);
    for (const drill of rule.drills) {
      assert.ok(drill.name && drill.description && drill.objective);
    }
    // le diagnostic doit être généré sans erreur
    const text = rule.diagnosis({
      value: 10,
      unit: '%',
      reference: { p50: 20, p25: 15 },
      playlistLabel: '2v2',
    });
    assert.ok(typeof text === 'string' && text.length > 20);
  }
});

test('comparaison : un joueur au niveau pro obtient un bon score', () => {
  const cohort = buildSeedCohort('ranked-doubles');
  const strong = compareToCohort({
    stats: fakeStats(),
    durationSeconds: 300,
    cohort,
    playlist: 'ranked-doubles',
    teamSize: 2,
  });
  const weak = compareToCohort({
    stats: fakeStats({
      boost: { percentZeroBoost: 30, bpm: 120 },
      movement: { percentSupersonicSpeed: 2, avgSpeed: 900, percentSlowSpeed: 70 },
      positioning: { percentOffensiveThird: 5, avgDistanceToBall: 4000 },
      custom: { touchesPerMinute: 4, aerialHitPercent: 1 },
    }),
    durationSeconds: 300,
    cohort,
    playlist: 'ranked-doubles',
    teamSize: 2,
  });
  assert.ok(strong.score > 55, `score fort ${strong.score}`);
  assert.ok(weak.score < strong.score - 15, `score faible ${weak.score} vs ${strong.score}`);
  assert.ok(strong.metrics.every((m) => m.performance >= 0 && m.performance <= 100));
  assert.ok(strong.metrics.every((m) => m.value >= 0));
});

test('comparaison : les métriques sans donnée (touches ballchasing) sont ignorées', () => {
  const cohort = buildSeedCohort('ranked-doubles');
  const stats = fakeStats();
  stats.custom = { touches: null, touchesPerMinute: null, aerialHitPercent: null };
  const comparison = compareToCohort({ stats, durationSeconds: 300, cohort, playlist: 'ranked-doubles', teamSize: 2 });
  assert.ok(!comparison.metrics.some((m) => m.key === 'custom.touchesPerMinute'));
});

test('coaching : les recommandations sont triées par priorité décroissante', () => {
  const cohort = buildSeedCohort('ranked-doubles');
  const { messages } = buildSimulatedMatch({ seed: 5, durationSeconds: 180, localName: 'Toi', profile: 'casual' });
  let match = null;
  const tracker = new MatchTracker({ playerName: 'Toi', onMatchEnded: (m) => { match = m; } });
  for (const message of messages) tracker.ingest(message);

  const { comparison, coaching } = coachMatch({ match, cohort });
  assert.ok(comparison.score > 0 && comparison.score <= 100);
  assert.ok(coaching.recommendations.length > 0);
  for (let i = 1; i < coaching.recommendations.length; i += 1) {
    assert.ok(
      coaching.recommendations[i - 1].priority >= coaching.recommendations[i].priority,
      'les recommandations doivent être classées par priorité',
    );
  }
  assert.ok(coaching.recommendations.length <= 5);
  assert.ok(coaching.headline.includes('Priorité n°1'));
  assert.ok(coaching.recommendations[0].drills.length > 0);
});

test('coachOverview : agrège plusieurs matchs et produit un plan', () => {
  const cohort = buildSeedCohort('ranked-doubles');
  const matches = [];
  for (const seed of [1, 2, 3]) {
    const { messages } = buildSimulatedMatch({ seed, durationSeconds: 150, localName: 'Toi', profile: 'ranked' });
    let match = null;
    const tracker = new MatchTracker({ playerName: 'Toi', onMatchEnded: (m) => { match = m; } });
    for (const message of messages) tracker.ingest(message);
    const { comparison, coaching } = coachMatch({ match, cohort });
    match.comparison = comparison;
    match.coaching = coaching;
    matches.push(match);
  }
  const overview = coachOverview({ matches, cohort, playlist: 'ranked-doubles' });
  assert.equal(overview.scope.matchCount, 3);
  assert.ok(overview.metrics.length > 10);
  assert.ok(overview.priorities.length > 0);
  assert.ok(overview.plan.weekly.length > 0);
  assert.equal(overview.trend.scores.length, 3);
  assert.ok(overview.headline.length > 10);
});

test('coachOverview : historique vide → message explicite', () => {
  const overview = coachOverview({ matches: [], cohort: null, playlist: 'ranked-doubles' });
  assert.equal(overview.scope.matchCount, 0);
  assert.equal(overview.score, null);
  assert.ok(overview.headline.includes('Aucun match'));
});

test('cohorte ballchasing : agrège les distributions depuis des replays', () => {
  // Structure réelle de `GET /replays/{id}` : rosters dans blue/orange, buts
  // d'équipe dans `<side>.stats.core.goals`, aucun tableau `players` racine.
  const replay = {
    id: 'r1',
    date: '2024-01-01T00:00:00Z',
    playlist: 'ranked-doubles',
    duration: 300,
    team_size: 2,
    blue: {
      stats: { core: { goals: 3 } },
      players: [
        { name: 'Pro1', id: { platform: 'steam', id: 'p1' }, stats: ballchasingStats({ percent_zero_boost: 2, bpm: 430 }) },
        { name: 'Pro2', id: { platform: 'steam', id: 'p2' }, stats: ballchasingStats({ percent_zero_boost: 4, bpm: 460 }) },
      ],
    },
    orange: {
      stats: { core: { goals: 1 } },
      players: [
        { name: 'Pro3', id: { platform: 'steam', id: 'p3' }, stats: ballchasingStats({ percent_zero_boost: 6, bpm: 400 }) },
        { name: 'Pro4', id: { platform: 'steam', id: 'p4' }, stats: ballchasingStats({ percent_zero_boost: 8, bpm: 480 }) },
      ],
    },
  };
  const cohort = buildCohortFromReplays([replay], { playlist: 'ranked-doubles' });
  assert.equal(cohort.isDemo, false);
  assert.equal(cohort.replaysAnalyzed, 1);
  assert.equal(cohort.playersAnalyzed, 4);
  assert.equal(cohort.metrics['boost.percentZeroBoost'].count, 4);
  assert.equal(cohort.metrics['boost.percentZeroBoost'].p50, 5);
  assert.ok(cohort.metrics['boost.bpm'].p50 >= 400 && cohort.metrics['boost.bpm'].p50 <= 480);
});

test('cohorte ballchasing : ignore les replays sans statistiques', () => {
  const cohort = buildCohortFromReplays(
    [{ id: 'x', duration: 300, team_size: 2, blue: { players: [] }, orange: { players: [] } }],
    { playlist: 'ranked-doubles' },
  );
  assert.equal(cohort.replaysAnalyzed, 0);
  assert.deepEqual(cohort.metrics, {});
});

function ballchasingStats(boostOverrides = {}) {
  return {
    core: { shots: 2, goals: 1, saves: 1, assists: 1, score: 300, shooting_percentage: 50 },
    boost: {
      bpm: 400,
      avg_amount: 30,
      amount_collected: 2000,
      amount_stolen: 300,
      amount_collected_big: 1500,
      amount_collected_small: 500,
      count_collected_big: 15,
      count_collected_small: 40,
      time_zero_boost: 10,
      time_full_boost: 10,
      percent_zero_boost: 4,
      percent_full_boost: 4,
      ...boostOverrides,
    },
    movement: {
      avg_speed: 1600,
      total_distance: 480000,
      time_supersonic_speed: 50,
      percent_supersonic_speed: 18,
      time_slow_speed: 60,
      percent_slow_speed: 20,
      time_boost_speed: 150,
      percent_boost_speed: 55,
      time_fast_speed: 70,
      percent_fast_speed: 25,
      time_ground: 200,
      percent_ground: 65,
      time_low_air: 60,
      percent_low_air: 20,
      time_high_air: 40,
      percent_high_air: 15,
    },
    positioning: {
      avg_distance_to_ball: 2000,
      avg_distance_to_ball_possession: 1500,
      avg_distance_to_ball_no_possession: 2600,
      avg_distance_to_mates: 2400,
      percent_defensive_half: 45,
      percent_offensive_half: 55,
      percent_defensive_third: 30,
      percent_neutral_third: 35,
      percent_offensive_third: 35,
      percent_behind_ball: 60,
    },
    demo: { inflicted: 2, taken: 1 },
  };
}
