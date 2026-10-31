/**
 * Client HTTP + WebSocket du serveur local RL Coach.
 * Aucune dépendance externe : fetch natif et WebSocket navigateur.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, data = null, code = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = code;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function describeNetworkError(error) {
  if (error?.name === 'AbortError') return error;
  return new ApiError(
    "Serveur local injoignable : lance « npm run dev » à la racine du projet (API sur le port 4317).",
    { code: 'network' },
  );
}

export async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: body === undefined ? undefined : JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw describeNetworkError(error);
  }

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(data?.error || data?.message || `Requête refusée (${response.status}).`, {
      status: response.status,
      data,
    });
  }
  return data;
}

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  status: (signal) => request('/api/status', { signal }),
  getSettings: (signal) => request('/api/settings', { signal }),
  updateSettings: (patch) => request('/api/settings', { method: 'PATCH', body: patch }),
  testToken: (token) => request('/api/settings/test-token', { method: 'POST', body: { token } }),

  connect: () => request('/api/rl/connect', { method: 'POST', body: {} }),
  disconnect: () => request('/api/rl/disconnect', { method: 'POST', body: {} }),
  live: (signal) => request('/api/live', { signal }),

  startDemo: (body) => request('/api/demo/start', { method: 'POST', body }),
  stopDemo: () => request('/api/demo/stop', { method: 'POST', body: {} }),

  matches: ({ limit = 100, playlist } = {}, signal) =>
    request(`/api/matches${query({ limit, playlist })}`, { signal }),
  match: (id, signal) => request(`/api/matches/${encodeURIComponent(id)}`, { signal }),
  deleteMatch: (id) => request(`/api/matches/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteMatches: () => request('/api/matches', { method: 'DELETE' }),

  overview: ({ limit = 15, playlist } = {}, signal) =>
    request(`/api/coach/overview${query({ limit, playlist })}`, { signal }),

  proReference: (playlist, signal) => request(`/api/pro/reference${query({ playlist })}`, { signal }),
  refreshPro: (body) => request('/api/pro/refresh', { method: 'POST', body }),

  importReplay: (body) => request('/api/replays/import', { method: 'POST', body }),
};

/** URL du WebSocket live, compatible Vite (proxy /live) et build servi par Express. */
export function liveSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/live`;
}

/** Lit un fichier local en base64 (sans préfixe data URL). */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ApiError(`Lecture impossible de « ${file.name} ».`));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.split(',').pop() || '');
    };
    reader.readAsDataURL(file);
  });
}
