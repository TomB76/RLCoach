/**
 * Construction et cache des références pro.
 *
 * Deux modes de référence :
 *  - « global »  : cohorte agrégée de tous les joueurs pros analysés (coach global) ;
 *  - « player »  : cohorte mono-joueur, calculée uniquement sur ses propres replays.
 *
 * Dans les deux cas on stocke des distributions (p10 → p90) par métrique, ce qui
 * permet de comparer un match exactement de la même façon.
 *
 * Les clés de métriques suivent ballchasing (`boost.percentZeroBoost`…).
 */

import { BALLCHASING_MIN_INTERVAL_MS, PLAYLISTS } from '../config.js';
import { getProCache, setProCache } from '../store.js';
import { BallchasingClient } from './client.js';
import { METRICS, metricValue, summarize } from '../coach/metrics.js';
import { buildSeedCohort } from '../coach/seedBenchmarks.js';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const MAX_REPLAYS_PER_REFRESH = 60;

/** État du rafraîchissement en cours (exposé à l'UI). */
export const refreshState = {
  running: false,
  playlist: null,
  mode: 'global',
  player: null,
  done: 0,
  total: 0,
  error: null,
  startedAt: null,
  finishedAt: null,
  source: null,
};

/** Identifiant de cache stable pour un nom de joueur. */
export function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Clé de cache d'une référence.
 * - global  → `cohort:<playlist>`
 * - joueur  → `cohort:<playlist>:player:<slug>`
 */
export function cohortKey(playlist, mode = 'global', player = null) {
  if (mode === 'player' && player) return `cohort:${playlist}:player:${slugify(player)}`;
  return `cohort:${playlist}`;
}

/** Référence de secours : repères de démarrage, marqués comme tels. */
export function fallbackCohort(playlist, { mode = 'global', player = null } = {}) {
  const seed = buildSeedCohort(playlist || 'ranked-doubles');
  return {
    ...seed,
    mode,
    player: mode === 'player' ? player : null,
    label: mode === 'player' ? `${player} (aucun replay analysé)` : 'Pros — repères de démarrage',
    playerAvailable: mode === 'player' ? false : null,
  };
}

/**
 * Retourne la référence active : cache valide, sinon repères de démarrage.
 */
export function getCohort(playlist = 'ranked-doubles', { mode = 'global', player = null, allowStale = true } = {}) {
  const key = cohortKey(playlist, mode, player);
  const cached = getProCache(key);
  if (cached && (allowStale || !isStale(cached))) {
    return { ...cached, mode, player: mode === 'player' ? player : null };
  }
  return fallbackCohort(playlist, { mode, player });
}

/** Indique si une cohorte est absente ou trop ancienne. */
export function isStale(cohort) {
  if (!cohort?.updatedAt) return true;
  return Date.now() - new Date(cohort.updatedAt).getTime() > CACHE_TTL_MS;
}

/**
 * Agrège une liste de replays ballchasing en une cohorte de distributions.
 *
 * @param {object[]} replays replays ballchasing (avec `players[].stats`)
 * @param {object} options
 * @param {string} options.playlist
 * @param {string} [options.source]
 * @param {'global'|'player'} [options.mode]
 * @param {string|null} [options.playerName] si fourni, on ne garde que ce joueur
 */
