import { useEffect } from 'react';
import { useHashRoute } from './hooks/useApiResource.js';
import { useAppData } from './hooks/useAppData.jsx';
import { Icon } from './components/icons.jsx';
import { Badge, StatusDot } from './components/ui.jsx';
import { num, relative } from './format.js';
import CockpitView from './views/CockpitView.jsx';
import HistoryView from './views/HistoryView.jsx';
import MatchDetailView from './views/MatchDetailView.jsx';
import CoachView from './views/CoachView.jsx';
import ProReferenceView from './views/ProReferenceView.jsx';
import SettingsView from './views/SettingsView.jsx';

const NAV = [
  { path: '/cockpit', label: 'Cockpit', icon: 'cockpit' },
  { path: '/historique', label: 'Historique', icon: 'history' },
  { path: '/coach', label: 'Coach', icon: 'coach' },
  { path: '/pro', label: 'Référence pro', icon: 'pro' },
  { path: '/reglages', label: 'Réglages', icon: 'settings' },
];

const TITLES = {
  '/cockpit': 'Cockpit',
  '/historique': 'Historique',
  '/coach': 'Coach',
  '/pro': 'Référence pro',
  '/reglages': 'Réglages',
};

export default function App() {
  const { segments, path, navigate } = useHashRoute();
  const { status, socketState, snapshot, statusError } = useAppData();

  const isMatchDetail = segments[0] === 'match';
  const activePath = isMatchDetail ? '/historique' : path;
  const pageTitle = isMatchDetail ? 'Détail du match' : TITLES[path] || 'Cockpit';

  useEffect(() => {
    document.title = `RL Coach · ${pageTitle}`;
  }, [pageTitle]);

  let view;
  if (isMatchDetail) view = <MatchDetailView id={segments[1]} navigate={navigate} />;
  else if (path === '/historique') view = <HistoryView navigate={navigate} />;
  else if (path === '/coach') view = <CoachView />;
  else if (path === '/pro') view = <ProReferenceView />;
  else if (path === '/reglages') view = <SettingsView navigate={navigate} />;
  else view = <CockpitView navigate={navigate} />;

  const rlState = status?.rl?.state || 'disconnected';
  const cohort = status?.ballchasing?.cohort;
  const liveActive = Boolean(snapshot?.active);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#contenu">Aller au contenu principal</a>

      <aside className="sidebar">
        <a className="brand" href="#/cockpit" aria-label="RL Coach, accueil">
          <span className="brand__mark" aria-hidden="true"><Icon name="ball" size={22} /></span>
          <span className="brand__text">
            <span className="brand__name">RL Coach</span>
            <span className="brand__tag">ton coach Rocket League</span>
          </span>
        </a>

        <nav className="nav" aria-label="Navigation principale">
          {NAV.map((item) => {
            const active = activePath === item.path;
            return (
              <a
                key={item.path}
                href={`#${item.path}`}
                className={`nav__item${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={item.icon} size={18} />
                <span className="nav__label">{item.label}</span>
                {item.path === '/cockpit' && liveActive ? <span className="nav__dot" aria-label="match en cours" /> : null}
              </a>
            );
          })}
        </nav>

        <div className="sidebar__foot">
          <div className="sidebar__status">
            <StatusDot tone={rlState === 'connected' || rlState === 'waiting' ? 'ok' : rlState === 'error' ? 'danger' : rlState === 'connecting' ? 'warn' : 'neutral'} pulse={rlState === 'connecting'} />
            <span>API Stats {rlState === 'connected' || rlState === 'waiting' ? 'connectée' : rlState === 'connecting' ? 'en connexion' : rlState === 'error' ? 'en erreur' : 'hors ligne'}</span>
          </div>
          <div className="sidebar__status">
            <StatusDot tone={socketState === 'open' ? 'ok' : 'warn'} />
            <span>{socketState === 'open' ? 'flux temps réel' : 'repli polling (2 s)'}</span>
          </div>
          <p className="sidebar__version">
            v{status?.version || '1.0.0'} · {num(status?.storage?.matchCount, 0)} matchs ·{' '}
            {status?.storage?.lastMatchAt ? relative(status.storage.lastMatchAt) : 'aucun match'}
          </p>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="topbar__title">{pageTitle}</span>
          <div className="topbar__pills">
            <Badge tone={cohort?.isDemo === false ? 'ok' : 'warn'} dot>
              {cohort?.isDemo === false ? 'cohorte pro' : 'repères de démarrage'}
            </Badge>
            {status?.ballchasing?.tokenSet ? <Badge tone="info">ballchasing lié</Badge> : <Badge tone="neutral">sans token</Badge>}
            {statusError ? <Badge tone="danger" dot>serveur injoignable</Badge> : null}
            {liveActive ? <Badge tone="ok" dot>match en cours</Badge> : null}
          </div>
        </header>

        <main id="contenu" className="content" tabIndex={-1}>
          {view}
          <footer className="app-foot">
            <span>RL Coach — données locales, aucune donnée envoyée sans ton token ballchasing.</span>
            <span className="app-foot__links">
              <a href="https://ballchasing.com" target="_blank" rel="noreferrer noopener">ballchasing.com</a>
              <a href="#/reglages">réglages</a>
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
