// ---------------------------------------------------------------------------
// GAME ENGINE  (no DOM, no timers, no browser APIs)
//
// This class is the single source of truth for a match. It is written so the
// same file can later run on a server (Node) with real network players:
//
//   game.dispatch(playerId, action)  -> { ok, error? }    validates + applies
//   game.getView(playerId)           -> plain JSON         what that player may see
//   game.onChange(fn)                                      notified after every change
//
// All state lives in `game.state` and is JSON-serialisable (including the RNG),
// so it can be saved, restored (Game.fromState) or broadcast.
//
// Actions (what a client may send):
//   { type:'draw' }
//   { type:'stand' }
//   { type:'playRune', runeUid, params:{ player?, ownCard?, active?, ownActive?, ownRune? } }
//   { type:'vote', target }          (Exile vote)
//   { type:'pick', cardUid }         (Double Draw: choose which card to keep)
//   { type:'ready' }                 (continue after a round summary)
//   { type:'debugGiveRune', runeId } (only when config.devMode)
// ---------------------------------------------------------------------------
import { Rng } from './rng.js';
import { DEFAULT_CONFIG } from './config.js';
import { RUNES, buildRuneDeckList } from './runes.js';
import { cardTotal, currentTarget, currentBet, evaluateRound } from './rules.js';
import { rollTwist } from './twists.js';

export class Game {
  constructor({ players, config = {}, seed, state } = {}) {
    this.listeners = [];
    if (state) { this.state = state; this.rng = new Rng(state.rng); return; }
    if (!players || players.length < 2) throw new Error('Need at least 2 players');
    const cfg = { ...DEFAULT_CONFIG, ...config };
    if (players.length > cfg.maxPlayers) throw new Error(`Max ${cfg.maxPlayers} players`);
    this.state = {
      config: cfg,
      rng: { s: (seed ?? (Math.random() * 4294967296)) >>> 0 },
      nextUid: 1, nextLogId: 1,
      phase: 'turn', round: 0, baseBet: cfg.startingBet,
      players: players.map((p) => ({
        id: p.id, name: p.name, isAI: !!p.isAI,
        lives: cfg.startingLives, alive: true,
        runes: [], cards: [],
        skipDraw: false, doubleDraw: false, jackpotTax: 0, runesThisTurn: 0, forfeited: false,
      })),
      unitDeck: [], unitDiscard: [], runeDeck: [], runeDiscard: [],
      active: [],               // [{ uid, runeId, owner, data }]
      turn: null, consecutiveStands: 0,
      turnNo: 0, starterIdx: -1, dir: 1, reversed: false, lastCall: null, turnEnds: null, turnMs: 0,
      twist: null, nextTwist: null,   // this round's twist / the one rolled for the next round
      pending: null,            // { kind:'vote' | 'pick', ... }
      lastVote: null,           // result of the latest Exile vote (public once it is resolved): who voted for whom
      roundResult: null, ready: [], winnerId: null,
      log: [],
    };
    this.rng = new Rng(this.state.rng);
    this.state.runeDeck = this.rng.shuffle(buildRuneDeckList(this.runeDeckMult(players.length), cfg).map((runeId) => ({ uid: this._uid(), runeId })));
    this._rollNext(1);
    this.startRound();
  }

