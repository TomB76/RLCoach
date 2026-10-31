import { useMemo, useState } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { useApiResource } from '../hooks/useApiResource.js';
import { api } from '../api.js';
import { Badge, Banner, Button, Card, CardHead, EmptyState, Meter, PageHead, SkeletonBlock } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { Radar, ScoreGauge, Sparkline } from '../components/charts.jsx';
import { OverviewMetricsTable, RecommendationCard } from '../components/coach.jsx';
import { durationLabel, metric as fmtMetric, num, relative } from '../format.js';
import { METRIC_GROUPS, METRIC_GROUP_ORDER, playlistLabel } from '../metrics.js';

const DIRECTION = { up: { icon: 'arrowUp', tone: 'ok', label: 'en progression' }, down: { icon: 'arrowDown', tone: 'danger', label: 'en baisse' }, flat: { icon: 'flat', tone: 'neutral', label: 'stable' } };

export default function CoachView() {
  const { status, playlists, dataVersion } = useAppData();
  const [playlist, setPlaylist] = useState(null);
  const [groupFilter, setGroupFilter] = useState('all');
  const [hideNeutral, setHideNeutral] = useState(false);

  const scope = playlist || status?.settings?.targetPlaylist || 'ranked-doubles';
  const res = useApiResource((signal) => api.overview({ limit: 15, playlist: scope }, signal), [scope, dataVersion]);
  const overview = res.data?.overview || null;
  const loading = res.loading && !overview;

  const axes = useMemo(() => {
    const metrics = overview?.metrics || [];
    return METRIC_GROUP_ORDER.map((group) => {
      const rows = metrics.filter((row) => row.group === group && row.higherIsBetter !== null);
      if (!rows.length) return null;
      const value = rows.reduce((acc, row) => acc + (row.avgPerformance ?? 0), 0) / rows.length;
      return { group, label: METRIC_GROUPS[group]?.label || group, value, color: METRIC_GROUPS[group]?.color };
    }).filter(Boolean);
  }, [overview]);

  const filteredMetrics = useMemo(() => {
    let rows = overview?.metrics || [];
    if (groupFilter !== 'all') rows = rows.filter((row) => row.group === groupFilter);
    if (hideNeutral) rows = rows.filter((row) => row.higherIsBetter !== null);
    return rows;
  }, [overview, groupFilter, hideNeutral]);

  const trend = overview?.trend || null;
  const direction = DIRECTION[trend?.direction] || DIRECTION.flat;

  return (
    <div className="page">
      <PageHead
        eyebrow="Coaching"
        title="Vue d’ensemble"
        subtitle="Tes 15 derniers matchs comparés à la cohorte pro : score global, plan d’entraînement et écarts à combler."
        actions={
          <div className="head-status">
            <div className="field field--inline">
              <label className="field__label" htmlFor="coach-playlist">Mode</label>
              <select id="coach-playlist" className="input input--sm" value={scope} onChange={(event) => setPlaylist(event.target.value)}>
                {Object.entries(playlists || {}).map(([key, entry]) => (
                  <option key={key} value={key}>{entry.label}</option>
                ))}
              </select>
            </div>
            <Button size="sm" icon="refresh" onClick={res.reload} loading={res.loading}>Actualiser</Button>
          </div>
        }
      />

      {res.error ? (
        <Banner tone="danger" title="Impossible de charger la vue d’ensemble" action={<Button size="sm" icon="refresh" onClick={res.reload}>Réessayer</Button>}>
          {res.error}
        </Banner>
      ) : null}

      {overview?.cohort?.isDemo ? (
        <Banner tone="warn" title="Comparaison sur des repères de démarrage" action={<a className="btn btn--ghost btn--sm" href="#/pro">Référence pro</a>}>
          {overview.cohort.note || 'Aucune cohorte ballchasing chargée : les valeurs pro sont des ordres de grandeur embarqués.'}
        </Banner>
      ) : null}

      {loading ? (
        <div className="grid grid--3">
          <Card><SkeletonBlock rows={3} /></Card>
          <Card><SkeletonBlock rows={3} /></Card>
          <Card><SkeletonBlock rows={3} /></Card>
        </div>
      ) : !overview || overview.scope?.matchCount === 0 ? (
        <Card>
          <EmptyState
            icon="coach"
            title="Aucun match analysé dans ce mode"
            description={overview?.headline || 'Joue une partie (API Stats connectée) ou lance une démo simulée pour générer un premier plan de coaching.'}
            action={<a className="btn btn--primary" href="#/cockpit"><Icon name="cockpit" size={16} /><span>Cockpit</span></a>}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid--3">
            <Card>
              <CardHead title="Score global" hint={`${overview.scope.playlistLabel || playlistLabel(playlists, scope)} · ${num(overview.scope.matchCount, 0)} matchs`} />
              <div className="hero-score hero-score--compact">
                <ScoreGauge score={overview.score} grade={overview.grade} level={overview.level} size="md" />
                <div className="hero-score__body">
                  <p className="hero-score__headline">{overview.headline}</p>
                  <dl className="meta-list meta-list--tight">
                    <div><dt>Victoires</dt><dd>{num(overview.scope.wins, 0)}</dd></div>
                    <div><dt>Défaites</dt><dd>{num(overview.scope.losses, 0)}</dd></div>
                    <div><dt>Temps de jeu</dt><dd>{durationLabel((overview.scope.minutes || 0) * 60)}</dd></div>
                    <div><dt>Période</dt><dd>{overview.scope.since ? relative(overview.scope.since) : '—'}</dd></div>
                  </dl>
                </div>
              </div>
            </Card>

            <Card>
              <CardHead
                title="Tendance"
                hint={trend ? `Moyenne récente ${num(trend.recentAverage, 1)} / 100` : 'Pas assez de matchs'}
                actions={<Badge tone={direction.tone} dot>{direction.label}</Badge>}
              />
              <Sparkline values={trend?.scores || []} height={104} />
              <div className="trend-foot">
                <span className="trend-foot__delta">
                  <Icon name={direction.icon} size={15} />
                  {trend?.previousAverage != null ? `${trend.delta > 0 ? '+' : ''}${num(trend.delta, 1)} pts` : 'première série'}
                </span>
                <span className="muted">{trend?.previousAverage != null ? `avant : ${num(trend.previousAverage, 1)} / 100` : 'aucune série précédente'}</span>
              </div>
            </Card>

            <Card>
              <CardHead title="Profil par famille" hint="Performance moyenne 0–100 (repère : médiane pro)" />
              {axes.length ? (
                <>
                  <Radar axes={axes} size={200} />
                  <ul className="legend">
                    {axes.map((axis) => (
                      <li key={axis.group}>
                        <span className="legend__dot" style={{ background: axis.color }} aria-hidden="true" />
                        <span className="legend__label">{axis.label}</span>
                        <span className="legend__value">{Math.round(axis.value)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="muted">Pas assez de métriques comparables.</p>
              )}
            </Card>
          </div>

          {overview.plan ? (
            <Card>
              <CardHead title="Plan d’entraînement" icon="coach" hint="Deux axes de travail + exercices pour la semaine." />
              <div className="plan">
                <div className="plan__focus">
                  <h3 className="plan__title">Focus</h3>
                  <ul className="bullets">
                    {overview.plan.focus.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                  {overview.plan.cue ? (
                    <p className="plan__cue"><Icon name="live" size={15} /><span>{overview.plan.cue}</span></p>
                  ) : null}
                  {overview.plan.milestone ? <p className="plan__milestone">{overview.plan.milestone}</p> : null}
                </div>
                <div className="plan__weekly">
                  {overview.plan.weekly.map((item) => {
                    const current = Number.isFinite(item.current) ? item.current : null;
                    const goal = Number.isFinite(item.goal) ? item.goal : null;
                    const progress = current != null && goal ? (Math.min(current, goal) / Math.max(current, goal)) * 100 : 0;
                    return (
                      <div key={item.id} className="weekly">
                        <div className="weekly__head">
                          <span className="weekly__title">{item.title}</span>
                          <span className="weekly__values">
                            {fmtMetric(item.current, item.unit, item.unit === '%' ? 1 : 2)} <span className="weekly__arrow">→</span>{' '}
                            <strong>{fmtMetric(item.goal, item.unit, item.unit === '%' ? 1 : 2)}</strong>
                          </span>
                        </div>
                        <Meter value={progress} tone={item.goal > item.current ? 'good' : 'brand'} label={`Progression vers ${item.metric}`} />
                        <ul className="weekly__drills">
                          {item.drills?.map((drill) => (
                            <li key={drill.name}><strong>{drill.name}</strong> — {drill.objective}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          ) : null}

          {overview.priorities?.length ? (
            <Card>
              <CardHead
                title="Priorités récurrentes"
                hint="Faiblesses qui reviennent de match en match, pondérées par leur impact."
                actions={<Badge tone="neutral">{num(overview.priorities.length, 0)} axes</Badge>}
              />
              <div className="reco-list">
                {overview.priorities.map((priority, index) => (
                  <RecommendationCard
                    key={`${priority.id}-${index}`}
                    recommendation={priority}
                    index={index}
                    meta={`Présente sur ${num(priority.matchesAffected, 0)} match(s) · ${num(priority.frequency, 0)} % des parties récentes`}
                  />
                ))}
              </div>
            </Card>
          ) : null}

          <div className="grid grid--2">
            <Card>
              <CardHead title="Points forts" hint="Tes meilleures métriques face aux pros" />
              <ul className="strength-list">
                {(overview.strengths || []).map((item) => (
                  <li key={item.key}>
                    <span className="strength-list__label">{item.label}</span>
                    <span className="strength-list__value">{fmtMetric(item.value, item.unit, item.decimals)}<span className="strength-list__pct">p{Math.round(item.avgPerformance ?? 0)}</span></span>
                  </li>
                ))}
                {!overview.strengths?.length ? <li className="muted">Aucune métrique au-dessus du seuil pro.</li> : null}
              </ul>
            </Card>
            <Card>
              <CardHead title="Points à travailler" hint="Tes métriques les plus en retard" />
              <ul className="strength-list">
                {(overview.weaknesses || []).map((item) => (
                  <li key={item.key}>
                    <span className="strength-list__label">{item.label}</span>
                    <span className="strength-list__value">{fmtMetric(item.value, item.unit, item.decimals)}<span className="strength-list__pct">p{Math.round(item.avgPerformance ?? 0)}</span></span>
                  </li>
                ))}
                {!overview.weaknesses?.length ? <li className="muted">Aucune faiblesse marquée.</li> : null}
              </ul>
            </Card>
          </div>

          <Card>
            <CardHead
              title="Toutes les métriques"
              hint="Moyenne sur la période comparée à la médiane pro et à la cible p25."
              actions={
                <div className="chip-row">
                  <button type="button" className={`chip${groupFilter === 'all' ? ' is-active' : ''}`} onClick={() => setGroupFilter('all')}>Tout</button>
                  {METRIC_GROUP_ORDER.map((group) => (
                    <button key={group} type="button" className={`chip${groupFilter === group ? ' is-active' : ''}`} onClick={() => setGroupFilter(group)}>
                      {METRIC_GROUPS[group]?.label || group}
                    </button>
                  ))}
                  <label className="chip chip--toggle">
                    <input type="checkbox" checked={hideNeutral} onChange={(event) => setHideNeutral(event.target.checked)} />
                    Masquer les neutres
                  </label>
                </div>
              }
            />
            <OverviewMetricsTable metrics={filteredMetrics} />
          </Card>
        </>
      )}
    </div>
  );
}
