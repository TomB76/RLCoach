/**
 * Catalogue de diagnostics du coach.
 *
 * Chaque règle cible une métrique, explique pourquoi c'est important (en termes
 * de jeu), propose des exercices concrets et un rappel utilisable en match.
 * Une règle se déclenche quand la performance de la métrique passe sous
 * `threshold` (0–100, 100 = niveau p90 des pros).
 */

export const RULES = [
  {
    id: 'boost-drought',
    metricKey: 'boost.percentZeroBoost',
    category: 'boost',
    threshold: 45,
    title: 'Tu joues une grande partie du match sans boost',
    diagnosis: (c) =>
      `Tu passes ${fmt(c.value, c.unit)} du temps à 0 boost, contre ${fmt(c.reference.p50, c.unit)} pour un pro (${c.playlistLabel}). Sans boost, tu ne peux ni contester en l'air, ni revenir en défense, ni finir une action.`,
    why: "Le boost n'est pas une ressource de confort : c'est ce qui te permet de gagner les duels aériens et de tenir ta rotation. Tomber à zéro signifie que tu n'as pas pris de pads pendant 10 à 20 secondes.",
    cue: 'Après chaque action, prends deux petits pads sur le chemin du retour.',
    drills: [
      {
        name: 'Routine de pads',
        description:
          "En freeplay, pendant 3 minutes, ne prends JAMAIS le gros pad central. Ramasse uniquement les petits pads en enchaînant des rotations dans les 6 positions du terrain. Compte tes passages sous 30 de boost.",
        objective: 'Réduire le temps à 0 boost sous 5 % du temps de jeu.',
      },
      {
        name: 'Demi-tour boost',
        description:
          'En match, après chaque touche offensive, prends systématiquement le pad arrière le plus proche et pas le plus gros : tu dois rester au-dessus de 30 de boost en permanence.',
        objective: 'Jamais deux actions offensives de suite avec moins de 20 de boost.',
      },
    ],
  },
  {
    id: 'boost-collection',
    metricKey: 'boost.bpm',
    category: 'boost',
    threshold: 45,
    title: 'Tu collectes trop peu de boost par minute',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit === '/min' ? '' : c.unit)} de boost collecté par minute contre ${fmt(c.reference.p50, c.unit)} chez un pro. Ton tracé sur le terrain ne croise pas assez les pads.`,
    why: 'La collecte est le reflet direct de tes trajectoires : les pros ramassent presque sans s\'arrêter parce qu\'ils passent systématiquement sur les pads.',
    cue: 'Chemin en zigzag : prends les pads même quand tu ne manques pas de boost.',
    drills: [
      {
        name: 'Course aux pads',
        description:
          "En freeplay sans le ballon, fais 5 tours du terrain en 60 secondes en prenant au moins 3 pads par aller-retour, sans jamais atteindre 0.",
        objective: 'Dépasser la médiane pro de collecte.',
      },
    ],
  },
  {
    id: 'supersonic',
    metricKey: 'movement.percentSupersonicSpeed',
    category: 'movement',
    threshold: 42,
    title: 'Tu passes trop peu de temps à vitesse supersonique',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit)} du temps en supersonique contre ${fmt(c.reference.p50, c.unit)} pour un pro. Tu te déplaces plus lentement que le rythme du match.`,
    why: "La vitesse supersonique te donne les duels à 50/50 et te permet d'arriver sur les rotations en premier. Un joueur qui ne dépasse pas la vitesse seuil arrive systématiquement à la balle après son adversaire.",
    cue: 'Boost pour atteindre le supersonique AVANT de tourner, pas pendant.',
    drills: [
      {
        name: 'Lignes supersoniques',
        description:
          "En freeplay, sur chaque ligne droite du terrain, atteins le supersonique en 1,5 seconde puis maintiens-le jusqu'à la fin de la course. Alterne les lignes droites et les virages serrés.",
        objective: 'Supersonique > 15 % du temps de jeu.',
      },
    ],
  },
  {
    id: 'slow-speed',
    metricKey: 'movement.percentSlowSpeed',
    category: 'movement',
    threshold: 45,
    title: 'Tu restes trop souvent à faible vitesse',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit)} du temps sous 1400 uu/s, contre ${fmt(c.reference.p50, c.unit)} chez un pro. Cela signifie beaucoup d'attentes immobiles et peu d'anticipation.`,
    why: 'Le temps lent révèle les hésitations : quand tu attends de voir, ton adversaire est déjà en train de jouer la balle.',
    cue: 'Décide plus tôt : mouvement vers la zone, pas vers la balle.',
    drills: [
      {
        name: 'Anticipation',
        description:
          'Regarde 5 replays et mets sur pause AVANT chaque touche : note où tu aurais dû être. Rejoue pour vérifier. Objectif : ne plus jamais être complètement à l\'arrêt en attente.',
        objective: 'Descendre le temps lent sous la médiane pro.',
      },
    ],
  },
  {
    id: 'aerial',
    metricKey: 'movement.percentHighAir',
    category: 'movement',
    threshold: 40,
    title: 'Ton jeu aérien est très limité',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit)} du temps en hauteur, contre ${fmt(c.reference.p50, c.unit)} pour un pro. Les balles qui retombent te coûtent des secondes de plus pour les contrôler.`,
    why: "Le vertical est ce qui sépare les niveaux : les pros attaquent la balle en l'air avant qu'elle ne devienne un duel au sol.",
    cue: "Si la balle est haute, la voiture va aussi en l'air : ne la laisse pas retomber.",
    drills: [
      {
        name: 'Double saut immobile',
        description:
          'En freeplay : 10 minutes de balles au-dessus de la voiture, en essayant de toucher la balle au plus haut du double saut. Puis 10 minutes de passes que tu dois reprendre en l\'air.',
        objective: 'Part de touches aériennes > 15 %.',
      },
      {
        name: 'Aérien en match',
        description:
          "Sur 5 matchs, imposes-toi 8 aériens minimum, même mal négociés : l'objectif est le déclenchement, pas la réussite.",
        objective: 'Initiative aérienne dans chaque possession.',
      },
    ],
  },
  {
    id: 'distance-to-ball',
    metricKey: 'positioning.avgDistanceToBall',
    category: 'positioning',
    threshold: 42,
    title: 'Tu restes trop loin de la balle',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit)} de distance moyenne à la balle, contre ${fmt(c.reference.p50, c.unit)} chez un pro. Tu subis le jeu plutôt que de le contester.`,
    why: "Trop loin, tu arrives toujours après l'action : une distance moyenne élevée est le symptôme d'une absence de contrôle de la zone et d'un positionnement défensif permanent.",
    cue: 'Reste dans la zone où la balle sera dans 1 seconde.',
    drills: [
      {
        name: 'Position de soutien',
        description:
          'En 2v2, impose-toi de rester à moins de 2 500 uu de la balle au moment où ton coéquipier touche, sans jamais doubler la même balle.',
        objective: 'Rapprocher la distance moyenne de la cible pro.',
      },
    ],
  },
  {
    id: 'passive-offense',
    metricKey: 'positioning.percentOffensiveThird',
    category: 'positioning',
    threshold: 42,
    title: 'Tu passes trop peu de temps dans le tiers offensif',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit)} du temps dans le dernier tiers contre ${fmt(c.reference.p50, c.unit)} chez un pro. Tu défends beaucoup, tu ne mets pas la pression.`,
    why: 'Le tiers offensif est ce qui crée les buts : centre, remise dans la dernière zone, pression permanente. Un rythme de rotation lent te laisse dans ton camp.',
    cue: 'Après un dégagement clair, monte et prends un pad : reviens en attaque.',
    drills: [
      {
        name: 'Pression après dégagement',
        description:
          'En match, sur chaque dégagement propre, force un joueur en avant (toi ou coéquipier) pour aller chercher une balle haute dans le tiers adverse.',
        objective: 'Approcher 30 % du temps en zone offensive.',
      },
    ],
  },
  {
    id: 'few-touches',
    metricKey: 'custom.touchesPerMinute',
    category: 'custom',
    threshold: 45,
    title: 'Tu touches peu de ballons',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit === '/min' ? '' : c.unit)} touches par minute contre ${fmt(c.reference.p50, c.unit)} chez un pro. Ton impact sur le jeu reste faible.`,
    why: 'Le nombre de touches mesure ta participation réelle : plus tu touches la balle proprement, plus tu dictes le rythme.',
    cue: 'Cherche une touche utile par action, pas un exploit par action.',
    drills: [
      {
        name: 'Contrôles propres',
        description:
          '10 minutes de freeplay : chaque touche doit rester à moins de 300 uu de la voiture. Objectif : 60 contrôles consécutifs sans perdre la balle.',
        objective: 'Augmenter les touches utiles, pas les touches de panique.',
      },
    ],
  },
  {
    id: 'shooting',
    metricKey: 'core.shootingPercentage',
    category: 'core',
    threshold: 45,
    title: 'Beaucoup de tirs, peu de précision',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit)} de réussite sur tes tirs contre ${fmt(c.reference.p50, c.unit)} chez un pro. Tu prends des tirs non préparés.`,
    why: "La précision est le produit de la position de départ : les tirs pros partent d'un angle préparé, pas d'un contact dans l'urgence.",
    cue: 'Cadre d\'abord, ajoute la puissance ensuite.',
    drills: [
      {
        name: 'Tirs placés',
        description:
          'En freeplay, 100 tirs sur la même cible (coin haut opposé) : arrête le compte si tu ne touches pas la zone. Puis 50 tirs depuis une passe en retrait.',
        objective: 'Précision > 30 %.',
      },
    ],
  },
  {
    id: 'shot-volume',
    metricKey: 'core.shotsPerMinute',
    category: 'core',
    threshold: 42,
    title: 'Tu ne prends pas assez de tirs',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit === '/min' ? '' : c.unit)} tirs par minute contre ${fmt(c.reference.p50, c.unit)} chez un pro. Tu construis peu de situations de tir.`,
    why: 'Sans volume de tirs, tu laisses le gardien et la défense contrôler. Les équipes pros forcent le tir dès que la ligne est ouverte.',
    cue: 'Dès que tu as un angle, tire : un tir force une décision au gardien.',
    drills: [
      {
        name: 'Volume contrôlé',
        description:
          'Sur 5 matchs, impose-toi au minimum 1 tir toutes les 90 secondes, depuis une balle préparée.',
        objective: 'Atteindre la moitié du volume pro minimum.',
      },
    ],
  },
  {
    id: 'passes',
    metricKey: 'core.assistsPerMinute',
    category: 'core',
    threshold: 45,
    title: 'Tu joues peu en équipe',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit === '/min' ? '' : c.unit)} passes décisives par minute contre ${fmt(c.reference.p50, c.unit)} chez un pro. Tes actions se terminent sans relais.`,
    why: 'Les passes décisives mesurent ta capacité à finir une action en la mettant aux pieds de ton coéquipier au bon endroit.',
    cue: 'Cherche la remise à 45° plutôt que le duel systématique.',
    drills: [
      {
        name: 'Deux touches',
        description:
          'En 2v2, sur 10 minutes : après ta première touche, cherche obligatoirement une passe vers un coéquipier ou une touche vers le corner.',
        objective: 'Créer au moins 2 situations de passe par match.',
      },
    ],
  },
  {
    id: 'demo-taken',
    metricKey: 'demo.takenPerMinute',
    category: 'demo',
    threshold: 40,
    title: 'Tu te fais démolir trop souvent',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit === '/min' ? '' : c.unit)} démolitions subies par minute contre ${fmt(c.reference.p50, c.unit)} chez un pro. Tu es prévisible dans tes rotations.`,
    why: 'Se faire démolir coûte plus que la perte de boost : tu perds 3 secondes de jeu et la structure de ton équipe. Un tracé qui ne change jamais est une cible offerte.',
    cue: 'Après chaque touche, prends une sortie différente.',
    drills: [
      {
        name: 'Rotation imprévisible',
        description:
          'Sur 5 matchs, change volontairement de route de sortie à chaque fois (ligne arrière, mur, diagonale).',
        objective: 'Démos subies sous la médiane pro.',
      },
    ],
  },
  {
    id: 'saves',
    metricKey: 'core.savesPerMinute',
    category: 'core',
    threshold: 42,
    title: 'Peu d\'arrêts pour un temps passé en défense',
    diagnosis: (c) =>
      `${fmt(c.value, c.unit === '/min' ? '' : c.unit)} arrêts par minute contre ${fmt(c.reference.p50, c.unit)} chez un pro, alors que tu passes beaucoup de temps derrière.`,
    why: "Le défenseur qui touche peu de ballons dangereuses subit : ses arrêts sont le résultat du placement plus que du réflexe.",
    cue: 'Place-toi sur la ligne de tir, pas dans la cage.',
    drills: [
      {
        name: 'Placement défensif',
        description:
          'En freeplay, ballons envoyés vers ton but depuis 3 angles : place la voiture sur la ligne balle-but, jamais collée au mur.',
        objective: 'Arrêts > 0,3 / min.',
      },
    ],
  },
];

export const RULES_BY_METRIC = new Map(RULES.map((rule) => [rule.metricKey, rule]));

function fmt(value, unit) {
  const v = Number.isFinite(value) ? value : 0;
  const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  if (unit === '%') return `${rounded} %`;
  if (unit === '/min') return `${rounded}/min`;
  if (unit === 'uu') return `${rounded} uu`;
  if (unit === 'uu/s') return `${rounded} uu/s`;
  return `${rounded}`;
}

/**
 * Objectif chiffré intermédiaire : à mi-chemin entre la valeur actuelle et le
 * palier p25 des pros (objectif atteignable avant de viser le niveau pro).
 * Sans valeur actuelle, renvoie directement la cible pro.
 */
export function targetFor(reference, current = null) {
  if (!reference) return null;
  const goal = reference.p25 ?? reference.p50 ?? null;
  if (goal === null || goal === undefined) return null;
  if (current === null || current === undefined || !Number.isFinite(current)) return goal;
  return Math.round((current + (goal - current) * 0.5) * 100) / 100;
}