  static fromState(state) { return new Game({ state }); }
  toJSON() { return this.state; }
  onChange(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  _emit() { for (const fn of this.listeners) fn(this); }

  // ---------------------------------------------------------------- helpers
  // (the rune effects in runes.js use these)
  _uid() { return this.state.nextUid++; }
  player(id) { return this.state.players.find((p) => p.id === id); }
  alivePlayers() { return this.state.players.filter((p) => p.alive); }
  log(text, big = false) {
    const s = this.state;
    s.log.push({ id: s.nextLogId++, text, big });
    if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
  }
  announce(text) { this.log(text, true); }
  /** Attach a structured event to the latest log line (the UI reacts to these). */
  tag(ev, big = false) {
    const l = this.state.log[this.state.log.length - 1];
    if (!l) return;
    l.ev = ev;
    if (big) l.big = true;
  }

  /** Copies of every unit card in a fresh deck for `n` living players (config: unitDeckScaling, playersPerDeck, min/maxUnitCopies, unitCopies). */
  unitCopies(n = this.alivePlayers().length) {
    const c = this.state.config;
    let k = c.unitDeckScaling === 'fixed' ? c.unitCopies : Math.ceil(n / Math.max(1, c.playersPerDeck));
    k = Math.max(c.minUnitCopies || 1, k);
    if (c.maxUnitCopies > 0) k = Math.min(k, c.maxUnitCopies);
    return Math.max(1, Math.round(k));
  }
  /** Copies in the deck dealt this round (stays put when a player is eliminated mid-round). */
  deckCopies() { return this.state.deckCopies || this.unitCopies(); }
  /** Multiplier for the rune deck at a table of `n` players: a number from the config, or the 'auto' tiers. */
  runeDeckMult(n) {
    const c = this.state.config;
    if (typeof c.runeDeckMultiplier === 'number' && c.runeDeckMultiplier > 0) return c.runeDeckMultiplier;
    let m = 1;
    for (const [min, mult] of [...(c.runeDeckAuto || [])].sort((a, b) => a[0] - b[0])) if (n >= min) m = mult;
    return m;
  }

  unitCardsAvailable() { return this.state.unitDeck.length + this.state.unitDiscard.length; }
  ensureDeck(n = 1) {
    const s = this.state;
    if (s.unitDeck.length < n && s.unitDiscard.length) {
      // Reshuffle discards under the remaining deck.
      s.unitDeck = this.rng.shuffle(s.unitDiscard.splice(0)).concat(s.unitDeck);
    }
  }
  takeUnit() {
    this.ensureDeck(1);
    const c = this.state.unitDeck.pop();
    if (c) { c.faceDown = false; c.revealed = false; }
    return c || null;
  }
  drawUnit(p, { faceDown = false } = {}) {
    const c = this.takeUnit();
    if (!c) return null;
    c.faceDown = faceDown;
    p.cards.push(c);
    return c;
  }
  returnToDeck(card) {
    card.faceDown = false; card.revealed = false;
    const d = this.state.unitDeck;
    d.splice(this.rng.int(d.length + 1), 0, card);
  }
  isStalled() { return this.state.active.some((a) => a.runeId === 'stall' && !a.data.expired); }
  /** Vow: the owner auto-stands for a few turns and rune cards can't target them. */
  vowOf(p) { return this.state.active.find((a) => a.runeId === 'vow' && a.owner === p.id && a.data.left > 0) || null; }
  isVowed(p) { return !!this.vowOf(p); }
  isRestrained(p) { return this.state.active.some((a) => a.runeId === 'restrain' && a.data.targetId === p.id); }
  // Round twist limits (fall back to the table config when no twist changes them).
  handLimit() { const t = this.state.twist, base = this.state.config.runeHandLimit; return t && t.handLimit ? Math.min(t.handLimit, base) : base; }
  maxRunes() { const t = this.state.twist; return (t && t.maxRunes) || this.state.config.maxRunesPerTurn; }
  /** Seconds per turn right now (0 = untimed). Speed Round shrinks it. */
  turnSecs() { const base = this.state.config.turnTimer, t = this.state.twist; return base > 0 ? (t && t.timer) || base : 0; }
  _rollNext(round) { const s = this.state; s.nextTwist = rollTwist(s.config, round, this.rng, s.twist ? s.twist.id : null); }
  /** Which rune to draw from the deck: normally the top; with Rare Tide, the rarest of 3 random cards. */
  _runeIdx() {
    const d = this.state.runeDeck, t = this.state.twist;
    if (!(t && t.rarity === 'high') || d.length < 2) return d.length - 1;
    let best = this.rng.int(d.length);
    for (let k = 0; k < 2; k++) { const j = this.rng.int(d.length); if (RUNES[d[j].runeId].tier > RUNES[d[best].runeId].tier) best = j; }
    return best;
  }
  drawRune(p, n = 1) {
    const s = this.state;
    if (this.isRestrained(p)) { this.log(`${p.name} is restrained and can\u2019t draw runes.`); return 0; }
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (p.runes.length >= this.handLimit()) { this.log(`${p.name}\u2019s rune hand is full.`); break; }
      if (!s.runeDeck.length) s.runeDeck = this.rng.shuffle(s.runeDiscard.splice(0));
      if (!s.runeDeck.length) break;
      const [r] = s.runeDeck.splice(this._runeIdx(), 1);
      p.runes.push(r); got++;
    }
    return got;
  }
  discardRandomRune(p) {
    if (!p.runes.length) return null;
    const [r] = p.runes.splice(this.rng.int(p.runes.length), 1);
    this.state.runeDiscard.push(r);
    return r;
  }
  destroyActive(uid, msg) {
    const s = this.state;
    const i = s.active.findIndex((a) => a.uid === uid);
    if (i < 0) return;
    const [a] = s.active.splice(i, 1);
    s.runeDiscard.push({ uid: a.uid, runeId: a.runeId });
    this.log(msg || `${RUNES[a.runeId].name} was destroyed.`);
  }
  startVote(caster, entry) {
    const alive = this.alivePlayers();
    this.state.pending = {
      kind: 'vote', casterId: caster.id, entryUid: entry.uid,
      voters: alive.map((p) => p.id),
      candidates: alive.filter((p) => p.id !== caster.id && !this.isVowed(p)).map((p) => p.id),
      votes: {},
    };
    this.announce(`${caster.name} cast Exile! Vote for who gets exiled.`);
  }

