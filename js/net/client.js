// ---------------------------------------------------------------------------
// NetworkSession: the same four methods as LocalSession (getView, send, subscribe,
// destroy), backed by a WebSocket to server.js. The game screen cannot tell them apart.
//
// Extra, for the lobby:  create / join / rejoin / host actions, onLobby, onStart, onError, onStatus.
// The seat token is kept in sessionStorage, so a refresh or a dropped connection
// puts you back in your seat.
// ---------------------------------------------------------------------------
const KEY = 'solace.mp';
const store = {
  get() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } },
  clear() { try { sessionStorage.removeItem(KEY); } catch { /* private mode */ } },
};

export class NetworkSession {
  constructor() {
    this.ws = null; this.view = null; this.lobby = null; this.subs = [];
    this.h = { lobby: () => {}, start: () => {}, error: () => {}, status: () => {} };
    this.dead = false; this.started = false; this.retry = 0; this.wasOpen = false;
  }
  static saved() { return store.get(); }
  on(h) { Object.assign(this.h, h); return this; }

  _url() { return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`; }
  /** Open the socket, then send `first` (create / join / rejoin). Resolves on the first lobby message. */
  open(first) {
    return new Promise((resolve, reject) => {
      this.first = first; let settled = false;
      const ws = this.ws = new WebSocket(this._url());
      ws.onopen = () => { this.wasOpen = true; this.retry = 0; this.h.status('online'); ws.send(JSON.stringify(this.first)); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'lobby') {
          this.lobby = m; store.set({ code: m.code, token: m.token });
          this.first = { t: 'rejoin', code: m.code, token: m.token };      // reconnects use the seat token
          if (!settled) { settled = true; resolve(m); }
          this.h.lobby(m);
        } else if (m.t === 'view') {
          this.view = m.view;
          if (!this.started) { this.started = true; this.h.start(); }
          else this.subs.forEach((fn) => fn(this.view));
        } else if (m.t === 'error') {
          if (!settled) { settled = true; reject(new Error(m.msg)); } else this.h.error(m.msg);
        }
      };
      ws.onclose = () => {
        if (this.dead) return;
        if (!settled) { settled = true; return reject(new Error(this.wasOpen ? 'Connection lost.' : 'Could not reach the server.')); }
        this.h.status('reconnecting');
        setTimeout(() => !this.dead && this.open(this.first).catch((e) => { if (/rejoin|No room/.test(e.message)) { store.clear(); this.h.status('gone'); } else this.ws && this.ws.onclose && this.ws.onclose(); }), Math.min(5000, 800 * ++this.retry));
      };
      ws.onerror = () => {};
    });
  }
  create(name) { return this.open({ t: 'create', name }); }
  join(name, code) { return this.open({ t: 'join', name, code: String(code).trim().toUpperCase() }); }
  rejoin(saved) { return this.open({ t: 'rejoin', code: saved.code, token: saved.token }); }

  _tx(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  addBot() { this._tx({ t: 'addBot' }); }
  removeBot() { this._tx({ t: 'removeBot' }); }
  setLives(v) { this._tx({ t: 'lives', value: v }); }
  setRule(key, value) { this._tx({ t: 'rules', key, value }); }
  startGame() { this._tx({ t: 'start' }); }

  // ---- same surface as LocalSession ----
  getView() { return this.view; }
  send(action) { this._tx({ t: 'act', action }); return { ok: true }; }   // rejections arrive asynchronously through onError
  subscribe(fn) { this.subs.push(fn); return () => { this.subs = this.subs.filter((f) => f !== fn); }; }
  destroy({ leave = true } = {}) {
    this.dead = true; this.subs = [];
    if (leave) { this._tx({ t: 'leave' }); store.clear(); }
    try { this.ws && this.ws.close(); } catch { /* already closed */ }
  }
}
