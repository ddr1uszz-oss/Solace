// ---------------------------------------------------------------------------
// SESSION: the only thing the UI talks to.
//
//   session.getView()        -> the current view for the local player
//   session.send(action)     -> { ok, error? }
//   session.subscribe(fn)    -> fn(view) after every change; returns unsubscribe
//   session.destroy()
//
// LocalSession runs the Game in this tab and drives the AI players.
// For online play, write a NetworkSession with the same four methods that sends
// actions over a WebSocket and receives views from a server running Game —
// no UI or engine code needs to change.
// ---------------------------------------------------------------------------
import { Game } from './game.js';
import { nextAIAction } from './ai.js';

export class LocalSession {
  constructor({ humanId = 'you', humanName = 'You', aiCount = 3, config = {}, seed, aiDelay = 900, players: given } = {}) {
    const names = ['Mara', 'Odo', 'Ilsa', 'Bram', 'Wren', 'Sable', 'Quill', 'Tamsin', 'Fenn'];
    const players = [{ id: humanId, name: humanName, isAI: false }];
    for (let i = 0; i < aiCount; i++) players.push({ id: `ai${i + 1}`, name: names[i % names.length], isAI: true });
    if (given) players.splice(0, players.length, ...given);        // server rooms: several humans, supplied seats
    this.humanId = humanId;
    this.aiDelay = aiDelay;
    this.game = new Game({ players, config, seed });
    this.subs = [];
    this.timer = null;
    this.dead = false;
    this.game.onChange(() => { this._armTimer(); this.subs.forEach((fn) => fn(this.getView())); this._schedule(); });
    this._armTimer();
    this._schedule();
  }
  getView() { return this.game.getView(this.humanId); }
  send(action) { return this.game.dispatch(this.humanId, action); }
  subscribe(fn) { this.subs.push(fn); return () => { this.subs = this.subs.filter((f) => f !== fn); }; }
  destroy() { this.dead = true; clearTimeout(this.timer); clearTimeout(this.tt); this.subs = []; }

  /** UI hook: hold the AI while a cast / verdict moment plays, so the screen never lags the game. */
  setPaused(on) {
    this.paused = !!on;
    if (on) { clearTimeout(this.timer); this.timer = null; } else this._schedule();
  }

  // ---- turn timer (config.turnTimer seconds, 0 = off) ----
  // Humans who run out of time are acted for: stand / first vote option / first card / ready.
  // The deadline lives in game.state.turnEnds so every view can show a countdown.
  _awaited() {
    const g = this.game, s = g.state, secs = g.turnSecs();
    if (!(secs > 0) || s.phase === 'gameOver') return null;
    const human = (id) => { const p = g.player(id); return p && p.alive && !p.isAI; };
    if (s.phase === 'roundEnd') {
      const ids = g.alivePlayers().filter((p) => !p.isAI && !s.ready.includes(p.id)).map((p) => p.id);
      return ids.length ? { key: `r${s.round}`, ms: 20000, act: () => ids.forEach((id) => g.dispatch(id, { type: 'ready' })) } : null;
    }
    const pd = s.pending;
    if (pd && pd.kind === 'vote') {
      const ids = pd.voters.filter((id) => human(id) && pd.votes[id] == null);
      return ids.length ? { key: `v${s.round}${pd.entryUid}`, ms: secs * 1000, act: () => ids.forEach((id) => g.dispatch(id, { type: 'vote', target: pd.candidates[0] })) } : null;
    }
    if (pd && pd.kind === 'pick') return human(pd.playerId) ? { key: `p${s.round}.${s.turnNo}`, ms: secs * 1000, act: () => g.dispatch(pd.playerId, { type: 'pick', cardUid: pd.cards[0].uid }) } : null;
    return human(s.turn) ? { key: `t${s.round}.${s.turnNo}`, ms: secs * 1000, act: () => (g.state.config.timeoutAction === 'lose' ? g.forfeit(s.turn) : g.dispatch(s.turn, { type: 'stand' })) } : null;
  }
  _armTimer() {
    const s = this.game.state, w = this.dead ? null : this._awaited();
    if (!w) { clearTimeout(this.tt); this.tkey = null; s.turnEnds = null; return; }
    if (w.key === this.tkey) return;
    clearTimeout(this.tt);
    this.tkey = w.key; s.turnEnds = Date.now() + w.ms; s.turnMs = w.ms;
    this.tt = setTimeout(() => { this.tkey = null; if (!this.dead) w.act(); }, w.ms);
  }

  _schedule() {
    this._armTimer();
    if (this.dead || this.paused || this.timer || this.aiDelay < 0) return;
    const ais = this.game.state.players.filter((p) => p.isAI && p.alive);
    for (const ai of ais) {
      const action = nextAIAction(this.game, ai.id);
      if (!action) continue;
      const delay = action.type === 'vote' || action.type === 'pick' ? this.aiDelay * 0.5 : this.aiDelay;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.dead) return;
        const res = this.game.dispatch(ai.id, action);
        if (!res.ok) { console.warn('AI action rejected', ai.id, action, res.error); this._schedule(); }
      }, delay);
      return;
    }
  }

  /** Test helper: run AI-only games instantly (aiDelay < 0, no timers). */
  runAIsNow(limit = 5000) {
    for (let i = 0; i < limit; i++) {
      let acted = false;
      for (const ai of this.game.state.players.filter((p) => p.isAI && p.alive)) {
        const a = nextAIAction(this.game, ai.id);
        if (a) { const r = this.game.dispatch(ai.id, a); if (!r.ok) throw new Error(`AI action rejected: ${JSON.stringify(a)} -> ${r.error}`); acted = true; break; }
      }
      if (!acted) return i;
    }
    throw new Error('AI loop did not settle');
  }
}
