import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, liveSocketUrl } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { num } from '../format.js';

const AppDataContext = createContext(null);

const MAX_TOAST_DEDUPE_MS = 2500;

/**
 * Source de vérité unique de l'app : statut serveur, snapshot live (WebSocket
 * avec repli polling), paramètres, cohorte pro. Les vues consomment ce contexte.
 */
export function AppDataProvider({ children }) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [socketState, setSocketState] = useState('connecting');
  const [proRefresh, setProRefresh] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [playlists, setPlaylists] = useState({});
  const settingsRef = useRef(null);

  const bumpData = useCallback(() => setDataVersion((value) => value + 1), []);
  const mergeRl = useCallback((rl) => {
    if (!rl) return;
    setStatus((prev) => (prev ? { ...prev, rl } : prev));
  }, []);

  const refreshStatus = useCallback(async ({ silent = false } = {}) => {
    try {
      const next = await api.status();
      setStatus(next);
      setStatusError(null);
      return next;
    } catch (error) {
      if (!silent) setStatusError(error.message);
      throw error;
    }
  }, []);

  // Statut initial + liste des modes (pour les sélecteurs)
  useEffect(() => {
    let alive = true;
    refreshStatus({ silent: true }).catch(() => {});
    api
      .getSettings()
      .then((data) => {
        if (!alive) return;
        setPlaylists(data?.playlists || {});
        setStatus((prev) => (prev ? { ...prev, settings: data?.settings ?? prev.settings } : prev));
      })
      .catch((error) => {
        if (alive) setStatusError(error.message);
      });
    return () => {
      alive = false;
    };
  }, [refreshStatus]);

  // Le serveur ne diffuse `snapshot` que sur les messages du jeu : pendant une
  // démo (ou si le WebSocket tombe) on complète avec /api/live toutes les 2 s.
  const demoRunning = Boolean(status?.demo?.running);
  const matchActive = Boolean(snapshot?.active);
  const livePolling = socketState !== 'open' || demoRunning || matchActive;

  useEffect(() => {
    if (!livePolling) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const live = await api.live();
        if (!alive) return;
        setSnapshot(live?.snapshot ?? null);
        mergeRl(live?.rl);
        if (live?.demo) setStatus((prev) => (prev ? { ...prev, demo: live.demo } : prev));
        setStatusError(null);
      } catch (error) {
        if (alive) setStatusError(error.message);
      }
    };
    tick();
    const liveId = window.setInterval(tick, 2000);
    const statusId =
      socketState === 'open'
        ? null
        : window.setInterval(() => {
            api
              .status()
              .then((next) => {
                if (alive) setStatus(next);
              })
              .catch(() => {});
          }, 4000);
    return () => {
      alive = false;
      window.clearInterval(liveId);
      if (statusId) window.clearInterval(statusId);
    };
  }, [livePolling, socketState, mergeRl]);

  const lastRefreshToastRef = useRef({ key: '', at: 0 });

  const handleMessage = useCallback(
    (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      const { type, payload } = message || {};
      if (!type) return;

      if (type === 'hello') {
        if (payload?.status) setStatus(payload.status);
        setSnapshot(payload?.live ?? null);
        if (payload?.status?.ballchasing?.refresh) setProRefresh(payload.status.ballchasing.refresh);
        return;
      }
      if (type === 'snapshot') {
        setSnapshot(payload?.snapshot ?? null);
        mergeRl(payload?.rl);
        return;
      }
      if (type === 'status') {
        if (payload?.status) setStatus(payload.status);
        else mergeRl(payload?.rl);
        return;
      }
      if (type === 'match-completed') {
        if (payload?.status) setStatus(payload.status);
        bumpData();
        const summary = payload?.summary;
        toastRef.current.push({
          kind: 'success',
          title: summary?.result === 'loss' ? 'Match analysé (défaite)' : 'Match analysé',
          message: summary
            ? `${summary.playlistLabel || summary.playlist} · score coach ${num(summary.rlCoachScore, 0)}/100 (${summary.grade ?? '—'})`
            : 'Un nouveau match vient d’être analysé.',
        });
        return;
      }
      if (type === 'match-ai') {
        bumpData();
        return;
      }
      if (type === 'pro-refresh') {
        setProRefresh(payload || null);
        if (payload?.running === false) {
          const key = `${payload?.ok ? 'ok' : 'ko'}-${payload?.finishedAt ?? ''}-${payload?.reanalyzed ?? ''}`;
          const now = Date.now();
          const already = lastRefreshToastRef.current;
          if (already.key !== key || now - already.at > MAX_TOAST_DEDUPE_MS) {
            lastRefreshToastRef.current = { key, at: now };
            if (payload?.error) {
              toastRef.current.push({ kind: 'error', title: 'Actualisation ballchasing échouée', message: payload.error });
            } else if (payload?.ok) {
              toastRef.current.push({
                kind: 'success',
                title: 'Cohorte pro actualisée',
                message:
                  payload.reanalyzed != null
                    ? `${payload.reanalyzed} match(s) réanalysé(s) avec les nouvelles références.`
                    : undefined,
              });
            }
          }
          bumpData();
        }
      }
    },
    [bumpData, mergeRl],
  );

  const handleRef = useRef(handleMessage);
  handleRef.current = handleMessage;

  // WebSocket live avec reconnexion exponentielle
  useEffect(() => {
    let disposed = false;
    let socket = null;
    let retryTimer = null;
    let attempt = 0;

    const schedule = () => {
      if (disposed) return;
      attempt += 1;
      const delay = Math.min(8000, 500 * 2 ** Math.min(attempt, 4));
      retryTimer = window.setTimeout(connect, delay);
    };

    function connect() {
      if (disposed) return;
      setSocketState((prev) => (prev === 'open' ? prev : 'connecting'));
      let next;
      try {
        next = new WebSocket(liveSocketUrl());
      } catch {
        setSocketState('closed');
        schedule();
        return;
      }
      socket = next;
      next.addEventListener('open', () => {
        if (disposed) return;
        attempt = 0;
        setSocketState('open');
        setStatusError(null);
      });
      next.addEventListener('message', (event) => handleRef.current(event.data));
      next.addEventListener('close', () => {
        if (disposed) return;
        setSocketState('closed');
        schedule();
      });
      next.addEventListener('error', () => {
        /* le handler close enchaîne la reconnexion */
      });
    }

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const connectRl = useCallback(async () => {
    const result = await api.connect();
    await refreshStatus({ silent: true });
    return result;
  }, [refreshStatus]);

  const disconnectRl = useCallback(async () => {
    const result = await api.disconnect();
    await refreshStatus({ silent: true });
    return result;
  }, [refreshStatus]);

  const startDemo = useCallback(
    async (body) => {
      const result = await api.startDemo(body);
      await refreshStatus({ silent: true });
      return result;
    },
    [refreshStatus],
  );

  const stopDemo = useCallback(async () => {
    const result = await api.stopDemo();
    await refreshStatus({ silent: true });
    return result;
  }, [refreshStatus]);

  const saveSettings = useCallback(async (patch) => {
    const result = await api.updateSettings(patch);
    if (result?.status) setStatus(result.status);
    if (result?.settings) settingsRef.current = result.settings;
    return result;
  }, []);

  const deleteMatch = useCallback(
    async (id) => {
      const result = await api.deleteMatch(id);
      if (result?.status) setStatus(result.status);
      bumpData();
      return result;
    },
    [bumpData],
  );

  const clearHistory = useCallback(async () => {
    const result = await api.deleteMatches();
    if (result?.status) setStatus(result.status);
    bumpData();
    return result;
  }, [bumpData]);

  const refreshPro = useCallback(
    async (body) => {
      const result = await api.refreshPro(body);
      if (result?.refresh) setProRefresh(result.refresh);
      return result;
    },
    [],
  );

  const value = useMemo(
    () => ({
      status,
      statusError,
      snapshot,
      socketState,
      proRefresh,
      dataVersion,
      playlists: playlists && Object.keys(playlists).length ? playlists : status?.settings ? {} : {},
      refreshStatus,
      connectRl,
      disconnectRl,
      startDemo,
      stopDemo,
      saveSettings,
      deleteMatch,
      clearHistory,
      refreshPro,
      bumpData,
    }),
    [
      status,
      statusError,
      snapshot,
      socketState,
      proRefresh,
      dataVersion,
      playlists,
      refreshStatus,
      connectRl,
      disconnectRl,
      startDemo,
      stopDemo,
      saveSettings,
      deleteMatch,
      clearHistory,
      refreshPro,
      bumpData,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) throw new Error('useAppData doit être utilisé dans <AppDataProvider>.');
  return context;
}