export function buildCohortFromReplays(
  replays,
  { playlist, source = 'ballchasing', mode = 'global', playerName = null } = {},
) {
  const buckets = new Map(METRICS.map((metric) => [metric.key, []]));
  const players = new Map(); // id/nom → { name, replays:Set, teamSize }
  const target = playerName ? normalizeName(playerName) : null;
  let usableReplays = 0;
  let playerMatchCount = 0;
  const replayIndex = [];

  for (const replay of replays) {
    if (!replay || replay.status === 'pending') continue;
    const duration = Number(replay.duration) || 0;
    if (duration < 45) continue; // matchs trop courts / bots
    const teamSize = Number(replay.team_size) || 2;
    const roster = Array.isArray(replay.players) ? replay.players : [];
    if (roster.length < teamSize * 2) continue;

    let counted = false;
    for (const player of roster) {
      const raw = player?.stats;
      if (!raw?.core || !raw?.movement || !raw?.positioning) continue;

      const name = String(player.name || '').trim();
      const isTarget = target ? normalizeName(name) === target : true;
      const stats = normalizeBallchasingStats(raw, duration);

      if (isTarget) {
        for (const metric of METRICS) {
          if (teamSize === 1 && metric.key === 'positioning.avgDistanceToTeammates') continue;
          if (teamSize === 1 && metric.key === 'core.assistsPerMinute') continue;
          const value = metricValue(metric, stats, duration);
          if (Number.isFinite(value)) buckets.get(metric.key).push(value);
        }
        counted = true;
        if (target) playerMatchCount += 1;
      }

      // index des joueurs rencontrés (sert au sélecteur de coach)
      if (name) {
        const key = normalizeName(name);
        if (!players.has(key)) {
          players.set(key, { name, id: player.id || null, replays: new Set(), matches: 0, lastSeen: null });
        }
        const entry = players.get(key);
        entry.replays.add(replay.id);
        if (isTarget) entry.matches += 1;
        if (!entry.lastSeen || String(replay.date) > String(entry.lastSeen)) entry.lastSeen = replay.date;
      }
    }

    if (counted) {
      usableReplays += 1;
      replayIndex.push({
        id: replay.id,
        date: replay.date,
        playlist: replay.playlist,
        duration,
        teamSize,
      });
    }
  }

  const metrics = {};
  let sampleSize = 0;
  for (const metric of METRICS) {
    const values = buckets.get(metric.key) || [];
    const summary = summarize(values);
    if (!summary) continue;
    metrics[metric.key] = summary;
    sampleSize = Math.max(sampleSize, summary.count);
  }
  const totalSamples = Object.values(metrics).reduce((acc, m) => acc + (m.count || 0), 0);

  const playerIndex = [...players.values()]
    .map((entry) => ({
      name: entry.name,
      id: entry.id,
      replays: entry.replays.size,
      matches: entry.matches,
      lastSeen: entry.lastSeen,
    }))
    .sort((a, b) => b.replays - a.replays);

  const isPlayerMode = mode === 'player';
  const label = isPlayerMode ? playerName : 'Pros (cohorte globale)';

  /**
   * Fiabilité de l'échantillon : une cohorte mono-joueur peut reposer sur peu de
   * replays, ce qui rend les percentiles grossiers. On l'expose explicitement.
   */
  const quality = usableReplays >= 15 ? 'good' : usableReplays >= 5 ? 'fair' : 'low';
  const qualityNote =
    quality === 'good'
      ? ''
      : quality === 'fair'
        ? ' Échantillon modéré : les percentiles restent indicatifs.'
        : ' Échantillon faible : interprète les percentiles avec prudence (idéalement 15 replays ou plus).';

  const note =
    (isPlayerMode
      ? `Référence mono-joueur : ${usableReplays} replay(s) de ${playerName} (${playerMatchCount} performance(s) mesurée(s)).`
      : `Cohorte globale construite sur ${usableReplays} replays pro (${players.size} joueurs) récupérés via l'API ballchasing.`) +
    qualityNote;

  return {
    playlist,
    playlistLabel: PLAYLISTS[playlist]?.label || playlist,
    source,
    mode,
    player: isPlayerMode ? playerName : null,
    label,
    quality,
    playerAvailable: isPlayerMode ? usableReplays > 0 : null,
    isDemo: false,
    updatedAt: new Date().toISOString(),
    sampleSize: totalSamples,
    playersAnalyzed: isPlayerMode ? new Set([normalizeName(playerName)]).size : players.size,
    replaysAnalyzed: usableReplays,
    replays: replayIndex,
    playerIndex,
    metrics,
    note,
  };
}

