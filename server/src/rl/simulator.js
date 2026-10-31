/**
 * Simulateur de flux « API Stats » : permet de faire tourner l'app et les tests
 * sans lancer Rocket League. Les messages produits ont exactement la même forme
 * que ceux du jeu : `{ Event, Data }` où `Data` est une chaîne JSON.
 *
 * Le modèle n'est pas une physique réaliste : c'est un modèle de possession.
 * La balle voyage d'une zone à l'autre, un joueur la touche quand il est à
 * portée, et les joueurs se déplacent avec une inertie crédible. Les grandeurs
 * qui comptent pour le coaching (vitesse, hauteur, boost, zones, touches, buts,
 * arrêts) restent dans des ordres de grandeur plausibles.
 */

import { FIELD, ownGoal, opponentGoal } from './geometry.js';

const FRAME_RATE = 10; // 10 Hz, suffisant pour des agrégats de temps
const TICK = 1 / FRAME_RATE;
const BOOST_PER_SECOND = 33.3;

const BIG_PADS = [
  { x: 0, y: 4240, big: true },
  { x: 0, y: -4240, big: true },
  { x: 3584, y: 4184, big: true },
  { x: -3584, y: 4184, big: true },
  { x: 3584, y: -4184, big: true },
  { x: -3584, y: -4184, big: true },
  { x: 3584, y: 0, big: true },
  { x: -3584, y: 0, big: true },
];

const SMALL_PADS = (() => {
  const pads = [];
  for (const y of [-4600, -3600, -2600, -1600, -600, 600, 1600, 2600, 3600, 4600]) {
    for (const x of [-3072, -2048, -1024, 0, 1024, 2048, 3072]) {
      if (Math.abs(y) > 4000 && Math.abs(x) > 2500) continue;
      pads.push({ x, y, big: false });
    }
  }
  return pads;
})();

