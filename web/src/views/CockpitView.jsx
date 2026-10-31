import { useMemo, useState } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { useApiResource } from '../hooks/useApiResource.js';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { Badge, Banner, Button, Card, CardHead, EmptyState, PageHead, Segmented, SkeletonBlock, Spinner, StatTile, StatusDot, StepControl } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { RecommendationCard } from '../components/coach.jsx';
import { clock, durationLabel, metric, num, relative, EMPTY } from '../format.js';
import { DEMO_PROFILES, playlistLabel } from '../metrics.js';

const RL_STATES = {
  disconnected: { label: 'Déconnecté', tone: 'neutral', dot: 'neutral' },
  connecting: { label: 'Connexion…', tone: 'warn', dot: 'warn' },
  connected: { label: 'Connecté', tone: 'ok', dot: 'ok' },
  waiting: { label: 'En attente du jeu', tone: 'info', dot: 'info' },
  error: { label: 'Erreur de connexion', tone: 'danger', dot: 'danger' },
};

const DURATIONS = [60, 90, 120, 180];
const SPEEDS = [1, 8, 20, 40];
const EVENT_ICONS = { goal: 'ball', 'match-start': 'clock', 'match-end': 'clock', statfeed: 'live', touch: 'live', crossbar: 'alert', replay: 'clock', discard: 'alert' };

