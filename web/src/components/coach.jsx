import { METRIC_GROUPS } from '../metrics.js';
import { metric as fmtMetric, num, delta as fmtDelta, EMPTY, isNumber } from '../format.js';
import { PercentileBar, DeltaTag } from './charts.jsx';
import { Badge } from './ui.jsx';
import { Icon } from './icons.jsx';

const CATEGORY_LABELS = {
  core: 'Production',
  boost: 'Boost',
  movement: 'Mouvement',
  positioning: 'Positionnement',
  demo: 'Physique',
  custom: 'Touches',
};

export function CategoryBadge({ category }) {
  const color = METRIC_GROUPS[category]?.color;
  return (
    <span className="cat" style={color ? { '--cat-color': color } : undefined}>
      <span className="cat__dot" aria-hidden="true" />
      {CATEGORY_LABELS[category] || category || 'Général'}
    </span>
  );
}

function Drills({ drills = [] }) {
  if (!drills.length) return null;
  return (
    <ul className="drills">
      {drills.map((drill) => (
        <li key={drill.name} className="drill">
          <p className="drill__name">{drill.name}</p>
          <p className="drill__desc">{drill.description}</p>
          {drill.objective ? <p className="drill__objective">Objectif : {drill.objective}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** Carte de recommandation du coach (match ou vue d'ensemble). */
export function RecommendationCard({ recommendation, index = 0, expanded = false, meta }) {
  if (!recommendation) return null;
  const target = recommendation.target || null;
  const priority = isNumber(recommendation.priority) ? recommendation.priority : null;

  return (
    <article className="reco" style={{ '--i': index }}>
      <header className="reco__head">
        <span className="reco__rank" aria-hidden="true">
          {recommendation.rank ?? index + 1}
        </span>
        <div className="reco__titles">
          <CategoryBadge category={recommendation.category} />
          <h3 className="reco__title">{recommendation.title}</h3>
        </div>
        {priority != null ? (
          <div className="reco__priority" title={`Priorité ${priority} sur 100`}>
            <span className="reco__priority-bar">
              <span style={{ width: `${priority}%` }} />
            </span>
            <span className="reco__priority-label">priorité {priority}</span>
          </div>
        ) : null}
      </header>

      {meta ? <p className="reco__meta">{meta}</p> : null}
      {recommendation.diagnosis ? <p className="reco__diagnosis">{recommendation.diagnosis}</p> : null}

      {target ? (
        <dl className="reco__target">
          <div>
            <dt>Aujourd’hui</dt>
            <dd>{fmtMetric(target.current, target.unit, 2)}</dd>
          </div>
          <div>
            <dt>Objectif</dt>
            <dd className="is-goal">{fmtMetric(target.goal, target.unit, 2)}</dd>
          </div>
          <div>
            <dt>Médiane pro</dt>
            <dd>{fmtMetric(target.proMedian, target.unit, 2)}</dd>
          </div>
        </dl>
      ) : null}

      {recommendation.cue ? (
        <p className="reco__cue">
          <Icon name="live" size={15} />
          <span>{recommendation.cue}</span>
        </p>
      ) : null}

      {recommendation.why || (recommendation.drills && recommendation.drills.length) ? (
        <details className="reco__details" open={expanded}>
          <summary>
            Pourquoi ça compte
            {recommendation.drills?.length ? ` · ${recommendation.drills.length} exercice${recommendation.drills.length > 1 ? 's' : ''}` : ''}
          </summary>
          {recommendation.why ? <p className="reco__why">{recommendation.why}</p> : null}
          <Drills drills={recommendation.drills} />
        </details>
      ) : null}
    </article>
  );
}

/** Ligne de comparaison métrique par métrique (détail d'un match). */
export function MetricCompareRow({ row }) {
  const { reference } = row;
  const favorable = row.higherIsBetter === null ? null : row.delta > 0 === Boolean(row.higherIsBetter);
  return (
    <div className={`cmp cmp--${row.status || 'neutral'}`}>
      <div className="cmp__head">
        <span className="cmp__label">{row.label}</span>
        <span className="cmp__value">
          {fmtMetric(row.value, row.unit, row.decimals)}
          {row.higherIsBetter === null ? <em className="cmp__neutral">neutre</em> : null}
        </span>
      </div>
      <PercentileBar percentile={row.percentile} status={row.status} />
      <dl className="cmp__meta">
        <div>
          <dt>Médiane pro</dt>
          <dd>{fmtMetric(reference?.p50, row.unit, row.decimals)}</dd>
        </div>
        <div>
          <dt>Cible p25</dt>
          <dd>{fmtMetric(row.target, row.unit, row.decimals)}</dd>
        </div>
        <div>
          <dt>Écart</dt>
          <dd>
            <span
              className={`delta ${
                favorable === null ? 'delta--flat' : favorable ? 'delta--good' : 'delta--bad'
              }`}
            >
              {fmtDelta(row.delta, row.unit, row.decimals)}
            </span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Tableau des métriques moyennes (vue coach). */
export function OverviewMetricsTable({ metrics = [] }) {
  if (!metrics.length) return null;
  return (
    <div className="table-wrap">
      <table className="data-table data-table--metrics">
        <caption className="sr-only">Métriques moyennes comparées à la cohorte pro</caption>
        <thead>
          <tr>
            <th scope="col">Métrique</th>
            <th scope="col" className="is-num">Toi</th>
            <th scope="col">Percentile moyen</th>
            <th scope="col" className="is-num">Médiane pro</th>
            <th scope="col" className="is-num">Cible p25</th>
            <th scope="col" className="is-num">Écart</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((row) => (
            <tr key={row.key} className={`row--${row.status || 'neutral'}`}>
              <th scope="row" className="cell-metric">
                <span className="cell-metric__dot" style={{ background: METRIC_GROUPS[row.group]?.color || 'var(--text-mute)' }} aria-hidden="true" />
                {row.label}
                <span className="cell-metric__count">{num(row.matchCount, 0)} match{row.matchCount > 1 ? 's' : ''}</span>
              </th>
              <td className="is-num">{fmtMetric(row.value, row.unit, row.decimals)}</td>
              <td>
                <PercentileBar percentile={row.avgPerformance} status={row.status} />
              </td>
              <td className="is-num">{fmtMetric(row.reference?.p50, row.unit, row.decimals)}</td>
              <td className="is-num">{fmtMetric(row.target, row.unit, row.decimals)}</td>
              <td className="is-num">
                <DeltaTag
                  value={row.value - (row.reference?.p50 ?? 0)}
                  unit={row.unit}
                  decimals={row.decimals}
                  higherIsBetter={row.higherIsBetter}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tableau des joueurs d'un match (la ligne locale est surlignée). */
export function PlayerStatsTable({ players = [] }) {
  if (!players.length) return null;
  const sorted = [...players].sort((a, b) => {
    if (a.team !== b.team) return a.team - b.team;
    return (b.stats?.core?.score ?? 0) - (a.stats?.core?.score ?? 0);
  });

  return (
    <div className="table-wrap">
      <table className="data-table data-table--players">
        <caption className="sr-only">Statistiques de tous les joueurs du match</caption>
        <thead>
          <tr>
            <th scope="col">Joueur</th>
            <th scope="col" className="is-num">Buts</th>
            <th scope="col" className="is-num">Passes</th>
            <th scope="col" className="is-num">Arrêts</th>
            <th scope="col" className="is-num">Tirs</th>
            <th scope="col" className="is-num">Touches</th>
            <th scope="col" className="is-num">Boost/min</th>
            <th scope="col" className="is-num">Superson.</th>
            <th scope="col" className="is-num">Score</th>
            <th scope="col" className="is-num">Note</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((player) => {
            const stats = player.stats || {};
            return (
              <tr key={player.id || player.name} className={player.isLocal ? 'is-local' : undefined}>
                <th scope="row" className="cell-player">
                  <span className={`team-dot team-dot--${player.team}`} aria-hidden="true" />
                  <span className="cell-player__name">{player.name}</span>
                  {player.isLocal ? <Badge tone="accent">toi</Badge> : null}
                  {stats.core?.mvp ? <Badge tone="warn">MVP</Badge> : null}
                </th>
                <td className="is-num">{num(stats.core?.goals, 0)}</td>
                <td className="is-num">{num(stats.core?.assists, 0)}</td>
                <td className="is-num">{num(stats.core?.saves, 0)}</td>
                <td className="is-num">{num(stats.core?.shots, 0)}</td>
                <td className="is-num">{num(stats.custom?.touches, 0)}</td>
                <td className="is-num">{num(stats.boost?.bpm, 0)}</td>
                <td className="is-num">{fmtMetric(stats.movement?.percentSupersonicSpeed, '%', 1)}</td>
                <td className="is-num">{num(stats.core?.score, 0)}</td>
                <td className="is-num">
                  {isNumber(player.rlCoachScore) ? (
                    <span className="score-cell">
                      {num(player.rlCoachScore, 0)}
                      <span className="score-cell__grade">{player.grade || EMPTY}</span>
                    </span>
                  ) : (
                    EMPTY
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StrengthList({ items = [], emptyLabel }) {
  if (!items.length) return <p className="muted">{emptyLabel}</p>;
  return (
    <ul className="strength-list">
      {items.map((item) => (
        <li key={item.key}>
          <span className="strength-list__label">{item.label}</span>
          <span className="strength-list__value">
            {fmtMetric(item.value, item.unit, 2)}
            <span className="strength-list__pct">p{Math.round(item.percentile ?? 0)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
