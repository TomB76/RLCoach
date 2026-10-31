/**
 * MatchTracker — transforme le flux de l'API Stats de Rocket League
 * (messages JSON `{ Event, Data }`, où `Data` est souvent une chaîne JSON)
 * en un match analysable, avec des métriques alignées sur le schéma de
 * ballchasing.com (core / boost / movement / positioning / demo).
 *
 * Référence des événements : https://www.rocketleague.com/developer/stats-api
 */

import {
  FIELD,
  HEIGHT,
  SPEED,
  clamp,
  distance,
  distance2D,
  magnitude,
  normalizedY,
  ownGoal,
  playlistFromTeamSize,
  safeNumber,
  thirdOf,
} from './geometry.js';

const MAX_EVENTS = 400;
const MAX_FRAME_GAP = 1.0; // s — au-delà on considère une coupure (replay, pause, chargement)
const TELEPORT_THRESHOLD = 2500; // uu — saut de position anormal (respawn)
/** Événement de l'API Stats → nom de méthode du tracker. */
const HANDLER_NAMES = {
  MatchCreated: 'handleMatchCreated',
  MatchInitialized: 'handleMatchInitialized',
  MatchEnded: 'handleMatchEnded',
  MatchDestroyed: 'handleMatchDestroyed',
  UpdateState: 'handleUpdateState',
  BallHit: 'handleBallHit',
  GoalScored: 'handleGoalScored',
  StatfeedEvent: 'handleStatfeedEvent',
  CrossbarHit: 'handleCrossbarHit',
  ReplayCreated: 'handleReplayCreated',
};

