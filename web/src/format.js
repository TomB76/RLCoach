/** Formatage français : aucun NaN, aucun undefined ne doit atteindre l'écran. */

export const EMPTY = '—';

const numberFormats = new Map();
function numberFormat(decimals) {
  const key = Math.max(0, Math.min(4, Math.round(decimals)));
  if (!numberFormats.has(key)) {
    numberFormats.set(
      key,
      new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: key,
        maximumFractionDigits: key,
      }),
    );
  }
  return numberFormats.get(key);
}

export function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clamp(value, min = 0, max = 100) {
  if (!isNumber(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function num(value, decimals = 0) {
  if (!isNumber(value)) return EMPTY;
  return numberFormat(decimals).format(value);
}

/** Formate une valeur de métrique avec son unité ballchasing. */
export function metric(value, unit = '', decimals = 0) {
  if (!isNumber(value)) return EMPTY;
  const rounded = num(value, decimals);
  if (unit === '%') return `${rounded} %`;
  if (unit === '/min') return `${rounded}/min`;
  if (unit === 'uu') return `${rounded} uu`;
  if (unit === 'uu/s') return `${rounded} uu/s`;
  return rounded;
}

/** Écart signé, ex. « +12,4 % » / « −0,3/min ». */
export function delta(value, unit = '', decimals = 0) {
  if (!isNumber(value)) return EMPTY;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  return `${sign}${metric(Math.abs(value), unit, decimals)}`;
}

/** Durée de match au format mm:ss (ou s si < 60 s). */
export function clock(seconds) {
  if (!isNumber(seconds) || seconds < 0) return EMPTY;
  const total = Math.round(seconds);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  if (mm >= 60) {
    const hh = Math.floor(mm / 60);
    return `${hh}:${String(mm % 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

/** Durée lisible : « 6 min 12 s ». */
export function durationLabel(seconds) {
  if (!isNumber(seconds)) return EMPTY;
  const total = Math.round(seconds);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  if (mm <= 0) return `${ss} s`;
  if (ss === 0) return `${mm} min`;
  return `${mm} min ${ss} s`;
}

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateFormatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function toDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateTime(iso) {
  const date = toDate(iso);
  return date ? dateTimeFormatter.format(date) : EMPTY;
}

export function dateOnly(iso) {
  const date = toDate(iso);
  return date ? dateFormatter.format(date) : EMPTY;
}

export function timeOnly(iso) {
  const date = toDate(iso);
  return date ? timeFormatter.format(date) : EMPTY;
}

/** « il y a 3 min », « il y a 2 h », « le 12/03 ». */
export function relative(iso) {
  const date = toDate(iso);
  if (!date) return EMPTY;
  const diff = Date.now() - date.getTime();
  if (diff < 0) return timeOnly(iso);
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `il y a ${days} j`;
  return `le ${dateOnly(iso)}`;
}

export function initials(name) {
  if (!name) return '?';
  return name
    .split(/[\s|\-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

export const STATUS_LABELS = {
  strength: 'Point fort',
  weak: 'À travailler',
  neutral: 'Neutre',
};