/**
 * Rafraîchit une référence depuis ballchasing (tâche appelée par l'API).
 *
 * @param {object} params
 * @param {string} params.token token API ballchasing
 * @param {string} params.playlist
 * @param {number} params.size nombre de replays à analyser
 * @param {'global'|'player'} [params.mode]
 * @param {string|null} [params.player]
 * @param {(progress: object) => void} [params.onProgress]
 */
export async function refreshCohort({
  token = '',
  playlist = 'ranked-doubles',
  size = 30,
  mode = 'global',
  player = null,
  onProgress = null,
} = {}) {
  if (refreshState.running) {
    return { ok: false, error: 'Une actualisation est déjà en cours.' };
  }
  const isPlayerMode = mode === 'player';
  if (isPlayerMode && !String(player || '').trim()) {
    return { ok: false, error: 'Indique le nom du joueur pro à analyser.' };
  }
  const count = Math.max(5, Math.min(MAX_REPLAYS_PER_REFRESH, Number(size) || 30));

  Object.assign(refreshState, {
    running: true,
    playlist,
    mode,
    player: isPlayerMode ? player : null,
    done: 0,
    total: count,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    source: null,
  });

  const client = new BallchasingClient({ token, minIntervalMs: BALLCHASING_MIN_INTERVAL_MS });

  try {
    const notify = () => onProgress?.({ ...refreshState });

    let list;
    let source;
    if (isPlayerMode) {
      list = await client.listPlayerReplays({ playlist, count, playerName: player, pro: true });
      source = 'ballchasing:player-pro';
      if (!list.length) {
        list = await client.listPlayerReplays({ playlist, count, playerName: player, pro: false });
        source = 'ballchasing:player-any';
      }
      if (!list.length) {
        throw new Error(
          `Aucun replay trouvé pour « ${player} » en ${PLAYLISTS[playlist]?.label || playlist}. Vérifie l'orthographe exacte du pseudo (tel qu'il apparaît sur ballchasing).`,
        );
      }
    } else {
      list = await client.listProReplays({ playlist, count });
      source = 'ballchasing:pro';
      if (!list.length) {
        // Repli : pas de matchs étiquetés pro → on prend les plus hauts rangs.
        list = await client.listProReplays({ playlist, count, pro: false, minRank: 'grand-champion' });
        source = 'ballchasing:grand-champion';
      }
      if (!list.length) {
        throw new Error("Aucun replay trouvé sur ballchasing pour ce mode. Vérifie le token et le mode sélectionné.");
      }
    }

    refreshState.total = Math.min(count, list.length);
    notify();

    const replays = [];
    for (const entry of list.slice(0, refreshState.total)) {
      try {
        const replay = await client.getReplay(entry.id);
        replays.push(replay);
      } catch (err) {
        // Un replay indisponible ne doit pas bloquer toute la cohorte.
        console.warn(`[cohort] replay ${entry.id} ignoré : ${err.message}`);
      }
      refreshState.done += 1;
      notify();
    }

    const cohort = buildCohortFromReplays(replays, {
      playlist,
      source,
      mode,
      playerName: isPlayerMode ? player : null,
    });

    if (!cohort.replaysAnalyzed) {
      throw new Error(
        isPlayerMode
          ? `Les replays récupérés ne contiennent pas de statistiques exploitables pour « ${player} ».`
          : "Les replays récupérés ne contiennent pas assez de statistiques exploitables.",
      );
    }

    setProCache(cohortKey(playlist, mode, player), cohort);
    Object.assign(refreshState, {
      running: false,
      finishedAt: new Date().toISOString(),
      source,
      done: refreshState.done,
    });
    notify();
    return { ok: true, cohort, state: { ...refreshState } };
  } catch (err) {
    Object.assign(refreshState, {
      running: false,
      error: err.message,
      finishedAt: new Date().toISOString(),
    });
    onProgress?.({ ...refreshState });
    return { ok: false, error: err.message, state: { ...refreshState } };
  }
}

