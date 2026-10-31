import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCohortFromReplays, cohortKey, replayToMatch, slugify } from '../src/ballchasing/cohort.js';
import { buildSeedCohort } from '../src/coach/seedBenchmarks.js';
import { coachMatch, coachOverview, compareToCohort } from '../src/coach/engine.js';
import { buildSimulatedMatch } from '../src/rl/simulator.js';
import { MatchTracker } from '../src/rl/matchTracker.js';
import {
  AI_PROVIDERS,
  buildMatchPrompt,
  buildOverviewPrompt,
  callAi,
  generateMatchNarrative,
  positionVsRange,
  publicAiStatus,
  resolveAiConfig,
  testAi,
} from '../src/coach/ai.js';

function statsFor(playerName, boostZero, bpm) {
  return {
    core: { shots: 3, goals: 1, saves: 1, assists: 1, score: 300, shooting_percentage: 33 },
    boost: {
      bpm,
      avg_amount: 30,
      amount_collected: 2000,
      amount_stolen: 300,
      amount_collected_big: 1500,
      amount_collected_small: 500,
      count_collected_big: 15,
      count_collected_small: 40,
      time_zero_boost: 10,
      time_full_boost: 10,
      percent_zero_boost: boostZero,
      percent_full_boost: 4,
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
    playerName,
  };
}

/** Joueur au format réel de l'API ballchasing (`blue.players[]` / `orange.players[]`). */
function playerFixture({ name, boostZero, bpm, team, accountId }) {
  return {
    name,
    id: { platform: 'steam', id: accountId || `steam-${name.toLowerCase()}` },
    mvp: false,
    stats: statsFor(name, boostZero, bpm),
  };
}

/**
 * Replay au format réel de `GET /replays/{id}`.
 *
 * Il n'existe PAS de tableau `players` à la racine : les rosters sont dans
 * `blue.players` / `orange.players`, et les buts d'équipe dans
 * `blue.stats.core.goals`. C'est exactement ce que le parseur doit lire.
 */
function replayFixture(id, entries, { blueGoals = 2, orangeGoals = 1 } = {}) {
  const sides = { blue: [], orange: [] };
  for (const entry of entries) {
    sides[entry.team === 'orange' ? 'orange' : 'blue'].push(playerFixture(entry));
  }
  return {
    id,
    date: '2024-05-01T00:00:00Z',
    playlist: 'ranked-doubles',
    duration: 300,
    team_size: 2,
    blue: { stats: { core: { goals: blueGoals } }, players: sides.blue },
    orange: { stats: { core: { goals: orangeGoals } }, players: sides.orange },
  };
}

const replays = [
  replayFixture('r1', [
    { name: 'Vatira', boostZero: 2, bpm: 420, team: 'blue' },
    { name: 'Zen', boostZero: 3, bpm: 440, team: 'blue' },
    { name: 'Rw9', boostZero: 5, bpm: 400, team: 'orange' },
    { name: 'Atow', boostZero: 7, bpm: 460, team: 'orange' },
  ]),
  replayFixture('r2', [
    { name: 'Vatira', boostZero: 4, bpm: 430, team: 'blue' },
    { name: 'Zen', boostZero: 2, bpm: 450, team: 'blue' },
    { name: 'Rw9', boostZero: 6, bpm: 410, team: 'orange' },
    { name: 'Atow', boostZero: 8, bpm: 470, team: 'orange' },
  ]),
];

// ---------------------------------------------------------------------------
// Références pro
// ---------------------------------------------------------------------------

test('référence pro : clé de cache stable et slugify', () => {
  assert.equal(slugify('M0nkey M00n'), 'm0nkey-m00n');
  assert.equal(slugify('  Vatira '), 'vatira');
  assert.equal(cohortKey('ranked-doubles', 'global'), 'cohort:ranked-doubles');
  assert.equal(cohortKey('ranked-doubles', 'player', 'Vatira'), 'cohort:ranked-doubles:player:vatira');
  // deux orthographes (casse/espaces) partagent la même entrée
  assert.equal(cohortKey('ranked-doubles', 'player', ' vatira'), cohortKey('ranked-doubles', 'player', 'Vatira'));
});

test('cohorte mono-joueur : ne garde que les performances du joueur choisi', () => {
  const global = buildCohortFromReplays(replays, { playlist: 'ranked-doubles', mode: 'global' });
  const vatira = buildCohortFromReplays(replays, {
    playlist: 'ranked-doubles',
    mode: 'player',
    playerName: 'Vatira',
  });

  assert.equal(global.mode, 'global');
  assert.equal(global.replaysAnalyzed, 2);
  assert.equal(global.metrics['boost.percentZeroBoost'].count, 8, '4 joueurs × 2 replays');
  assert.equal(vatira.mode, 'player');
  assert.equal(vatira.player, 'Vatira');
  assert.equal(vatira.label, 'Vatira');
  assert.equal(vatira.playerAvailable, true);
  assert.equal(vatira.metrics['boost.percentZeroBoost'].count, 2, 'seulement les 2 matchs de Vatira');
  assert.equal(vatira.metrics['boost.percentZeroBoost'].p50, 3, 'médiane de 2 et 4');
  assert.equal(vatira.metrics['boost.bpm'].p50, 425);
  assert.notEqual(vatira.metrics['boost.bpm'].p50, global.metrics['boost.bpm'].p50);
});

test('cohorte mono-joueur : un nom inconnu est signalé comme indisponible', () => {
  const unknown = buildCohortFromReplays(replays, {
    playlist: 'ranked-doubles',
    mode: 'player',
    playerName: 'Joueur Inexistant',
  });
  assert.equal(unknown.replaysAnalyzed, 0);
  assert.equal(unknown.playerAvailable, false);
  assert.deepEqual(unknown.metrics, {});
});

test('index des joueurs : sert de source au sélecteur de coach', () => {
  const global = buildCohortFromReplays(replays, { playlist: 'ranked-doubles' });
  const names = global.playerIndex.map((p) => p.name).sort();
  assert.deepEqual(names, ['Atow', 'Rw9', 'Vatira', 'Zen']);
  for (const entry of global.playerIndex) {
    assert.equal(entry.replays, 2);
    assert.ok(entry.lastSeen);
  }
});

test('cohorte mono-joueur : un même compte sous plusieurs pseudos reste reconnu (alias)', () => {
  // Cas réel : « M0nkey M00n » apparaît comme « L4rpey M00n » ou « SH33PY M00N »
  // sur certains replays, mais toujours avec le même id de compte ballchasing.
  const aliased = [
    replayFixture('k1', [
      { name: 'L4rpey M00n', boostZero: 2, bpm: 420, team: 'blue', accountId: 'steam-m0nkey' },
      { name: 'Equipier A', boostZero: 9, bpm: 300, team: 'blue' },
      { name: 'Rival A', boostZero: 8, bpm: 460, team: 'orange' },
      { name: 'Rival B', boostZero: 7, bpm: 470, team: 'orange' },
    ]),
    replayFixture('k2', [
      { name: 'SH33PY M00N', boostZero: 4, bpm: 430, team: 'blue', accountId: 'steam-m0nkey' },
      { name: 'Equipier A', boostZero: 9, bpm: 300, team: 'blue' },
      { name: 'Rival A', boostZero: 8, bpm: 460, team: 'orange' },
      { name: 'Rival B', boostZero: 7, bpm: 470, team: 'orange' },
    ]),
  ];

  const cohort = buildCohortFromReplays(aliased, {
    playlist: 'ranked-doubles',
    mode: 'player',
    playerName: 'M0nkey M00n',
  });

  assert.equal(cohort.replaysAnalyzed, 2, 'les deux pseudos comptent pour le même joueur');
  assert.equal(cohort.playerAvailable, true);
  assert.equal(cohort.resolution.method, 'alias');
  assert.equal(cohort.resolution.unresolved, false);
  assert.equal(cohort.metrics['boost.percentZeroBoost'].count, 2, 'une performance par replay');
  assert.equal(cohort.metrics['boost.percentZeroBoost'].p50, 3, 'médiane de 2 et 4');
  assert.match(cohort.note, /L4rpey M00n/);
  assert.match(cohort.note, /SH33PY M00N/);
});

test('cohorte mono-joueur : les pseudos rencontrés sont listés si le joueur est absent', () => {
  const cohort = buildCohortFromReplays(replays, {
    playlist: 'ranked-doubles',
    mode: 'player',
    playerName: 'M0nkey M00n',
  });
  assert.equal(cohort.replaysAnalyzed, 0);
  assert.equal(cohort.playerAvailable, false);
  assert.equal(cohort.resolution.method, 'none');
  assert.equal(cohort.resolution.unresolved, true);
  assert.deepEqual(cohort.resolution.seenNames.sort(), ['Atow', 'Rw9', 'Vatira', 'Zen']);
});

test('replayToMatch : lit les rosters blue/orange et les buts d’équipe', () => {
  const replay = replayFixture(
    'bc-1',
    [
      { name: 'Vatira', boostZero: 2, bpm: 420, team: 'blue' },
      { name: 'Zen', boostZero: 3, bpm: 440, team: 'blue' },
      { name: 'Rw9', boostZero: 5, bpm: 400, team: 'orange' },
      { name: 'Atow', boostZero: 7, bpm: 460, team: 'orange' },
    ],
    { blueGoals: 3, orangeGoals: 1 },
  );

  const match = replayToMatch(replay, { playerName: 'Vatira' });
  assert.equal(match.players.length, 4, 'les deux rosters sont convertis');
  assert.deepEqual(match.players.map((p) => p.team), [0, 0, 1, 1]);
  assert.deepEqual(match.teamScores, { 0: 3, 1: 1 });
  assert.equal(match.winner, 0);
  assert.equal(match.result, 'win');
  assert.equal(match.durationSeconds, 300);
  assert.equal(match.externalId, 'bc-1');
  assert.equal(match.ballchasingUrl, 'https://ballchasing.com/replay/bc-1');
  assert.deepEqual(match.warnings, []);

  const local = match.players.find((p) => p.isLocal);
  assert.equal(local.name, 'Vatira');
  assert.equal(local.stats.boost.bpm, 420, 'les stats ballchasing sont normalisées');

  // alias : le joueur local est reconnu même sous un autre pseudo du même compte
  const aliasReplay = replayFixture('bc-2', [
    { name: 'L4rpey M00n', boostZero: 2, bpm: 420, team: 'blue', accountId: 'steam-m0nkey' },
    { name: 'Zen', boostZero: 3, bpm: 440, team: 'blue' },
    { name: 'Rw9', boostZero: 5, bpm: 400, team: 'orange' },
    { name: 'Atow', boostZero: 7, bpm: 460, team: 'orange' },
  ]);
  const aliasMatch = replayToMatch(aliasReplay, { playerName: 'M0nkey M00n' });
  assert.equal(aliasMatch.localPlayer, 'L4rpey M00n');
  assert.equal(aliasMatch.players.filter((p) => p.isLocal).length, 1);
});

test('comparaison : le libellé de référence suit la cohorte (mono-joueur incluse)', () => {
  const vatira = buildCohortFromReplays(replays, { playlist: 'ranked-doubles', mode: 'player', playerName: 'Vatira' });
  const stats = {
    core: { goals: 1, shots: 3, saves: 1, assists: 0, score: 250, shootingPercentage: 33 },
    boost: { bpm: 300, avgAmount: 25, percentZeroBoost: 12, amountStolen: 100 },
    movement: { avgSpeed: 1400, percentSupersonicSpeed: 8, percentSlowSpeed: 35, percentHighAir: 4 },
    positioning: { avgDistanceToBall: 2400, percentOffensiveThird: 20, avgDistanceToTeammates: 2000 },
    demo: { inflicted: 1, taken: 2 },
    custom: { touchesPerMinute: 14, aerialHitPercent: 6 },
  };
  const comparison = compareToCohort({
    stats,
    durationSeconds: 300,
    cohort: vatira,
    playlist: 'ranked-doubles',
    teamSize: 2,
  });
  assert.equal(comparison.referenceLabel, 'Vatira');
  assert.equal(comparison.cohort.mode, 'player');
  assert.equal(comparison.cohort.player, 'Vatira');
});

test('coaching : le diagnostic cite la référence choisie', () => {
  const vatira = buildCohortFromReplays(replays, { playlist: 'ranked-doubles', mode: 'player', playerName: 'Vatira' });
  const { messages } = buildSimulatedMatch({ seed: 21, durationSeconds: 150, localName: 'Toi', profile: 'casual' });
  let match = null;
  const tracker = new MatchTracker({ playerName: 'Toi', onMatchEnded: (m) => { match = m; } });
  for (const message of messages) tracker.ingest(message);

  const { comparison, coaching } = coachMatch({ match, cohort: vatira });
  assert.equal(comparison.referenceLabel, 'Vatira');
  assert.ok(coaching.summary.includes('Vatira'), `synthèse : ${coaching.summary.slice(0, 120)}`);
  const boost = coaching.recommendations.find((r) => r.id === 'boost-drought');
  if (boost) assert.ok(boost.diagnosis.includes('Vatira'), 'le diagnostic doit nommer le pro de référence');
});

test('coach global : agrège plusieurs pros et reste distinct du mono-joueur', () => {
  const global = buildCohortFromReplays(replays, { playlist: 'ranked-doubles', mode: 'global' });
  const vatira = buildCohortFromReplays(replays, { playlist: 'ranked-doubles', mode: 'player', playerName: 'Vatira' });
  const seed = buildSeedCohort('ranked-doubles');

  assert.equal(global.label, 'Pros (cohorte globale)');
  assert.equal(global.playersAnalyzed, 4);
  assert.equal(global.playerIndex.length, 4);
  assert.ok(global.sampleSize > vatira.sampleSize);

  const overview = coachOverview({
    matches: [],
    cohort: global,
    playlist: 'ranked-doubles',
  });
  assert.equal(overview.cohort.mode, 'global');
  assert.equal(overview.referenceLabel, 'Pros (cohorte globale)');
  assert.ok(seed.metrics['boost.bpm'].p50 !== global.metrics['boost.bpm'].p50);
});

// ---------------------------------------------------------------------------
// Coach IA
// ---------------------------------------------------------------------------

const fakeMatch = {
  id: 'm1',
  playlist: 'ranked-doubles',
  result: 'loss',
  teamScores: { 0: 1, 1: 3 },
  durationSeconds: 300,
  localPlayer: 'Toi',
  players: [{ name: 'Toi', isLocal: true }],
};

const fakeComparison = {
  playlistLabel: '2v2 (Doubles)',
  referenceLabel: 'Vatira',
  cohort: { mode: 'player', label: 'Vatira', replaysAnalyzed: 12 },
  score: 41,
  level: 'en progression',
  metrics: [
    {
      key: 'boost.percentZeroBoost',
      label: 'Temps à 0 boost',
      unit: '%',
      value: 21.4,
      reference: { p10: 1.22, p25: 2.36, p50: 3, p75: 7, p90: 10.5 },
      percentile: 4,
      performance: 4,
      higherIsBetter: false,
    },
    {
      key: 'positioning.percentDefensiveThird',
      label: 'Tiers défensif',
      unit: '%',
      value: 44,
      reference: { p10: 20, p25: 26, p50: 30, p75: 35, p90: 45 },
      percentile: 80,
      performance: 50,
      higherIsBetter: null,
    },
  ],
};
const fakeCoaching = {
  score: 41,
  level: 'en progression',
  strengths: [{ key: 'core.savesPerMinute', label: 'Arrêts / min', unit: '/min', value: 0.4, performance: 72 }],
  weaknesses: [
    {
      key: 'boost.percentZeroBoost',
      label: 'Temps à 0 boost',
      unit: '%',
      value: 21.4,
      reference: 3,
      performance: 4,
    },
  ],
  recommendations: [
    { title: 'Gère ton boost', priority: 100, drills: [{ name: 'Routine de pads' }], target: { current: 21.4, goal: 12 } },
  ],
};

test('IA : la configuration est validée avant tout appel', () => {
  assert.equal(resolveAiConfig({}).enabled, false);
  assert.equal(resolveAiConfig({ provider: 'none' }).enabled, false);

  const openaiNoKey = resolveAiConfig({ provider: 'openai' });
  assert.equal(openaiNoKey.enabled, false);
  assert.match(openaiNoKey.reason, /clé/i);
  assert.equal(openaiNoKey.baseUrl, AI_PROVIDERS.openai.defaultBaseUrl);
  assert.equal(openaiNoKey.model, AI_PROVIDERS.openai.defaultModel);

  const openai = resolveAiConfig({ provider: 'openai', apiKey: 'sk-test' });
  assert.equal(openai.enabled, true);
  assert.equal(openai.apiKey, 'sk-test');

  const ollama = resolveAiConfig({ provider: 'ollama' });
  assert.equal(ollama.enabled, true, 'Ollama local ne demande pas de clé');
  assert.equal(ollama.model, 'llama3.1');

  const noModel = resolveAiConfig({ provider: 'custom', baseUrl: 'http://localhost:1234/v1' });
  assert.equal(noModel.enabled, false);
  assert.match(noModel.reason, /modèle/i);

  const noUrl = resolveAiConfig({ provider: 'custom', model: 'x' });
  assert.equal(noUrl.enabled, false);
  assert.match(noUrl.reason, /URL/i);
});

test('IA : le statut public ne divulgue jamais la clé', () => {
  const status = publicAiStatus({ provider: 'openai', apiKey: 'sk-secret', baseUrl: 'https://api.openai.com/v1' });
  assert.equal(status.keySet, true);
  assert.equal(status.enabled, true);
  assert.ok(!JSON.stringify(status).includes('sk-secret'));
});

test('IA : le prompt contient la fourchette pro (p25–p75) et le sens des métriques', () => {
  const prompt = buildMatchPrompt({ match: fakeMatch, comparison: fakeComparison, coaching: fakeCoaching });
  assert.match(prompt.system, /Rocket League/);
  assert.match(prompt.system, /n'inventes aucun chiffre/);
  assert.match(prompt.system, /fourchette/i);
  assert.match(prompt.system, /p25/);
  assert.match(prompt.user, /Vatira/);
  assert.match(prompt.user, /21\.4/);
  assert.match(prompt.user, /Temps à 0 boost/);
  assert.match(prompt.user, /Ce qui a fonctionné/);

  // fourchette, position et sens sont transmis pour chaque métrique
  assert.match(prompt.user, /"reference_fourchette_p25_p75": \[/);
  assert.match(prompt.user, /2\.36/);
  assert.match(prompt.user, /"position_vs_fourchette": "au_dessus_p75"/);
  assert.match(prompt.user, /"sens": "moins_est_mieux"/);
  assert.match(prompt.user, /"reference_dispersion_p75_moins_p25":/);

  // on retrouve aussi la fourchette sur les faiblesses identifiées
  const weaknessBlock = prompt.user.slice(prompt.user.indexOf('"faiblesses"'), prompt.user.indexOf('"forces"'));
  assert.match(weaknessBlock, /reference_fourchette_p25_p75/);
  assert.match(weaknessBlock, /position_vs_fourchette/);

  // la métrique neutre ne doit pas être présentée comme un axe de progrès
  assert.ok(!prompt.user.includes('Tiers défensif'));
});

test('IA : positionVsRange classe correctement une valeur', () => {
  assert.equal(positionVsRange(1, 2, 7), 'sous_p25');
  assert.equal(positionVsRange(4, 2, 7), 'dans_p25_p75');
  assert.equal(positionVsRange(12, 2, 7), 'au_dessus_p75');
  assert.equal(positionVsRange(2, 2, 7), 'dans_p25_p75', 'borne basse incluse');
  assert.equal(positionVsRange(7, 2, 7), 'dans_p25_p75', 'borne haute incluse');
  assert.equal(positionVsRange(4, null, 7), null);
  assert.equal(positionVsRange(Number.NaN, 2, 7), null);
});

test('IA : le prompt de synthèse inclut aussi la fourchette pro', () => {
  const overviewPrompt = buildOverviewPrompt({
    overview: {
      referenceLabel: 'Pros (cohorte globale)',
      scope: { playlistLabel: '2v2 (Doubles)', matchCount: 8, minutes: 40, wins: 5, losses: 3 },
      score: 44,
      trend: { direction: 'up', delta: 2.1 },
      priorities: [
        {
          title: 'Gère ton boost',
          priority: 100,
          frequency: 100,
          diagnosis: 'x',
          target: { metricKey: 'boost.percentZeroBoost', current: 21.4, goal: 10 },
        },
      ],
      strengths: [{ key: 'core.savesPerMinute', label: 'Arrêts', value: 0.4, performance: 70 }],
      metrics: [
        {
          key: 'boost.percentZeroBoost',
          label: 'Temps à 0 boost',
          unit: '%',
          value: 21.4,
          higherIsBetter: false,
          reference: { p25: 2.36, p50: 3, p75: 7 },
          avgPerformance: 20,
        },
      ],
    },
  });
  assert.match(overviewPrompt.user, /Pros \(cohorte globale\)/);
  assert.match(overviewPrompt.user, /10 prochains matchs/);
  assert.match(overviewPrompt.user, /reference_fourchette_p25_p75/);
  assert.match(overviewPrompt.user, /au_dessus_p75/);
  assert.match(overviewPrompt.user, /"sens": "moins_est_mieux"/);
});

test('IA : appel réussi, réponse vide et erreurs HTTP sont gérées', async () => {
  const okFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '  Débriefing.  ' } }], usage: { total_tokens: 42 } }),
  });
  const ok = await callAi({ config: resolveAiConfig({ provider: 'ollama' }), messages: { system: 's', user: 'u' }, fetchImpl: okFetch });
  assert.equal(ok.ok, true);
  assert.equal(ok.text, 'Débriefing.');
  assert.equal(ok.provider, 'ollama');

  const emptyFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) });
  const empty = await callAi({ config: resolveAiConfig({ provider: 'ollama' }), messages: { system: 's', user: 'u' }, fetchImpl: emptyFetch });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /Réponse inattendue/);

  const unauthorized = async () => ({ ok: false, status: 401, text: async () => 'invalid api key' });
  const denied = await callAi({
    config: resolveAiConfig({ provider: 'openai', apiKey: 'bad' }),
    messages: { system: 's', user: 'u' },
    fetchImpl: unauthorized,
  });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /Clé API refusée/);

  const networkDown = async () => {
    throw new Error('ECONNREFUSED');
  };
  const down = await callAi({ config: resolveAiConfig({ provider: 'ollama' }), messages: { system: 's', user: 'u' }, fetchImpl: networkDown });
  assert.equal(down.ok, false);
  assert.match(down.error, /impossible/);
});

