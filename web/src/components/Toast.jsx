import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);
let nextId = 1;

const KIND_ICON = {
  success: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10.5l3.6 3.6L16 5.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.5 6.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 9v6M10 5.4v.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast) => {
      const id = nextId++;
      const entry = {
        id,
        kind: toast.kind || 'info',
        title: toast.title || '',
        message: toast.message || '',
        action: toast.action || null,
      };
      setToasts((prev) => [...prev.slice(-3), entry]);
      const timer = window.setTimeout(() => dismiss(id), toast.duration ?? 6500);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const current = timers.current;
    return () => {
      for (const timer of current.values()) window.clearTimeout(timer);
      current.clear();
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast__icon" aria-hidden="true">
              {KIND_ICON[toast.kind] || KIND_ICON.info}
            </span>
            <div className="toast__body">
              {toast.title ? <strong className="toast__title">{toast.title}</strong> : null}
              {toast.message ? <span className="toast__message">{toast.message}</span> : null}
            </div>
            <button
              type="button"
              className="toast__close"
              onClick={() => dismiss(toast.id)}
              aria-label="Fermer la notification"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6 6l8 8m0-8l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast doit être utilisé dans <ToastProvider>.');
  return context;
}
