/**
 * Construction et cache de la cohorte pro (distributions par métrique),
 * à partir des replays professionnels de ballchasing.com.
 *
 * Stratégie :
 *  1. lister les derniers replays « pro » du mode voulu ;
 *  2. récupérer chaque replay pour obtenir les stats de chaque joueur ;
 *  3. agréger les métriques et calculer les quantiles (p10 → p90) ;
 *  4. mettre la cohorte en cache sur disque (data/pro-cache.json).
 *
 * Sans token / sans réseau, on retombe sur les repères de démarrage
 * (seedBenchmarks.js), clairement identifiés comme tels dans l'UI.
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
  done: 0,
  total: 0,
  error: null,
  startedAt: null,
  finishedAt: null,
  source: null,
};

function cacheKey(playlist) {
  return `cohort:${playlist}`;
}

/** Cohortede secours : repères de démarrage. */
export function fallbackCohort(playlist) {
  return buildSeedCohort(playlist || 'ranked-doubles');
}

/**
 * Retourne la cohorte pro d'un mode : cache valide, sinon repères de démarrage.
 */
export function getCohort(playlist = 'ranked-doubles', { allowStale = true } = {}) {
  const cached = getProCache(cacheKey(playlist));
  if (cached && (allowStale || !isStale(cached))) return cached;
  return fallbackCohort(playlist);
}

export function isStale(cohort) {
  if (!cohort?.updatedAt) return true;
  return Date.now() - new Date(cohort.updatedAt).getTime() > CACHE_TTL_MS;
}

/**
 * Agrège une liste de replays ballchasing en une cohorte de distributions.
 */
export function buildCohortFromReplays(replays, { playlist, source = 'ballchasing' } = {}) {
  const buckets = new Map(METRICS.map((metric) => [metric.key, []]));
  const players = new Set();
  let usableReplays = 0;
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
      const stats = normalizeBallchasingStats(raw, duration);
      for (const metric of METRICS) {
        if (teamSize === 1 && metric.key === 'positioning.avgDistanceToTeammates') continue;
        if (teamSize === 1 && metric.key === 'core.assistsPerMinute') continue;
        const value = metricValue(metric, stats, duration);
        if (Number.isFinite(value)) buckets.get(metric.key).push(value);
      }
      players.add(player.id || player.name);
      counted = true;
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

  return {
    playlist,
    playlistLabel: PLAYLISTS[playlist]?.label || playlist,
    source,
    isDemo: false,
    updatedAt: new Date().toISOString(),
    sampleSize: totalSamples,
    playersAnalyzed: players.size,
    replaysAnalyzed: usableReplays,
    replays: replayIndex,
    metrics,
    note: `Cohorte construite sur ${usableReplays} replays pro (${players.size} joueurs) récupérés via l'API ballchasing.`,
  };
}

/**
 * Rafraîchit la cohorte depuis ballchasing. Écrit dans le cache disque.
 * @param {object} params
 * @param {string} params.token token API ballchasing (ou chaîne vide)
 * @param {string} params.playlist
 * @param {number} params.size nombre de replays à analyser
 * @param {(progress: object) => void} [params.onProgress]
 */
export async function refreshCohort({ token = '', playlist = 'ranked-doubles', size = 30, onProgress = null } = {}) {
  if (refreshState.running) {
    return { ok: false, error: 'Une actualisation est déjà en cours.' };
  }
  const count = Math.max(5, Math.min(MAX_REPLAYS_PER_REFRESH, Number(size) || 30));

  Object.assign(refreshState, {
    running: true,
    playlist,
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

    let list = await client.listProReplays({ playlist, count });
    let source = 'ballchasing:pro';

    if (!list.length) {
      // Repli : pas de matchs étiquetés pro → on prend les plus hauts rangs.
      list = await client.listProReplays({ playlist, count, pro: false, minRank: 'grand-champion' });
      source = 'ballchasing:grand-champion';
    }

    if (!list.length) {
      throw new Error(
        "Aucun replay trouvé sur ballchasing pour ce mode. Vérifie le token et le mode sélectionné.",
      );
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

    const cohort = buildCohortFromReplays(replays, { playlist, source });
    if (!cohort.replaysAnalyzed) {
      throw new Error("Les replays récupérés ne contiennent pas assez de statistiques exploitables.");
    }

    setProCache(cacheKey(playlist), cohort);
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
      isLocal: Boolean(
        playerName && String(player.name).toLowerCase() === String(playerName).toLowerCase(),
      ),
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

/** Normalise les stats ballchasing (déjà au bon format) et complète ce qui manque. */
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