test('IA : sans configuration, aucune requête réseau n’est tentée', async () => {
  let called = false;
  const spyFetch = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const result = await generateMatchNarrative({
    match: fakeMatch,
    comparison: fakeComparison,
    coaching: fakeCoaching,
    config: { provider: 'none' },
    fetchImpl: spyFetch,
  });
  assert.equal(result.ok, false);
  assert.equal(called, false, 'aucun appel réseau sans configuration explicite');

  const testResult = await testAi({ config: { provider: 'openai' }, fetchImpl: spyFetch });
  assert.equal(testResult.ok, false);
  assert.equal(called, false);
});

test('IA : la narration générée est horodatée et traçable', async () => {
  const fakeFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.match(url, /\/chat\/completions$/);
    assert.equal(options.headers.Authorization, 'Bearer sk-test');
    assert.ok(body.messages[0].content.includes('coach professionnel'));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Analyse personnalisée.' } }] }) };
  };
  const result = await generateMatchNarrative({
    match: fakeMatch,
    comparison: fakeComparison,
    coaching: fakeCoaching,
    config: { provider: 'openai', apiKey: 'sk-test' },
    fetchImpl: fakeFetch,
  });
  assert.equal(result.ok, true);
  assert.equal(result.narrative, 'Analyse personnalisée.');
  assert.equal(result.provider, 'openai');
  assert.ok(result.generatedAt);
  assert.equal(result.promptVersion, 1);
});
