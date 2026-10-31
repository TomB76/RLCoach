import { useId } from 'react';
import { clamp, isNumber, num, metric as fmtMetric, delta as fmtDelta, EMPTY } from '../format.js';

/** Anneau de score fait main (SVG). */
export function ScoreGauge({ score, grade, level, size = 'lg', label = 'Score coach' }) {
  const gradientId = `gauge-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const value = isNumber(score) ? clamp(score) : null;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - (value ?? 0) / 100);
  const tone = value == null ? 'neutral' : value >= 70 ? 'good' : value >= 55 ? 'mid' : 'low';
  const stops = tone === 'good' ? ['#22d3ee', '#34d399'] : tone === 'mid' ? ['#38bdf8', '#6366f1'] : ['#ff7a33', '#f97316'];

  return (
    <div className={`gauge gauge--${size} gauge--${tone}`}>
      <svg viewBox="0 0 132 132" className="gauge__svg" role="img" aria-label={`${label} : ${value == null ? 'non disponible' : `${value} sur 100`}${grade ? `, note ${grade}` : ''}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={stops[0]} />
            <stop offset="100%" stopColor={stops[1]} />
          </linearGradient>
        </defs>
        <circle className="gauge__track" cx="66" cy="66" r={radius} />
        <circle
          className="gauge__value"
          cx="66"
          cy="66"
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="gauge__center">
        <span className="gauge__score">{value == null ? EMPTY : num(value, 0)}</span>
        <span className="gauge__scale">/100</span>
        {grade ? <span className="gauge__grade">{grade}</span> : null}
      </div>
      {level ? <span className="gauge__caption">{level}</span> : null}
    </div>
  );
}

/** Barre de percentile : la médiane pro est la graduation à 50. */
export function PercentileBar({ percentile, status = 'neutral' }) {
  const value = isNumber(percentile) ? clamp(percentile) : null;
  const tone = status === 'strength' ? 'good' : status === 'weak' ? 'low' : 'mid';
  return (
    <div
      className={`pctbar pctbar--${tone}`}
      role="img"
      aria-label={value == null ? 'Percentile indisponible' : `Percentile ${Math.round(value)} sur 100`}
      title={value == null ? 'Percentile indisponible' : `Percentile ${Math.round(value)} / 100`}
    >
      <span className="pctbar__track">
        <span className="pctbar__fill" style={{ width: `${value ?? 0}%` }} />
        <span className="pctbar__tick" style={{ left: '50%' }} aria-hidden="true" />
      </span>
      <span className="pctbar__label">{value == null ? EMPTY : `${Math.round(value)}`}</span>
    </div>
  );
}

/** Sparkline de tendance (échelle fixe 0–100 pour rester comparable). */
export function Sparkline({ values = [], height = 96, label = 'Tendance des scores' }) {
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const clean = values.filter((value) => isNumber(value));
  const width = 320;
  const padX = 8;
  const padY = 10;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const points = clean.map((value, index) => {
    const x = clean.length === 1 ? width / 2 : padX + (index * innerW) / (clean.length - 1);
    const y = padY + innerH - (clamp(value) / 100) * innerH;
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });

  const line = points.map(([x, y]) => `${x},${y}`).join(' ');
  const area = points.length
    ? `M${points[0][0]},${padY + innerH} L${line.replace(/ /g, ' L')} L${points[points.length - 1][0]},${padY + innerH} Z`
    : '';
  const last = points[points.length - 1];

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label} : ${clean.length ? clean.map((v) => num(v, 0)).join(', ') : 'aucune donnée'}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line className="spark__grid" x1={padX} x2={width - padX} y1={padY + innerH / 2} y2={padY + innerH / 2} />
      {area ? <path d={area} fill={`url(#${gradientId})`} /> : null}
      {points.length > 1 ? <polyline className="spark__line" points={line} /> : null}
      {last ? (
        <>
          <circle className="spark__dot" cx={last[0]} cy={last[1]} r="4" />
          <circle className="spark__dot-halo" cx={last[0]} cy={last[1]} r="8" />
        </>
      ) : null}
    </svg>
  );
}

/** Radar de profil : 6 familles de métriques comparées à la médiane pro. */
export function Radar({ axes = [], size = 216, label = 'Profil par famille de statistiques' }) {
  const center = size / 2;
  const radius = size / 2 - 14;
  const count = Math.max(axes.length, 3);
  const point = (index, ratio) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    return [center + Math.cos(angle) * radius * ratio, center + Math.sin(angle) * radius * ratio];
  };
  const ring = (ratio) => axes.map((_, index) => point(index, ratio).map((n) => n.toFixed(1)).join(',')).join(' ');
  const values = axes.map((axis, index) => point(index, clamp(axis.value) / 100).map((n) => n.toFixed(1)).join(',')).join(' ');

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="radar"
      role="img"
      aria-label={`${label} : ${axes.map((axis) => `${axis.label} ${Math.round(axis.value)} %`).join(', ')}`}
    >
      {[1, 0.75, 0.5, 0.25].map((ratio) => (
        <polygon key={ratio} className={`radar__ring${ratio === 0.5 ? ' radar__ring--ref' : ''}`} points={ring(ratio)} />
      ))}
      {axes.map((axis, index) => {
        const [x, y] = point(index, 1);
        return <line key={axis.label} className="radar__axis" x1={center} y1={center} x2={x} y2={y} />;
      })}
      <polygon className="radar__shape" points={values} />
      {axes.map((axis, index) => {
        const [x, y] = point(index, clamp(axis.value) / 100);
        return <circle key={axis.label} className="radar__dot" cx={x} cy={y} r="2.6" />;
      })}
    </svg>
  );
}

/** Écart entre la valeur du joueur et la distribution pro, positionné sur p10→p90. */
export function SpreadBar({ reference, value, decimals = 1, unit = '', higherIsBetter = true }) {
  const lo = reference?.p10;
  const hi = reference?.p90;
  if (!isNumber(lo) || !isNumber(hi) || hi <= lo) return null;
  const position = (input) => clamp(((input - lo) / (hi - lo)) * 100, 0, 100);
  const hasValue = isNumber(value);
  return (
    <span className="spread" aria-hidden="true">
      <span className="spread__range" />
      <span className="spread__tick" style={{ left: `${position(reference.p25)}%` }} />
      <span className="spread__tick spread__tick--median" style={{ left: `${position(reference.p50)}%` }} />
      <span className="spread__tick" style={{ left: `${position(reference.p75)}%` }} />
      {hasValue ? (
        <span
          className={`spread__you${higherIsBetter === false ? ' is-inverted' : ''}`}
          style={{ left: `${position(value)}%` }}
          title={`Toi : ${fmtMetric(value, unit, decimals)}`}
        />
      ) : null}
    </span>
  );
}

export function DeltaTag({ value, unit, decimals = 1, higherIsBetter = true }) {
  if (!isNumber(value)) return <span className="delta">{EMPTY}</span>;
  const favorable = higherIsBetter === null ? null : value > 0 === Boolean(higherIsBetter);
  const className = favorable === null ? 'delta delta--flat' : favorable ? 'delta delta--good' : 'delta delta--bad';
  return <span className={className}>{fmtDelta(value, unit, decimals)}</span>;
}
