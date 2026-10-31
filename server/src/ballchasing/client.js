/**
 * Client de l'API ballchasing.com — https://ballchasing.com/doc/api
 *
 * - GET  /replays            liste les replays (filtres playlist, pro, rang…)
 * - GET  /replays/{id}       détail complet avec les stats par joueur
 * - POST /v2/upload          envoie un fichier .replay (multipart)
 *
 * L'API est limitée en débit (~2 requêtes/seconde) : toutes les requêtes
 * passent par un throttle et un retry sur HTTP 429.
 */

export const BALLCHASING_BASE = 'https://ballchasing.com/api';

export class BallchasingError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'BallchasingError';
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class BallchasingClient {
  constructor({ token = '', minIntervalMs = 550 } = {}) {
    this.token = token;
    this.minIntervalMs = minIntervalMs;
    this.lastRequestAt = 0;
    this.requestCount = 0;
  }

  get configured() {
    return Boolean(this.token);
  }

  async throttle() {
    const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  async request(path, { method = 'GET', body, headers = {}, retries = 2 } = {}) {
    await this.throttle();
    this.requestCount += 1;

    const url = path.startsWith('http') ? path : `${BALLCHASING_BASE}${path}`;
    const requestHeaders = { Accept: 'application/json', ...headers };
    if (this.token) requestHeaders.Authorization = this.token;

    let response;
    try {
      response = await fetch(url, { method, headers: requestHeaders, body, signal: AbortSignal.timeout(20000) });
    } catch (err) {
      if (retries > 0) {
        await sleep(1200);
        return this.request(url, { method, body, headers, retries: retries - 1 });
      }
      throw new BallchasingError(`Réseau indisponible : ${err.message}`, 0);
    }

    if (response.status === 429) {
      if (retries > 0) {
        const retryAfter = Number(response.headers.get('retry-after') || 2);
        await sleep(Math.max(1200, retryAfter * 1000));
        return this.request(url, { method, body, headers, retries: retries - 1 });
      }
      throw new BallchasingError('Limite de requêtes ballchasing atteinte (HTTP 429). Réessaie dans un instant.', 429);
    }

    if (response.status === 401 || response.status === 403) {
      throw new BallchasingError('Token ballchasing refusé. Vérifie le token dans les réglages.', response.status);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new BallchasingError(
        `ballchasing ${method} ${path} → HTTP ${response.status}${text ? ` (${text.slice(0, 160)})` : ''}`,
        response.status,
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  /**
   * Liste les replays pro d'un mode.
   * @param {object} params
   * @param {string} params.playlist ex. ranked-doubles
   * @param {number} params.count 1..200
   * @param {boolean} params.pro filtre « matchs professionnels »
   */
  async listProReplays({ playlist = 'ranked-doubles', count = 40, pro = true, minRank = null } = {}) {
    const params = new URLSearchParams();
    params.set('playlist', playlist);
    params.set('count', String(Math.min(200, Math.max(1, count))));
    params.set('sort', 'replay-date-desc');
    if (pro) params.set('pro', 'true');
    if (minRank) params.set('min-rank', minRank);
    const data = await this.request(`/replays?${params.toString()}`);
    return data?.list || [];
  }

  /**
   * Liste les replays d'un joueur précis (filtre `player-name` de l'API).
   * Sert à construire la référence « prendre X comme coach ».
   */
  async listPlayerReplays({ playlist = 'ranked-doubles', count = 40, playerName = '', pro = true } = {}) {
    const params = new URLSearchParams();
    params.set('player-name', String(playerName));
    params.set('playlist', playlist);
    params.set('count', String(Math.min(200, Math.max(1, count))));
    params.set('sort', 'replay-date-desc');
    if (pro) params.set('pro', 'true');
    const data = await this.request(`/replays?${params.toString()}`);
    return data?.list || [];
  }

  /** Détail d'un replay (stats par joueur). */
  async getReplay(id) {
    return this.request(`/replays/${id}`);
  }

  /** Envoie un fichier .replay (nécessite un token avec droit d'upload). */
  async uploadReplay(buffer, filename, { visibility = 'unlisted' } = {}) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'application/octet-stream' }), filename);
    form.append('visibility', visibility);
    return this.request('/v2/upload', { method: 'POST', body: form });
  }

  /** Attend que ballchasing finisse d'analyser un replay uploadé. */
  async waitForReplay(id, { attempts = 12, delayMs = 1500 } = {}) {
    for (let i = 0; i < attempts; i += 1) {
      const replay = await this.getReplay(id);
      if (replay && replay.status !== 'pending') return replay;
      await sleep(delayMs);
    }
    throw new BallchasingError("Le replay n'a pas fini d'être analysé par ballchasing.", 408);
  }
}