const BOT_NAMES = ['Kilo', 'Lima', 'Mike', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Profils : le local peut jouer « moyen » ou « propre », les bots sont intermédiaires. */
const PROFILES = {
  casual: { boostDiscipline: 0.4, reaction: 0.5, aerial: 0.12, touch: 0.6 },
  ranked: { boostDiscipline: 0.7, reaction: 0.72, aerial: 0.3, touch: 0.72 },
  pro: { boostDiscipline: 0.95, reaction: 0.95, aerial: 0.5, touch: 0.9 },
};

function teamSizeOf(playlist) {
  if (playlist === 'ranked-duels') return 1;
  if (playlist === 'ranked-doubles') return 2;
  return 3;
}

function clampField(x, y) {
  return {
    x: Math.max(-FIELD.halfWidth + 250, Math.min(FIELD.halfWidth - 250, x)),
    y: Math.max(-FIELD.halfLength + 250, Math.min(FIELD.halfLength - 250, y)),
  };
}

function createPlayer({ name, id, team, profile, random }) {
  const home = ownGoal(team);
  return {
    name,
    id,
    team,
    profile,
    role: 'mid',
    x: (random() - 0.5) * 2400,
    y: home.y * 0.72,
    z: 17,
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 0,
    boost: 33,
    boosting: false,
    onGround: true,
    superSonic: false,
    demolishedAt: null,
    nextTouchAt: 0,
    goals: 0,
    assists: 0,
    saves: 0,
    shots: 0,
    score: 0,
    touches: 0,
  };
}

/**
 * Construit un match simulé complet.
 * @returns {{messages: object[], meta: object}}
 */
export function buildSimulatedMatch({
  seed = 7,
  playlist = 'ranked-doubles',
  durationSeconds = 300,
  localName = 'Toi',
  profile = 'casual',
} = {}) {
  const random = mulberry32(seed);
  const teamSize = teamSizeOf(playlist);
  const localProfile = PROFILES[profile] || PROFILES.casual;

  const players = [
    createPlayer({ name: localName, id: 'local-player', team: 0, profile: localProfile, random }),
  ];
  for (let i = 1; i < teamSize; i += 1) {
    players.push(
      createPlayer({
        name: `${BOT_NAMES[i]} (ally)`,
        id: `ally-${i}`,
        team: 0,
        profile: PROFILES.ranked,
        random,
      }),
    );
  }
  for (let i = 0; i < teamSize; i += 1) {
    players.push(
      createPlayer({
        name: `${BOT_NAMES[i + 3]} (ennemi)`,
        id: `enemy-${i}`,
        team: 1,
        profile: PROFILES.ranked,
        random,
      }),
    );
  }

  const ball = {
    x: 0,
    y: 0,
    z: 92,
    vx: 0,
    vy: 0,
    vz: 0,
    tx: 0,
    ty: 0,
    speed: 0,
    shot: false,
    shooter: null,
  };
  const pads = [...BIG_PADS, ...SMALL_PADS].map((p) => ({ ...p, availableAt: 0 }));
  const scores = { 0: 0, 1: 0 };
  const goals = [];
  const messages = [];
  const push = (event, data) => messages.push({ Event: event, Data: JSON.stringify(data) });

  let matchTime = 0;
  let possession = null;
  let lastTouch = null;
  let previousTouch = null;
  let nextTouchAt = 0;
  push('MatchCreated', {
    MatchGuid: `sim-${seed}-${playlist}`,
    Arena: 'DFH Stadium (simulé)',
    Players: players.map((p) => ({ Name: p.name, PrimaryId: p.id, TeamNum: p.team })),
  });
  push('MatchInitialized', { Arena: 'DFH Stadium (simulé)' });

  const aimAtGoal = (team, quality = 0.6) => {
    const goal = opponentGoal(team);
    const spread = (1 - quality) * 1500 + 220;
    ball.tx = goal.x + (random() - 0.5) * spread;
    ball.ty = goal.y - Math.sign(goal.y) * 120;
    ball.speed = 1700 + random() * 900;
    ball.shot = true;
    ball.shooter = null;
  };

  const advanceBall = (team) => {
    // la balle progresse dans la direction d'attaque de l'équipe en possession
    const dir = team === 0 ? 1 : -1;
    const lead = 1400 + random() * 1900;
    const next = clampField(
      ball.x * 0.4 + (random() - 0.5) * 2600,
      ball.y + dir * lead,
    );
    ball.tx = next.x;
    ball.ty = next.y;
    ball.speed = 1300 + random() * 700;
    ball.shot = false;
    ball.shooter = null;
  };

  const resetKickoff = () => {
    ball.x = 0;
    ball.y = 0;
    ball.z = 92;
    ball.speed = 0;
    ball.shot = false;
    ball.shooter = null;
    ball.tx = 0;
    ball.ty = 0;
    lastTouch = null;
    previousTouch = null;
    possession = null;
    for (const p of players) {
      p.x = (random() - 0.5) * 1600;
      p.y = ownGoal(p.team).y * 0.78;
      p.speed = 0;
      p.boost = 33;
    }
  };

  aimAtGoal(possession ?? 0, 0.3);
  ball.tx = 0;
  ball.ty = 0;

  const frames = Math.round(durationSeconds * FRAME_RATE);

  for (let frame = 0; frame < frames; frame += 1) {
    matchTime += TICK;

    // ---------------- rôles (le plus proche de la balle attaque) ----------------
    for (const team of [0, 1]) {
      const mates = players.filter((p) => p.team === team && !p.demolishedAt);
      if (!mates.length) continue;
      const sorted = mates
        .map((p) => ({ p, d: Math.hypot(p.x - ball.x, p.y - ball.y) }))
        .sort((a, b) => a.d - b.d);
      sorted.forEach((entry, index) => {
        entry.p.role = index === 0 ? 'attack' : index === 1 ? 'support' : 'back';
      });
    }

    // ---------------- déplacement des joueurs ----------------
    for (const player of players) {
      if (player.demolishedAt) {
        if (matchTime - player.demolishedAt > 3) {
          player.demolishedAt = null;
          const home = ownGoal(player.team);
          player.x = (random() - 0.5) * 1200;
          player.y = home.y * 0.8;
          player.z = 17;
          player.boost = 33;
          player.speed = 0;
        }
        continue;
      }

      const dir = player.team === 0 ? 1 : -1;
      let target;
      const lowBoost = player.boost < 24;
      if (lowBoost && player.role !== 'attack') {
        // « boost run » : on va chercher le gros pad le plus proche
        const pad = nearestBigPad(player);
        target = pad ? { x: pad.x, y: pad.y } : { x: ball.x * 0.5, y: ball.y - dir * 1400 };
      } else if (player.role === 'attack') {
        // se place juste derrière la balle pour la pousser vers le but adverse
        target = { x: ball.x * 0.95, y: ball.y - dir * 300 };
      } else if (player.role === 'support') {
        target = { x: ball.x * 0.5, y: ball.y - dir * 1600 };
      } else {
        const home = ownGoal(player.team);
        target = {
          x: ball.x * 0.25,
          y: Math.min(Math.abs(home.y) - 900, Math.abs(ball.y) * 0.35 + 700) * (dir > 0 ? -1 : 1),
        };
      }
      target = clampField(target.x, target.y);

      const dist = Math.hypot(target.x - player.x, target.y - player.y);
      const wantsSpeed = dist > 350;
      const canBoost = player.boost > 2 && wantsSpeed && random() < player.profile.boostDiscipline;
      const maxSpeed = canBoost ? 2300 : 1410;
      const desired = Math.min(maxSpeed, dist * 2.4 + 300);
      const inertia = 8 + player.profile.reaction * 6;
      player.speed += (desired - player.speed) * Math.min(1, inertia * TICK);
      if (player.speed < 0) player.speed = 0;

      if (player.boost > 0.5 && player.speed > 1350 && canBoost) {
        player.boosting = true;
        player.boost = Math.max(0, player.boost - BOOST_PER_SECOND * TICK);
      } else {
        player.boosting = false;
      }

      if (dist > 4) {
        const nx = (target.x - player.x) / dist;
        const ny = (target.y - player.y) / dist;
        player.x += nx * player.speed * TICK;
        player.y += ny * player.speed * TICK;
        player.vx = nx * player.speed;
        player.vy = ny * player.speed;
      } else {
        player.vx = 0;
        player.vy = 0;
      }

      // aériens : uniquement quand la balle est haute et proche
      const ballNear = Math.hypot(player.x - ball.x, player.y - ball.y) < 700;
      if (ballNear && ball.z > 300 && random() < player.profile.aerial * 0.3 && player.boost > 12) {
        player.z = Math.min(1100, player.z + 1000 * TICK);
        player.vz = 1000;
        player.onGround = false;
        player.boost = Math.max(0, player.boost - BOOST_PER_SECOND * TICK);
      } else if (player.z > 17) {
        player.z = Math.max(17, player.z - 1400 * TICK);
        player.vz = player.z > 17 ? -1400 : 0;
        player.onGround = player.z <= 20;
      } else {
        player.z = 17;
        player.vz = 0;
        player.onGround = true;
      }
      player.superSonic = player.speed >= 2200;

      // ramassage de boost
      for (const pad of pads) {
        if (pad.availableAt > matchTime) continue;
        if (Math.hypot(pad.x - player.x, pad.y - player.y) > 190) continue;
        if (random() > 0.35 + player.profile.boostDiscipline * 0.65) continue;
        player.boost = Math.min(100, player.boost + (pad.big ? 100 : 12));
        pad.availableAt = matchTime + (pad.big ? 10 : 4);
        break;
      }
    }

    // ---------------- balle ----------------
    if (possession === null) {
      // coup d'envoi : la balle est jouée après ~1 s
      const nearest = players
        .filter((p) => !p.demolishedAt)
        .map((p) => ({ p, d: Math.hypot(p.x - ball.x, p.y - ball.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (nearest && nearest.d < 520) {
        possession = nearest.p.team;
        lastTouch = nearest.p;
        nextReach(nearest.p);
        advanceBall(possession);
      }
    } else {
      const dx = ball.tx - ball.x;
      const dy = ball.ty - ball.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1) {
        const step = Math.min(dist, ball.speed * TICK);
        ball.x += (dx / dist) * step;
        ball.y += (dy / dist) * step;
        ball.vx = (dx / dist) * ball.speed;
        ball.vy = (dy / dist) * ball.speed;
      }
      ball.z = ball.z > 92 ? Math.max(92, ball.z - 260 * TICK) : 92;

      if (dist < 200) {
        // arrivée : but, ou récupération par l'adversaire
        if (ball.shot) {
          const defender = players
            .filter((p) => !p.demolishedAt && p.team !== possession)
            .map((p) => ({ p, d: Math.hypot(p.x - ball.x, p.y - ball.y) }))
            .sort((a, b) => a.d - b.d)[0];
          const saved = defender && defender.d < 700 && random() < 0.72;
          if (saved) {
            defender.p.saves += 1;
            defender.p.score += 50;
            push('StatfeedEvent', {
              EventName: 'Save',
              MainTarget: { Name: defender.p.name, PrimaryId: defender.p.id, TeamNum: defender.p.team },
            });
            possession = defender.p.team;
            lastTouch = defender.p;
            previousTouch = null;
            advanceBall(possession);
          } else {
            // but
            const scorer = ball.shooter || lastTouch;
            const scoringTeam = scorer ? scorer.team : possession;
            scores[scoringTeam] += 1;
            if (scorer) {
              scorer.goals += 1;
              scorer.score += 100;
            }
            const assister =
              previousTouch && previousTouch.team === scoringTeam && previousTouch !== scorer
                ? previousTouch
                : null;
            if (assister) {
              assister.assists += 1;
              assister.score += 50;
            }
            goals.push({
              time: Math.round(matchTime),
              scorer: scorer?.name || 'Inconnu',
              assister: assister?.name || null,
              team: scoringTeam,
            });
            push('GoalScored', {
              GoalTime: Math.round(matchTime),
              Scorer: scorer
                ? { Name: scorer.name, PrimaryId: scorer.id, TeamNum: scorer.team }
                : { Name: 'Inconnu', TeamNum: scoringTeam },
              Assister: assister
                ? { Name: assister.name, PrimaryId: assister.id, TeamNum: assister.team }
                : null,
              GoalSpeed: Math.round(ball.speed),
            });
            resetKickoff();
            continue;
          }
        } else {
          // ballon qui traîne : l'équipe la plus proche le récupère
          const nearest = players
            .filter((p) => !p.demolishedAt)
            .map((p) => ({ p, d: Math.hypot(p.x - ball.x, p.y - ball.y) }))
            .sort((a, b) => a.d - b.d)[0];
          if (nearest && nearest.d < 700) {
            possession = nearest.p.team;
            nextReach(nearest.p);
            advanceBall(possession);
          } else {
            advanceBall(random() > 0.5 ? 0 : 1);
            possession = random() > 0.5 ? 0 : 1;
          }
        }
      }

      // touches : le joueur de l'équipe en possession le plus proche joue la balle
      if (matchTime > nextTouchAt) {
        const candidates = players.filter((p) => !p.demolishedAt && p.team === possession);
        const near = candidates
          .map((p) => ({ p, d: Math.hypot(p.x - ball.x, p.y - ball.y) }))
          .sort((a, b) => a.d - b.d)[0];
        if (near) {
          touch(near.p);
          nextTouchAt = matchTime + 0.5 + random() * 0.8;
        }
      }
    }

    // ---------------- démolitions ----------------
    if (random() < 0.0012) {
      const killer = players[Math.floor(random() * players.length)];
      const victim = players.find((p) => p.team !== killer.team && !p.demolishedAt);
      if (killer && victim) {
        victim.demolishedAt = matchTime;
        victim.boost = 0;
        victim.score = Math.max(0, victim.score - 10);
        killer.score += 20;
        push('StatfeedEvent', {
          EventName: 'Demolition',
          MainTarget: { Name: killer.name, PrimaryId: killer.id, TeamNum: killer.team },
          SecondaryTarget: { Name: victim.name, PrimaryId: victim.id, TeamNum: victim.team },
        });
      }
    }

    // ---------------- frame d'état ----------------
    push('UpdateState', {
      Game: {
        TimeSeconds: Math.round(matchTime * 100) / 100,
        Frame: frame,
        bReplicatedHasBegunPlay: true,
        Teams: [
          { TeamNum: 0, Score: scores[0] },
          { TeamNum: 1, Score: scores[1] },
        ],
      },
      Ball: {
        Location: { X: round1(ball.x), Y: round1(ball.y), Z: round1(ball.z) },
        Velocity: { X: Math.round(ball.vx), Y: Math.round(ball.vy), Z: Math.round(ball.vz) },
      },
      Players: players.map((p) => ({
        Name: p.name,
        PrimaryId: p.id,
        TeamNum: p.team,
        Score: Math.round(p.score),
        Goals: p.goals,
        Assists: p.assists,
        Saves: p.saves,
        Shots: p.shots,
        Touches: p.touches,
        CarTouches: p.touches,
        Demolitions: 0,
        Boost: Math.round(p.boost * 10) / 10,
        bBoosting: p.boosting,
        bOnGround: p.onGround,
        bOnWall: false,
        bDemolished: Boolean(p.demolishedAt),
        bSuperSonic: p.superSonic,
        Speed: Math.round(p.speed),
        Location: { X: round1(p.x), Y: round1(p.y), Z: round1(p.z) },
        Velocity: { X: Math.round(p.vx), Y: Math.round(p.vy), Z: Math.round(p.vz) },
        Rotation: { X: 0, Y: 0, Z: 0 },
      })),
    });
  }

  // -------------------- fin de match --------------------
  const winner = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
  push('MatchEnded', winner === null ? {} : { Winner: winner });
  push('MatchDestroyed', {});

  return {
    messages,
    meta: {
      arena: 'DFH Stadium (simulé)',
      playlist,
      teamSize,
      durationSeconds,
      teamScores: scores,
      goals,
      localName,
      profile,
      seed,
    },
  };

  // ------------------------------------------------------------------
  // helpers internes (fermetures sur l'état de la simulation)
  // ------------------------------------------------------------------

  function nextReach(player) {
    player.nextTouchAt = matchTime + 0.35;
  }

  function nearestBigPad(player) {
    let best = null;
    let bestDist = Infinity;
    for (const pad of pads) {
      if (!pad.big || pad.availableAt > matchTime) continue;
      const d = Math.hypot(pad.x - player.x, pad.y - player.y);
      if (d < bestDist) {
        bestDist = d;
        best = pad;
      }
    }
    return best;
  }

  /**
   * Une touche : compte pour le joueur, peut déclencher un tir s'il est dans
   * la moitié adverse et orienté vers le but.
   */
  function touch(player) {
    player.touches += 1;
    player.nextTouchAt = matchTime + 0.45 + random() * 0.5;
    previousTouch = lastTouch;
    lastTouch = player;
    possession = player.team;

    const dir = player.team === 0 ? 1 : -1;
    const yNorm = ball.y * dir;
    const inAttackingHalf = yNorm > 0;
    const wantsShot =
      inAttackingHalf && ball.y * dir > FIELD.halfLength * 0.35 && random() < 0.3 + player.profile.touch * 0.2;

    if (wantsShot) {
      player.shots += 1;
      aimAtGoal(player.team, 0.35 + player.profile.touch * 0.5);
      ball.shooter = player;
      ball.z = 160 + random() * 240;
      push('StatfeedEvent', {
        EventName: 'Shot',
        MainTarget: { Name: player.name, PrimaryId: player.id, TeamNum: player.team },
      });
    } else {
      advanceBall(player.team);
    }

    push('BallHit', {
      Player: { Name: player.name, PrimaryId: player.id, TeamNum: player.team },
      Ball: {
        PreHitSpeed: Math.round(ball.speed * 0.6),
        PostHitSpeed: Math.round(ball.speed),
        Location: { X: round1(ball.x), Y: round1(ball.y), Z: round1(ball.z) },
      },
    });
  }
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Déroule un match simulé en direct (mode démo).
 * Les frames sont envoyées par paquets : un setTimeout par frame serait
 * limité à ~15 ms sous Windows, ce qui rendrait la démo trop lente.
 */
export async function playSimulatedMatch({ onMessage, speed = 8, signal, ...options } = {}) {
  const { messages, meta } = buildSimulatedMatch(options);
  const frameMs = 1000 / FRAME_RATE / Math.max(0.5, speed);
  let budget = 0;
  for (const message of messages) {
    if (signal?.aborted) return { aborted: true, meta };
    onMessage?.(message);
    if (message.Event === 'UpdateState') {
      budget += frameMs;
      if (budget >= 50) {
        await new Promise((resolve) => setTimeout(resolve, budget));
        budget = 0;
      }
    }
  }
  return { aborted: false, meta };
}