  // ------------------------------------------------------------------ rounds
  startRound() {
    const s = this.state, c = s.config;
    s.round += 1;
    s.twist = s.nextTwist; s.nextTwist = null;
    s.baseBet = c.startingBet + (s.round - 1) * c.betIncreasePerRound;
    for (const a of s.active) s.runeDiscard.push({ uid: a.uid, runeId: a.runeId });
    s.active = []; s.pending = null; s.roundResult = null; s.ready = [];

    const alive = this.alivePlayers();
    // Fresh unit deck every round: one 1–11 set per `playersPerDeck` players.
    const copies = this.unitCopies(alive.length);
    s.deckCopies = copies;
    const deck = [];
    for (let k = 0; k < copies; k++) for (const v of c.unitValues) deck.push({ uid: this._uid(), value: v, faceDown: false, revealed: false });
    s.unitDeck = this.rng.shuffle(deck); s.unitDiscard = [];

    for (const p of alive) {
      p.cards = []; p.skipDraw = false; p.forfeited = false; p.doubleDraw = false; p.jackpotTax = 0; p.runesThisTurn = 0;
      this.drawUnit(p, { faceDown: true });
      this.drawUnit(p, { faceDown: false });
      this.drawRune(p, s.round === 1 ? c.startingRunes : c.runesPerRound);
      if (s.twist && s.twist.extraRunes) this.drawRune(p, s.twist.extraRunes);
    }
    // First player rotates through the original seating order (skipping eliminated players).
    const n = s.players.length;
    do { s.starterIdx = (s.starterIdx + 1) % n; } while (!s.players[s.starterIdx].alive);
    s.turn = s.players[s.starterIdx].id;
    s.dir = c.turnDirection === 'ccw' ? -1 : c.turnDirection === 'alternate' && s.round % 2 === 0 ? -1 : 1;
    s.reversed = false; s.lastCall = null;
    s.consecutiveStands = 0;
    s.phase = 'turn';
    if (s.twist) this.announce(`Twist: ${s.twist.name}. ${s.twist.desc}`);
    this.announce(`Round ${s.round}. The bet is ${currentBet(s)}.`);
    this.tag({ t: 'roundStart', round: s.round, bet: currentBet(s), twist: s.twist ? { id: s.twist.id, name: s.twist.name, icon: s.twist.icon, desc: s.twist.desc } : null });
  }

  _endRound() {
    const s = this.state;
    s.lastCall = null; s.turnEnds = null;
    const result = evaluateRound(s);
    const rows = result.rows;
    for (const r of rows) {
      const p = this.player(r.id);
      r.name = p.name;
      r.cards = p.cards.map((c) => ({ uid: c.uid, value: c.value, faceDown: c.faceDown }));
      r.livesBefore = p.lives;
      p.lives = Math.max(0, p.lives - r.loss);
      r.livesAfter = p.lives;
      if (p.lives === 0) { p.alive = false; r.eliminated = true; }
      if (r.reward) this.drawRune(p, r.reward);
    }
    result.round = s.round;
    s.roundResult = result;
    s.pending = null;
    const winners = rows.filter((r) => r.winner).map((r) => r.name).join(' & ');
    this.announce(`Round ${s.round} over \u2014 target ${result.target}. Closest: ${winners}.`);
    this.tag({ t: 'roundEnd' });

    const survivors = this.alivePlayers();
    if (survivors.length <= 1) {
      s.phase = 'gameOver';
      s.winnerId = survivors[0] ? survivors[0].id : null;
      this.announce(survivors[0] ? `${survivors[0].name} is the last one standing!` : 'Nobody survived.');
      return;
    }
    s.phase = 'roundEnd';
    this._rollNext(s.round + 1);
    s.ready = survivors.filter((p) => p.isAI).map((p) => p.id);
    this._maybeNextRound();
  }

