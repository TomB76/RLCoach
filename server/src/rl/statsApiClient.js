/**
 * Client de l'API Stats locale de Rocket League.
 *
 * Le jeu, quand l'export est activé (TAStatsAPI.ini), ouvre un serveur local
 * sur 127.0.0.1:49123 qui diffuse des messages JSON `{ "Event": "...", "Data": "..." }`
 * (Data est une chaîne JSON). Le jeu expose à la fois un WebSocket et un socket
 * TCP brut : on privilégie le WebSocket, avec repli TCP.
 *
 * Doc : https://www.rocketleague.com/developer/stats-api
 */

import { EventEmitter } from 'node:events';
import net from 'node:net';
import WebSocket from 'ws';

const RECONNECT_DELAY_MS = 4000;

export class StatsApiClient extends EventEmitter {
  constructor({ host = '127.0.0.1', port = 49123, transport = 'ws' } = {}) {
    super();
    this.host = host;
    this.port = port;
    this.transport = transport;
    this.state = 'disconnected';
    this.lastError = null;
    this.lastMessageAt = null;
    this.messageCount = 0;
    this.ws = null;
    this.socket = null;
    this.reconnectTimer = null;
    this.manualClose = false;
    this.buffer = '';
  }

  configure({ host, port, transport } = {}) {
    if (host) this.host = host;
    if (port) this.port = Number(port);
    if (transport) this.transport = transport;
  }

  getStatus() {
    return {
      state: this.state,
      transport: this.transport,
      host: this.host,
      port: this.port,
      lastError: this.lastError,
      lastMessageAt: this.lastMessageAt,
      messageCount: this.messageCount,
    };
  }

  setState(state, error = null) {
    this.state = state;
    if (error !== undefined) this.lastError = error;
    this.emit('status', this.getStatus());
  }

  connect() {
    this.manualClose = false;
    this.clearReconnect();
    this.closeTransports();
    this.setState('connecting');
    if (this.transport === 'tcp') this.connectTcp();
    else this.connectWs();
  }

  connectWs() {
    const url = `ws://${this.host}:${this.port}`;
    let settled = false;
    try {
      this.ws = new WebSocket(url, { handshakeTimeout: 4000 });
    } catch (err) {
      this.handleFailure(err.message);
      return;
    }

    this.ws.on('open', () => {
      settled = true;
      this.setState('connected', null);
      this.emit('connected', this.getStatus());
    });

    this.ws.on('message', (raw) => {
      this.handleRaw(raw.toString());
    });

    this.ws.on('error', (err) => {
      if (!settled) this.handleFailure(err.message || 'Connexion WebSocket impossible');
      else this.lastError = err.message || String(err);
    });

    this.ws.on('close', () => {
      if (this.ws) {
        this.ws.removeAllListeners();
        this.ws = null;
      }
      if (this.manualClose) {
        this.setState('disconnected', this.lastError);
        return;
      }
      if (settled) this.scheduleReconnect('Connexion fermée par le jeu');
      else this.handleFailure(this.lastError || 'Connexion WebSocket refusée');
    });
  }

  connectTcp() {
    this.buffer = '';
    this.socket = net.createConnection({ host: this.host, port: this.port });
    this.socket.setEncoding('utf8');

    this.socket.on('connect', () => {
      this.setState('connected', null);
      this.emit('connected', this.getStatus());
    });

    this.socket.on('data', (chunk) => {
      // Flux JSON concaténé : on découpe par équilibrage des accolades.
      this.buffer += chunk;
      this.drainTcpBuffer();
    });

    this.socket.on('error', (err) => {
      this.handleFailure(err.message);
    });

    this.socket.on('close', () => {
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket = null;
      }
      if (!this.manualClose) this.scheduleReconnect('Connexion TCP fermée');
    });
  }

  drainTcpBuffer() {
    for (;;) {
      const start = this.buffer.indexOf('{');
      if (start === -1) {
        this.buffer = '';
        return;
      }
      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;
      for (let i = start; i < this.buffer.length; i += 1) {
        const ch = this.buffer[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) {
        this.buffer = this.buffer.slice(start);
        return;
      }
      const json = this.buffer.slice(start, end + 1);
      this.buffer = this.buffer.slice(end + 1);
      this.handleRaw(json);
    }
  }

  handleRaw(raw) {
    this.messageCount += 1;
    this.lastMessageAt = new Date().toISOString();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    this.emit('message', parsed);
  }

  handleFailure(message) {
    this.lastError = message;
    this.setState('error', message);
    this.scheduleReconnect(message);
  }

  scheduleReconnect(reason) {
    if (this.manualClose) return;
    this.setState('waiting', reason);
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
    this.reconnectTimer.unref?.();
  }

  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  closeTransports() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.removeAllListeners();
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
    }
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
  }

  disconnect() {
    this.manualClose = true;
    this.clearReconnect();
    this.closeTransports();
    this.setState('disconnected', null);
  }
}