function vec(location) {
  if (!location) return { x: 0, y: 0, z: 0 };
  return {
    x: safeNumber(location.X ?? location.x, 0),
    y: safeNumber(location.Y ?? location.y, 0),
    z: safeNumber(location.Z ?? location.z, 0),
  };
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratio(part, total) {
  return total > 0 ? part / total : 0;
}

function newPlayerAccum({ key, name, primaryId, team, isLocal }) {
  return {
    key,
    name,
    primaryId,
    team,
    isLocal,
    // valeurs officielles du jeu (cumulatives, fournies par l'API)
    goals: 0,
    assists: 0,
    saves: 0,
    shots: 0,
    score: 0,
    touches: 0,
    carTouches: 0,
    demos: 0,
    // accumulateurs temporels
    activeTime: 0,
    demoted: 0,
    distance: 0,
    speedSum: 0,
    speedSamples: 0,
    timeSlow: 0,
    timeBoostSpeed: 0,
    timeFast: 0,
    timeSupersonic: 0,
    timeGround: 0,
    timeLowAir: 0,
    timeHighAir: 0,
    timeZeroBoost: 0,
    timeFullBoost: 0,
    timeBoosting: 0,
    timeNoBoostButNotBoosting: 0,
    // boost
    boostSum: 0,
    boostSamples: 0,
    amountCollected: 0,
    amountStolen: 0,
    amountCollectedBig: 0,
    amountCollectedSmall: 0,
    countCollectedBig: 0,
    countCollectedSmall: 0,
    // positionnement
    distBallSum: 0,
    distBallPossSum: 0,
    distBallNoPossSum: 0,
    distTeammatesSum: 0,
    distTeammatesSamples: 0,
    timeDefHalf: 0,
    timeOffHalf: 0,
    timeDefThird: 0,
    timeNeutralThird: 0,
    timeOffThird: 0,
    timeBehindBall: 0,
    timeAheadBall: 0,
    timeLastMan: 0,
    lastManFrames: 0,
    frames: 0,
    // touches
    hits: 0,
    aerialHits: 0,
    ballCarryTime: 0,
    kickoffFirstTouches: 0,
    // divers
    demosInflicted: 0,
    demosTaken: 0,
    crossbarHits: 0,
    prevBoost: null,
    prevPos: null,
    lastTime: null,
  };
}

export class MatchTracker {
  constructor({ playerName = '', onMatchEnded = () => {}, onEvent = () => {}, mode = 'live' } = {}) {
    this.playerName = playerName;
    this.mode = mode;
    this.onMatchEnded = onMatchEnded;
    this.onEvent = onEvent;
    this.reset();
  }

  setPlayerName(playerName) {
    this.playerName = playerName || '';
    for (const player of this.match.players.values()) {
      player.isLocal = this.isLocalName(player.name);
    }
  }

  isLocalName(name) {
    if (!this.playerName || !name) return false;
    return String(name).trim().toLowerCase() === String(this.playerName).trim().toLowerCase();
  }

  reset() {
    this.match = {
      guid: null,
      startedAt: null,
      arena: null,
      initialized: false,
      players: new Map(),
      teamScores: { 0: 0, 1: 0 },
      events: [],
      lastTimeSeconds: null,
      gameTimeSeconds: 0,
      goals: [],
      finished: false,
    };
    this.lastTouchKey = null;
    this.possessionTeam = null;
    this.lastActive = [];
    this.lastTick = null;
    this.freeplay = false;
  }

  // ------------------------------------------------------------------
  // Entrée : message brut de l'API Stats
  // ------------------------------------------------------------------

  /**
   * @param {object|string} message message brut `{ Event, Data }` (Data peut être une string JSON)
   */
  ingest(message) {
    let msg = message;
    if (typeof msg === 'string') {
      try {
        msg = JSON.parse(msg);
      } catch {
        return null;
      }
    }
    if (!msg || typeof msg !== 'object') return null;

    const eventName = msg.Event || msg.event || msg.type;
    if (!eventName) return null;

    let data = msg.Data ?? msg.data ?? msg.payload ?? null;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        data = null;
      }
    }

    const method = HANDLER_NAMES[eventName];
    if (method && typeof this[method] === 'function') {
      this[method](data || {});
      return eventName;
    }
    return null;
  }


  // ------------------------------------------------------------------
  // Cycle de vie
  // ------------------------------------------------------------------

  handleMatchCreated(data) {
    this.reset();
    this.match.guid = data.MatchGuid || data.Guid || `local-${Date.now()}`;
    this.match.startedAt = new Date().toISOString();
    this.match.arena = data.Arena || data.ArenaName || null;

    const players = data.Players || [];
    for (const p of players) {
      const name = p.Name || p.player_name || 'Inconnu';
      const team = Number(p.TeamNum ?? p.Team ?? 0) === 0 ? 0 : 1;
      const primaryId = p.PrimaryId || p.SteamID || p.id || name;
      const acc = newPlayerAccum({
        key: String(primaryId),
        name,
        primaryId: String(primaryId),
        team,
        isLocal: this.isLocalName(name),
      });
      this.match.players.set(String(primaryId), acc);
      this.match.teamScores[team] = this.match.teamScores[team] || 0;
    }
    const teamSize = Math.max(...this.countPerTeam());
    this.match.playlist = playlistFromTeamSize(teamSize);
    this.pushEvent('match-start', `Match détecté (${players.length} joueurs)`);
  }

  countPerTeam() {
    const counts = [0, 0];
    for (const p of this.match.players.values()) counts[p.team] = (counts[p.team] || 0) + 1;
    return counts;
  }

  handleMatchInitialized(data) {
    this.match.initialized = true;
    this.match.arena = data.Arena || this.match.arena;
    this.pushEvent('match-init', 'Partie chargée, en attente du coup d’envoi');
  }

  handleReplayCreated() {
    this.pushEvent('replay', 'Replay créé par le jeu');
  }

  handleMatchEnded(data) {
    if (this.match.finished) return;
    this.match.finished = true;
    const final = this.finalize(data);
    if (final) this.onMatchEnded(final);
  }

  handleMatchDestroyed() {
    if (!this.match.finished && this.match.players.size > 0) {
      this.match.finished = true;
      const final = this.finalize({});
      if (final) this.onMatchEnded(final);
    }
  }

  // ------------------------------------------------------------------
  // Frame de jeu : le gros des métriques
  // ------------------------------------------------------------------

  /**
   * Vrai quand le jeu tourne sans partie lancée (jeu libre).
   *
   * L'API Stats envoie `Game.bReplicatedHasBegunPlay: false` pendant le
   * freeplay et `true` dès qu'une partie démarre. Toute autre valeur
   * (`undefined`) est ignorée pour ne pas bloquer les versions du jeu qui
   * n'envoient pas ce champ : la détection de partie reste inchangée.
   */
  isFreeplayFrame(game) {
    return game?.bReplicatedHasBegunPlay === false;
  }

  /**
   * Entre en jeu libre : aucune donnée n'est collectée et l'état accumulé est
   * effacé, pour qu'une partie précédente ne soit ni finalisée ni polluée.
   */
  enterFreeplay() {
    if (this.match.players.size > 0 || this.match.gameTimeSeconds > 0) {
      this.reset();
    }
    if (!this.freeplay) {
      this.freeplay = true;
      this.pushEvent('freeplay', 'Jeu libre détecté — aucune statistique collectée');
    }
  }

  handleUpdateState(state) {
    const game = state.Game || {};
    if (this.isFreeplayFrame(game)) {
      this.enterFreeplay();
      return;
    }
    this.freeplay = false;
    const time = safeNumber(game.TimeSeconds ?? game.Time ?? this.match.gameTimeSeconds, this.match.gameTimeSeconds);
    this.match.gameTimeSeconds = time;
    this.match.lastTimeSeconds = time;

    const ballRaw = Array.isArray(state.Ball) ? state.Ball[0] : state.Ball;
    const ball = vec(ballRaw?.Location);
    const playersRaw = Array.isArray(state.Players) ? state.Players : [];

    // mise à jour scores d'équipe
    const teams = Array.isArray(game.Teams) ? game.Teams : [];
    for (let i = 0; i < teams.length; i += 1) {
      const teamNum = Number(teams[i]?.TeamNum ?? i) === 0 ? 0 : 1;
      const score = safeNumber(teams[i]?.Score, this.match.teamScores[teamNum]);
      this.match.teamScores[teamNum] = score;
    }

    const active = [];
    for (const p of playersRaw) {
      const name = p.Name;
      if (!name) continue;
      const key = String(p.PrimaryId || p.SteamID || name);
      let player = this.match.players.get(key);
      if (!player) {
        player = newPlayerAccum({
          key,
          name,
          primaryId: key,
          team: Number(p.TeamNum ?? 0) === 0 ? 0 : 1,
          isLocal: this.isLocalName(name),
        });
        this.match.players.set(key, player);
      }
      player.team = Number(p.TeamNum ?? player.team) === 0 ? 0 : 1;
      // valeurs officielles (on garde le max : les compteurs sont cumulatifs)
      player.goals = Math.max(player.goals, safeNumber(p.Goals, player.goals));
      player.assists = Math.max(player.assists, safeNumber(p.Assists, player.assists));
      player.saves = Math.max(player.saves, safeNumber(p.Saves, player.saves));
      player.shots = Math.max(player.shots, safeNumber(p.Shots, player.shots));
      player.score = Math.max(player.score, safeNumber(p.Score, player.score));
      player.touches = Math.max(player.touches, safeNumber(p.Touches, player.touches));
      player.carTouches = Math.max(player.carTouches, safeNumber(p.CarTouches, player.carTouches));
      player.demos = Math.max(player.demos, safeNumber(p.Demolitions, player.demos));

      const pos = vec(p.Location);
      const speed = safeNumber(
        p.Speed,
        magnitude(p.Velocity || { X: p.vel_x, Y: p.vel_y, Z: p.vel_z }),
      );
      const boost = clamp(safeNumber(p.Boost, 0), 0, 100);
      const isDemolished = Boolean(p.bDemolished);

      if (player.lastTime != null) {
        const dt = clamp(time - player.lastTime, 0, MAX_FRAME_GAP);
        if (dt > 0) {
          const jumped = player.prevPos ? distance2D(player.prevPos, pos) > TELEPORT_THRESHOLD : false;

          if (isDemolished) {
            player.demoted += dt;
          } else {
            player.activeTime += dt;

            // --- mouvement
            if (!jumped) player.distance += speed * dt;
            player.speedSum += speed * dt;
            player.speedSamples += dt;

            const supersonic = p.bSuperSonic === true || speed >= SPEED.supersonic;
            if (supersonic) player.timeSupersonic += dt;
            if (speed < SPEED.slow) player.timeSlow += dt;
            else if (speed <= SPEED.fast) player.timeBoostSpeed += dt;
            else player.timeFast += dt;

            if (p.bOnGround) player.timeGround += dt;
            else if (pos.z < HEIGHT.highAir) player.timeLowAir += dt;
            else player.timeHighAir += dt;

            // --- boost
            player.boostSum += boost * dt;
            player.boostSamples += dt;
            if (boost <= 1) player.timeZeroBoost += dt;
            if (boost >= 99) player.timeFullBoost += dt;
            if (p.bBoosting) player.timeBoosting += dt;

            // --- positionnement
            const d = distance2D(pos, ball);
            player.distBallSum += d * dt;
            const possessionTeam = this.possessionTeam;
            if (possessionTeam === null || possessionTeam === player.team) {
              player.distBallPossSum += d * dt;
            } else {
              player.distBallNoPossSum += d * dt;
            }

            const yNorm = normalizedY(pos.y, player.team);
            if (yNorm < 0) player.timeDefHalf += dt;
            else player.timeOffHalf += dt;
            const third = thirdOf(pos.y, player.team);
            if (third === 'defensive') player.timeDefThird += dt;
            else if (third === 'offensive') player.timeOffThird += dt;
            else player.timeNeutralThird += dt;

            const ballYNorm = normalizedY(ball.y, player.team);
            if (yNorm < ballYNorm) player.timeBehindBall += dt;
            else player.timeAheadBall += dt;

            // --- carry (garde la balle)
            if (this.lastTouchKey === player.key && d < 320 && ball.z < 260) {
              player.ballCarryTime += dt;
            }
          }

          // --- collecte de boost (approximation : delta positif de la jauge)
          if (player.prevBoost != null && !isDemolished) {
            const delta = boost - player.prevBoost;
            if (delta > 2) {
              player.amountCollected += delta;
              const inEnemyHalf = normalizedY(pos.y, player.team) > 0;
              if (inEnemyHalf) player.amountStolen += delta;
              // un petit pad rend 12, un gros pad remonte franchement la jauge
              if (delta >= 40) {
                player.amountCollectedBig += delta;
                player.countCollectedBig += 1;
              } else {
                player.amountCollectedSmall += delta;
                player.countCollectedSmall += 1;
              }
            }
          }
          player.prevBoost = boost;
          player.prevPos = pos;
          player.lastTime = time;
        }
      } else {
        player.prevBoost = boost;
        player.prevPos = pos;
        player.lastTime = time;
      }

      if (!isDemolished) {
        player.frames += 1;
        active.push({ player, pos, team: player.team });
      }
    }

    // distance aux coéquipiers + "dernier homme"
    for (const entry of active) {
      let sum = 0;
      let count = 0;
      for (const other of active) {
        if (other === entry || other.team !== entry.team) continue;
        sum += distance2D(entry.pos, other.pos);
        count += 1;
      }
      if (count > 0) {
        entry.player.distTeammatesSum += sum / count;
        entry.player.distTeammatesSamples += 1;
      }
      const mates = active.filter((o) => o.team === entry.team);
      if (mates.length > 1) {
        const goal = ownGoal(entry.team);
        let nearest = mates[0];
        let nearestDist = distance2D(nearest.pos, goal);
        for (const mate of mates) {
          const d = distance2D(mate.pos, goal);
          if (d < nearestDist) {
            nearest = mate;
            nearestDist = d;
          }
        }
        if (nearest === entry) entry.player.lastManFrames += 1;
      }
    }
  }

  // ------------------------------------------------------------------
  // Touches, buts, événements
  // ------------------------------------------------------------------

  resolvePlayer(proto) {
    if (!proto) return null;
    const name = proto.Name || proto.name;
    const key = String(proto.PrimaryId || proto.Id || proto.SteamID || name || '');
    if (key && this.match.players.has(key)) return this.match.players.get(key);
    if (name) {
      for (const p of this.match.players.values()) {
        if (p.name === name) return p;
      }
    }
    return null;
  }

  handleBallHit(data) {
    const player = this.resolvePlayer(data.Player);
    const ball = vec(Array.isArray(data.Ball) ? data.Ball[0]?.Location : data.Ball?.Location);
    if (!player) return;
    const speedAfter = safeNumber(data.Ball?.PostHitSpeed, safeNumber(data.PostHitSpeed, 0));
    player.hits += 1;
    if (ball.z > HEIGHT.highAir) player.aerialHits += 1;
    this.lastTouchKey = player.key;
    this.possessionTeam = player.team;
    this.pushEvent('touch', `${player.name} touche la balle (${Math.round(speedAfter)} uu/s)`, {
      player: player.name,
      team: player.team,
      speed: speedAfter,
      z: ball.z,
    });
  }

  handleGoalScored(data) {
    const scorer = this.resolvePlayer(data.Scorer);
    const assister = this.resolvePlayer(data.Assister);
    const team = scorer ? scorer.team : Number(data.Scorer?.TeamNum ?? 0);
    this.match.teamScores[team] = (this.match.teamScores[team] || 0) + 1;
    const goal = {
      time: safeNumber(data.GoalTime, this.match.gameTimeSeconds),
      scorer: scorer?.name || data.Scorer?.Name || 'Inconnu',
      assister: assister?.name || null,
      team,
      speed: safeNumber(data.GoalSpeed, 0),
    };
    this.match.goals.push(goal);
    this.pushEvent('goal', `But de ${goal.scorer}${goal.assister ? ` (passe de ${goal.assister})` : ''}`, goal);
  }

  handleStatfeedEvent(data) {
    const type = data.EventName || data.Type || data.event || 'Evénement';
    const main = this.resolvePlayer(data.MainTarget);
    const secondary = this.resolvePlayer(data.SecondaryTarget);
    const labels = {
      Save: 'arrêt',
      Shot: 'tir',
      Goal: 'but',
      Assist: 'passe décisive',
      Demolition: 'démolition',
      Demolish: 'démolition',
      Center: 'centre',
      FirstTouch: 'premier toucher',
      EpicSave: 'arrêt épique',
      BicycleHit: 'retourné',
      Juggling: 'jonglage',
      Clear: 'dégagement',
    };
    if (type === 'FirstTouch' && main) main.kickoffFirstTouches += 1;
    if ((type === 'Demolition' || type === 'Demolish') && main) {
      main.demosInflicted += 1;
      if (secondary) secondary.demosTaken += 1;
    }
    this.pushEvent('statfeed', `${main?.name || 'Joueur'} : ${labels[type] || type}`, {
      type,
      player: main?.name || null,
      secondary: secondary?.name || null,
      team: main?.team ?? null,
    });
  }

  handleCrossbarHit(data) {
    const player = this.resolvePlayer(data.Player);
    if (player) player.crossbarHits += 1;
    this.pushEvent('crossbar', `Barre touchée${player ? ` par ${player.name}` : ''}`);
  }

  pushEvent(type, message, extra = {}) {
    const event = {
      t: round(this.match.gameTimeSeconds, 1),
      type,
      message,
      ...extra,
    };
    this.match.events.push(event);
    if (this.match.events.length > MAX_EVENTS) this.match.events.shift();
    this.onEvent(event);
  }

  // ------------------------------------------------------------------
  // Calcul des statistiques (schéma ballchasing)
  // ------------------------------------------------------------------

  computePlayerStats(player) {
    const t = player.activeTime;
    const minutes = t / 60;
    const boostTime = player.boostSamples;
    const samples = player.speedSamples;
    const distBallTime = player.distBallSum > 0 ? t : 0;
    const carryBase = t;
    return {
      core: {
        shots: player.shots,
        goals: player.goals,
        saves: player.saves,
        assists: player.assists,
        score: player.score,
        shootingPercentage: round(ratio(player.goals, Math.max(player.shots, 1)) * 100, 1),
        mvp: false,
      },
      boost: {
        bpm: round(ratio(player.amountCollected, minutes), 1),
        avgAmount: round(ratio(player.boostSum, boostTime), 1),
        amountCollected: round(player.amountCollected, 0),
        amountStolen: round(player.amountStolen, 0),
        amountCollectedBig: round(player.amountCollectedBig, 0),
        amountCollectedSmall: round(player.amountCollectedSmall, 0),
        countCollectedBig: player.countCollectedBig,
        countCollectedSmall: player.countCollectedSmall,
        timeZeroBoost: round(player.timeZeroBoost, 1),
        timeFullBoost: round(player.timeFullBoost, 1),
        percentZeroBoost: round(ratio(player.timeZeroBoost, t) * 100, 1),
        percentFullBoost: round(ratio(player.timeFullBoost, t) * 100, 1),
        percentBoosting: round(ratio(player.timeBoosting, t) * 100, 1),
      },
      movement: {
        avgSpeed: round(ratio(player.speedSum, samples), 0),
        totalDistance: round(player.distance, 0),
        timeSupersonicSpeed: round(player.timeSupersonic, 1),
        percentSupersonicSpeed: round(ratio(player.timeSupersonic, t) * 100, 1),
        timeSlowSpeed: round(player.timeSlow, 1),
        percentSlowSpeed: round(ratio(player.timeSlow, t) * 100, 1),
        timeBoostSpeed: round(player.timeBoostSpeed, 1),
        percentBoostSpeed: round(ratio(player.timeBoostSpeed, t) * 100, 1),
        timeFastSpeed: round(player.timeFast, 1),
        percentFastSpeed: round(ratio(player.timeFast, t) * 100, 1),
        timeGround: round(player.timeGround, 1),
        percentGround: round(ratio(player.timeGround, t) * 100, 1),
        timeLowAir: round(player.timeLowAir, 1),
        percentLowAir: round(ratio(player.timeLowAir, t) * 100, 1),
        timeHighAir: round(player.timeHighAir, 1),
        percentHighAir: round(ratio(player.timeHighAir, t) * 100, 1),
        avgSpeedPerMinute: round(ratio(player.distance, minutes), 0),
      },
      positioning: {
        avgDistanceToBall: round(ratio(player.distBallSum, distBallTime), 0),
        avgDistanceToBallPossession: round(ratio(player.distBallPossSum, distBallTime), 0),
        avgDistanceToBallNoPossession: round(ratio(player.distBallNoPossSum, distBallTime), 0),
        avgDistanceToTeammates: round(
          ratio(player.distTeammatesSum, player.distTeammatesSamples),
          0,
        ),
        percentDefensiveHalf: round(ratio(player.timeDefHalf, t) * 100, 1),
        percentOffensiveHalf: round(ratio(player.timeOffHalf, t) * 100, 1),
        percentDefensiveThird: round(ratio(player.timeDefThird, t) * 100, 1),
        percentNeutralThird: round(ratio(player.timeNeutralThird, t) * 100, 1),
        percentOffensiveThird: round(ratio(player.timeOffThird, t) * 100, 1),
        percentBehindBall: round(ratio(player.timeBehindBall, t) * 100, 1),
        percentAheadOfBall: round(ratio(player.timeAheadBall, t) * 100, 1),
        percentLastMan: round(ratio(player.lastManFrames, player.frames) * 100, 1),
      },
      demo: {
        inflicted: player.demosInflicted,
        taken: player.demosTaken,
      },
      custom: {
        touches: player.touches,
        carTouches: player.carTouches,
        touchesPerMinute: round(ratio(player.touches, minutes), 1),
        ballHits: player.hits,
        aerialHits: player.aerialHits,
        aerialHitPercent: round(ratio(player.aerialHits, Math.max(player.hits, 1)) * 100, 1),
        ballCarryPercent: round(ratio(player.ballCarryTime, carryBase) * 100, 1),
        kickoffFirstTouches: player.kickoffFirstTouches,
        crossbarHits: player.crossbarHits,
        timeDemolished: round(player.demoted, 1),
        boostStolenShare: round(ratio(player.amountStolen, Math.max(player.amountCollected, 1)) * 100, 1),
      },
      meta: {
        activeSeconds: round(t, 1),
        minutes: round(minutes, 2),
        samples,
      },
    };
  }

  /** Snapshot live (léger) pour l'UI. */
  snapshot() {
    if (this.freeplay) {
      // Aucune partie lancée : on n'expose ni joueurs ni scores, même si l'API
      // continue d'envoyer des frames de jeu libre.
      return {
        active: false,
        freeplay: true,
        guid: this.match.guid,
        startedAt: this.match.startedAt,
        arena: this.match.arena,
        playlist: this.match.playlist,
        gameTimeSeconds: 0,
        teamScores: { 0: 0, 1: 0 },
        players: [],
        localPlayer: null,
        recentEvents: this.match.events.slice(-14),
        goals: [],
      };
    }
    const players = [];
    for (const player of this.match.players.values()) {
      const stats = this.computePlayerStats(player);
      players.push({
        name: player.name,
        team: player.team,
        isLocal: player.isLocal,
        stats,
      });
    }
    players.sort((a, b) => b.stats.core.score - a.stats.core.score);
    const local = players.find((p) => p.isLocal) || null;
    return {
      active: this.match.players.size > 0 && !this.match.finished,
      freeplay: false,
      guid: this.match.guid,
      startedAt: this.match.startedAt,
      arena: this.match.arena,
      playlist: this.match.playlist,
      gameTimeSeconds: round(this.match.gameTimeSeconds, 1),
      teamScores: this.match.teamScores,
      players,
      localPlayer: local,
      recentEvents: this.match.events.slice(-14),
      goals: this.match.goals,
    };
  }

  /** Construit l'enregistrement final du match. */
  finalize(endData = {}) {
    if (this.freeplay) {
      this.pushEvent('discard', 'Jeu libre : aucune donnée collectée');
      return null;
    }
    const duration = round(this.match.gameTimeSeconds, 1);
    if (!this.match.players.size || duration < 5) {
      this.pushEvent('discard', 'Match ignoré (trop court ou aucun joueur détecté)');
      return null;
    }

    const players = [];
    let bestScore = -1;
    let mvpName = null;
    for (const player of this.match.players.values()) {
      const stats = this.computePlayerStats(player);
      if (stats.core.score > bestScore) {
        bestScore = stats.core.score;
        mvpName = player.name;
      }
      players.push({
        id: player.primaryId,
        name: player.name,
        team: player.team,
        isLocal: player.isLocal,
        stats,
        rlCoachScore: null,
        grade: null,
      });
    }
    for (const p of players) p.stats.core.mvp = p.name === mvpName;

    const winnerData = endData.Winner ?? endData.WinnerTeamNum;
    let winner = null;
    if (winnerData !== undefined && winnerData !== null) winner = Number(winnerData) === 0 ? 0 : 1;
    else if (this.match.teamScores[0] !== this.match.teamScores[1]) {
      winner = this.match.teamScores[0] > this.match.teamScores[1] ? 0 : 1;
    }

    const local = players.find((p) => p.isLocal) || null;
    let result = 'unknown';
    if (winner !== null && local) result = local.team === winner ? 'win' : 'loss';

    const match = {
      id: `${this.match.guid || 'match'}-${Date.now().toString(36)}`,
      guid: this.match.guid,
      date: this.match.startedAt || new Date().toISOString(),
      mode: this.mode,
      playlist: this.match.playlist,
      arena: this.match.arena,
      durationSeconds: duration,
      teamScores: { ...this.match.teamScores },
      winner,
      result,
      localPlayer: local?.name || this.playerName || null,
      players,
      goals: this.match.goals,
      events: this.match.events,
      source: 'rl-stats-api',
      warnings: [],
      comparison: null,
      coaching: null,
    };
    if (!local) match.warnings.push('Aucun joueur local identifié — renseigne ton pseudo dans les réglages.');
    this.pushEvent('match-end', `Match terminé ${this.match.teamScores[0]}–${this.match.teamScores[1]}`);
    return match;
  }
}

export { round, ratio, vec };