/** Vérifie qu'un token ballchasing est valide (GET /replays, 1 résultat). */
export async function checkToken(token) {
  const client = new BallchasingClient({ token, minIntervalMs: 0 });
  try {
    await client.request('/replays?count=1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message, status: err.status ?? null };
  }
}

/**
 * Joueurs pros connus pour un mode, d'après la cohorte globale en cache.
 * Sert de source au sélecteur « prendre X comme coach ».
 */
export function listKnownPlayers(playlist = 'ranked-doubles') {
  const global = getProCache(cohortKey(playlist, 'global', null));
  const index = global?.playerIndex || [];
  const withCohort = index
    .map((entry) => ({
      ...entry,
      hasCohort: Boolean(getProCache(cohortKey(playlist, 'player', entry.name))),
      cohortReplays: getProCache(cohortKey(playlist, 'player', entry.name))?.replaysAnalyzed || 0,
    }))
    .sort((a, b) => b.replays - a.replays);
  return {
    playlist,
    playlistLabel: PLAYLISTS[playlist]?.label || playlist,
    source: global ? 'cohorte globale' : 'aucune cohorte globale en cache',
    updatedAt: global?.updatedAt || null,
    players: withCohort,
  };
}

/**
 * Convertit un replay ballchasing (uploadé ou récupéré) en match analysable
 * par le moteur de coaching.
 */
export function replayToMatch(replay, { playerName = '', playlistHint = null } = {}) {
  const duration = Number(replay.duration) || 0;
  const blueGoals = Number(replay.blue?.goals) || 0;
  const orangeGoals = Number(replay.orange?.goals) || 0;
  const winner = blueGoals === orangeGoals ? null : blueGoals > orangeGoals ? 0 : 1;
  const roster = Array.isArray(replay.players) ? replay.players : [];

  const players = roster.map((player) => {
    const team = player.team === 'orange' ? 1 : 0;
    const stats = normalizeBallchasingStats(player.stats || {}, duration);
    return {
      id: player.id || player.name,
      name: player.name,
      team,
      isLocal: Boolean(playerName && normalizeName(player.name) === normalizeName(playerName)),
      stats,
      rlCoachScore: null,
      grade: null,
    };
  });

  const local = players.find((p) => p.isLocal) || null;
  const result = winner === null || !local ? 'unknown' : local.team === winner ? 'win' : 'loss';

  return {
    id: `bc-${replay.id}`,
    guid: replay.id,
    date: replay.date || new Date().toISOString(),
    mode: 'ballchasing',
    playlist: replay.playlist || playlistHint || 'ranked-doubles',
    playlistLabel: PLAYLISTS[replay.playlist]?.label || replay.playlist,
    arena: replay.map_name || replay.map_code || null,
    durationSeconds: duration,
    teamScores: { 0: blueGoals, 1: orangeGoals },
    winner,
    result,
    localPlayer: local?.name || playerName || null,
    players,
    goals: [],
    events: [],
    source: 'ballchasing',
    externalId: replay.id,
    ballchasingUrl: `https://ballchasing.com/replay/${replay.id}`,
    warnings: local ? [] : ['Aucun joueur ne correspond à ton pseudo : renseigne-le dans les réglages.'],
    comparison: null,
    coaching: null,
  };
}

/** Normalise les stats ballchasing (snake_case) au format interne. */
function normalizeBallchasingStats(stats = {}, duration = 0) {
  return {
    core: {
      shots: stats.core?.shots ?? 0,
      goals: stats.core?.goals ?? 0,
      saves: stats.core?.saves ?? 0,
      assists: stats.core?.assists ?? 0,
      score: stats.core?.score ?? 0,
      shootingPercentage: stats.core?.shooting_percentage ?? 0,
      mvp: Boolean(stats.core?.mvp),
    },
    boost: {
      bpm: stats.boost?.bpm ?? 0,
      avgAmount: stats.boost?.avg_amount ?? 0,
      amountCollected: stats.boost?.amount_collected ?? 0,
      amountStolen: stats.boost?.amount_stolen ?? 0,
      amountCollectedBig: stats.boost?.amount_collected_big ?? 0,
      amountCollectedSmall: stats.boost?.amount_collected_small ?? 0,
      countCollectedBig: stats.boost?.count_collected_big ?? 0,
      countCollectedSmall: stats.boost?.count_collected_small ?? 0,
      timeZeroBoost: stats.boost?.time_zero_boost ?? 0,
      timeFullBoost: stats.boost?.time_full_boost ?? 0,
      percentZeroBoost: stats.boost?.percent_zero_boost ?? 0,
      percentFullBoost: stats.boost?.percent_full_boost ?? 0,
      percentBoosting: stats.boost?.percent_boost_0_25 ?? 0,
    },
    movement: {
      avgSpeed: stats.movement?.avg_speed ?? 0,
      totalDistance: stats.movement?.total_distance ?? 0,
      timeSupersonicSpeed: stats.movement?.time_supersonic_speed ?? 0,
      percentSupersonicSpeed: stats.movement?.percent_supersonic_speed ?? 0,
      timeSlowSpeed: stats.movement?.time_slow_speed ?? 0,
      percentSlowSpeed: stats.movement?.percent_slow_speed ?? 0,
      timeBoostSpeed: stats.movement?.time_boost_speed ?? 0,
      percentBoostSpeed: stats.movement?.percent_boost_speed ?? 0,
      timeFastSpeed: stats.movement?.time_fast_speed ?? 0,
      percentFastSpeed: stats.movement?.percent_fast_speed ?? 0,
      timeGround: stats.movement?.time_ground ?? 0,
      percentGround: stats.movement?.percent_ground ?? 0,
      timeLowAir: stats.movement?.time_low_air ?? 0,
      percentLowAir: stats.movement?.percent_low_air ?? 0,
      timeHighAir: stats.movement?.time_high_air ?? 0,
      percentHighAir: stats.movement?.percent_high_air ?? 0,
      avgSpeedPerMinute: 0,
    },
    positioning: {
      avgDistanceToBall: stats.positioning?.avg_distance_to_ball ?? 0,
      avgDistanceToBallPossession: stats.positioning?.avg_distance_to_ball_possession ?? 0,
      avgDistanceToBallNoPossession: stats.positioning?.avg_distance_to_ball_no_possession ?? 0,
      avgDistanceToTeammates: stats.positioning?.avg_distance_to_mates ?? 0,
      percentDefensiveHalf: stats.positioning?.percent_defensive_half ?? 0,
      percentOffensiveHalf: stats.positioning?.percent_offensive_half ?? 0,
      percentDefensiveThird: stats.positioning?.percent_defensive_third ?? 0,
      percentNeutralThird: stats.positioning?.percent_neutral_third ?? 0,
      percentOffensiveThird: stats.positioning?.percent_offensive_third ?? 0,
      percentBehindBall: stats.positioning?.percent_behind_ball ?? 0,
      percentAheadOfBall: 0,
      percentLastMan: 0,
    },
    demo: {
      inflicted: stats.demo?.inflicted ?? 0,
      taken: stats.demo?.taken ?? 0,
    },
    custom: {
      // ballchasing n'expose pas les touches : on laisse `null` pour que le
      // moteur ignore ces métriques au lieu de les compter comme nulles.
      touches: null,
      carTouches: null,
      touchesPerMinute: null,
      ballHits: null,
      aerialHits: null,
      aerialHitPercent: null,
      ballCarryPercent: null,
      kickoffFirstTouches: null,
      crossbarHits: null,
      timeDemolished: null,
      boostStolenShare: null,
    },
    meta: {
      activeSeconds: duration || null,
      minutes: null,
      samples: 0,
    },
  };
}
