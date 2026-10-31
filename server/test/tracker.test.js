import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSimulatedMatch } from '../src/rl/simulator.js';
import { MatchTracker } from '../src/rl/matchTracker.js';
import { FIELD, normalizedY, thirdOf, playlistFromTeamSize } from '../src/rl/geometry.js';

function runMatch(options = {}) {
  const { messages, meta } = buildSimulatedMatch({
    seed: 42,
    durationSeconds: 180,
    localName: 'Toi',
    profile: 'ranked',
    ...options,
  });
  let final = null;
  const events = [];
  const tracker = new MatchTracker({
    playerName: 'Toi',
    onMatchEnded: (match) => {
      final = match;
    },
    onEvent: (event) => events.push(event),
  });
  for (const message of messages) tracker.ingest(message);
  return { final, meta, events, tracker, messages };
}

test('géométrie : repère terrain et tiers', () => {
  assert.equal(FIELD.halfLength, 5120);
  // équipe bleue (0) attaque vers +Y
  assert.equal(normalizedY(1000, 0), 1000);
  assert.equal(normalizedY(1000, 1), -1000);
  assert.equal(thirdOf(4000, 0), 'offensive');
  assert.equal(thirdOf(-4000, 0), 'defensive');
  assert.equal(thirdOf(0, 0), 'neutral');
  assert.equal(playlistFromTeamSize(1), 'ranked-duels');
  assert.equal(playlistFromTeamSize(2), 'ranked-doubles');
  assert.equal(playlistFromTeamSize(3), 'ranked-standard');
});

test('simulateur : déterministe pour une même graine', () => {
  const a = buildSimulatedMatch({ seed: 7, durationSeconds: 60 });
  const b = buildSimulatedMatch({ seed: 7, durationSeconds: 60 });
  assert.equal(a.messages.length, b.messages.length);
  assert.deepEqual(a.meta.teamScores, b.meta.teamScores);
  const c = buildSimulatedMatch({ seed: 8, durationSeconds: 60 });
  assert.notDeepEqual(a.meta.teamScores, c.meta.teamScores);
});

test('simulateur : le score des buts correspond aux événements GoalScored', () => {
  const { messages, meta } = buildSimulatedMatch({ seed: 3, durationSeconds: 120 });
  const goals = messages.filter((m) => m.Event === 'GoalScored').length;
  assert.equal(goals, meta.teamScores[0] + meta.teamScores[1]);
  assert.ok(meta.teamScores[0] + meta.teamScores[1] > 0, 'un match de 2 min doit produire au moins un but');
});

test('tracker : finalise un match complet avec des métriques ballchasing-like', () => {
  const { final, meta } = runMatch();
  assert.ok(final, 'le match doit être finalisé');
  assert.equal(final.players.length, 4, '2v2 → 4 joueurs');
  assert.equal(final.source, 'rl-stats-api');
  assert.ok(final.durationSeconds > 170 && final.durationSeconds <= 181, `durée inattendue : ${final.durationSeconds}`);
  assert.deepEqual(final.teamScores, meta.teamScores);

  const local = final.players.find((p) => p.isLocal);
  assert.ok(local, 'le joueur local doit être identifié par son pseudo');
  const stats = local.stats;

  for (const group of ['core', 'boost', 'movement', 'positioning', 'demo', 'custom']) {
    assert.ok(stats[group], `groupe de stats manquant : ${group}`);
  }

  // cohérences internes
  assert.ok(stats.custom.touches > 0, 'des touches doivent être comptées');
  assert.ok(stats.movement.totalDistance > 10000, 'la voiture doit parcourir du terrain');
  assert.ok(stats.movement.avgSpeed > 100 && stats.movement.avgSpeed <= 2300);
  assert.ok(stats.boost.amountCollected > 0);
  assert.ok(stats.boost.percentZeroBoost >= 0 && stats.boost.percentZeroBoost <= 100);
  assert.ok(Math.abs(stats.meta.activeSeconds - final.durationSeconds) < 20);

  // les pourcentages de zones doivent couvrir ~100 %
  const thirds =
    stats.positioning.percentDefensiveThird +
    stats.positioning.percentNeutralThird +
    stats.positioning.percentOffensiveThird;
  assert.ok(Math.abs(thirds - 100) < 1.5, `somme des tiers = ${thirds}`);

  const movement =
    stats.movement.percentSlowSpeed + stats.movement.percentBoostSpeed + stats.movement.percentFastSpeed;
  assert.ok(Math.abs(movement - 100) < 1.5, `somme des vitesses = ${movement}`);
});