  _maybeNextRound() {
    const s = this.state;
    if (s.phase !== 'roundEnd') return;
    const humans = this.alivePlayers().filter((p) => !p.isAI);
    if (humans.every((p) => s.ready.includes(p.id))) this.startRound();
  }

  _advanceTurn() {
    const s = this.state;
    const alive = this.alivePlayers();
    let cur = this.player(s.turn);
    cur.runesThisTurn = 0; cur.skipDraw = false;
    // Each pass of this loop moves the turn on by one seat. A player under a Vow stands automatically and the loop moves on again.
    for (let guard = 0; guard < 200; guard++) {
      // Wrap: after the caller's turn, every other player gets exactly one turn (a Vow auto-stand counts as theirs).
      const lc = s.lastCall;
      if (lc) {
        if (!lc.started) { lc.started = true; lc.left = alive.filter((p) => p.id !== lc.callerId).length; }
        else lc.left -= 1;
        if (lc.left <= 0) { this._endRound(); return; }
      }
      const n = s.players.length;          // walk the seats so this also works when `cur` was just eliminated
      let j = s.players.findIndex((p) => p.id === cur.id);
      do { j = (j + s.dir + n) % n; } while (!s.players[j].alive);
      const next = s.players[j];
      s.turn = next.id; next.runesThisTurn = 0; s.turnNo += 1;
      // Stall counts down as turns begin; once spent, drawing is allowed again.
      for (const a of s.active) {
        if (a.runeId === 'stall' && !a.data.expired && --a.data.turnsLeft <= 0) a.data.expired = true;
      }
      if (next.forfeited) {            // ran out of time earlier this round: no more turns, counts as standing
        s.consecutiveStands += 1;
        if (s.consecutiveStands >= alive.length) { this._endRound(); return; }
        cur = next; continue;
      }
      const vow = this.vowOf(next);
      if (!vow) return;
      vow.data.left -= 1; next.skipDraw = false;
      this.log(`${next.name} stands (Vow).`);
      this.tag({ t: 'stand', pid: next.id });
      s.consecutiveStands += 1;
      if (vow.data.left <= 0) this.destroyActive(vow.uid, `${next.name}\u2019s Vow is fulfilled.`);
      if (s.consecutiveStands >= alive.length) { this._endRound(); return; }
      cur = next;
    }
  }

  /**
   * Take a player out of the game right now (a disconnect, or leaving). Their unit cards go to the discard, their runes to the
   * rune discard, and active runes they played stay on the table. Whatever was waiting on them (their turn, a pick, an Exile
   * vote, the next-round ready check) moves on without them. If one player is left, that player wins.
   */
  eliminate(pid, why = 'left the game') {
    const s = this.state, p = this.player(pid);
    if (!p || !p.alive || s.phase === 'gameOver') return false;
    const wasTurn = s.phase === 'turn' && s.turn === pid;
    p.alive = false; p.lives = 0;
    for (const r of p.runes.splice(0)) s.runeDiscard.push(r);
    if (s.phase === 'turn') for (const c of p.cards.splice(0)) { c.faceDown = false; c.revealed = false; s.unitDiscard.push(c); }
    this.announce(`${p.name} ${why} and is out of the game.`);
    this.tag({ t: 'eliminated', pid, reason: why });
    const left = this.alivePlayers();
    if (left.length <= 1) {
      s.pending = null; s.turnEnds = null; s.phase = 'gameOver'; s.winnerId = left[0] ? left[0].id : null;
      this.announce(left[0] ? `${left[0].name} is the last one standing!` : 'Nobody survived.');
      this._emit(); return true;
    }
    if (s.phase === 'roundEnd') { s.ready = s.ready.filter((id) => id !== pid); this._maybeNextRound(); this._emit(); return true; }
    const pd = s.pending;
    if (pd && pd.kind === 'pick' && pd.playerId === pid) { for (const c of pd.cards) this.returnToDeck(c); s.pending = null; }
    else if (pd && pd.kind === 'vote') {
      pd.voters = pd.voters.filter((id) => id !== pid);
      pd.candidates = pd.candidates.filter((id) => id !== pid);
      delete pd.votes[pid];
      for (const v of Object.keys(pd.votes)) if (pd.votes[v] === pid) delete pd.votes[v];   // those voters vote again
      if (!pd.candidates.length || !pd.voters.length) s.pending = null;
      else if (pd.voters.every((id) => pd.votes[id] != null)) this._resolveVote();
    }
    if (s.lastCall && s.lastCall.callerId === pid) s.lastCall = null;
    if (s.consecutiveStands >= left.length) this._endRound();
    else if (wasTurn) this._advanceTurn();
    this._emit();
    return true;
  }

