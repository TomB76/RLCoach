import { useMemo, useState } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { useApiResource } from '../hooks/useApiResource.js';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { Badge, Banner, Button, Card, CardHead, EmptyState, Meter, PageHead, SkeletonBlock } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { SpreadBar } from '../components/charts.jsx';
import { metric as fmtMetric, num, relative } from '../format.js';
import { METRICS, METRIC_GROUPS, METRIC_GROUP_ORDER, playlistLabel } from '../metrics.js';

const SOURCE_LABELS = {
  ballchasing: 'ballchasing.com',
  seed: 'repères de démarrage',
  cache: 'cache local',
};

const SIZES = [20, 40, 80, 120];

export default function ProReferenceView() {
  const { status, playlists, dataVersion, proRefresh, refreshPro } = useAppData();
  const toast = useToast();
  const [playlist, setPlaylist] = useState(null);
  const [size, setSize] = useState(40);
  const [busy, setBusy] = useState(false);

  const scope = playlist || status?.settings?.targetPlaylist || 'ranked-doubles';
  const tokenSet = Boolean(status?.ballchasing?.tokenSet);

  const res = useApiResource(async (signal) => {
    const [reference, overview] = await Promise.all([
      api.proReference(scope, signal),
      api.overview({ limit: 15, playlist: scope }, signal).catch(() => null),
    ]);
    return { reference, overview: overview?.overview || null };
  }, [scope, dataVersion]);

  const cohort = res.data?.reference?.cohort || null;
  const storedRefresh = res.data?.reference?.refresh || null;
  const liveRefresh = proRefresh && (!proRefresh.playlist || proRefresh.playlist === scope) ? proRefresh : null;
  const refresh = liveRefresh || storedRefresh;
  const metrics = cohort?.metrics || {};

  const myValues = useMemo(() => {
    const map = new Map();
    for (const row of res.data?.overview?.metrics || []) map.set(row.key, row.value);
    return map;
  }, [res.data]);

  const rows = useMemo(() => METRICS.filter((metric) => metrics[metric.key]), [metrics]);
  const groups = useMemo(
    () => METRIC_GROUP_ORDER.map((group) => [group, rows.filter((row) => row.group === group)]).filter(([, list]) => list.length),
    [rows],
  );

  async function handleRefresh() {
    setBusy(true);
    try {
      await refreshPro({ playlist: scope, size });
      toast.push({ kind: 'info', title: 'Actualisation lancée', message: `${size} replays vont être analysés via ballchasing. La progression s’affiche ici.` });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Actualisation impossible', message: error.message });
    } finally {
      setBusy(false);
    }
  }

  const running = Boolean(refresh?.running);
  const progressPercent = refresh?.total ? Math.min(100, ((refresh.done || 0) / refresh.total) * 100) : 0;

  return (
    <div className="page">
      <PageHead
        eyebrow="Cohorte"
        title="Référence pro"
        subtitle="Distributions de statistiques des joueurs pros utilisées pour te noter, et leur fraîcheur."
        actions={
          <div className="head-status">
            <div className="field field--inline">
              <label className="field__label" htmlFor="pro-playlist">Mode</label>
              <select id="pro-playlist" className="input input--sm" value={scope} onChange={(event) => setPlaylist(event.target.value)}>
                {Object.entries(playlists || {}).map(([key, entry]) => (
                  <option key={key} value={key}>{entry.label}</option>
                ))}
              </select>
            </div>
            <Button size="sm" icon="refresh" onClick={res.reload} loading={res.loading}>Recharger</Button>
          </div>
        }
      />

      {res.error ? (
        <Banner tone="danger" title="Impossible de charger la référence pro" action={<Button size="sm" icon="refresh" onClick={res.reload}>Réessayer</Button>}>
          {res.error}
        </Banner>
      ) : null}

      {cohort?.isDemo ? (
        <Banner
          tone="warn"
          title="Repères de démarrage, pas une vraie cohorte"
          action={tokenSet ? null : <a className="btn btn--ghost btn--sm" href="#/reglages">Ajouter un token</a>}
        >
          {cohort.note || 'Les valeurs pro affichées sont des ordres de grandeur embarqués. Ajoute un token ballchasing puis lance une actualisation pour obtenir les distributions réelles (p10 → p90).'}
        </Banner>
      ) : null}

      <div className="grid grid--2">
        <Card>
          <CardHead
            title="Cohorte utilisée"
            hint={playlistLabel(playlists, scope)}
            actions={<Badge tone={cohort?.isDemo ? 'warn' : 'ok'} dot>{SOURCE_LABELS[cohort?.source] || cohort?.source || 'inconnue'}</Badge>}
          />
          {res.loading && !cohort ? (
            <SkeletonBlock rows={4} />
          ) : cohort ? (
            <dl className="meta-list">
              <div><dt>Replays analysés</dt><dd>{num(cohort.replaysAnalyzed, 0)}</dd></div>
              <div><dt>Joueurs pros</dt><dd>{num(cohort.playersAnalyzed, 0)}</dd></div>
              <div><dt>Échantillons</dt><dd>{num(cohort.sampleSize, 0)}</dd></div>
              <div><dt>Métriques suivies</dt><dd>{num(rows.length, 0)} / {num(METRICS.length, 0)}</dd></div>
              <div><dt>Mise à jour</dt><dd>{cohort.updatedAt ? relative(cohort.updatedAt) : 'jamais'}</dd></div>
              <div><dt>État</dt><dd>{cohort.stale || cohort.isDemo ? 'à actualiser' : 'à jour'}</dd></div>
            </dl>
          ) : (
            <p className="muted">Aucune cohorte disponible.</p>
          )}
          {cohort?.note ? <p className="hint-text">{cohort.note}</p> : null}
        </Card>

        <Card>
          <CardHead
            title="Actualiser depuis ballchasing"
            hint="Analyse en tâche de fond, progression en temps réel par WebSocket."
            actions={running ? <Badge tone="info" dot>en cours</Badge> : null}
          />
          {!tokenSet ? (
            <Banner tone="info" title="Token ballchasing requis">
              L’actualisation nécessite un token API (gratuit). Ajoute-le dans les <a href="#/reglages">réglages</a>, puis reviens ici.
            </Banner>
          ) : null}
          <div className="form-row form-row--end">
            <div className="field">
              <label className="field__label" htmlFor="pro-size">Replays par actualisation</label>
              <select
                id="pro-size"
                className="input"
                value={size}
                disabled={running}
                onChange={(event) => setSize(Number(event.target.value))}
              >
                {SIZES.map((value) => <option key={value} value={value}>{value} replays</option>)}
              </select>
            </div>
            <Button variant="primary" icon="refresh" loading={busy} disabled={!tokenSet || running} onClick={handleRefresh}>
              {running ? 'Actualisation en cours…' : 'Actualiser la cohorte'}
            </Button>
          </div>
          {refresh ? (
            <div className="refresh">
              <div className="refresh__head">
                <span>{running ? 'Analyse des replays…' : refresh.error ? 'Dernière actualisation en échec' : 'Dernière actualisation terminée'}</span>
                <span className="muted">
                  {num(refresh.done || 0, 0)} / {num(refresh.total || 0, 0)}
                </span>
              </div>
              <Meter value={progressPercent} tone={refresh.error ? 'danger' : running ? 'brand' : 'good'} label="Progression de l’actualisation" />
              {refresh.error ? <p className="field__error">{refresh.error}</p> : null}
              {refresh.startedAt ? (
                <p className="hint-text">
                  Démarrée {relative(refresh.startedAt)}
                  {refresh.finishedAt ? ` · terminée ${relative(refresh.finishedAt)}` : ''}
                </p>
              ) : (
                <p className="hint-text">Aucune actualisation lancée depuis le démarrage du serveur.</p>
              )}
            </div>
          ) : null}
        </Card>
      </div>

      <Card>
        <CardHead
          title="Distributions par métrique"
          hint="p10 → p90 des performances pros. Le trait plein est ta moyenne, le trait fort la médiane pro."
          actions={<Badge tone="neutral">{num(rows.length, 0)} métriques</Badge>}
        />
        {res.loading && !rows.length ? (
          <SkeletonBlock rows={6} />
        ) : !rows.length ? (
          <EmptyState icon="pro" title="Aucune distribution disponible" description="Lance une actualisation ballchasing ou vérifie que le serveur répond." />
        ) : (
          <div className="pro-groups">
            {groups.map(([group, list]) => (
              <section key={group} className="pro-group">
                <h3 className="cmp-group__title" style={{ '--cat-color': METRIC_GROUPS[group]?.color }}>
                  <span className="cmp-group__dot" aria-hidden="true" />
                  {METRIC_GROUPS[group]?.label || group}
                </h3>
                <div className="table-wrap">
                  <table className="data-table data-table--pro">
                    <thead>
                      <tr>
                        <th scope="col">Métrique</th>
                        <th scope="col" className="is-num">p10</th>
                        <th scope="col" className="is-num">p25</th>
                        <th scope="col" className="is-num is-median">p50</th>
                        <th scope="col" className="is-num">p75</th>
                        <th scope="col" className="is-num">p90</th>
                        <th scope="col">Distribution</th>
                        <th scope="col" className="is-num">n</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((metric) => {
                        const ref = metrics[metric.key];
                        const mine = myValues.get(metric.key);
                        return (
                          <tr key={metric.key}>
                            <th scope="row" className="cell-metric">
                              {metric.label}
                              {metric.higherIsBetter === null ? <span className="cell-metric__count">neutre</span> : null}
                            </th>
                            {['p10', 'p25', 'p50', 'p75', 'p90'].map((key) => (
                              <td key={key} className={`is-num${key === 'p50' ? ' is-median' : ''}`}>
                                {fmtMetric(ref?.[key], metric.unit, metric.decimals)}
                              </td>
                            ))}
                            <td className="cell-spread">
                              <SpreadBar reference={ref} value={mine} unit={metric.unit} decimals={metric.decimals} higherIsBetter={metric.higherIsBetter} />
                            </td>
                            <td className="is-num muted">{num(ref?.count, 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="D’où viennent les valeurs ?" />
        <div className="note-grid">
          <div>
            <h3 className="note-grid__title"><Icon name="pro" size={15} /> Cohorte ballchasing</h3>
            <p className="muted">Les distributions p10→p90 sont calculées sur les replays récupérés via l’API ballchasing pour ce mode, par joueur et par match.</p>
          </div>
          <div>
            <h3 className="note-grid__title"><Icon name="info" size={15} /> Repères de démarrage</h3>
            <p className="muted">Sans token, l’app utilise des ordres de grandeur pros embarqués : les scores restent utiles mais approximatifs. L’interface les signale partout où c’est le cas.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