test('tracker : accepte les messages en chaîne JSON (format réel du jeu)', () => {
  const tracker = new MatchTracker({ playerName: 'Toi' });
  const payload = JSON.stringify({
    Event: 'MatchCreated',
    Data: JSON.stringify({
      MatchGuid: 'abc',
      Players: [
        { Name: 'Toi', PrimaryId: 'p1', TeamNum: 0 },
        { Name: 'Bot', PrimaryId: 'p2', TeamNum: 1 },
      ],
    }),
  });
  tracker.ingest(payload);
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.players.length, 2);
  assert.ok(snapshot.localPlayer);
  assert.equal(snapshot.localPlayer.name, 'Toi');
});

test('tracker : ignore les matchs trop courts', () => {
  const tracker = new MatchTracker({ playerName: 'Toi' });
  tracker.ingest({
    Event: 'MatchCreated',
    Data: JSON.stringify({ MatchGuid: 'x', Players: [{ Name: 'Toi', PrimaryId: 'p1', TeamNum: 0 }] }),
  });
  const final = tracker.finalize({});
  assert.equal(final, null);
});

test('tracker : score des équipes et résultat', () => {
  const tracker = new MatchTracker({ playerName: 'Toi' });
  tracker.ingest({
    Event: 'MatchCreated',
    Data: JSON.stringify({
      MatchGuid: 'g1',
      Players: [
        { Name: 'Toi', PrimaryId: 'p1', TeamNum: 0 },
        { Name: 'Adv', PrimaryId: 'p2', TeamNum: 1 },
      ],
    }),
  });
  for (let i = 1; i <= 60; i += 1) {
    tracker.ingest({
      Event: 'UpdateState',
      Data: JSON.stringify({
        Game: { TimeSeconds: i, Teams: [{ TeamNum: 0, Score: 2 }, { TeamNum: 1, Score: 1 }] },
        Ball: { Location: { X: 0, Y: 0, Z: 93 } },
        Players: [
          { Name: 'Toi', PrimaryId: 'p1', TeamNum: 0, Boost: 50, Speed: 1200, Location: { X: 0, Y: -1000, Z: 17 }, bOnGround: true },
          { Name: 'Adv', PrimaryId: 'p2', TeamNum: 1, Boost: 50, Speed: 1200, Location: { X: 0, Y: 1000, Z: 17 }, bOnGround: true },
        ],
      }),
    });
  }
  const final = tracker.finalize({ Winner: 0 });
  assert.ok(final);
  assert.equal(final.winner, 0);
  assert.equal(final.result, 'win');
  assert.deepEqual(final.teamScores, { 0: 2, 1: 1 });
});

/** Frame UpdateState minimale ; `begunPlay` reproduit le champ du jeu. */
function updateStateFrame({ time, begunPlay, score = [0, 0], boost = 50 }) {
  const game = {
    TimeSeconds: time,
    Teams: [
      { TeamNum: 0, Score: score[0] },
      { TeamNum: 1, Score: score[1] },
    ],
  };
  if (begunPlay !== undefined) game.bReplicatedHasBegunPlay = begunPlay;
  return {
    Event: 'UpdateState',
    Data: JSON.stringify({
      Game: game,
      Ball: { Location: { X: 0, Y: 0, Z: 93 } },
      Players: [
        { Name: 'Toi', PrimaryId: 'p1', TeamNum: 0, Boost: boost, Speed: 1200, Location: { X: 0, Y: -1000, Z: 17 }, bOnGround: true },
        { Name: 'Adv', PrimaryId: 'p2', TeamNum: 1, Boost: boost, Speed: 1200, Location: { X: 0, Y: 1000, Z: 17 }, bOnGround: true },
      ],
    }),
  };
}

