#!/usr/bin/env node
/**
 * Simule un match et affiche le diagnostic du coach dans le terminal.
 *
 *   node server/src/cli/simulate.js [--profile=ranked] [--playlist=ranked-doubles] [--duration=300] [--candidates=2]
 */

import { buildSimulatedMatch } from '../rl/simulator.js';
import { MatchTracker } from '../rl/matchTracker.js';
import { coachMatch } from '../coach/engine.js';
import { getCohort } from '../ballchasing/cohort.js';
import { getSettings } from '../../src/store.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }),
);

const settings = getSettings();
const playlist = args.playlist || settings.targetPlaylist || 'ranked-doubles';
const durationSeconds = Number(args.duration) || 240;
const profile = args.profile || 'ranked';
const localName = settings.playerName || args.player || 'Toi';

const { messages, meta } = buildSimulatedMatch({ playlist, durationSeconds, localName, profile, seed: Number(args.seed) || 7 });

let match = null;
const tracker = new MatchTracker({ playerName: localName, onMatchEnded: (m) => { match = m; } });
for (const message of messages) tracker.ingest(message);

if (!match) {
  console.error('Aucun match produit par la simulation.');
  process.exit(1);
}

const cohort = getCohort(playlist);
const { comparison, coaching } = coachMatch({ match, cohort });
const local = match.players.find((p) => p.isLocal);

const bar = (value) => '█'.repeat(Math.round(value / 5)).padEnd(20, '·');

console.log(`\n🏁 Match simulé — ${playlist} — ${meta.teamScores[0]}–${meta.teamScores[1]} (${Math.round(durationSeconds / 60)} min)`);
console.log(`   Référence : ${cohort.isDemo ? 'repères de démarrage (aucune cohorte ballchasing)' : `${cohort.replaysAnalyzed} replays pro`}`);
console.log(`\n   Score coach : ${comparison.score}/100 (${comparison.grade}) — ${comparison.level}`);
console.log(`   ${coaching.headline}\n`);

if (local) {
  console.log('   Métriques clés vs pros :');
  for (const metric of comparison.metrics.filter((m) => m.higherIsBetter !== null).slice(0, 10)) {
    console.log(
      `   ${metric.label.padEnd(34)} ${String(metric.value).padStart(7)}${metric.unit === '%' ? '%' : ''}` +
        ` (pro ${String(metric.reference.p50).padStart(6)}) ${bar(metric.performance)} ${metric.performance.toFixed(0).padStart(3)}%`,
    );
  }
}

console.log('\n   Recommandations priorisées :');
for (const reco of coaching.recommendations) {
  console.log(`\n   ${reco.rank}. [priorité ${reco.priority}] ${reco.title}`);
  console.log(`      ${reco.diagnosis}`);
  console.log(`      Rappel en jeu : ${reco.cue}`);
  console.log(`      Exercice : ${reco.drills[0].name} — ${reco.drills[0].description}`);
  if (reco.target.goal !== null && reco.target.goal !== undefined) {
    console.log(`      Objectif : passer de ${reco.target.current} à ${reco.target.goal}${reco.target.unit === '%' ? ' %' : ''}`);
  }
}
console.log('');