  // ----------------------------------------------------------------- queries
  drawBlockReason(p) {
    if (this.isStalled()) return 'Stall: no one can draw right now.';
    if (p.skipDraw) return 'You skip your draw this turn.';
    if (cardTotal(p) > currentTarget(this.state)) return 'You\u2019ve exceeded the target \u2014 you can\u2019t draw normally (rune cards that draw still work).';
    if (!this.unitCardsAvailable()) return 'The deck is empty.';
    return null;
  }
  _stepOptions(me, def, kind, runeCard) {
    const s = this.state;
    switch (kind) {
      case 'player': {
        const f = def.targetFilter || ((g, m, t) => t.id !== m.id);
        return this.alivePlayers().filter((t) => (t.id === me.id || !this.isVowed(t)) && f(this, me, t)).map((t) => ({ id: t.id, label: t.name }));
      }
      case 'ownCard': return me.cards.map((c) => ({ id: c.uid, value: c.value, faceDown: c.faceDown }));
      case 'active': return s.active.map((a) => ({ id: a.uid, runeId: a.runeId, owner: a.owner }));
      case 'ownActive': return s.active.filter((a) => a.owner === me.id).map((a) => ({ id: a.uid, runeId: a.runeId, owner: a.owner }));
      case 'ownRune': return me.runes.filter((r) => r.uid !== runeCard.uid).map((r) => ({ id: r.uid, runeId: r.runeId }));
      default: return [];
    }
  }
  _steps(me, runeCard) {
    const def = RUNES[runeCard.runeId];
    return def.needs.map((kind) => ({ kind, options: this._stepOptions(me, def, kind, runeCard) }));
  }
  /** null if playable right now, otherwise a human-readable reason. */
  playableReason(me, runeCard) {
    const s = this.state, def = RUNES[runeCard.runeId];
    if (s.phase !== 'turn') return 'The round is over.';
    if (s.pending) return 'Waiting for a decision.';
    if (s.turn !== me.id) return 'Not your turn.';
    if (me.runesThisTurn >= this.maxRunes()) return `Max ${this.maxRunes()} rune${this.maxRunes() === 1 ? '' : 's'} per turn.`;
    if (s.lastCall && s.lastCall.started) return 'Wrap: no rune cards in the last lap.';
    if (this.isRestrained(me) && !def.destroy) return 'Restrained: only Destroy-type runes.';
    const r = def.canPlay && def.canPlay(this, me);
    if (r) return r;
    if (this._steps(me, runeCard).some((st) => !st.options.length)) return 'No valid target.';
    return null;
  }

  // ---------------------------------------------------------------- dispatch
  dispatch(playerId, action) {
    let error;
    try { error = this._apply(playerId, action || {}); }
    catch (e) { console.error(e); error = 'Internal error: ' + e.message; }
    if (error) return { ok: false, error };
    this._emit();
    return { ok: true };
  }