function matchCreatedMessage(guid, players = [
  { Name: 'Toi', PrimaryId: 'p1', TeamNum: 0 },
  { Name: 'Adv', PrimaryId: 'p2', TeamNum: 1 },
]) {
  return { Event: 'MatchCreated', Data: JSON.stringify({ MatchGuid: guid, Players: players }) };
}

test('tracker : le jeu libre ne collecte aucune statistique', () => {
  const tracker = new MatchTracker({ playerName: 'Toi' });
  tracker.ingest(matchCreatedMessage('fp'));
  for (let i = 1; i <= 60; i += 1) tracker.ingest(updateStateFrame({ time: i, begunPlay: false }));

  const snapshot = tracker.snapshot();
  assert.equal(snapshot.freeplay, true, 'le jeu libre doit être signalé');
  assert.equal(snapshot.active, false, 'aucun match actif en jeu libre');
  assert.deepEqual(snapshot.players, [], 'aucun joueur exposé');
  assert.equal(snapshot.localPlayer, null);
  assert.deepEqual(snapshot.teamScores, { 0: 0, 1: 0 });
  assert.equal(snapshot.gameTimeSeconds, 0, 'le chrono ne doit pas avancer');
  assert.equal(tracker.finalize({}), null, 'aucun match ne doit être produit');
});

test('tracker : sans bReplicatedHasBegunPlay, la détection reste inchangée', () => {
  // Non-régression : les versions du jeu qui n'envoient pas le champ doivent
  // continuer à produire un match normal.
  const tracker = new MatchTracker({ playerName: 'Toi' });
  tracker.ingest(matchCreatedMessage('legacy'));
  for (let i = 1; i <= 60; i += 1) tracker.ingest(updateStateFrame({ time: i }));

  const snapshot = tracker.snapshot();
  assert.equal(snapshot.freeplay, false);
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.players.length, 2);
  assert.ok(tracker.finalize({ Winner: 0 }), 'le match doit être finalisé normalement');
});

test('tracker : sortir du jeu libre relance une détection normale', () => {
  const tracker = new MatchTracker({ playerName: 'Toi' });
  for (let i = 1; i <= 20; i += 1) tracker.ingest(updateStateFrame({ time: i, begunPlay: false }));
  assert.equal(tracker.snapshot().freeplay, true);

  tracker.ingest(matchCreatedMessage('m2'));
  for (let i = 1; i <= 120; i += 1) tracker.ingest(updateStateFrame({ time: i, begunPlay: true }));

  const snapshot = tracker.snapshot();
  assert.equal(snapshot.freeplay, false, 'le jeu libre doit se terminer au coup d’envoi');
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.players.length, 2);
  assert.ok(tracker.finalize({ Winner: 0 }), 'le match suivant doit être finalisé');
});

test('tracker : passer en jeu libre en cours de match abandonne les données', () => {
  const tracker = new MatchTracker({ playerName: 'Toi' });
  let ended = 0;
  tracker.onMatchEnded = () => {
    ended += 1;
  };

  tracker.ingest(matchCreatedMessage('m3'));
  for (let i = 1; i <= 30; i += 1) tracker.ingest(updateStateFrame({ time: i, begunPlay: true }));
  assert.equal(tracker.snapshot().active, true, 'le match doit d’abord être actif');

  // Retour au jeu libre sans MatchEnded : les données partielles sont jetées.
  for (let i = 31; i <= 40; i += 1) tracker.ingest(updateStateFrame({ time: i, begunPlay: false }));
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.freeplay, true);
  assert.equal(snapshot.active, false);
  assert.equal(snapshot.players.length, 0, 'les stats du match interrompu sont effacées');

  tracker.ingest({ Event: 'MatchEnded', Data: JSON.stringify({ Winner: 0 }) });
  assert.equal(ended, 0, 'aucun match ne doit être enregistré depuis le jeu libre');
});
