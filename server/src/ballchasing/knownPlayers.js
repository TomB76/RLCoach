/**
 * Suggestions de noms de joueurs professionnels.
 *
 * ⚠️ Liste d'aide à la saisie uniquement : ce ne sont PAS des données mesurées.
 * L'application ne peut construire la référence d'un joueur qu'en récupérant ses
 * replays via ballchasing (token requis). Les noms doivent correspondre
 * exactement au pseudo utilisé sur ballchasing ; l'UI signale les échecs.
 */

export const SUGGESTED_PLAYERS = [
  'Vatira',
  'Zen',
  'M0nkey M00n',
  'Rw9',
  'Atow',
  'Kai',
  'Rise',
  'Joyo',
  'Joreuz',
  'Archie',
  'Atomik',
  'Seikoo',
  'Extra',
  'Itachi',
  'ApparentlyJack',
  'Chronic',
  'BeastMode',
  'Firstkiller',
  'Sypical',
  'Mist',
  'Atomic',
  'Daniel',
  'Comm',
  'Torment',
  'Squishy',
  'GarrettG',
  'Jstn',
  'Chicago',
  'Aztral',
  'Chausette45',
];

/** Suggestions pour un mode donné (mêmes noms, l'app filtre ensuite par replays trouvés). */
export function suggestedPlayersFor() {
  return SUGGESTED_PLAYERS;
}