  _apply(pid, a) {
    const s = this.state, p = this.player(pid);
    if (!p) return 'Unknown player.';
    if (s.phase === 'gameOver') return 'The game is over.';

    if (a.type === 'debugGiveRune') {
      if (!s.config.devMode || !RUNES[a.runeId]) return 'Not allowed.';
      p.runes.push({ uid: this._uid(), runeId: a.runeId });
      return null;
    }
    if (s.phase === 'roundEnd') {
      if (a.type !== 'ready') return 'Waiting for the next round.';
      if (!s.ready.includes(pid)) s.ready.push(pid);
      this._maybeNextRound();
      return null;
    }
    if (!p.alive) return 'You are out of the game.';

    // Pending decisions take priority over everything else.
    if (s.pending) return this._applyPending(p, a);

    if (s.turn !== pid) return 'Not your turn.';
    switch (a.type) {
      case 'draw': return this._draw(p);
      case 'stand': return this._stand(p);
      case 'playRune': return this._playRune(p, a);
      default: return 'Unknown action.';
    }
  }

  _draw(p) {
    const s = this.state;
    const why = this.drawBlockReason(p);
    if (why) return why;
    if (p.doubleDraw) {
      p.doubleDraw = false;
      const c1 = this.takeUnit(), c2 = this.takeUnit();
      if (c1 && c2) {
        s.pending = { kind: 'pick', playerId: p.id, cards: [c1, c2] };
        this.log(`${p.name} draws two and must keep one.`);
        this.tag({ t: 'draw', pid: p.id });
        return null;
      }
      const only = c1 || c2;
      if (only) p.cards.push(only);
    } else {
      this.drawUnit(p);
    }
    const bonus = this._bonusRune(p);
    this.log(`${p.name} drew a card.`);
    this.tag({ t: 'draw', pid: p.id, rune: bonus });
    if (bonus) this.log(`${p.name} found a rune card.`);
    s.consecutiveStands = 0;
    this._advanceTurn();
    return null;
  }

  /** Normal draws sometimes also hand out a rune card (config.runeDrawChance). Returns 1 if one was given. */
  _bonusRune(p) {
    const s = this.state, c = s.config;
    if (!(c.runeDrawChance > 0) || this.rng.next() >= c.runeDrawChance) return 0;
    if (p.runes.length >= this.handLimit() || this.isRestrained(p)) return 0;
    return this.drawRune(p, 1);
  }

  /** The turn timer ran out with config.timeoutAction 'lose': the player has no more turns this round and ranks last (see rules.js). */
  forfeit(pid) {
    const s = this.state, p = this.player(pid);
    if (!p || !p.alive || s.phase !== 'turn' || s.pending || s.turn !== pid) return false;
    p.forfeited = true;
    this.log(`${p.name} ran out of time and forfeits the round.`);
    this.tag({ t: 'stand', pid: p.id, forfeit: true });
    s.consecutiveStands += 1;
    if (s.consecutiveStands >= this.alivePlayers().length) this._endRound(); else this._advanceTurn();
    this._emit();
    return true;
  }

  _stand(p) {
    const s = this.state;
    this.log(`${p.name} stands.`);
    this.tag({ t: 'stand', pid: p.id });
    s.consecutiveStands += 1;
    if (s.consecutiveStands >= this.alivePlayers().length) { this._endRound(); return null; }
    this._advanceTurn();
    return null;
  }

  _playRune(p, a) {
    const s = this.state;
    const card = p.runes.find((r) => r.uid === a.runeUid);
    if (!card) return 'You don\u2019t have that rune.';
    const def = RUNES[card.runeId];
    const why = this.playableReason(p, card);
    if (why) return why;
    const params = a.params || {};
    for (const st of this._steps(p, card)) {
      if (!st.options.some((o) => o.id === params[st.kind])) return 'Invalid choice.';
    }
    const lastActive = s.active.length ? s.active[s.active.length - 1].uid : null;   // what Rebuke-style runes hit (for the animation)
    p.runes.splice(p.runes.indexOf(card), 1);
    p.runesThisTurn += 1;
    s.consecutiveStands = 0;                     // the table changed: everyone gets another look
    let entry = null;
    if (def.kind === 'active') {
      entry = { uid: card.uid, runeId: card.runeId, owner: p.id, data: {} };
      s.active.push(entry);
    } else {
      s.runeDiscard.push(card);
    }
    this.log(`${p.name} played ${def.name}.`);
    this.tag({ t: 'rune', pid: p.id, runeId: card.runeId, uid: card.uid, kind: def.kind, tier: def.tier, targetId: params.player ?? null, params: { ...params }, lastActive }, true);
    def.play(this, p, params, entry);
    return null;
  }

