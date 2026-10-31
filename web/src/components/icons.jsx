/** Icônes inline (aucune dépendance, aucune requête réseau). */

const ICONS = {
  cockpit: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 12l4.2-4.2" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.9-6.4" />
      <path d="M3.5 4.5v4.6h4.6" />
      <path d="M12 8v4.3l3 1.8" />
    </>
  ),
  coach: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  pro: (
    <>
      <path d="M8 4h8v3.6a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5.2H5.2v1.6A3.2 3.2 0 0 0 8.4 10M16 5.2h2.8v1.6A3.2 3.2 0 0 1 15.6 10" />
      <path d="M12 11.6V15" />
      <path d="M8.6 20h6.8l-.7-2.7a1.7 1.7 0 0 0-1.6-1.3h-2.2a1.7 1.7 0 0 0-1.6 1.3L8.6 20Z" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.5h8M16.5 7.5H20M4 16.5h3.5M13 16.5h7" />
      <circle cx="14" cy="7.5" r="2.1" />
      <circle cx="10" cy="16.5" r="2.1" />
    </>
  ),
  play: <path d="M8.4 5.6v12.8L19 12 8.4 5.6Z" fill="currentColor" stroke="none" />,
  stop: <rect x="6.8" y="6.8" width="10.4" height="10.4" rx="2.2" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.7-6" />
      <path d="M20.4 4.4v5.1h-5.1" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.8h5V7" />
      <path d="M6.5 7l.9 12.2h9.2L17.5 7" />
      <path d="M10.5 10.5v5.5M13.5 10.5v5.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16.5V4.4" />
      <path d="M12 4.4L7.6 8.8M12 4.4l4.4 4.4" />
      <path d="M4.5 15.6v3.9h15v-3.9" />
    </>
  ),
  external: (
    <>
      <path d="M14.4 4.2h5.4v5.4" />
      <path d="M19.8 4.2L11 13" />
      <path d="M8.4 5.2H5.2v13.6h13.6v-3.2" />
    </>
  ),
  check: <path d="M5 12.4l4.4 4.3L19 5.8" />,
  alert: (
    <>
      <path d="M12 4.4l8.4 15.2H3.6L12 4.4Z" />
      <path d="M12 10v4.2M12 17v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11v5.6M12 7.6v.1" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11m0-11l-11 11" />,
  chevronRight: <path d="M9.5 5.5l7 6.5-7 6.5" />,
  chevronLeft: <path d="M14.5 5.5l-7 6.5 7 6.5" />,
  arrowUp: <path d="M12 19V5m0 0l-6 6m6-6l6 6" />,
  arrowDown: <path d="M12 5v14m0 0l6-6m-6 6l-6-6" />,
  flat: <path d="M5 12h14" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  wifi: (
    <>
      <path d="M3.8 9.2a12.5 12.5 0 0 1 16.4 0" />
      <path d="M6.9 12.7a8 8 0 0 1 10.2 0" />
      <path d="M10 16.1a3.6 3.6 0 0 1 4 0" />
      <circle cx="12" cy="19.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  live: <path d="M3.5 12h3.8l2.4-6 3.9 12 2.4-6h4.5" />,
  ball: (
    <>
      <path d="M12 2.6l8.1 4.7v9.4L12 21.4 3.9 16.7V7.3L12 2.6Z" />
      <circle cx="12" cy="12" r="3.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3.2 2" />
    </>
  ),
  users: (
    <>
      <circle cx="9.4" cy="9" r="3.2" />
      <path d="M3.8 19.4c0-3 2.5-5.2 5.6-5.2s5.6 2.2 5.6 5.2" />
      <path d="M16.2 6.2a3 3 0 0 1 0 5.8M17.4 14.6c2.2.5 3.8 2.3 3.8 4.8" />
    </>
  ),
  file: (
    <>
      <path d="M13.6 3.4H6.6v17.2h10.8V7.2l-3.8-3.8Z" />
      <path d="M13.4 3.6v3.9h3.9" />
    </>
  ),
};

export function Icon({ name, size = 18, className = '', title }) {
  const content = ICONS[name];
  if (!content) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`icon ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {content}
    </svg>
  );
}
