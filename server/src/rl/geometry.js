/**
 * Géométrie du terrain standard de Rocket League (unités Unreal / uu).
 *
 * Repère du jeu : X = largeur (-4096..4096), Y = longueur (-5120..5120),
 * Z = hauteur (0 = sol). Les buts sont aux deux extrémités de l'axe Y.
 * L'équipe 0 (bleue) défend Y < 0 et attaque vers +Y ; l'équipe 1 (orange)
 * défend Y > 0 et attaque vers -Y.
 */

export const FIELD = {
  halfWidth: 4096, // |X| max
  halfLength: 5120, // |Y| max (buts sur cet axe)
  ceiling: 2048,
  goalHalfWidth: 893,
  goalHeight: 642,
};

/** Seuils de vitesse utilisés par ballchasing (uu/s). */
export const SPEED = {
  slow: 1400,
  fast: 2300,
  supersonic: 2200,
};

/** Seuils de hauteur (uu) : ballchasing distingue sol / bas / haut. */
export const HEIGHT = {
  lowAir: 100,
  highAir: 500,
};

export function attackDirection(team) {
  // Team 0 (bleu) attaque vers +Y, team 1 (orange) vers -Y.
  return team === 0 ? 1 : -1;
}

/**
 * Coordonnée Y normalisée du point de vue de l'équipe : positif = vers le but adverse.
 */
export function normalizedY(y, team) {
  return y * attackDirection(team);
}

/** Tiers du terrain du point de vue de l'équipe : -1 défensif, 0 neutre, 1 offensif. */
export function thirdOf(y, team) {
  const yNorm = normalizedY(y, team);
  const third = FIELD.halfLength / 3; // 1706.67
  if (yNorm < -third) return 'defensive';
  if (yNorm > third) return 'offensive';
  return 'neutral';
}

/** Moitié du terrain du point de vue de l'équipe. */
export function halfOf(y, team) {
  return normalizedY(y, team) < 0 ? 'defensive' : 'offensive';
}

export function distance(a, b) {
  if (!a || !b) return 0;
  const dx = (a.x ?? a.X ?? 0) - (b.x ?? b.X ?? 0);
  const dy = (a.y ?? a.Y ?? 0) - (b.y ?? b.Y ?? 0);
  const dz = (a.z ?? a.Z ?? 0) - (b.z ?? b.Z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distance2D(a, b) {
  if (!a || !b) return 0;
  const dx = (a.x ?? a.X ?? 0) - (b.x ?? b.X ?? 0);
  const dy = (a.y ?? a.Y ?? 0) - (b.y ?? b.Y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

export function magnitude(v) {
  if (!v) return 0;
  const x = v.x ?? v.X ?? 0;
  const y = v.y ?? v.Y ?? 0;
  const z = v.z ?? v.Z ?? 0;
  return Math.sqrt(x * x + y * y + z * z);
}

/** Position du but défendu par une équipe (centre de la cage). */
export function ownGoal(team) {
  return { x: 0, y: team === 0 ? -FIELD.halfLength : FIELD.halfLength, z: 0 };
}

export function opponentGoal(team) {
  return ownGoal(team === 0 ? 1 : 0);
}

/** Clamp utilitaire. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Nombre de joueurs par équipe → playlist ballchasing. */
export function playlistFromTeamSize(teamSize) {
  if (teamSize <= 1) return 'ranked-duels';
  if (teamSize === 2) return 'ranked-doubles';
  return 'ranked-standard';
}

export function safeNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
