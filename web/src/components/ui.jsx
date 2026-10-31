import { useEffect, useState } from 'react';
import { Icon } from './icons.jsx';
import { clamp, num } from '../format.js';

export function Card({ className = '', children, tone, ...rest }) {
  return (
    <section className={`card${tone ? ` card--${tone}` : ''} ${className}`.trim()} {...rest}>
      {children}
    </section>
  );
}

export function CardHead({ title, hint, actions, icon }) {
  return (
    <header className="card__head">
      <div className="card__headtext">
        <h2 className="card__title">
          {icon ? <Icon name={icon} size={16} className="card__icon" /> : null}
          {title}
        </h2>
        {hint ? <p className="card__hint">{hint}</p> : null}
      </div>
      {actions ? <div className="card__actions">{actions}</div> : null}
    </header>
  );
}

export function Badge({ tone = 'neutral', children, className = '', dot = false, title }) {
  return (
    <span className={`badge badge--${tone} ${className}`.trim()} title={title}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'neutral', pulse = false, label }) {
  return (
    <span className={`statusdot statusdot--${tone}${pulse ? ' is-pulse' : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      <span className="statusdot__core" />
    </span>
  );
}

export function Banner({ tone = 'info', title, children, action }) {
  const iconName = tone === 'danger' || tone === 'warn' ? 'alert' : tone === 'ok' ? 'check' : 'info';
  return (
    <div className={`banner banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={iconName} size={18} className="banner__icon" />
      <div className="banner__body">
        {title ? <strong className="banner__title">{title}</strong> : null}
        {children ? <div className="banner__text">{children}</div> : null}
      </div>
      {action ? <div className="banner__action">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ height = 12, width = '100%', className = '', radius = 6 }) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ height, width, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonBlock({ rows = 4 }) {
  return (
    <div className="skeleton-block" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={index === 0 ? 18 : 12} width={index === 0 ? '42%' : `${88 - index * 9}%`} />
      ))}
    </div>
  );
}

export function EmptyState({ icon = 'ball', title, description, action, tone }) {
  return (
    <div className={`empty${tone ? ` empty--${tone}` : ''}`}>
      <span className="empty__icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <div className="empty__body">
        <p className="empty__title">{title}</p>
        {description ? <p className="empty__description">{description}</p> : null}
      </div>
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export function Spinner({ size = 16 }) {
  return (
    <svg className="spinner" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.22" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Button({ children, variant = 'ghost', size, icon, loading = false, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`btn btn--${variant}${size ? ` btn--${size}` : ''} ${className}`.trim()}
      {...rest}
    >
      {loading ? <Spinner size={15} /> : icon ? <Icon name={icon} size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}

/**
 * Action destructrice en deux temps : le premier clic arme, le second confirme.
 * Évite la boîte de dialogue bloquante du navigateur.
 */
export function ConfirmButton({
  label,
  confirmLabel = 'Clique pour confirmer',
  onConfirm,
  variant = 'danger',
  size,
  disabled = false,
  busy = false,
  className = '',
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const timer = window.setTimeout(() => setArmed(false), 4500);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={`btn btn--${variant}${size ? ` btn--${size}` : ''}${armed ? ' is-armed' : ''} ${className}`.trim()}
      disabled={disabled || busy}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        await onConfirm();
      }}
      aria-live="polite"
    >
      {busy ? <Spinner size={15} /> : <Icon name="trash" size={16} />}
      <span>{armed ? confirmLabel : label}</span>
    </button>
  );
}

export function Meter({ value, max = 100, tone = 'brand', label, valueText }) {
  const percent = clamp((Number(value) || 0) / (max || 1) * 100);
  return (
    <div
      className={`meter meter--${tone}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(Number(value) || 0)}
      aria-label={label || undefined}
    >
      <span className="meter__fill" style={{ width: `${percent}%` }} />
      {valueText ? <span className="meter__text">{valueText}</span> : null}
    </div>
  );
}

/** Groupe de boutons radio natif : clavier complet (flèches) sans JS supplémentaire. */
export function Segmented({ label, value, onChange, options, name }) {
  const groupName = name || `seg-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <fieldset className="segmented" aria-label={label}>
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={`segmented__option${value === option.value ? ' is-selected' : ''}`}
          title={option.hint}
        >
          <input
            type="radio"
            className="sr-only"
            name={groupName}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span className="segmented__label">{option.label}</span>
          {option.hint ? <span className="segmented__hint">{option.hint}</span> : null}
        </label>
      ))}
    </fieldset>
  );
}

export function StatTile({ label, value, unit, sub, tone }) {
  return (
    <div className={`stat-tile${tone ? ` stat-tile--${tone}` : ''}`}>
      <span className="stat-tile__label">{label}</span>
      <span className="stat-tile__value">
        {value}
        {unit ? <span className="stat-tile__unit">{unit}</span> : null}
      </span>
      {sub ? <span className="stat-tile__sub">{sub}</span> : null}
    </div>
  );
}

export function StepControl({ label, value, min = 1, max = 10, onChange, suffix }) {
  return (
    <div className="step">
      <span className="field__label">{label}</span>
      <div className="step__controls">
        <button
          type="button"
          className="step__btn"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Diminuer ${label.toLowerCase()}`}
        >
          <Icon name="minus" size={15} />
        </button>
        <span className="step__value" aria-live="polite">
          {num(value, 0)}
          {suffix ? <span className="step__suffix">{suffix}</span> : null}
        </span>
        <button
          type="button"
          className="step__btn"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Augmenter ${label.toLowerCase()}`}
        >
          <Icon name="plus" size={15} />
        </button>
      </div>
    </div>
  );
}

export function PageHead({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="page-head">
      <div className="page-head__text">
        {eyebrow ? <span className="page-head__eyebrow">{eyebrow}</span> : null}
        <h1 className="page-head__title">{title}</h1>
        {subtitle ? <p className="page-head__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}

export function Chip({ children, tone, active, onClick, title, as = 'span' }) {
  const Tag = onClick ? 'button' : as;
  const props = onClick ? { type: 'button', onClick, 'aria-pressed': Boolean(active) } : {};
  return (
    <Tag className={`chip${tone ? ` chip--${tone}` : ''}${active ? ' is-active' : ''}`.trim()} title={title} {...props}>
      {children}
    </Tag>
  );
}
