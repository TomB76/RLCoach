import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * Charge une ressource asynchrone avec états loading / error / data et recharge
 * manuelle. Le loader est lu via ref : il n'a pas besoin d'être stable.
 */
export function useApiResource(loader, deps = []) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [nonce, setNonce] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    Promise.resolve()
      .then(() => loaderRef.current(controller.signal))
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ loading: false, error: null, data });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ loading: false, error: error?.message || 'Erreur inconnue.', data: null });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { ...state, reload };
}

/** Requête ponctuelle déclenchée par une action (suppression, refresh…). */
export function useAsyncAction() {
  const [pending, setPending] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (task) => {
    setPending(true);
    try {
      return await task();
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }, []);

  return { pending, run };
}

/** Navigation par hash : #/cockpit, #/match/:id, … */
function parseHash() {
  const raw = window.location.hash.replace(/^#!?/, '') || '/cockpit';
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  return {
    path: `/${segments.join('/')}`,
    segments,
    query: new URLSearchParams(queryPart || ''),
  };
}

export function useHashRoute() {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) {
      window.location.hash = '#/cockpit';
    }
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((to) => {
    const next = to.startsWith('#') ? to.slice(1) : to;
    if (window.location.hash.replace(/^#/, '') === next) return;
    window.location.hash = next;
  }, []);

  return { ...route, navigate };
}

/** Statut global partagé par plusieurs écrans (rafraîchissement doux). */
export function useStatusPolling(enabled, onStatus, onError, intervalMs = 10000) {
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const tick = () => {
      api
        .status()
        .then((status) => {
          if (alive) onStatus(status);
        })
        .catch((error) => {
          if (alive) onError?.(error);
        });
    };
    const id = window.setInterval(tick, intervalMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled, intervalMs, onStatus, onError]);
}