  _applyPending(p, a) {
    const s = this.state, pend = s.pending;
    if (pend.kind === 'pick') {
      if (a.type !== 'pick' || p.id !== pend.playerId) return 'Waiting for another player\u2019s choice.';
      const keep = pend.cards.find((c) => c.uid === a.cardUid);
      if (!keep) return 'Pick one of the two cards.';
      const other = pend.cards.find((c) => c !== keep);
      keep.faceDown = false; p.cards.push(keep);
      this.returnToDeck(other);
      s.pending = null; s.consecutiveStands = 0;
      this.log(`${p.name} kept a card.`);
      if (this._bonusRune(p)) this.log(`${p.name} found a rune card.`);
      this._advanceTurn();
      return null;
    }
    if (pend.kind === 'vote') {
      if (a.type !== 'vote') return 'Waiting for the Exile vote.';
      if (!pend.voters.includes(p.id)) return 'You can\u2019t vote.';
      if (pend.votes[p.id] != null) return 'You already voted.';
      if (!pend.candidates.includes(a.target)) return 'Invalid vote.';
      pend.votes[p.id] = a.target;
      if (Object.keys(pend.votes).length >= pend.voters.length) this._resolveVote();
      return null;
    }
    return 'Unknown pending state.';
  }

  _resolveVote() {
    const s = this.state, pend = s.pending;
    const tally = {};
    for (const t of Object.values(pend.votes)) tally[t] = (tally[t] || 0) + 1;
    const top = Math.max(...Object.values(tally));
    const tied = Object.keys(tally).filter((k) => tally[k] === top);
    const chosenId = tied.length === 1 ? tied[0] : tied[this.rng.int(tied.length)];
    const target = this.state.players.find((x) => String(x.id) === String(chosenId));
    target.skipDraw = true;
    this.discardRandomRune(target);
    const entry = s.active.find((x) => x.uid === pend.entryUid);
    if (entry) entry.data.exiledId = target.id;
    s.lastVote = { entryUid: pend.entryUid, casterId: pend.casterId, voters: pend.voters.slice(), candidates: pend.candidates.slice(), votes: { ...pend.votes }, exiledId: target.id };
    s.pending = null;
    this.announce(`${target.name} was exiled: skips their next draw and discards a rune.`);
  }

  /** Unit cards the viewer cannot place (deck + other players' hidden cards): { value: copies left }. Only uses what `me` can see. */
  _unseen(me) {
    const s = this.state, copies = this.deckCopies(), unseen = {};
    for (const v of s.config.unitValues) unseen[v] = copies;
    for (const p of this.alivePlayers()) for (const c of p.cards) if (p.id === me.id || !c.faceDown || c.revealed) unseen[c.value]--;
    for (const c of s.unitDiscard) if (!c.faceDown || c.revealed) unseen[c.value]--;
    for (const v in unseen) unseen[v] = Math.max(0, unseen[v]);
    return unseen;
  }

  /** Rough chance (0..1) that the viewer busts if they draw now, from cards they can see. */
  _risk(me) {
    const room = currentTarget(this.state) - cardTotal(me);
    if (room <= 0) return 1;
    let n = 0, bad = 0;
    for (const [v, q] of Object.entries(this._unseen(me))) { n += q; if (+v > room) bad += q; }
    return n ? bad / n : null;
  }

