# 🏎️ RL Coach

Coach Rocket League local : l'app analyse tes matchs, compare **tes statistiques à celles des pros** (ballchasing.com) et génère des **recommandations personnalisées et priorisées** — diagnostic, explication, exercices concrets et objectif chiffré.

![statut](https://img.shields.io/badge/node-%E2%89%A520-informational) ![licence](https://img.shields.io/badge/usage-local%20only-informational)

---

## Ce que fait l'application

| Étape | Détail |
|---|---|
| 1. Captation | Connexion à l'**API Stats locale du jeu** (`rocketleague.com/developer/stats-api`) : le jeu diffuse le match en JSON sur `127.0.0.1:49123` (WebSocket ou TCP). |
| 2. Analyse | Le tracker transforme ce flux en **21 métriques** alignées sur le schéma ballchasing : boost, mouvement, positionnement, production, démolitions, touches. |
| 3. Référence pro | Les distributions pros (p10 → p90) sont récupérées via l'**API ballchasing** (`ballchasing.com/doc/api`) : replays étiquetés *pro*, un point de mesure par joueur et par match. |
| 4. Diagnostic | Chaque métrique est positionnée en **percentile** dans la distribution pro, puis convertie en performance 0–100 (direction de la métrique respectée). |
| 5. Coaching | Les faiblesses sont triées par **impact = poids métier × gravité de l'écart**, traduites en diagnostics, exercices et objectifs (palier p25 pro). |

Le score global (`RL Coach score`) est la moyenne pondérée des performances face aux pros. Il mesure ton **profil de jeu**, pas ton classement en jeu.

---

## Démarrage rapide

```powershell
cd C:\Users\Tom\Desktop\RlCoachApp
npm install
npm run dev
```

- Interface : http://localhost:5317
- API : http://localhost:4317/api/status

Sans Rocket League lancé ni token ballchasing, l'app fonctionne quand même : clique sur **« Lancer une démo »** (match simulé, 2 profils disponibles) et la référence pro utilise des **repères de démarrage** clairement identifiés dans l'interface.

### Activer l'export des stats dans Rocket League (obligatoire pour le live)

Crée/édite `Documents\My Games\Rocket League\TAGame\Config\TAStatsAPI.ini` :

```ini
[TAGame.MatchStatsExporter_TA]
Port=49123
PacketSendRate=30
```

Puis relance le jeu. L'indicateur de connexion dans l'app passe au vert dès que le jeu émet.

### Configurer ballchasing (pour les vrais pros)

1. Crée un compte sur [ballchasing.com](https://ballchasing.com) (gratuit).
2. Récupère ton **API token** dans ton profil.
3. Dans l'app → **Réglages** → colle le token → **Tester** → **Actualiser la référence pro**.

L'actualisation récupère N replays pros du mode choisi (throttle 550 ms entre requêtes, conformément à la limite de l'API), calcule les quantiles et met en cache le résultat 7 jours (`data/pro-cache.json`). Tes matchs déjà analysés sont automatiquement recalculés.

### Analyser un fichier `.replay`

Réglages → **Import de replay** : le fichier est envoyé à ballchasing (visibilité *unlisted*), analysé, puis importé dans ton historique avec son diagnostic de coach.

---

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | serveur + interface (Vite) en parallèle |
| `npm run dev:server` / `npm run dev:web` | l'un ou l'autre |
| `npm start` | serveur seul, sert `dist/` s'il existe |
| `npm run build` | build de production de l'interface |
| `npm test` | 17 tests (`node --test`) : tracker, moteur, cohorte, simulateur |
| `npm run simulate` | un match simulé en ligne de commande |

---

## Architecture

```
server/src/
  config.js                 paramètres (.env + data/settings.json)
  store.js                  persistance JSON atomique (matchs, réglages, cache pro)
  index.js                  Express + WebSocket /live, orchestration
  rl/statsApiClient.js      WebSocket/TCP vers le jeu, reconnexion, parsing flux
  rl/matchTracker.js        machine à états du match → métriques ballchasing-like
  rl/geometry.js            repère du terrain, tiers, seuils de vitesse
  rl/simulator.js           flux « API Stats » simulé (démo + tests)
  ballchasing/client.js     API ballchasing (throttle, retry 429, upload)
  ballchasing/cohort.js     construction/cache des distributions pros
  coach/metrics.js          catalogue des 21 métriques + quantiles/percentiles
  coach/rules.js            13 règles de coaching (diagnostic, drills, objectif)
  coach/engine.js           comparaison, score, priorisation, plan d'entraînement
  coach/seedBenchmarks.js   repères de démarrage par mode (marqués « démo »)
web/src/                    interface React 19 (Vite), CSS maison, SVG inline
server/test/                tests node:test
```

### Flux de données

```
Rocket League ──(JSON)──▶ StatsApiClient ──▶ MatchTracker ──▶ comparaison pro ──▶ recommandations
                                                  │                                    │
ballchasing ──▶ cohorte (p10…p90) ────────────────┘                                    ▼
                                                                            data/matches.json
                                                                                      │
WebSocket /live + REST ◀──────────────────────────────────────────────────────────────┘
```

---

## Méthodologie (et ses limites, assumées)

**Métriques comparables.** Les clés suivent ballchasing (`boost.percentZeroBoost`, `movement.avgSpeed`, `positioning.percentOffensiveThird`…) pour que les données calculées en direct et celles récupérées via ballchasing soient directement comparables.

**Normalisation.** Les compteurs (buts, arrêts, tirs, passes, démos) sont convertis en *par minute*. Les métriques temporelles sont des pourcentages du temps joué, donc insensibles à la durée du match.

**Percentiles.** Le rang percentile est interpolé sur les quantiles pro (min, p10, p25, p50, p75, p90, max). Performance = percentile si « plus c'est haut, mieux c'est », `100 − percentile` sinon.

**Priorisation.** `impact = poids × (seuil − performance)`, puis normalisation 0–100 pour l'affichage. Le poids reflète l'importance de la dimension dans le jeu (gestion du boost et vitesse > démolitions).

**Limites connues :**
- L'API Stats locale du jeu est le seul canal fiable pour tes propres matchs. L'API publique « stats » de Rocket League n'est pas ouverte : pas de requête web pour tes matchs, uniquement le flux local (ou des replays via ballchasing).
- Le mode de jeu n'est pas transmis par l'API Stats : il est **déduit du nombre de joueurs** (1v1 / 2v2 / 3v3). Un mode spécial n'est pas détecté.
- Les touches par minute, touches aériennes et temps de portage sont calculés par nos soins ; ballchasing ne les expose pas, donc ces métriques ne sont pas comparées aux pros quand le match vient d'un replay ballchasing (elles sont ignorées, pas comptées comme nulles).
- Détection des gros/petits pads approximée par le delta de jauge de boost.
- Les repères de démarrage (`source: seed`) sont des ordres de grandeur par mode, pas une cohorte mesurée : l'interface l'indique explicitement et invite à actualiser via ballchasing.
- Pas de détection de rang (l'API Stats ne le fournit pas), donc un seul référentiel pro par mode.

---

## API interne (utilisée par l'interface)

| Route | Rôle |
|---|---|
| `GET /api/status` | état complet (jeu, démo, cohorte, stockage) |
| `GET/PATCH /api/settings` | réglages (le token n'est jamais renvoyé en clair) |
| `POST /api/settings/test-token` | validation du token ballchasing |
| `POST /api/rl/connect` `POST /api/rl/disconnect` | connexion au jeu |
| `GET /api/live` | snapshot du match en cours |
| `POST /api/demo/start` `POST /api/demo/stop` | matchs simulés |
| `GET /api/matches` `GET /api/matches/:id` `DELETE` | historique |
| `POST /api/matches/:id/set-local` | déclarer « c'est moi » dans un match (mémorise le pseudo) |
| `GET /api/coach/overview` | plan d'entraînement multi-matchs |
| `GET /api/pro/reference` `POST /api/pro/refresh` | cohorte pro |
| `POST /api/replays/import` | import d'un `.replay` via ballchasing |
| `WS /live` | `snapshot`, `status`, `match-completed`, `pro-refresh` |

---

## Dépannage

| Symptôme | Cause probable |
|---|---|
| « Connexion refusée » dans le cockpit | `TAStatsAPI.ini` absent ou jeu fermé (le socket n'existe que jeu lancé). |
| Aucun match enregistré après une partie | pseudo in-game saisi différemment (majuscules/accents) : l'app compare sans tenir compte de la casse ; vérifie aussi `minMatchSeconds`. |
| `HTTP 401` ballchasing | token invalide ou révoqué. |
| `HTTP 429` ballchasing | trop de requêtes : attends ~10 s, le client réessaie automatiquement. |
| « Aucun replay trouvé » | le filtre *pro* ne renvoie rien pour ce mode ; l'app retente automatiquement sur Grand Champion. |
| Port 4317 occupé | `PORT=4400 npm start` (et adapte le proxy Vite). |

---

## Versionnement Git

```powershell
cd C:\Users\Tom\Desktop\RlCoachApp
git init
git add .
git commit -m "feat: coach Rocket League (analyse locale + comparaison pro + recommandations)"
```

`data/` et `.env` sont ignorés : tes matchs et ton token restent chez toi.
