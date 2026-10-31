import { useMemo, useState } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { useApiResource } from '../hooks/useApiResource.js';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { Badge, Banner, Button, Card, CardHead, ConfirmButton, EmptyState, PageHead, Skeleton } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { clock, dateTime, num, EMPTY } from '../format.js';
import { playlistLabel } from '../metrics.js';

const RESULT = {
  win: { label: 'Victoire', tone: 'ok' },
  loss: { label: 'Défaite', tone: 'danger' },
  unknown: { label: 'Résultat inconnu', tone: 'neutral' },
};

export default function HistoryView({ navigate }) {
  const { dataVersion, deleteMatch, clearHistory, playlists, status } = useAppData();
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [clearing, setClearing] = useState(false);

  const res = useApiResource((signal) => api.matches({ limit: 200 }, signal), [dataVersion]);
  const matches = res.data?.matches || [];

  const counts = useMemo(() => {
    const map = new Map();
    for (const match of matches) map.set(match.playlist, (map.get(match.playlist) || 0) + 1);
    return map;
  }, [matches]);

  const visible = filter === 'all' ? matches : matches.filter((match) => match.playlist === filter);

  async function handleDelete(match) {
    setBusyId(match.id);
    try {
      await deleteMatch(match.id);
      toast.push({ kind: 'success', title: 'Match supprimé', message: `${dateTime(match.date)} · ${playlistLabel(playlists, match.playlist)}` });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Suppression impossible', message: error.message });
    } finally {
      setBusyId(null);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      await clearHistory();
      toast.push({ kind: 'success', title: 'Historique vidé', message: 'Tous les matchs analysés ont été supprimés.' });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Suppression impossible', message: error.message });
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Journal"
        title="Historique"
        subtitle="Chaque match analysé, son score coach et l’action prioritaire qui en ressort."
        actions={
          <ConfirmButton
            label="Vider l’historique"
            confirmLabel={`Supprimer ${num(matches.length, 0)} match(s) ?`}
            onConfirm={handleClear}
            busy={clearing}
            disabled={!matches.length}
            size="sm"
          />
        }
      />

      <Card>
        <CardHead
          title={`${num(visible.length, 0)} match${visible.length > 1 ? 's' : ''}`}
          hint="Clique sur une ligne pour ouvrir le détail et les recommandations du coach."
          actions={
            <div className="chip-row" role="group" aria-label="Filtrer par mode de jeu">
              <button type="button" className={`chip${filter === 'all' ? ' is-active' : ''}`} onClick={() => setFilter('all')} aria-pressed={filter === 'all'}>
                Tous <span className="chip__count">{num(matches.length, 0)}</span>
              </button>
              {[...counts.entries()].map(([key, count]) => (
                <button
                  key={key}
                  type="button"
                  className={`chip${filter === key ? ' is-active' : ''}`}
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                >
                  {playlistLabel(playlists, key, true)} <span className="chip__count">{num(count, 0)}</span>
                </button>
              ))}
            </div>
          }
        />

        {res.error ? (
          <Banner tone="danger" title="Impossible de charger l’historique" action={<Button size="sm" icon="refresh" onClick={res.reload}>Réessayer</Button>}>
            {res.error}
          </Banner>
        ) : null}

        {res.loading && !res.data ? (
          <div className="stack">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} height={44} radius={10} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="history"
            title={matches.length ? 'Aucun match pour ce mode' : 'Aucun match analysé pour le moment'}
            description={
              matches.length
                ? 'Change de filtre ou joue une partie dans ce mode.'
                : 'Lance une partie de Rocket League (API Stats connectée) ou une démo simulée depuis le cockpit.'
            }
            action={
              <Button variant="primary" size="sm" icon="cockpit" onClick={() => navigate('/cockpit')}>
                Ouvrir le cockpit
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table data-table--history">
              <caption className="sr-only">Matchs analysés</caption>
              <thead>
                <tr>
                  <th scope="col">Match</th>
                  <th scope="col">Mode</th>
                  <th scope="col" className="is-num">Score</th>
                  <th scope="col">Résultat</th>
                  <th scope="col" className="is-num">Durée</th>
                  <th scope="col">Score coach</th>
                  <th scope="col">Priorité n°1</th>
                  <th scope="col" className="is-actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((match) => {
                  const result = RESULT[match.result] || RESULT.unknown;
                  const mine = match.localTeam ?? 0;
                  return (
                    <tr key={match.id} className="is-clickable" onClick={() => navigate(`/match/${match.id}`)}>
                      <th scope="row" className="cell-match">
                        <a className="cell-match__link" href={`#/match/${match.id}`}>
                          {dateTime(match.date)}
                          <span className="cell-match__arena">{match.arena || 'Arène inconnue'}</span>
                        </a>
                      </th>
                      <td>
                        <Badge tone="ghost">{playlistLabel(playlists, match.playlist, true)}</Badge>
                      </td>
                      <td className="is-num scoreboard-cell">
                        <span className={mine === 0 ? 'is-strong' : undefined}>{num(match.teamScores?.[0] ?? 0, 0)}</span>
                        <span className="scoreboard-cell__sep">–</span>
                        <span className={mine === 1 ? 'is-strong' : undefined}>{num(match.teamScores?.[1] ?? 0, 0)}</span>
                      </td>
                      <td>
                        <Badge tone={result.tone} dot>{result.label}</Badge>
                      </td>
                      <td className="is-num">{clock(match.durationSeconds)}</td>
                      <td>
                        {num(match.rlCoachScore, 0) === EMPTY ? (
                          <span className="muted">{EMPTY}</span>
                        ) : (
                          <span className="score-cell">
                            {num(match.rlCoachScore, 0)}
                            <span className="score-cell__grade">{match.grade || EMPTY}</span>
                          </span>
                        )}
                      </td>
                      <td className="cell-reco">{match.topRecommendation || <span className="muted">Aucune faiblesse majeure</span>}</td>
                      <td className="is-actions">
                        <span className="row-actions">
                          <button
                            type="button"
                            className="btn btn--danger btn--icon"
                            aria-label={`Supprimer le match du ${dateTime(match.date)}`}
                            title="Supprimer ce match"
                            disabled={busyId === match.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDelete(match);
                            }}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                          <span className="btn btn--ghost btn--icon" aria-hidden="true">
                            <Icon name="chevronRight" size={16} />
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {status?.storage?.lastMatchAt ? (
          <p className="hint-text">
            Dernier match enregistré : {dateTime(status.storage.lastMatchAt)} · données stockées dans {status.storage.dataDir}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