export default function CockpitView({ navigate }) {
  const {
    status,
    statusError,
    snapshot,
    socketState,
    dataVersion,
    playlists,
    startDemo,
    stopDemo,
    connectRl,
    disconnectRl,
    refreshStatus,
  } = useAppData();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [demoPlaylist, setDemoPlaylist] = useState(null);
  const [demo, setDemo] = useState({ profile: 'ranked', count: 2, durationSeconds: 90, speed: 40 });

  const rl = status?.rl || {};
  const rlState = RL_STATES[rl.state] || RL_STATES.disconnected;
  const demoState = status?.demo || { running: false, progress: 0, total: 0 };
  const settings = status?.settings || {};
  const playlist = demoPlaylist || settings.targetPlaylist || 'ranked-doubles';
  const local = snapshot?.localPlayer || null;
  const stats = local?.stats || {};
  const active = Boolean(snapshot?.active);
  // Jeu libre : le jeu tourne mais aucune partie n'est lancée (rien n'est collecté).
  const freeplay = Boolean(snapshot?.freeplay) && !active;

  const referenceMode = status?.ballchasing?.reference?.mode || 'global';
  const referencePlayer = status?.ballchasing?.reference?.player || null;
  const referenceShort = referenceMode === 'player' ? referencePlayer || 'Joueur pro' : 'Pros';
  const referenceFull = status?.ballchasing?.reference?.label || (referenceMode === 'player' ? `${referencePlayer} (joueur unique)` : 'Pros (cohorte globale)');

  const overviewRes = useApiResource((signal) => api.overview({ limit: 15 }, signal), [dataVersion]);
  const overview = overviewRes.data?.overview || null;
  const priority = overview?.priorities?.[0] || null;
  const needsFallback = Boolean(overview) && !priority && (overview?.scope?.matchCount || 0) > 0;

  const fallbackRes = useApiResource(async (signal) => {
    if (!needsFallback) return null;
    const { matches } = await api.matches({ limit: 1 }, signal);
    const id = matches?.[0]?.id;
    if (!id) return null;
    const { match } = await api.match(id, signal);
    return match;
  }, [needsFallback, dataVersion]);

  const lastMatch = fallbackRes.data || null;
  const fallbackReco = lastMatch?.coaching?.recommendations?.[0] || null;

  const tiles = useMemo(
    () => [
      { label: 'Buts', value: num(stats.core?.goals, 0) },
      { label: 'Tirs', value: num(stats.core?.shots, 0) },
      { label: 'Arrêts', value: num(stats.core?.saves, 0) },
      { label: 'Passes', value: num(stats.core?.assists, 0) },
      { label: 'Touches', value: num(stats.custom?.touches, 0) },
      { label: 'Boost/min', value: num(stats.boost?.bpm, 0) },
      { label: 'Supersonique', value: metric(stats.movement?.percentSupersonicSpeed, '%', 1) },
      { label: 'Vitesse moy.', value: metric(stats.movement?.avgSpeed, 'uu/s', 0) },
    ],
    [stats],
  );

  const events = (snapshot?.recentEvents || []).slice(-9).reverse();

  async function handleConnection(action) {
    setBusy(action);
    try {
      if (action === 'connect') {
        await connectRl();
        toast.push({ kind: 'info', title: 'Connexion demandée', message: 'L’API Stats de Rocket League est contactée.' });
      } else {
        await disconnectRl();
        toast.push({ kind: 'info', title: 'Déconnecté', message: 'La connexion à l’API Stats est coupée.' });
      }
    } catch (error) {
      toast.push({ kind: 'error', title: 'Action impossible', message: error.message });
    } finally {
      setBusy(null);
    }
  }

  async function handleStartDemo() {
    setBusy('demo');
    try {
      await startDemo({
        playlist,
        durationSeconds: demo.durationSeconds,
        speed: demo.speed,
        profile: demo.profile,
        count: demo.count,
      });
      toast.push({
        kind: 'success',
        title: 'Démo lancée',
        message: `${demo.count} match${demo.count > 1 ? 's' : ''} simulé${demo.count > 1 ? 's' : ''} · le premier arrive dans quelques secondes.`,
      });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Démo non lancée', message: error.message });
      refreshStatus({ silent: true }).catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  async function handleStopDemo() {
    setBusy('stop');
    try {
      await stopDemo();
      toast.push({ kind: 'info', title: 'Démo arrêtée' });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Arrêt impossible', message: error.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Temps réel"
        title="Cockpit"
        subtitle="Ton match en cours, l’état de la connexion au jeu et la prochaine chose à travailler."
        actions={
          <div className="head-status">
            <Badge tone={socketState === 'open' ? 'ok' : 'warn'} dot>
              {socketState === 'open' ? 'WebSocket live' : 'Polling 2 s'}
            </Badge>
            <Badge tone="neutral">{num(status?.storage?.matchCount, 0)} matchs analysés</Badge>
            <Badge tone={referenceMode === 'player' ? 'accent' : 'info'} title={`Référence de comparaison : ${referenceFull}`}>
              Réf. : {referenceShort}
            </Badge>
          </div>
        }
      />

      {statusError ? (
        <Banner tone="danger" title="Serveur local injoignable">
          {statusError}
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => refreshStatus().catch(() => {})}>
            Réessayer
          </Button>
        </Banner>
      ) : null}

      <div className="cockpit-grid">
        <div className="cockpit-grid__main">
          <Card>
            <CardHead
              title="API Stats Rocket League"
              hint={`${rl.host || settings.host || '127.0.0.1'}:${rl.port || settings.port || 49123} · ${(rl.transport || 'ws').toUpperCase()}`}
              actions={
                <Badge tone={rlState.tone} dot>
                  {rlState.label}
                </Badge>
              }
            />
            <dl className="meta-list">
              <div>
                <dt>Messages reçus</dt>
                <dd>{num(rl.messageCount, 0)}</dd>
              </div>
              <div>
                <dt>Dernier message</dt>
                <dd>{rl.lastMessageAt ? relative(rl.lastMessageAt) : EMPTY}</dd>
              </div>
              <div>
                <dt>Suivi du match</dt>
                <dd>{status?.tracker?.tracking ? 'en cours' : 'inactif'}</dd>
              </div>
            </dl>

            {rl.state === 'error' && rl.lastError ? (
              <Banner tone="danger" title="Le jeu a renvoyé une erreur">
                {rl.lastError}
              </Banner>
            ) : null}

            {rl.state === 'disconnected' ? (
              <p className="hint-text">
                L’API Stats n’est pas ouverte. Lance Rocket League, puis clique sur <strong>Connecter</strong> (ou active
                l’auto-connexion dans les <a href="#/reglages">réglages</a>). Tu peux aussi tout tester sans le jeu avec la
                démo ci-contre.
              </p>
            ) : null}
            {rl.state === 'waiting' ? (
              <p className="hint-text">Connexion établie. En attente d’un match : lance une partie classée ou un freeplay.</p>
            ) : null}
            {rl.state === 'connected' ? (
              <p className="hint-text">Connecté à Rocket League. Les matchs sont détectés et analysés automatiquement.</p>
            ) : null}

            <div className="card__foot">
              {rl.state === 'disconnected' || rl.state === 'error' ? (
                <Button variant="primary" icon="wifi" loading={busy === 'connect'} onClick={() => handleConnection('connect')}>
                  Connecter
                </Button>
              ) : (
                <Button variant="ghost" icon="stop" loading={busy === 'disconnect'} onClick={() => handleConnection('disconnect')}>
                  Déconnecter
                </Button>
              )}
              <a className="btn btn--ghost" href="#/reglages">
                <Icon name="settings" size={16} />
                <span>Réglages de connexion</span>
              </a>
            </div>
          </Card>

          <Card className="live-card">
            <CardHead
              title="Match en cours"
              hint={active ? `${snapshot?.arena || 'Arène inconnue'} · ${playlistName(playlists, snapshot?.playlist)}` : freeplay ? 'Jeu libre — aucune donnée collectée' : 'Aucun match en cours'}
              actions={
                <Badge tone={active ? 'ok' : 'neutral'} dot>
                  {active ? `en direct · ${clock(snapshot?.gameTimeSeconds)}` : freeplay ? 'jeu libre' : 'en veille'}
                </Badge>
              }
            />

            {active ? (
              <>
                <div className="scoreboard">
                  <div className={`scoreboard__team${local?.team === 0 ? ' is-mine' : ''}`}>
                    <span className="scoreboard__name">Bleu</span>
                    <span className="scoreboard__score">{num(snapshot?.teamScores?.[0] ?? 0, 0)}</span>
                  </div>
                  <div className="scoreboard__clock">
                    <span className="scoreboard__time">{clock(snapshot?.gameTimeSeconds)}</span>
                    <span className="scoreboard__meta">{snapshot?.players?.length || 0} joueurs</span>
                  </div>
                  <div className={`scoreboard__team scoreboard__team--orange${local?.team === 1 ? ' is-mine' : ''}`}>
                    <span className="scoreboard__name">Orange</span>
                    <span className="scoreboard__score">{num(snapshot?.teamScores?.[1] ?? 0, 0)}</span>
                  </div>
                </div>

                {local ? (
                  <div className="stats-block">
                    <div className="stats-block__head">
                      <span className="stats-block__player">
                        <StatusDot tone="ok" pulse />
                        {local.name}
                      </span>
                      <span className="stats-block__team">{local.team === 0 ? 'équipe bleue' : 'équipe orange'}</span>
                    </div>
                    <div className="stat-grid">
                      {tiles.map((tile) => (
                        <StatTile key={tile.label} label={tile.label} value={tile.value} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <Banner tone="warn" title="Joueur local non identifié">
                    Renseigne ton pseudo in-game dans les <a href="#/reglages">réglages</a> pour voir ta ligne de stats en direct.
                  </Banner>
                )}

                <div className="event-feed">
                  <h3 className="event-feed__title">Derniers événements</h3>
                  {events.length ? (
                    <ol className="event-feed__list">
                      {events.map((event, index) => (
                        <li key={`${event.t}-${index}`} className={`event event--${event.type}`} style={{ '--i': index }}>
                          <span className="event__time">{clock(event.t)}</span>
                          <Icon name={EVENT_ICONS[event.type] || 'info'} size={14} className="event__icon" />
                          <span className="event__message">{event.message}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted">Aucun événement pour le moment.</p>
                  )}
                </div>
              </>
            ) : freeplay ? (
              <EmptyState
                icon="live"
                title="Jeu libre détecté"
                description="Aucune partie lancée : rien n’est collecté ni analysé. Lance un match (ou une démo) pour voir le cockpit s’activer."
              />
            ) : (
              <EmptyState
                icon="live"
                title={demoState.running ? 'Démo en cours : le match démarre…' : 'Aucun match en cours'}
                description={
                  demoState.running
                    ? 'Les données arrivent par le WebSocket, le score et tes stats s’affichent dès le coup d’envoi.'
                    : 'Lance une partie dans Rocket League (API Stats connectée) ou démarre une démo simulée pour voir le cockpit en action.'
                }
                action={
                  demoState.running ? (
                    <span className="inline-loading">
                      <Spinner /> <span>Attente du coup d’envoi…</span>
                    </span>
                  ) : null
                }
              />
            )}
          </Card>
        </div>

        <div className="cockpit-grid__side">
          <Card>
            <CardHead
              title="Démarrer une démo"
              hint="Données simulées localement : aucun besoin de lancer Rocket League."
              actions={<Badge tone="warn">démo</Badge>}
            />
            {demoState.running ? (
              <div className="demo-progress">
                <div className="demo-progress__head">
                  <span>
                    Match {num(Math.min(demoState.total || 1, (demoState.progress || 0) + 1), 0)} / {num(demoState.total, 0)}
                  </span>
                  <Badge tone="info">
                    profil {DEMO_PROFILES.find((p) => p.id === demoState.profile)?.label || demoState.profile || 'ranked'}
                  </Badge>
                </div>
                <div className="meter meter--brand" role="progressbar" aria-valuemin={0} aria-valuemax={demoState.total || 1} aria-valuenow={demoState.progress || 0} aria-label="Progression de la démo">
                  <span
                    className="meter__fill"
                    style={{ width: `${Math.min(100, ((demoState.progress || 0) / (demoState.total || 1)) * 100)}%` }}
                  />
                </div>
                <p className="hint-text">
                  Les matchs s’enchaînent automatiquement. Les scores coach apparaissent dans l’historique dès la fin de chaque partie.
                </p>
                <Button variant="ghost" icon="stop" loading={busy === 'stop'} onClick={handleStopDemo}>
                  Arrêter la démo
                </Button>
              </div>
            ) : (
              <div className="form-stack">
                <Segmented
                  label="Profil simulé"
                  value={demo.profile}
                  onChange={(value) => setDemo((prev) => ({ ...prev, profile: value }))}
                  options={DEMO_PROFILES.map((profile) => ({ value: profile.id, label: profile.label, hint: profile.hint }))}
                />
                <div className="field">
                  <label className="field__label" htmlFor="demo-playlist">
                    Mode de jeu
                  </label>
                  <select
                    id="demo-playlist"
                    className="input"
                    value={playlist}
                    onChange={(event) => setDemoPlaylist(event.target.value)}
                  >
                    {Object.entries(playlists || {}).map(([key, entry]) => (
                      <option key={key} value={key}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <StepControl
                    label="Matchs"
                    value={demo.count}
                    min={1}
                    max={5}
                    onChange={(value) => setDemo((prev) => ({ ...prev, count: value }))}
                  />
                  <div className="field">
                    <label className="field__label" htmlFor="demo-duration">
                      Durée simulée
                    </label>
                    <select
                      id="demo-duration"
                      className="input"
                      value={demo.durationSeconds}
                      onChange={(event) => setDemo((prev) => ({ ...prev, durationSeconds: Number(event.target.value) }))}
                    >
                      {DURATIONS.map((value) => (
                        <option key={value} value={value}>
                          {durationLabel(value)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="demo-speed">
                    Vitesse de simulation
                  </label>
                  <select
                    id="demo-speed"
                    className="input"
                    value={demo.speed}
                    onChange={(event) => setDemo((prev) => ({ ...prev, speed: Number(event.target.value) }))}
                  >
                    {SPEEDS.map((value) => (
                      <option key={value} value={value}>
                        ×{value}
                      </option>
                    ))}
                  </select>
                  <p className="field__hint">Accélère la simulation : ×40 termine un match simulé en quelques secondes.</p>
                </div>
                <Button variant="primary" icon="play" loading={busy === 'demo'} onClick={handleStartDemo}>
                  Démarrer la démo
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <CardHead
              title="Priorité n°1"
              icon="coach"
              hint={overview ? `sur les ${num(overview.scope?.matchCount, 0)} derniers matchs · ${overview.scope?.playlistLabel || ''}` : 'Calculée sur tes derniers matchs'}
              actions={
                <a className="btn btn--ghost btn--sm" href="#/coach">
                  <span>Plan complet</span>
                  <Icon name="chevronRight" size={14} />
                </a>
              }
            />
            {overviewRes.loading && !overview ? (
              <SkeletonBlock rows={4} />
            ) : overviewRes.error ? (
              <Banner tone="danger" title="Impossible de charger le coaching">
                {overviewRes.error}
              </Banner>
            ) : priority ? (
              <>
                <RecommendationCard recommendation={priority} />
                <p className="hint-text">
                  Faiblesse détectée sur {num(priority.matchesAffected, 0)} match(s), soit {num(priority.frequency, 0)} % de tes
                  parties récentes.
                </p>
              </>
            ) : fallbackReco ? (
              <>
                <RecommendationCard recommendation={fallbackReco} />
                <p className="hint-text">
                  Dernier match analysé :{' '}
                  <a href={`#/match/${lastMatch.id}`}>
                    {lastMatch.playlistLabel || lastMatch.playlist} du {relative(lastMatch.date)}
                  </a>
                </p>
              </>
            ) : (
              <EmptyState
                icon="coach"
                title="Pas encore de diagnostic"
                description="Dès qu’un match est analysé, ta priorité de travail apparaît ici avec un exercice concret."
                action={
                  <Button variant="primary" size="sm" icon="play" onClick={handleStartDemo} loading={busy === 'demo'}>
                    Lancer une démo
                  </Button>
                }
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function playlistName(playlists, key) {
  return playlistLabel(playlists, key);
}