  // -------------------------------------------------------------------- view
  /** Everything player `viewerId` is allowed to see, as plain JSON. */
  getView(viewerId) {
    const s = this.state, reveal = s.phase === 'roundEnd' || s.phase === 'gameOver';
    const me = this.player(viewerId);
    const showLives = s.config.showLives !== false, showDir = s.config.showDirection !== false, showRuneCount = s.config.showRuneCount !== false;
    // Lives table rule: with showLives off you only ever see your own lives (everyone's are revealed once the game is over).
    const livesOpen = (id) => showLives || id === viewerId || s.phase === 'gameOver';
    const players = s.players.map((p) => {
      const isYou = p.id === viewerId;
      const cards = p.cards.map((c) => ({
        uid: c.uid, faceDown: c.faceDown, revealed: !!c.revealed,
        value: !c.faceDown || isYou || c.revealed || reveal ? c.value : null,
      }));
      return {
        id: p.id, name: p.name, isAI: p.isAI, lives: livesOpen(p.id) ? p.lives : null, alive: p.alive,
        cards, visibleTotal: cards.reduce((t, c) => t + (c.value || 0), 0),
        hiddenCount: cards.filter((c) => c.value === null).length,
        runeCount: isYou || showRuneCount ? p.runes.length : null,
        runes: isYou ? p.runes.map((r) => ({ ...r })) : undefined,
        forfeited: p.forfeited, exceeded: cardTotal(p) > currentTarget(s),
        restrained: this.isRestrained(p), vowed: this.isVowed(p), vowLeft: (this.vowOf(p) || { data: { left: 0 } }).data.left, skipDraw: p.skipDraw,
        doubleDraw: isYou ? p.doubleDraw : undefined,
      };
    });
    const youTurn = s.phase === 'turn' && !s.pending && s.turn === viewerId && !!me && me.alive;
    const drawReason = me ? this.drawBlockReason(me) : 'Spectating';
    const runeInfo = {};
    if (me) for (const r of me.runes) runeInfo[r.uid] = { reason: this.playableReason(me, r), steps: this._steps(me, r) };

    let pending = null;
    if (s.pending) {
      const pd = s.pending;
      if (pd.kind === 'vote') {
        pending = {
          kind: 'vote', casterId: pd.casterId, candidates: pd.candidates, voters: pd.voters,
          voted: s.players.filter((x) => pd.votes[x.id] != null).map((x) => x.id),
        };
      } else {
        pending = {
          kind: 'pick', playerId: pd.playerId,
          cards: pd.playerId === viewerId ? pd.cards.map((c) => ({ uid: c.uid, value: c.value })) : null,
        };
      }
    }

    let roundResult = s.roundResult;
    if (roundResult && !showLives && s.phase !== 'gameOver') {
      roundResult = { ...roundResult, rows: roundResult.rows.map((r) => (r.id === viewerId ? r : { ...r, livesBefore: null, livesAfter: null })) };
    }

    return {
      you: viewerId, phase: s.phase, round: s.round,
      bet: currentBet(s), baseBet: s.baseBet, target: currentTarget(s), defaultTarget: s.config.defaultTarget,
      dir: showDir ? s.dir : 1, reversed: showDir ? s.reversed : false, lastCall: s.lastCall ? { started: s.lastCall.started, left: s.lastCall.left } : null,
      timer: s.turnEnds ? { total: s.turnMs, left: Math.max(0, s.turnEnds - Date.now()) } : null,
      turn: s.turn, deckCount: s.unitDeck.length + s.unitDiscard.length, runeDeckCount: s.runeDeck.length,
      players,
      active: s.active.map((a) => ({ uid: a.uid, runeId: a.runeId, owner: a.owner, data: { ...a.data } })),
      stalled: this.isStalled(),
      pending, lastVote: s.lastVote ? { ...s.lastVote, voters: s.lastVote.voters.slice(), candidates: s.lastVote.candidates.slice(), votes: { ...s.lastVote.votes } } : null,
      roundResult, ready: s.ready.slice(), winnerId: s.winnerId,
      legal: { yourTurn: youTurn, canDraw: youTurn && !drawReason, drawReason: youTurn ? drawReason : null, canStand: youTurn, runes: runeInfo },
      myTotal: me ? cardTotal(me) : 0,
      risk: me && me.alive ? this._risk(me) : null,
      log: s.log.slice(-60),
      twist: s.twist ? { id: s.twist.id, name: s.twist.name, icon: s.twist.icon, desc: s.twist.desc } : null,
      nextTwist: s.phase === 'roundEnd' && s.nextTwist ? { id: s.nextTwist.id, name: s.nextTwist.name, icon: s.nextTwist.icon, desc: s.nextTwist.desc } : null,
      config: { runeHandLimit: this.handLimit(), maxRunesPerTurn: this.maxRunes(), twistPreset: s.config.twistPreset, devMode: s.config.devMode, startingLives: s.config.startingLives, turnDirection: s.config.turnDirection, showDirection: showDir, showLives, showRuneCount, timeoutAction: s.config.timeoutAction, turnTimer: s.config.turnTimer, runeDrawChance: s.config.runeDrawChance, lossFrac: s.config.lossFrac ?? null, onDisconnect: s.config.onDisconnect },
    };
  }
}
