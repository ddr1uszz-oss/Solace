// ---------------------------------------------------------------------------
// GAME SCREEN
//
// Reading order, top to bottom — every element has one job and one place:
//   1. top bar     menu, round, log, sound, fullscreen
//   2. stakes      two compact plaques: the TARGET (hero) and the BET
//   3. opponents   one horizontal strip with EVERY opponent: scroll / swipe / drag / wheel; it follows whoever's turn it is; Tab = full player list
//   4. stage       what just happened (feed) + runes on the table
//   5. you         status + lives, your cards, total meter, Draw / Stand
//   6. rune drawer hidden by default; click / tap the handle above "you" (or press Up) to toggle it; Left / Right browse it; Down / Esc / click away closes it
// Every draw / stand shows a small chip at the seat; rune casts are a non-blocking banner plus a card flying to what it hits.
//
// The screen only renders `session.getView()` and sends `session.send()`
// actions, so it works unchanged with a future network session. Effects are
// driven by the structured events the engine puts on log lines (`line.ev`).
// ---------------------------------------------------------------------------
import { RUNES } from '../engine/runes.js';
import { cardHTML, esc, runeAccent } from './cards.js';
import { createCinema } from './cinema.js';
import { fsSupported, isFs, toggleFs, onFsChange } from './fullscreen.js';
import { createFlights, rectOf } from './flight.js';
import { EASE, DUR, dur } from './motion.js';

const STEP_TITLE = {
  player: 'Choose a player',
  ownCard: 'Choose one of your unit cards',
  active: 'Choose an active rune',
  ownActive: 'Choose one of your active runes',
  ownRune: 'Choose one of your runes to give',
};

const RULES_HTML = `
  <h4>Goal</h4>
  <p>Finish each round with unit cards that total <b>exactly the target</b> (21 unless a New Target rune changes it). Go over and you bust.</p>
  <h4>A round</h4>
  <ul>
    <li>You start with one face-down card (only you can see it) and one face-up card.</li>
    <li>On your turn you may play runes, then <b>Draw</b> a unit card or <b>Stand</b>.</li>
    <li>The round ends when every player stands in a row. Any draw, or any rune played, gives everyone another turn.</li>
    <li>Closest to the target without going over is safe. If everyone busts, the smallest overshoot is safe. Ties are all safe.</li>
    <li>Everyone else loses lives equal to the <b>bet</b>. The bet rises every round, and runes can raise or lower it.</li>
  </ul>
  <h4>Runes</h4>
  <ul>
    <li><b>Active</b> runes stay on the table for the round. Destroy them and their effect ends.</li>
    <li><b>Instant</b> runes resolve immediately and are discarded.</li>
    <li>You draw a new rune at the start of each round (hand limit applies). A normal draw can also hand you a free rune.</li>
    <li>Turn order runs clockwise, counter-clockwise or alternates each round, depending on the table\u2019s settings (the table can also hide it). Reverse flips it once.</li>
    <li>The table can hide lives: then you only see your own until the game is over.</li>
    <li>If a turn timer is on, you stand automatically when it runs out.</li>
    <li><b>Round twists</b> (optional) change the rules for a single round: a new target, a doubled bet, tighter rune limits, extra or rarer runes, a faster timer. The next one is shown on the results screen, and the current one stays in the top bar.</li>
  </ul>`;

const svg = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  on: svg('<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>'),
  off: svg('<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  fsOn: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  fsOff: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  card: svg('<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M12 9v6M9 12h6"/>'),
  hand: svg('<path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L4 14.5a1.5 1.5 0 012.4-1.8L8 14"/>'),
  spark: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor"/><path d="M19 16v4M17 18h4"/>'),
  chev: svg('<path d="M6 15l6-6 6 6"/>'),
  users: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5a3 3 0 010 6M18 14c2 .8 3 2.700 3 6"/>'),
  chevL: svg('<path d="M15 6l-6 6 6 6"/>'),
  chevR: svg('<path d="M9 6l6 6-6 6"/>'),
  cw: svg('<path d="M20 12a8 8 0 11-2.6-5.9"/><path d="M20 4v5h-5"/>'),
  ccw: svg('<path d="M4 12a8 8 0 102.6-5.9"/><path d="M4 4v5h5"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
  log: svg('<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
  flag: svg('<path d="M5 21V4m0 1h12l-2 4 2 4H5"/>'),
  note: svg('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z"/><path d="M14 7l3 3"/>'),
};
// Quick "next play" guesses for the Tab notes (tap to toggle, nothing to type).
const NOTE_TAGS = [['draw', 'Will draw'], ['stand', 'Will stand'], ['rune', 'Has a rune'], ['bluff', 'Bluffing'], ['threat', 'Watch out']];
const NOTE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const TIER_NAME = { 1: 'Common', 2: 'Rare', 3: 'Epic', 4: 'Special' };

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

export function mountGame(root, session, { onExit, toast, audio, fx }) {
  const sfx = audio.sfx;
  const reduced = fx.reduced;
  const ui = { xfer: null, aimed: null, playRect: null, inspect: null, choose: null, panel: null, outcomePending: false, drawer: false, userScroll: 0, lastTurn: null, runeSel: 0, preview: false, pop: null, busy: false, lastChip: null, lastCast: null, notes: {}, noteOpen: null, runePick: false, myVote: null, reveal: null, voteSeen: false, dockShown: false, stOpen: null, pvFx: null, fan: false };
  const PREFS = 'solace.ui';
  const prefs = (() => { try { return { follow: true, ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch { return { follow: true }; } })();
  const setPref = (k, v) => { prefs[k] = v; try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* private mode */ } };
  const seen = new Set();          // card uids already dealt in
  const hold = new Set();          // active-rune uids hidden until their cast moment ends
  const hiddenUids = new Set();    // card uids last seen face-down (to animate the flip)
  const animated = new Set();      // feed line ids that already slid in
  const inFlight = new Set();      // unit card uids currently travelling (real card stays hidden until it lands)
  const knownUnits = new Set();    // every unit card uid we have already seen anywhere at the table
  const freshUnits = new Set();    // uids that arrived in the latest view and still need their deck flight
  const knownRunes = new Set();    // my rune uids already revealed
  const runeHold = new Set();      // my rune uids hidden in the drawer until their reveal lands
  const oppRunes = new Map();      // opponent id -> rune count last seen (to fly a card from the rune deck)
  const lastRects = new Map();     // uid -> { rect, spec } of every card on screen after the last render (effects find cards the next view removes)
  const lifeHold = new Map();      // pid -> lives kept on screen until the round-end drain plays
  const ghosts = new Map();        // predicted flights waiting for the server: 'draw' and 'rune:<uid>'
  const flights = createFlights({ layer: document.getElementById('flights'), reduced });
  let view = session.getView();
  const prev = { lastLog: view.log.length ? view.log[view.log.length - 1].id : 0, over: false, turnYou: false, voteShown: false };
  let disposed = false;

  const castLayer = document.getElementById('cast');

  // -------------------------------------------------------------- skeleton
  root.innerHTML = `
    <div class="shell" id="shell">
      <header class="topbar" id="r-top"></header>
      <section class="stakes" id="r-arena" aria-label="Round stakes"></section>
      <section class="opps" id="r-opps" aria-label="Opponents">
        <div class="seats" id="r-seats" tabindex="-1"></div>
        <button class="cue l" data-act="seat-go" aria-hidden="true" tabindex="-1"></button><button class="cue r" data-act="seat-go" aria-hidden="true" tabindex="-1"></button>
        <div class="seat-dots" id="r-dots"></div>
      </section>
      <section class="stage" id="r-stage" aria-label="Table"></section>
      <div class="turntimer" id="r-timer" aria-hidden="true"><i></i></div>
      <footer class="youwrap" id="r-wrap">
        <div class="drawer" id="r-drawer" role="region" aria-label="Your runes" aria-hidden="true"><div id="r-dprev"></div><div id="r-dmain"></div></div>
        <div class="you" id="r-you"></div>
      </footer>
      <div class="pop" id="r-pop"></div>
      <aside class="dock" id="r-dock" aria-label="Players"></aside>
      <div id="r-layer"></div>
    </div>`;
  const shell = root.querySelector('#shell');
  const R = (k) => root.querySelector('#r-' + k);
  const cinemaLayer = document.getElementById('cinema') || (() => { const d = document.createElement('div'); d.id = 'cinema'; document.body.appendChild(d); return d; })();
  const cinema = createCinema({ layer: cinemaLayer, fx, shell });

  /** Replace a region's markup only when it changed, keeping scroll positions and keyboard focus.
   *  A refresh of something already on screen (same `kind`) gets the `rr` class so its entrance animation does not replay. */
  const FOCUSABLE = 'button:not(:disabled), [tabindex]:not([tabindex="-1"]), a[href]';
  const focusId = (f) => { const d = f.dataset; return `${d.act || ''}|${d.id || d.uid || d.v || d.t || d.r || ''}`; };
  function put(k, html, kind) {
    const el = R(k);
    if (el.__h === html) return false;
    const refresh = !!el.__h && !!html && el.__k === kind;
    el.classList.toggle('rr', refresh);
    el.__h = html; el.__k = kind;
    const sl = el.scrollLeft, st = el.scrollTop;
    const hands = [...el.querySelectorAll('.hand, .dr-cards, .active-row, .np-runes')].map((h) => h.scrollLeft);
    const inner = [...el.querySelectorAll('.sheet, .loglist, .pl-list')].map((x) => ({ top: x.scrollTop, end: x.scrollHeight - x.clientHeight - x.scrollTop < 28 }));
    const f = document.activeElement, keepFocus = (k === 'layer' || k === 'dock' || k === 'dmain' || k === 'dprev') && f && f !== el && el.contains(f) && refresh
      ? { id: focusId(f), idx: [...el.querySelectorAll(FOCUSABLE)].indexOf(f) } : null;
    el.innerHTML = html;
    el.scrollLeft = sl; el.scrollTop = st;
    el.querySelectorAll('.hand, .dr-cards, .active-row, .np-runes').forEach((h, i) => { h.scrollLeft = hands[i] || 0; });
    if (refresh) el.querySelectorAll('.sheet, .loglist, .pl-list').forEach((x, i) => { const o = inner[i]; if (o) x.scrollTop = o.end && x.classList.contains('loglist') ? x.scrollHeight : o.top; });
    if (keepFocus) {
      const list = [...el.querySelectorAll(FOCUSABLE)];
      const t = list.find((b) => focusId(b) === keepFocus.id && keepFocus.id !== '|') || list[Math.max(0, Math.min(keepFocus.idx, list.length - 1))];
      if (t) t.focus({ preventScroll: true });
    }
    return true;
  }

  // --------------------------------------------------------------- helpers
  const nameOf = (id) => (view.players.find((p) => p.id === id) || { name: '?' }).name;
  const you = () => view.players.find((p) => p.id === view.you);

  function unitCard(c, { mine = false, cls = '' } = {}) {
    const hidden = c.value === null;
    if (hidden) hiddenUids.add(String(c.uid));
    const k = [mine && c.faceDown && !c.revealed ? 'peek' : '', c.faceDown && c.revealed ? 'revealed' : '', inFlight.has(String(c.uid)) ? 'held' : '', cls].join(' ');
    return cardHTML(hidden ? { kind: 'unit-back' } : { kind: 'unit', value: c.value }, { cls: k, uid: c.uid });
  }
  const runeCard = (runeId, { uid = null, cls = '' } = {}) => cardHTML({ kind: 'rune', runeId }, { cls, uid });

  // --------------------------------------------------------------- regions
  function dirChip() {
    if (view.config.showDirection === false) return '';
    const ccw = view.dir < 0, name = ccw ? 'Counter-clockwise' : 'Clockwise';
    return `<span class="dirchip ${view.reversed ? 'rev' : ''}" title="Turn order: ${name}${view.reversed ? ' (reversed this round)' : ''}" aria-label="Turn order ${name}">${ccw ? ICON.ccw : ICON.cw}</span>`;
  }
  /** The round's twist: a chip you can click (or press T) to read what it does. */
  function twistChip() {
    const t = view.twist;
    return t ? `<button class="twistchip" data-act="twist" aria-haspopup="dialog" aria-expanded="${ui.pop === 'twist'}" aria-label="Round twist: ${esc(t.name)}. Click to read."><b aria-hidden="true">${esc(t.icon)}</b><span>${esc(t.name)}</span></button>` : '';
  }
  const aliveN = () => view.players.filter((p) => p.alive).length;
  function topHTML() {
    const snd = audio.settings().sfx, fs = isFs();
    return `
      <div class="tb-l"><button class="iconbtn" data-act="menu" aria-label="Menu">${ICON.menu}</button><span class="rnd">Round <b>${view.round}</b></span>${dirChip()}${twistChip()}</div>
      <div class="tb-r">
        <button class="iconbtn plbtn" data-act="panel-players" aria-label="Players (Tab): ${aliveN()} of ${view.players.length} remaining" aria-pressed="${ui.panel === 'players'}" title="Players (Tab) \u00b7 ${aliveN()} of ${view.players.length} still in">${ICON.users}<span class="pcnt"><b>${aliveN()}</b>/${view.players.length}</span></button>
        <button class="iconbtn" data-act="panel-log" aria-label="Match log" title="Match log">${ICON.log}</button>
        <button class="iconbtn" data-act="sound" aria-label="Sound ${snd ? 'on' : 'off'}" aria-pressed="${snd}">${snd ? ICON.on : ICON.off}</button>
        ${fsSupported() ? `<button class="iconbtn" data-act="fs" aria-label="${fs ? 'Exit full screen' : 'Full screen'}">${fs ? ICON.fsOff : ICON.fsOn}</button>` : ''}
      </div>`;
  }

  /** The two numbers that decide everything: compact plaques, always in the same place. */
  function arenaHTML() {
    const custom = view.target !== view.defaultTarget;
    return `
      <span class="sr">Get closest to ${view.target} without going over to stay safe. Everyone else loses ${view.bet} lives.</span>
      <div class="stake target ${custom ? 'custom' : ''}" aria-label="Target ${view.target}">
        <div class="sunburst" aria-hidden="true"></div>
        <div class="st-l"><span class="lbl">${custom ? 'New target' : 'Target'}</span></div>
        <div class="num">${view.target}</div>
      </div>
      <div class="stake bet" aria-label="Bet ${view.bet}">
        <div class="st-l"><span class="lbl">Bet</span></div>
        <div class="bnum"><span class="heart">&#9829;</span>${view.bet}</div>
      </div>
      ${view.lastCall ? `<div class="lastcall" role="status">${ICON.flag}<span>Wrap</span><em>${view.lastCall.started ? `${view.lastCall.left} left` : 'last lap'}</em></div>` : ''}`;
  }

  // Each player keeps one colour for the whole match, so "who did that" reads at a glance.
  const PCOL = ['#19c2c9', '#e0a24f', '#b98bf5', '#6fd08c', '#f08a8a', '#6aa8f5', '#e0c35a', '#e88fc4', '#8fd3c8', '#c9a27a'];
  const colorOf = (id) => PCOL[Math.max(0, view.players.findIndex((p) => p.id === id)) % PCOL.length];
  /** Lives can be hidden by the table rules: null means "not yours to see". */
  const shown = (p) => (lifeHold.has(p.id) ? lifeHold.get(p.id) : p.lives);      // lives as drawn right now (round-end drains animate to the real value)
  const livesKnown = (p) => shown(p) != null;
  const livesPct = (p) => (livesKnown(p) ? Math.max(0, Math.min(100, (shown(p) / view.config.startingLives) * 100)) : 0);
  const livesTxt = (p) => (livesKnown(p) ? shown(p) : '?');
  const oppList = () => view.players.filter((p) => p.id !== view.you);
  /** Opponents drawn on the table: players who are out only show in the Tab list (until the round-end show is over, so their verdict can still play). */
  const seatList = () => oppList().filter((p) => p.alive || ui.outcomePending);
  const strip = () => R('seats');
  /** Every opponent lives in one scrollable strip. Seats are patched one by one, so the strip itself (and a swipe in progress) is never replaced. */
  function patchSeats() {
    const o = seatList(), st = strip(), want = o.map((p) => String(p.id));
    st.classList.toggle('many', o.length > 3);
    st.dataset.n = o.length;
    for (const p of o) {
      const html = seatHTML(p);
      let el = seatEl(p.id);
      if (el && el.__h === html) continue;
      const t = document.createElement('template'); t.innerHTML = html.trim();
      const fresh = t.content.firstElementChild; fresh.__h = html;
      if (el) el.replaceWith(fresh); else st.appendChild(fresh);
    }
    [...st.children].forEach((c) => { if (!want.includes(c.dataset.seat)) c.remove(); });
    want.forEach((id, i) => { const c = seatEl(id); if (c && st.children[i] !== c) st.insertBefore(c, st.children[i] || null); });
    put('dots', o.length > 3 ? o.map((p) => `<button class="dot" data-act="seat-go" data-id="${esc(p.id)}" style="--pc:${colorOf(p.id)}" aria-label="Show ${esc(p.name)}" title="${esc(p.name)}"></button>`).join('') : '');
    paintStrip();
  }
  /** Which seats are in view, which way the strip can still scroll, and a cue when the active player is off screen. */
  function paintStrip() {
    const st = strip(), box = R('opps'); if (!st) return;
    const r = st.getBoundingClientRect(), more = st.scrollWidth - st.clientWidth > 4;
    box.dataset.l = more && st.scrollLeft > 4 ? '1' : '';
    box.dataset.r = more && st.scrollLeft < st.scrollWidth - st.clientWidth - 4 ? '1' : '';
    let actSide = '', actName = '';
    st.querySelectorAll('.seat').forEach((el, i) => {
      const b = el.getBoundingClientRect(), vis = b.right > r.left + 12 && b.left < r.right - 12;
      const dot = R('dots').children[i]; if (dot) { dot.classList.toggle('on', vis); dot.classList.toggle('act', el.classList.contains('turn')); }
      if (el.classList.contains('turn') && !vis) { actSide = b.left < r.left ? 'l' : 'r'; actName = el.querySelector('.nm').textContent; actSeat = el.dataset.seat; }
    });
    box.querySelectorAll('.cue').forEach((c) => { const on = c.classList.contains(actSide); c.classList.toggle('show', on); c.dataset.id = on ? actSeat : ''; c.innerHTML = on ? `${actSide === 'l' ? ICON.chevL : ''}<span>${esc(actName)}</span>${actSide === 'r' ? ICON.chevR : ''}` : ''; });
  }
  let actSeat = '';
  /** Bring a seat into view. instant = true when a flight is about to measure it. */
  function showSeat(id, { instant = false, user = false } = {}) {
    const st = strip(), el = id && seatEl(id); if (!st || !el || st.scrollWidth <= st.clientWidth + 4) return;
    if (user) ui.userScroll = performance.now();
    const left = el.offsetLeft - (st.clientWidth - el.offsetWidth) / 2;
    st.scrollTo({ left: Math.max(0, Math.min(left, st.scrollWidth - st.clientWidth)), behavior: instant || reduced ? 'instant' : 'smooth' });
  }
  /** Follow the action: when the turn moves to an opponent who is not fully on screen, glide to them (unless you scrolled in the last few seconds). */
  function followTurn() {
    if (view.phase !== 'turn' || view.turn === ui.lastTurn) return;
    ui.lastTurn = view.turn;
    if (!prefs.follow || view.turn === view.you || performance.now() - ui.userScroll < 4000) return;
    const el = seatEl(view.turn), st = strip(); if (!el || !st) return;
    const a = el.getBoundingClientRect(), b = st.getBoundingClientRect();
    if (a.left < b.left + 6 || a.right > b.right - 6) showSeat(view.turn);
  }
  const seatEl = (pid) => root.querySelector(`[data-seat="${CSS.escape(String(pid))}"]`);

  function seatHTML(p) {
    const isTurn = view.phase === 'turn' && view.turn === p.id && !view.pending;
    const pct = livesPct(p);
    const cards = p.cards.map((c) => {
      const attrs = c.value !== null ? `data-act="inspect-unit" data-v="${c.value}"` : '';
      return `<div ${attrs}>${unitCard(c)}</div>`;
    }).join('');
    const chips = [
      p.restrained ? '<span class="chip warn">Restrained</span>' : '',
      p.skipDraw ? '<span class="chip warn">Skips draw</span>' : '',
      p.forfeited ? '<span class="chip warn" title="Ran out of time: no more turns this round">Forfeited</span>' : '',
      p.vowed ? `<span class="chip lock" title="Vow: stands automatically and can\u2019t be targeted">${ICON.lock}Vow \u00b7 ${p.vowLeft}</span>` : '',
      !p.alive ? '<span class="chip warn">Out</span>' : '',
      noteN(p.id) ? `<span class="chip note" title="Your notes on ${esc(p.name)}">${ICON.note}${noteN(p.id)}</span>` : '',
    ].join('');
    return `
    <div class="seat ${isTurn ? 'turn' : ''} ${p.alive ? '' : 'out'}" data-seat="${esc(p.id)}" style="--pc:${colorOf(p.id)}">
      <div class="s-top"><span class="nm">${esc(p.name)}</span>
        ${p.runeCount == null ? '' : `<span class="rc" data-rc title="Runes in hand">${cardHTML({ kind: 'rune-back' })}${p.runeCount}</span>`}
        <span class="life ${livesKnown(p) && pct <= 30 ? 'low' : ''}" title="${livesKnown(p) ? 'Lives' : 'Lives are hidden'}"><span class="heart">&#9829;</span><i>${livesTxt(p)}</i></span></div>
      ${livesKnown(p) ? `<div class="lifebar"><span style="width:${pct}%"></span></div>` : ''}
      <div class="s-row"><div class="s-cards">${cards || '<span class="empty">No cards</span>'}</div>
        <span class="tot" title="Total of the cards you can see"><b>${p.visibleTotal}</b>${p.hiddenCount ? '<em>+?</em>' : ''}</span></div>
      ${chips ? `<div class="s-foot">${chips}</div>` : ''}
      ${isTurn ? '<span class="pointer" aria-hidden="true"></span>' : ''}
    </div>`;
  }

  /** A scroll rail under a sideways row: arrows, a draggable thumb and edge fades. Painted by paintRails(). */
  const railHTML = () => `<div class="rail" aria-hidden="true"><button class="rl" data-rail="-1" tabindex="-1" aria-label="Scroll left">${ICON.chevL}</button><div class="rtrack"><i class="rthumb"></i></div><button class="rl" data-rail="1" tabindex="-1" aria-label="Scroll right">${ICON.chevR}</button></div>`;
  const EV_ICON = { draw: 'card', stand: 'hand', rune: 'spark', roundStart: 'flag' };
  function feedHTML() {
    const lines = view.log.slice(-1);
    return `<ol class="feed" aria-live="polite" data-act="panel-log" title="Open the match log">${lines.map((l, i) => {
      const t = (l.ev && l.ev.t) || '';
      const ic = EV_ICON[t] ? `<span class="fi">${ICON[EV_ICON[t]]}</span>` : '';
      return `<li class="${i === 0 ? 'new' : ''} ${l.big ? 'big' : ''} ev-${t}" data-lid="${l.id}">${ic}<span>${esc(l.text)}</span></li>`;
    }).join('')}</ol>`;
  }

  function trayHTML() {
    const items = view.active.map((a) => {
      const d = a.data || {};
      let cap = esc(nameOf(a.owner));
      if (d.targetId) cap += ` \u2192 ${esc(nameOf(d.targetId))}`;
      if (a.runeId === 'exile' && d.exiledId) cap += ` \u2192 ${esc(nameOf(d.exiledId))}`;
      if (a.runeId === 'vow' && d.left > 0) cap += ` \u00b7 ${d.left} turn${d.left === 1 ? '' : 's'} left`;
      const spent = a.runeId === 'stall' && d.expired;
      const held = hold.has(a.uid);
      return `<button class="active-item ${held ? 'held' : ''}" data-act="inspect-rune-id" data-id="${a.runeId}" aria-label="${esc(RUNES[a.runeId].name)}">
        ${runeCard(a.runeId, { uid: a.uid, cls: `${spent ? 'spent' : ''} ${held ? 'held' : ''}` })}<span>${cap}${spent ? ' (spent)' : ''}</span></button>`;
    }).join('');
    return `<div class="tray">
      <div class="decks">
        <div class="deckpile" data-deck aria-label="${view.deckCount} unit cards left in the deck">${cardHTML({ kind: 'unit-back' }, { cls: 'pile' })}<span class="dcount">${view.deckCount}</span><em class="dlbl">Units</em></div>
        <div class="deckpile runes" data-rdeck aria-label="${view.runeDeckCount} rune cards left in the deck">${cardHTML({ kind: 'rune-back' }, { cls: 'pile' })}<span class="dcount">${view.runeDeckCount}</span><em class="dlbl">Runes</em></div>
      </div>
      <div class="railed table-rail"><div class="active-row">${items || `<span class="empty" aria-label="No active runes">${ICON.spark}</span>`}</div>${railHTML()}</div>
    </div>`;
  }

  function coach() {
    const me = you(), p = view.pending, live = view.legal;
    if (view.phase === 'gameOver') return { kind: 'info', title: 'Game over', sub: '' };
    if (view.phase === 'roundEnd') return { kind: 'info', title: 'Round over', sub: '' };
    if (!me.alive) return { kind: 'info', title: 'You are out', sub: 'watching' };
    if (p && p.kind === 'vote') return { kind: p.voters.includes(view.you) && !p.voted.includes(view.you) ? 'you' : 'wait', title: 'Exile vote', sub: `${p.voted.length}/${p.voters.length} voted` };
    if (p && p.kind === 'pick') return p.playerId === view.you ? { kind: 'you', title: 'Choose a card', sub: 'keep one' } : { kind: 'wait', title: `${nameOf(p.playerId)} is choosing`, sub: 'Double Draw', dots: true };
    if (live.yourTurn) {
      const sub = me.skipDraw ? 'skip draw \u2014 rune or stand' : me.restrained ? 'restrained \u2014 destroy runes only' : 'Draw or Stand';
      return { kind: 'you', title: 'Your turn', sub };
    }
    const t = view.players.find((x) => x.id === view.turn);
    return { kind: 'wait', title: `${nameOf(view.turn)}${t && t.isAI ? ' is thinking' : '\u2019s turn'}`, sub: '', dots: true };
  }

  const lowLives = (p) => p.lives <= Math.max(2, Math.ceil(view.config.startingLives * 0.3));
  const playable = () => (you().runes || []).filter((r) => { const i = view.legal.runes[r.uid]; return i && !i.reason; }).length;

  /** Your total counts only cards that have landed in your hand, so a new round (or a Reset) builds it up card by card. */
  const shownTotal = () => you().cards.reduce((t, c) => t + (c.value && !inFlight.has(String(c.uid)) && !freshUnits.has(String(c.uid)) ? c.value : 0), 0);
  /** What is in force on the table and on you (Bless, Restrain, Stall ...). Only the titles show; tap one to read what it does. */
  function statusItems() {
    const me = you();
    if (!me || !me.alive || view.phase !== 'turn') return [];
    const out = [];
    const add = (k, cls, label, text) => out.push({ k, cls, label, text });
    if (me.forfeited) add('forfeited', 'bad', 'Forfeited', 'You ran out of time: no more turns, and you lose the bet.');
    if (me.restrained) add('restrained', 'bad', 'You are restrained', 'You can only play Destroy runes, and you can\u2019t draw runes.');
    if (me.vowed) add('vowed', 'bad', `Vow \u00b7 ${me.vowLeft}`, 'You stand automatically and can\u2019t be targeted.');
    if (me.skipDraw) add('skipdraw', 'warn', 'Skipping your draw', 'Play a rune or stand this turn.');
    if (me.exceeded) add('over', 'warn', 'Over the target', 'No normal draws (draw runes still work).');
    for (const a of view.active) {
      const d = RUNES[a.runeId];
      if (a.runeId === 'stall' && a.data.expired) continue;
      const aimed = a.data && a.data.targetId === view.you;
      add('a' + a.uid, aimed ? 'bad' : '', `${d.name}${aimed ? ' on you' : ''} \u00b7 ${nameOf(a.owner)}`, d.text);
    }
    return out;
  }
  function statusHTML() {
    const items = statusItems();
    if (ui.stOpen && !items.some((x) => x.k === ui.stOpen)) ui.stOpen = null;
    if (!items.length) return '';
    const open = items.find((x) => x.k === ui.stOpen);
    return `<div class="statuswrap"><div class="statusbar" role="group" aria-label="What is in effect">${items.map((x) => `<button type="button" class="st ${x.cls} ${open === x ? 'open' : ''}" data-act="status" data-k="${esc(x.k)}" aria-expanded="${open === x}" title="${esc(x.text)}"><b>${esc(x.label)}</b></button>`).join('')}</div>${open ? `<div class="st-pop ${open.cls}" role="status"><b>${esc(open.label)}</b><span>${esc(open.text)}</span></div>` : ''}</div>`;
  }
  function youHTML() {
    const me = you(), live = view.legal, cp = coach();
    const tot = shownTotal(), over = tot - view.target;
    let note = '';
    if (over > 0) note = `<span class="over">bust +${over}</span>`;
    else if (over === 0) note = '<span class="exact">on target</span>';

    const fill = Math.max(0, Math.min(100, (tot / view.target) * 100));
    const mstate = over > 0 ? 'over' : over === 0 ? 'exact' : fill >= 80 ? 'warm' : '';
    const cards = me.cards.map((c) => `<button data-act="inspect-unit" data-v="${c.value}" aria-label="Unit card ${c.value}${c.faceDown && !c.revealed ? ', hidden from others' : ''}">${unitCard(c, { mine: true })}</button>`).join('');
    const nRunes = me.runes ? me.runes.length : 0, ready = live.yourTurn ? playable() : 0;
    const why = live.yourTurn && live.drawReason ? esc(live.drawReason) : '';
    return `
      <button class="rune-handle ${ready ? 'ready' : ''}" data-act="drawer" aria-controls="r-drawer" aria-keyshortcuts="ArrowUp ArrowDown" title="Your runes (Up to open, Down to close)">
        <span class="rh-ic">${ICON.spark}</span><span class="rh-t">Runes</span><span class="rh-n">${nRunes}<i>/${view.config.runeHandLimit}</i></span>${ready ? `<span class="rh-dot" title="${ready} playable"></span>` : ''}<span class="rh-chev">${ICON.chev}</span>
      </button>
      ${statusHTML()}
      <div class="y-bar">
        <div class="coach ${cp.kind}" role="status">
          <span class="c-title">${esc(cp.title)}${cp.dots ? '<span class="dots"><i></i><i></i><i></i></span>' : ''}</span>
          ${cp.sub ? `<span class="c-sub">${esc(cp.sub)}</span>` : ''}
          ${view.timer ? '<b class="tcount" title="Time left to act"></b>' : ''}
        </div>
        <div class="y-life ${lowLives(me) ? 'low' : ''}" title="Your lives"><span class="heart">&#9829;</span><b>${livesTxt(me)}</b></div>
      </div>
      <div class="y-row">
        <div class="hand" aria-label="Your unit cards">${cards || '<span class="none">None</span>'}</div>
        <div class="y-total ${mstate}">
          <div class="yt-row"><b id="mytotal">${tot}</b><span class="yt-of">/ ${view.target}</span><span class="y-note">${note}</span></div>
          <div class="meter" aria-hidden="true"><span style="width:${fill}%"></span></div>
        </div>
        <div class="acts ${live.yourTurn ? '' : 'off'}" role="group" aria-label="Your move">
          <button class="act draw ${live.yourTurn && !live.canDraw ? 'nodraw' : ''}" data-act="draw" ${why ? `title="${why}"` : 'title="Draw a card (\u2190 or D)"'} aria-disabled="${!live.yourTurn || !live.canDraw}">
            <span class="a-ic">${ICON.card}</span><span class="a-t"><b>Draw</b>${live.yourTurn && !live.canDraw ? '<small>not now</small>' : ''}</span><kbd>\u2190</kbd>
          </button>
          <button class="act stand" data-act="stand" title="Stand with ${tot} (\u2192 or S)" aria-disabled="${!live.yourTurn}">
            <span class="a-ic">${ICON.hand}</span><span class="a-t"><b>Stand</b><small>${tot}</small></span><kbd>\u2192</kbd>
          </button>
        </div>
      </div>`;
  }

  /** Rune hand: a drawer that slides up over the table. Left / Right browse, Up previews the selected card, Down closes. */
  const runeBtns = () => [...root.querySelectorAll('#r-dmain .dr-cards > button')];
  function previewHTML() {
    const me = you(), live = view.legal, list = me.runes || [], cur = list[ui.runeSel];
    if (!(ui.drawer && ui.preview && cur)) return '';
    const d = RUNES[cur.runeId], info = live.runes[cur.uid], ok = info && !info.reason;
    const nav = (dir, ic) => (list.length > 1 ? `<button type="button" class="drp-nav ${dir < 0 ? 'l' : 'r'}" data-act="rune-nav" data-d="${dir}" aria-label="${dir < 0 ? 'Previous' : 'Next'} rune">${ic}</button>` : '');
    return `<div class="dr-preview t${d.tier}" style="--accent:${runeAccent(cur.runeId)}">
        ${nav(-1, ICON.chev)}
        <div class="drp-card">${runeCard(cur.runeId)}</div>
        <div class="drp-info"><span class="drp-kind">${TIER_NAME[d.tier]} \u00b7 ${d.kind === 'active' ? 'stays on the table' : 'instant'}${d.destroy ? ' \u00b7 destroy' : ''}${list.length > 1 ? `<em class="drp-n">${ui.runeSel + 1} / ${list.length}</em>` : ''}</span>
          <h4>${esc(d.name)}</h4><p>${esc(d.text)}</p>
          ${info && info.reason ? `<p class="reason">${esc(info.reason)}</p>` : ''}
          <button class="btn primary" data-act="play-sel" ${ok ? '' : 'disabled'}>Play</button></div>
        ${nav(1, ICON.chev)}</div>`;
  }
  function drawerHTML() {
    const me = you(), live = view.legal, list = me.runes || [];
    const runes = list.map((r, i) => {
      const info = live.runes[r.uid];
      const ok = info && !info.reason;
      return `<button class="${ok ? 'ready' : ''}" data-act="inspect-rune" data-uid="${r.uid}" style="--ac:${runeAccent(r.runeId)}" title="${esc(info && info.reason ? info.reason : RUNES[r.runeId].name)}" aria-label="${esc(RUNES[r.runeId].name)}${ok ? '' : ' (unavailable)'}">${runeCard(r.runeId, { uid: r.uid, cls: `${ok || !live.yourTurn ? '' : 'dim'} ${runeHold.has(r.uid) ? 'held' : ''}` })}<span class="rn">${esc(RUNES[r.runeId].name)}</span></button>`;
    }).join('');
    return `<div class="dr-title">${ICON.spark}<span>Your runes</span><small><kbd>\u2190</kbd><kbd>\u2192</kbd> browse <kbd>\u2191</kbd> preview <kbd>\u2193</kbd> close <kbd>Space</kbd> play</small></div>
      <div class="railed"><div class="dr-cards runes">${runes || '<span class="none">No runes yet</span>'}</div>${railHTML()}</div>`;
  }
  /** The selected rune is marked in place (not by re-rendering), so the highlight can glide from card to card. */
  function paintSel({ scroll = false } = {}) {
    const bs = runeBtns();
    bs.forEach((b, i) => { const on = ui.drawer && i === ui.runeSel; b.classList.toggle('sel', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    const b = bs[ui.runeSel], sc = b && b.closest('.dr-cards');
    if (scroll && b && sc && ui.drawer) {
      const left = b.offsetLeft - (sc.clientWidth - b.offsetWidth) / 2;
      sc.scrollTo({ left: Math.max(0, left), behavior: reduced ? 'instant' : 'smooth' });
    }
  }
  /** Entrance animations for the drawer (driven by what the player did, so a refresh never replays them). */
  function drawerFx() {
    const fan = ui.fan, pv = ui.pvFx; ui.fan = false; ui.pvFx = null;
    if (reduced) return;
    if (fan) {
      const bs = runeBtns();
      bs.forEach((b, i) => b.animate([{ opacity: 0, transform: `translateY(38px) rotate(${(i - (bs.length - 1) / 2) * 5}deg) scale(.84)` }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 60 + Math.min(i, 9) * 50, easing: EASE.spring, fill: 'backwards' }));
    }
    if (pv != null) {
      const box = root.querySelector('#r-dprev .dr-preview'); if (!box) return;
      const dir = pv.dir || 0, card = box.querySelector('.drp-card'), info = [...box.querySelectorAll('.drp-info > *')];
      if (pv.enter) box.animate([{ opacity: 0, transform: 'translateY(30px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 460, easing: EASE.spring });
      if (card) card.animate([
        { opacity: 0, transform: `perspective(760px) translateX(${dir * 90}px) rotateY(${dir ? dir * -64 : -78}deg) scale(.8)`, filter: 'brightness(2.4)' },
        { opacity: 1, transform: 'perspective(760px) translateX(0) rotateY(6deg) scale(1.05)', filter: 'brightness(1.3)', offset: 0.68 },
        { opacity: 1, transform: 'perspective(760px) none', filter: 'brightness(1)' },
      ], { duration: 640, easing: EASE.out, fill: 'backwards' });
      info.forEach((n, i) => n.animate([{ opacity: 0, transform: `translateX(${dir * 26}px) translateY(12px)` }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 110 + i * 60, easing: EASE.out, fill: 'backwards' }));
      const thumbs = pv.enter ? runeBtns() : [];
      thumbs.forEach((b, i) => b.animate([{ opacity: 0.3, transform: 'translateY(-26px) scale(1.5)' }, { opacity: 1, transform: 'none' }], { duration: 440, delay: i * 28, easing: EASE.spring, fill: 'backwards' }));
    }
  }
  /** Move the selection by `d` (wraps). With the preview open it flips to the new card. */
  function browseRunes(d) {
    const n = runesOf().length; if (n < 1) return;
    const from = ui.runeSel;
    ui.runeSel = ((ui.runeSel + d) % n + n) % n;
    if (ui.runeSel === from && n < 2) return;
    sfx.click();
    ui.pvFx = ui.preview ? { dir: d < 0 ? -1 : 1, enter: false } : null;
    render(); paintSel({ scroll: true });
  }

  // ----------------------------------------------------------------- modals
  const sheet = (inner, { close = true, cls = '', sheetCls = '' } = {}) => `<div class="scrim ${cls}" ${close ? 'data-act="scrim"' : ''}><div class="sheet ${sheetCls}" role="dialog" aria-modal="true">${inner}</div></div>`;

  function inspectHTML() {
    const i = ui.inspect;
    if (i.unit != null) {
      return sheet(`<div class="inspect">${cardHTML({ kind: 'unit', value: i.unit })}<div class="info"><h3>Unit card ${i.unit}</h3><p class="lede">Adds ${i.unit} to your total.</p></div></div>
        <div class="row"><button class="btn" data-act="close">Close</button></div>`);
    }
    const d = RUNES[i.runeId];
    const kind = d.kind === 'active' ? 'Active \u2014 stays on the table for the round' : 'Instant \u2014 resolves, then is discarded';
    let play = '', reason = '';
    if (i.uid != null) {
      const info = view.legal.runes[i.uid];
      if (info && info.reason) reason = `<p class="reason">${esc(info.reason)}</p>`;
      play = `<button class="btn primary" data-act="play" ${info && !info.reason ? '' : 'disabled'}>Play ${esc(d.name)}</button>`;
    }
    return sheet(`<div class="inspect">${runeCard(i.runeId)}
      <div class="info"><span class="kind" style="border-color:${runeAccent(i.runeId)}">${kind}${d.destroy ? ' \u00b7 Destroy-type' : ''}</span>
      <h3>${esc(d.name)}</h3><p class="lede">${esc(d.text)}</p>${reason}</div></div>
      <div class="row">${play}<button class="btn" data-act="close">Close</button></div>`);
  }

  function chooseHTML() {
    const ch = ui.choose, info = view.legal.runes[ch.runeUid];
    const step = info.steps[ch.step];
    const d = RUNES[you().runes.find((r) => r.uid === ch.runeUid).runeId];
    let body;
    if (step.kind === 'player') {
      body = `<div class="choices">${step.options.map((o) => {
        const p = view.players.find((x) => x.id === o.id);
        return `<button class="choice" data-act="choose" data-id="${esc(o.id)}">${esc(p.name)}<span class="meta">&#9829; ${livesTxt(p)} \u00b7 ${p.visibleTotal}${p.hiddenCount ? '+?' : ''} \u00b7 ${p.runeCount} runes</span></button>`;
      }).join('')}</div>`;
    } else if (step.kind === 'ownCard') {
      body = `<div class="choices cards">${step.options.map((o) => `<button class="choice" data-act="choose" data-id="${o.id}">${cardHTML({ kind: 'unit', value: o.value }, { cls: o.faceDown ? 'peek' : '' })}</button>`).join('')}</div>`;
    } else {
      body = `<div class="choices cards">${step.options.map((o) => `<button class="choice" data-act="choose" data-id="${o.id}" aria-label="${esc(RUNES[o.runeId].name)}">${runeCard(o.runeId)}</button>`).join('')}</div>`;
    }
    return sheet(`<h3>${esc(d.name)}</h3><p class="lede">${STEP_TITLE[step.kind]}</p>${body}
      <div class="row"><button class="btn" data-act="choose-back">${ch.step ? 'Back' : 'Cancel'}</button></div>`);
  }

  function voteHTML() {
    // your own vote shows at once (the table can hold the next view back for a moment while a cast animation finishes)
    const p = view.pending, me = view.you, voted = new Set(p.voted); if (ui.myVote != null) voted.add(me);
    const done = voted.has(me), left = p.voters.length - voted.size;
    const voters = `<ul class="vv-list" aria-label="Who has voted">${p.voters.map((id) => `<li class="vv ${voted.has(id) ? 'in' : ''} ${id === me ? 'me' : ''}" style="--pc:${colorOf(id)}"><i aria-hidden="true"></i><span>${id === me ? 'You' : esc(nameOf(id))}</span><em>${voted.has(id) ? 'voted' : 'thinking'}</em></li>`).join('')}</ul>`;
    const cands = p.candidates.map((id) => {
      const mine = done && String(ui.myVote) === String(id);
      return `<button class="choice vc ${mine ? 'mine' : ''}" data-act="vote" data-id="${esc(id)}" style="--pc:${colorOf(id)}" ${done ? 'disabled' : ''}><i class="vc-dot" aria-hidden="true"></i><span>${esc(nameOf(id))}</span>${mine ? '<em>Your vote</em>' : ''}</button>`;
    }).join('');
    const status = done
      ? `<p class="vv-wait" role="status">Vote cast. ${left ? `Waiting for ${left} more` : 'Counting'}<span class="dots"><i></i><i></i><i></i></span></p>`
      : `<p class="vv-wait" role="status">${left === 1 ? 'You are the last vote' : `${voted.size} of ${p.voters.length} voted`}</p>`;
    return sheet(`<h3>Exile</h3><p class="lede">${esc(nameOf(p.casterId))} cast Exile. Vote for who is exiled \u2014 they skip their next draw and discard a rune. ${esc(nameOf(p.casterId))} is immune.</p>
      ${voters}<div class="choices vcs ${done ? 'locked' : ''}">${cands}</div>${status}`, { close: false, cls: ui.voteSeen ? 'still' : '' });
  }

  /** The count, then the verdict. The markup is built once from the finished vote, so re-renders never restart the animation (CSS delays do the timing). */
  const revealTiming = (v) => { const order = v.voters.filter((id) => v.votes[id] != null), T = 0.55 + order.length * 0.3 + 0.5; return { order, T }; };
  function revealHTML() {
    const v = ui.reveal.v, { order, T } = revealTiming(v), me = view.you;
    const cnt = {}; Object.values(v.votes).forEach((t) => { cnt[t] = (cnt[t] || 0) + 1; });
    const top = Math.max(0, ...Object.values(cnt)), tied = Object.keys(cnt).filter((k) => cnt[k] === top).length > 1;
    const tiles = v.candidates.map((id) => {
      const got = order.map((vid, k) => ({ vid, k })).filter((o) => String(v.votes[o.vid]) === String(id)), win = String(id) === String(v.exiledId);
      return `<div class="vr-c ${win ? 'win' : 'lose'}" style="--pc:${colorOf(id)};--T:${T}s"><span class="vr-nm">${esc(nameOf(id))}</span>
        <span class="vr-pips">${got.map((o) => `<i style="--pc:${colorOf(o.vid)};--d:${(0.55 + o.k * 0.3).toFixed(2)}s" title="${esc(nameOf(o.vid))}"></i>`).join('') || '<em>no votes</em>'}</span>
        <b class="vr-n">${got.length}</b></div>`;
    }).join('');
    const legend = order.map((id) => `<li style="--pc:${colorOf(id)}"><i></i>${id === me ? 'You' : esc(nameOf(id))}</li>`).join('');
    const exiledYou = String(v.exiledId) === String(me);
    return sheet(`<div class="vr-k">The votes are in</div><div class="vr-grid">${tiles}</div><ul class="vr-legend" aria-label="Voters">${legend}</ul>
      <div class="vr-slam" style="--T:${T}s;--pc:${colorOf(v.exiledId)}" role="status"><small>${exiledYou ? 'You are exiled' : 'Exiled'}</small><b>${exiledYou ? 'You' : esc(nameOf(v.exiledId))}</b><span>Skips the next draw and discards a rune.</span>${tied ? '<em>Tie \u2014 settled at random.</em>' : ''}</div>
      <div class="row"><button class="btn primary vr-go" style="--T:${T}s" data-act="reveal-end">Continue</button></div>`, { close: false, cls: 'reveal', sheetCls: 'vreveal' });
  }

  function pickHTML() {
    const p = view.pending;
    return sheet(`<h3>Double Draw</h3><p class="lede">Keep one card. The other goes back into the deck.</p>
      <div class="pickpair">${p.cards.map((c) => `<button data-act="pick" data-id="${c.uid}" aria-label="Keep ${c.value}">${cardHTML({ kind: 'unit', value: c.value })}</button>`).join('')}</div>`, { close: false });
  }

  function myOutcome() {
    const r = view.roundResult; if (!r) return null;
    const row = r.rows.find((x) => x.id === view.you);
    if (!row) return { kind: 'watch', word: 'Round over', sub: '' };
    const final = view.phase === 'gameOver';
    if (final && view.winnerId === view.you) return { kind: 'victory', word: 'Victory', sub: 'Last one standing.', row };
    if (row.eliminated) return { kind: 'out', word: final ? 'Defeat' : 'Eliminated', sub: `You lost your last ${row.loss} \u2665.`, row };
    if (row.safe) return { kind: 'safe', word: 'Safe', sub: !row.winner ? `${row.total} \u2014 not among the worst.` : row.dist === 0 ? `Exactly ${r.target}.` : `${row.total} \u2014 closest to ${r.target}.`, row };
    if (row.bust) return { kind: 'bust', word: 'Bust', sub: `${row.total} is ${row.dist} over ${r.target}. You lose ${row.loss} \u2665.`, row };
    return { kind: 'lost', word: `\u2212${row.loss} \u2665`, sub: `${row.total} \u2014 ${row.dist} short of ${r.target}.`, row };
  }

  function resultsHTML(final) {
    const r = view.roundResult, o = myOutcome();
    const rows = [...r.rows].sort((a, b) => a.rank - b.rank).map((x, ix) => {
      const out = x.safe ? '<span class="win">Safe</span>' : '<span class="lose">Lost</span>';
      const bust = x.bust ? ' \u00b7 bust' : '';
      const delta = x.loss ? `&minus;${x.loss} &#9829;` : '';
      const notes = x.notes.map((nn) => `<span class="note">${esc(nn)}</span>`).join('');
      const mini = x.cards.map((c) => cardHTML({ kind: 'unit', value: c.value })).join('');
      return `<tr class="${x.id === view.you ? 'me' : ''} ${x.safe ? 'ok' : 'bad'}" style="--i:${ix}"><td><span class="nm">${esc(x.name)}</span>${x.eliminated ? ' <span class="chip warn">Out</span>' : ''}<div class="mini">${mini}</div></td>
        <td>${x.total}${bust}<span class="note">${x.dist === 0 ? 'exact' : `${x.dist} ${x.bust ? 'over' : 'short'}`}</span></td>
        <td>${out}${notes}</td><td class="delta">${delta}${x.livesBefore != null ? `<span class="note">${x.livesBefore} \u2192 ${x.livesAfter}</span>` : ''}</td></tr>`;
    }).join('');
    const hero = o ? `<div class="res-hero ${o.kind}"><div class="big">${esc(o.word)}</div><div class="sub">${esc(o.sub)}</div></div>` : '';
    const head = `<div class="rtitle"><h3>Round ${r.round}</h3><span>Target ${r.target} \u00b7 Bet ${r.bet}</span></div>`;
    const nt = '';                                           // the next twist stays secret until the round starts
    const table = `<table class="results"><thead><tr><th>Player</th><th>Total</th><th>Result</th><th>Lives</th></tr></thead><tbody>${rows}</tbody></table>`;
    if (final) {
      const w = view.winnerId ? nameOf(view.winnerId) : null;
      return sheet(`${head}${hero}<p class="lede">${w ? `<b>${esc(w)}</b> is the last one standing.` : 'Nobody survived.'}</p>${table}
        <div class="row"><button class="btn primary" data-act="exit">New game</button></div>`, { close: false });
    }
    const readied = view.ready.includes(view.you);
    return sheet(`${head}${hero}${table}${nt}<div class="row"><button class="btn primary" data-act="ready" ${readied ? 'disabled' : ''}>${readied ? 'Waiting for others\u2026' : 'Next round'}</button></div>`, { close: false });
  }

  /** Players, best health first (a table that hides lives keeps seat order). Docked, never modal: the game keeps running behind it. */
  // ---- Tab notes: guess what each opponent holds / will do. Everything is a tap, nothing is typed.
  const noteOf = (pid) => ui.notes[pid] || (ui.notes[pid] = { c: {}, t: [], r: [] });
  const noteN = (pid) => { const n = ui.notes[pid]; return n ? Object.keys(n.c).length + n.t.length + n.r.length : 0; };
  function noteSummary(pid) {
    const n = ui.notes[pid]; if (!n || !noteN(pid)) return '';
    const bits = [
      ...Object.keys(n.c).map(Number).sort((a, b) => a - b).map((v) => `<span class="ns ${n.c[v] === 'm' ? 'maybe' : 'no'}">${n.c[v] === 'm' ? '?' : '\u2715'}${v}</span>`),
      ...NOTE_TAGS.filter(([id]) => n.t.includes(id)).map(([, l]) => `<span class="ns tag">${l}</span>`),
      ...n.r.map((id) => `<span class="ns rune">${esc(RUNES[id].name)}</span>`),
    ];
    return `<div class="pl-sum">${bits.join('')}</div>`;
  }
  function notePanel(p) {
    const n = noteOf(p.id);
    const nums = NOTE_VALUES.map((v) => `<button class="nchip ${n.c[v] === 'm' ? 'maybe' : n.c[v] === 'x' ? 'no' : ''}" data-act="note-card" data-id="${esc(p.id)}" data-v="${v}" aria-pressed="${!!n.c[v]}" aria-label="Card ${v}: ${n.c[v] === 'm' ? 'maybe' : n.c[v] === 'x' ? 'ruled out' : 'no guess'}">${v}</button>`).join('');
    const tags = NOTE_TAGS.map(([id, l]) => `<button class="ntag ${n.t.includes(id) ? 'on' : ''}" data-act="note-tag" data-id="${esc(p.id)}" data-t="${id}" aria-pressed="${n.t.includes(id)}">${l}</button>`).join('');
    const all = Object.values(RUNES).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
    const picker = ui.runePick ? `<div class="railed"><div class="np-runes">${all.map((r) => `<button class="np-r ${n.r.includes(r.id) ? 'on' : ''}" data-act="note-rune" data-id="${esc(p.id)}" data-r="${r.id}" aria-pressed="${n.r.includes(r.id)}" aria-label="${esc(r.name)}">${runeCard(r.id)}<span>${esc(r.name)}</span></button>`).join('')}</div>${railHTML()}</div>` : '';
    return `<div class="pl-notes" style="--pc:${colorOf(p.id)}">
      ${p.hiddenCount ? `<div class="pn-h"><span>Their hidden card</span><small>tap = maybe \u00b7 again = not \u00b7 again = clear</small></div><div class="pn-nums">${nums}</div>` : '<div class="pn-h"><span>No hidden card right now</span></div>'}
      <div class="pn-h"><span>Their next play</span></div><div class="pn-tags">${tags}</div>
      <div class="pn-h"><span>Runes they may hold</span><button class="linkbtn" data-act="note-runes">${ui.runePick ? 'Hide runes' : 'Pick runes'}</button></div>${picker}
      <div class="pn-foot"><button class="linkbtn" data-act="note-clear" data-id="${esc(p.id)}" ${noteN(p.id) ? '' : 'disabled'}>Clear notes</button><small>Card and play guesses reset each round</small></div></div>`;
  }
  function playersHTML() {
    const idx = new Map(view.players.map((p, i) => [p.id, i]));
    const list = [...view.players].sort((a, b) => (b.alive - a.alive) || ((shown(b) ?? -1) - (shown(a) ?? -1)) || (idx.get(a.id) - idx.get(b.id)));
    const rows = list.map((p, i) => {
      const isTurn = view.phase === 'turn' && view.turn === p.id, pct = livesPct(p);
      const flags = [p.restrained ? 'Restrained' : '', p.skipDraw ? 'Skips draw' : '', p.vowed ? `Vow ${p.vowLeft}` : '', !p.alive ? 'Out' : ''].filter(Boolean).map((f) => `<span class="chip warn">${f}</span>`).join('');
      const total = p.id === view.you ? view.myTotal : `${p.visibleTotal}${p.hiddenCount ? '+?' : ''}`;
      return `<li class="pl ${p.id === view.you ? 'me' : ''} ${p.alive ? '' : 'dead'} ${isTurn ? 'turn' : ''}" style="--pc:${colorOf(p.id)};--i:${i}">
        <span class="pl-n">${i + 1}</span>
        <span class="pl-nm"><i class="pdot"></i>${esc(p.name)}${p.id === view.you ? ' <em>you</em>' : ''}</span>
        <span class="pl-l"><span class="heart">&#9829;</span><b>${livesTxt(p)}</b>${livesKnown(p) ? `<span class="lifebar"><span style="width:${pct}%"></span></span>` : ''}</span>
        <span class="pl-s"><span title="Visible total">${total}</span>${(p.id === view.you ? (p.runes || []).length : p.runeCount) == null ? '' : `<span title="Runes in hand">${ICON.spark}${p.id === view.you ? (p.runes || []).length : p.runeCount}</span>`}${p.id !== view.you && p.alive ? `<button class="pl-note ${noteN(p.id) ? 'has' : ''} ${ui.noteOpen === p.id ? 'open' : ''}" data-act="note-open" data-id="${esc(p.id)}" aria-expanded="${ui.noteOpen === p.id}" title="Notes and guesses on ${esc(p.name)}">${ICON.note}<span>${noteN(p.id) ? noteN(p.id) : 'Notes'}</span></button>` : ''}</span>
        ${flags ? `<span class="pl-f">${flags}</span>` : ''}
        ${p.id !== view.you && p.alive && ui.noteOpen !== p.id ? noteSummary(p.id) : ''}${p.id !== view.you && p.alive && ui.noteOpen === p.id ? notePanel(p) : ''}</li>`;
    }).join('');
    const tw = view.twist ? `<button class="pl-twist" data-act="twist"><b aria-hidden="true">${esc(view.twist.icon)}</b><span>${esc(view.twist.name)}</span></button>` : '';
    return `<div class="dock-h"><h3>Players <small>${aliveN()}/${view.players.length}</small></h3>${tw}<button class="iconbtn" data-act="close-dock" aria-label="Close players">${svg('<path d="M6 6l12 12M18 6L6 18"/>')}</button></div><ol class="pl-list ${ui.dockShown ? 'still' : ''}">${rows}</ol>`;
  }
  /** The round twist, readable on demand: a small popover that does not pause or dim anything. */
  function popHTML() {
    if (ui.pop !== 'twist') return '';
    const t = view.twist;
    const body = t
      ? `<div class="tp-h"><b aria-hidden="true">${esc(t.icon)}</b><div><span class="tp-k">Round twist</span><h4>${esc(t.name)}</h4></div></div><p>${esc(t.desc)}</p>`
      : `<div class="tp-h"><div><span class="tp-k">Round twist</span><h4>None this round</h4></div></div><p>Twists change the rules for a single round. Turn them on in the table settings.</p>`;
    return `<div class="twistpop" role="dialog" aria-label="Round twist">${body}</div>`;
  }

  function panelHTML() {
    const s = audio.settings();
    if (ui.panel === 'log') {
      return sheet(`<h3>Match log</h3><ul class="loglist" id="loglist">${view.log.map((l) => `<li class="${l.big ? 'big' : ''}">${esc(l.text)}</li>`).join('')}</ul>
        <div class="row"><button class="btn" data-act="close">Close</button></div>`);
    }
    if (ui.panel === 'keys') {
      const K = [['\u2190 / D', 'Draw'], ['\u2192 / S', 'Stand'], ['\u2191 / \u2193', 'Open / close your runes'], ['\u2190 / \u2192 (runes open)', 'Browse your runes'], ['Space (runes open)', 'Play the selected rune'], ['Tab', 'Players list'], ['T', 'Round twist'], ['L', 'Match log'], ['M', 'Sound on / off'], ['Esc', 'Close the top-most thing'], ['?', 'This list']];
      return sheet(`<h3>Shortcuts</h3><dl class="keys">${K.map(([k, d]) => `<dt><kbd>${k}</kbd></dt><dd>${d}</dd>`).join('')}</dl><div class="row"><button class="btn" data-act="panel-menu">Back</button></div>`);
    }
    if (ui.panel === 'rules') return sheet(`<h3>How it works</h3>${RULES_HTML}<div class="row"><button class="btn" data-act="panel-menu">Back</button></div>`);
    if (ui.panel === 'gallery') {
      const out = [1, 2, 3, 4].map((t) => {
        const items = Object.values(RUNES).filter((r) => r.tier === t);
        return `<h4>${TIER_NAME[t]}</h4><div class="gallery">${items.map((r) => `<button data-act="inspect-rune-id" data-id="${r.id}" aria-label="${esc(r.name)}">${runeCard(r.id)}<small>${esc(r.name)} \u00d7${r.copies}</small></button>`).join('')}</div>`;
      }).join('');
      return sheet(`<h3>All runes</h3><p class="lede">Tap a card to read it.</p>${out}<div class="row"><button class="btn" data-act="panel-menu">Back</button></div>`);
    }
    const dev = view.config.devMode ? `<h4>Test mode</h4><label class="sr" for="devrune">Rune to add</label>
      <select id="devrune">${Object.values(RUNES).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
      <div class="row"><button class="btn" data-act="dev-give">Add to my hand</button></div>` : '';
    return sheet(`<h3>Menu</h3>
      <label class="check"><input type="checkbox" data-act="tog-sfx" ${s.sfx ? 'checked' : ''}> Sound effects</label>
      <label class="check"><input type="checkbox" data-act="tog-amb" ${s.amb ? 'checked' : ''}> Ambient music</label>
      <label class="check"><input type="checkbox" data-act="tog-follow" ${prefs.follow ? 'checked' : ''}> Scroll opponents to follow the turn</label>

      <div class="row">${view.twist ? '<button class="btn" data-act="twist">Round twist</button>' : ''}<button class="btn" data-act="panel-rules">How it works</button><button class="btn" data-act="panel-gallery">All runes</button><button class="btn" data-act="panel-keys">Shortcuts</button><button class="btn" data-act="panel-log">Match log</button></div>
      ${dev}
      <div class="row"><button class="btn danger" data-act="exit">Leave match</button><button class="btn" data-act="close">Resume</button></div>`);
  }

  let layerK = '';
  const L = (kind, html) => { layerK = kind; return html; };
  function layerHTML() {
    layerK = '';
    if (view.phase === 'gameOver' && view.roundResult) return ui.outcomePending ? '' : L('results', resultsHTML(true));
    if (ui.reveal) return L('reveal', revealHTML());
    const me = you();
    if (ui.choose) return L('choose' + ui.choose.step, chooseHTML());
    const p = view.pending;
    if (p && p.kind === 'pick' && p.cards) return L('pick', pickHTML());
    if (p && p.kind === 'vote' && me.alive && p.voters.includes(view.you)) return L('vote', voteHTML());      // stays up after you vote, until the result is revealed
    if (ui.inspect) return L('inspect', inspectHTML());
    if (ui.panel && ui.panel !== 'players') return L('panel-' + ui.panel, panelHTML());
    if (view.phase === 'roundEnd' && view.roundResult) return ui.outcomePending ? '' : L('results', resultsHTML(false));
    return '';
  }

  // ---------------------------------------------------------------- render
  function render() {
    if (disposed) return;
    const me = you();
    if (ui.inspect && ui.inspect.uid != null && !(me.runes || []).some((r) => r.uid === ui.inspect.uid)) ui.inspect = null;
    if (ui.choose) {
      const info = view.legal.runes[ui.choose.runeUid];
      if (!info || info.reason) ui.choose = null;
    }

    put('top', topHTML());
    put('arena', arenaHTML());
    patchSeats(); followTurn();
    const stageChanged = put('stage', feedHTML() + trayHTML());
    put('you', youHTML());
    put('dprev', previewHTML(), 'preview');
    put('dmain', drawerHTML(), 'plain');
    paintSel();
    put('pop', popHTML());
    put('dock', ui.panel === 'players' ? playersHTML() : '');
    R('dock').classList.toggle('open', ui.panel === 'players');
    const kBefore = R('layer').__k, lh = layerHTML(), layerChanged = put('layer', lh, layerK), opened = layerChanged && kBefore !== layerK;
    ui.voteSeen = !!(view.pending && view.pending.kind === 'vote' && !ui.reveal);
    ui.dockShown = ui.panel === 'players';
    const ll = root.querySelector('#loglist');
    if (ll && opened) ll.scrollTop = ll.scrollHeight;                  // only jump to the newest line when the log is opened, never while you read it

    shell.classList.toggle('drawer-open', ui.drawer);
    const dr = R('drawer'); dr.setAttribute('aria-hidden', String(!ui.drawer)); dr.toggleAttribute('inert', !ui.drawer);
    const rh = root.querySelector('.rune-handle'); if (rh) rh.setAttribute('aria-expanded', String(ui.drawer));
    R('opps').classList.toggle('hasturn', view.phase === 'turn' && !view.pending && view.turn !== view.you);
    shell.classList.toggle('previewing', ui.drawer && ui.preview);
    shell.classList.toggle('myturn', !!view.legal.yourTurn);
    const bust = view.myTotal > view.target && me.alive && view.phase === 'turn';
    shell.classList.toggle('over', bust);
    document.documentElement.dataset.life = me.alive && me.lives === 1 ? '1' : '';       // last life: the screen's edge beats like a pulse
    document.documentElement.dataset.mood = bust ? 'danger' : view.legal.yourTurn ? 'turn' : 'calm';

    paintRails(); clipOverlays();
    drawerFx();
    animateFresh();
    startReveals();
    unstick(); paintAimed();
    if (stageChanged) animateFeed();
    rollTotal();
    paintGo();
    paintTimer();
    snapshot();
    if (layerChanged) focusSheet();
  }

  /** Your total rolls to its new value; landing exactly on the target gets a flare. */
  function rollTotal() {
    const t = root.querySelector('#mytotal'), now = shownTotal(), was = ui.tot;
    ui.tot = now;
    if (!t || was == null || was === now) return;
    if (now === view.target && view.phase === 'turn') {
      const c = fx.center(t); fx.ring(c.x, c.y, '#7fcf9a', { r1: 120, life: 0.8, size: 3 }); fx.burst(c.x, c.y, { color: '#7fcf9a', n: 34, speed: 300 });
      fx.floatText('On target', c.x, c.y - 34, { cls: 'chip win', ms: 1500 }); sfx.vote();
    }
    if (reduced) return;
    const t0 = performance.now();
    const step = (k0) => { const k = Math.min(1, (k0 - t0) / 520), e = 1 - Math.pow(1 - k, 3); t.textContent = Math.round(was + (now - was) * e); if (k < 1 && !disposed && t.isConnected) requestAnimationFrame(step); else if (t.isConnected) t.textContent = now; };
    requestAnimationFrame(step);
    if (t.animate) t.animate([{ transform: 'scale(1.28)' }, { transform: 'none' }], { duration: 480, easing: EASE.spring });
  }

  // ======================================================================= MOTION
  // How the animation system is organised (tweak here):
  //  * FLIGHTS are fire-and-forget and run in parallel in the background. Nothing waits for them and nothing blocks input.
  //    The only serialised thing is the rune CAST chain (so two casts never overlap), and even that is a small banner plus a
  //    card crossing the board: no scrim, no pointer capture, keys keep working.
  //  * PREDICTION: Draw and rune plays start moving the instant you act (ghost cards). When the authoritative view arrives
  //    the ghost is handed the real destination; if the action is rejected it slides back home.
  //  * COMMIT DELAY: when a view contains a rune cast, the board keeps showing the previous state until the cast lands
  //    (~0.7 s), then the new state is committed. A card is never seen vanishing before the rune that removes it arrives.
  //  * DIFF FLIGHTS: unit cards that change owner (swap / steal) or leave the table (return / remove) are animated from the
  //    difference between the old and the new authoritative view, so the visuals always match the real state.
  const rerender = (() => { let q = 0; return () => { if (q || disposed) return; q = requestAnimationFrame(() => { q = 0; render(); }); }; })();
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const unitDeckRect = () => rectOf(root.querySelector('[data-deck] .card')) || { x: innerWidth / 2, y: 90, w: 34 };
  const runeDeckRect = () => rectOf(root.querySelector('[data-rdeck] .card')) || { x: innerWidth / 2, y: 90, w: 34 };
  /**
   * A unit card's flight is over: show the real card.
   * The flight hides the real card with an inline style. put() compares markup, and the markup is unchanged, so it would
   * never touch that element again and the card stayed invisible until something else in its region changed (often the
   * next player's move, seconds later). So the card is un-hidden right here, not left for a re-render to maybe do.
   */
  const unhide = (c) => { c.style.visibility = ''; c.classList.remove('held'); };
  const land = (uid) => {
    uid = String(uid); inFlight.delete(uid);
    root.querySelectorAll(`.card[data-uid="${CSS.escape(uid)}"]`).forEach(unhide);
    rerender();
  };
  /** Hide the real card while its clone travels. A watchdog guarantees it comes back even if the flight never reports in. */
  const holdCard = (el, uid, maxMs = 3200) => {
    inFlight.add(uid); el.style.visibility = 'hidden';
    setTimeout(() => { if (!disposed && inFlight.has(uid)) land(uid); }, maxMs);
  };
  /** Cards a rune is flying at stay lit even if a region re-renders mid-flight (classes live on the elements, markup replaces them). */
  function paintAimed() {
    const a = ui.aimed; if (!a) return;
    for (const uid of a.uids) root.querySelectorAll(`.card[data-uid="${CSS.escape(uid)}"]`).forEach((c) => { c.style.setProperty('--ca', a.accent); c.classList.add('aimed'); });
  }
  /** Safety net after every render: no unit card stays hidden unless a flight really owns it. */
  function unstick() {
    root.querySelectorAll('.card[data-uid]').forEach((c) => {
      if (c.style.visibility === 'hidden' && !inFlight.has(String(c.dataset.uid))) c.style.visibility = '';
    });
  }
  const later = [];                                         // visual pops waiting for a cast to land
  const defer = (fn) => (castActive > 0 ? later.push(fn) : fn());
  const flushLater = () => { later.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); };

  /** Remember where every card is on screen, so effects can find a card that the next view removes. */
  function snapshot() {
    lastRects.clear();
    root.querySelectorAll('.card[data-uid]').forEach((el) => {
      if (el.closest('.drawer') && !ui.drawer) return;
      const r = rectOf(el); if (!r || !r.w) return;
      let spec; try { spec = JSON.parse(el.dataset.spec); } catch { return; }
      lastRects.set(String(el.dataset.uid), { rect: r, spec });
    });
  }
  function targetRect(pid) {
    const el = pid === view.you ? root.querySelector('.y-total') || R('you') : seatEl(pid);
    return el ? rectOf(el) : null;
  }
  /** Where a player's cards come from: their seat (opponents) or your rune handle. */
  function originRect(pid) {
    if (pid === view.you) {
      const h = root.querySelector('.rune-handle'), c = h ? rectOf(h) : null;
      return c ? { x: c.x, y: c.y - 30, w: 70 } : { x: fx.size().W / 2, y: fx.size().H - 90, w: 70 };
    }
    const se = seatEl(pid); if (!se) return null;
    const c = rectOf(se);
    return { x: c.x, y: c.y, w: Math.max(52, Math.min(84, c.w * 0.22)) };
  }
  const who = (pid) => (pid === view.you ? 'You' : nameOf(pid));
  /** The rune-hand icon of a player: your Runes handle, or the little rune card on an opponent's seat. */
  const runeIconEl = (pid) => (pid === view.you ? root.querySelector('.rune-handle .rh-ic') : (seatEl(pid) && seatEl(pid).querySelector('[data-rc] .card')));
  const runeIconRect = (pid, w = 40) => { const el = runeIconEl(pid), r = el && rectOf(el); return r ? { x: r.x, y: r.y, w } : null; };
  /** A player's latest unit card on screen (what Barter and Remove act on). */
  const latestCardEl = (pid) => {
    const list = pid === view.you ? root.querySelectorAll('#r-you .hand .card') : (seatEl(pid) ? seatEl(pid).querySelectorAll('.s-cards .card') : []);
    return list.length ? list[list.length - 1] : null;
  };
  /** The face-down card(s) of a player (what Prophecy reveals). */
  const hiddenCardEls = (pid) => [...(pid === view.you ? root.querySelectorAll('#r-you .hand .card.peek') : (seatEl(pid) ? seatEl(pid).querySelectorAll('.s-cards .card[data-face="down"][data-uid]') : []))];
  const cardAim = (el) => { const r = rectOf(el); return r ? { x: r.x, y: r.y, w: Math.max(54, r.w) } : null; };
  /** A cast needs its caster and target on screen so the flight has somewhere real to go: scroll them in at once. */
  function showSeats(ids) {
    const st = strip(); if (!st) return;
    for (const id of ids) {
      if (!id || id === view.you || !seatEl(id)) continue;
      const a = seatEl(id).getBoundingClientRect(), b = st.getBoundingClientRect();
      if (a.left < b.left + 4 || a.right > b.right - 4) showSeat(id, { instant: true });
    }
  }
  const originOf = (pid) => originRect(pid) || { x: fx.size().W / 2, y: pid === view.you ? fx.size().H : 0, w: 60 };

  // ------------------------------------------------------------ unit card deals
  function dealCard(el, uid, i) {
    const to = rectOf(el);
    let spec; try { spec = JSON.parse(el.dataset.spec); } catch { return; }
    const mine = !!el.closest('#r-you'), faceUp = el.dataset.face === 'up';
    holdCard(el, uid);
    const g = mine ? ghosts.get('draw') : null;
    if (g) { ghosts.delete('draw'); g.land(to, { spec, faceDown: true, ms: 320 }).then(() => land(uid)); return; }   // the predicted card finishes its trip
    flights.fly({ spec, from: unitDeckRect(), to, faceDown: faceUp, keepBack: !faceUp, flipAt: 0.66, ms: DUR.fly + 60, delay: i * 110, arc: 0.1, glow: 'rgba(205,178,123,.5)' }).then(() => land(uid));
  }
  function animateFresh() {
    let i = 0, f = 0;
    root.querySelectorAll('.card[data-uid]').forEach((el) => {
      const uid = el.dataset.uid;
      if (el.classList.contains('held') || el.closest('.tray') || el.closest('.runes') || inFlight.has(uid)) return;
      if (freshUnits.has(uid)) { freshUnits.delete(uid); if (!reduced) dealCard(el, uid, i++); }
      else if (hiddenUids.has(uid) && el.dataset.face === 'up') {
        hiddenUids.delete(uid);
        if (!reduced && el.animate) {
          el.animate([{ transform: 'rotateY(90deg) scale(1.08)' }, { transform: 'rotateY(0) scale(1)' }], { duration: DUR.slow, delay: f * 90, easing: EASE.out, fill: 'backwards' });
          if (!f++) sfx.flip();
        }
      }
    });
    const dealt = freshUnits.size; freshUnits.clear();
    if (dealt && reduced) rerender();                       // no flights to land: show the new total now
  }
  function animateFeed() {
    const li = root.querySelector('.feed li.new');
    if (!li || animated.has(li.dataset.lid)) return;
    animated.add(li.dataset.lid);
    if (!reduced && li.animate) li.animate([{ transform: 'translateY(-8px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: DUR.med, easing: EASE.out });
  }

  // ------------------------------------------------------------ predicted actions
  const cancelGhosts = () => {
    for (const [k, g] of ghosts) { g.cancel(); if (k.startsWith('rune:')) runeHold.delete(+k.slice(5)); }
    ghosts.clear(); ui.busy = false; rerender();
  };
  window.addEventListener('solace:reject', cancelGhosts);
  function predictDraw() {
    if (reduced || ghosts.has('draw')) return;
    const cards = [...root.querySelectorAll('#r-you .hand .card')], last = cards[cards.length - 1], lr = last && rectOf(last);
    const hr = rectOf(root.querySelector('#r-you .hand')); if (!hr) return;
    const to = lr ? { x: lr.x + lr.w * 1.1, y: lr.y, w: lr.w } : { x: hr.x, y: hr.y, w: 56 };
    const gh = flights.ghost({ spec: { kind: 'unit-back' }, from: unitDeckRect(), toward: to, frac: 0.85, ms: 380, glow: 'rgba(205,178,123,.5)' });
    if (!gh) return;
    ghosts.set('draw', gh);
    setTimeout(() => { if (ghosts.get('draw') === gh) { ghosts.delete('draw'); gh.cancel(); } }, 3200);
  }
  function predictRune(uid, fromRect) {
    if (reduced) return;
    const r = runesOf().find((x) => x.uid === uid); if (!r) return;
    const hdl = root.querySelector('.rune-handle .rh-ic');
    const from = fromRect || (hdl ? { ...rectOf(hdl), w: 56 } : null);
    const tray = root.querySelector('.tray .active-row') || root.querySelector('.tray');
    if (!from || !tray) return;
    const gh = flights.ghost({ spec: { kind: 'rune', runeId: r.runeId }, from, toward: { ...rectOf(tray), w: 70 }, frac: 0.55, ms: 360, glow: runeAccent(r.runeId) });
    if (!gh) return;
    const key = 'rune:' + uid; ghosts.set(key, gh); runeHold.add(uid); rerender();
    setTimeout(() => { if (ghosts.get(key) === gh) { ghosts.delete(key); gh.cancel(); runeHold.delete(uid); rerender(); } }, 3500);
  }

  /** A small chip at a player's seat for every draw / stand, so nothing goes unseen. Returns false when already shown (predicted). */
  function actChip(pid, kind) {
    const now = performance.now(), l = ui.lastChip;
    if (l && l.pid === pid && l.kind === kind && now - l.t < 700) return false;
    ui.lastChip = { pid, kind, t: now };
    const el = pid === view.you ? root.querySelector('.y-total') || R('you') : seatEl(pid), r = el && rectOf(el);
    if (!r) return true;
    if (el && pid !== view.you && !reduced) { el.classList.remove('acted'); void el.offsetWidth; el.classList.add('acted'); }
    fx.floatText(kind === 'draw' ? 'Draw' : 'Stand', Math.max(40, Math.min(fx.size().W - 40, r.x)), r.y - r.h / 2 + 4, { cls: `chip ${kind}`, ms: 1000 });
    return true;
  }

  // ------------------------------------------------------------ rune casts
  let castSeq = 0, castActive = 0, chainP = Promise.resolve();
  const waiting = [];                                       // views received while a cast is playing: { v, events, seq }
  function commitUpTo(seq) {
    let pick = null, events = [];
    while (waiting.length && waiting[0].seq <= seq) { pick = waiting.shift(); events = events.concat(pick.events); }
    if (pick) applyView(pick.v, events);
  }
  function enqueueCast(e, origin) {
    const seq = ++castSeq; castActive++;
    const speed = castActive > 3 ? 0.55 : castActive > 2 ? 0.7 : castActive > 1 ? 0.85 : 1;
    if (session.setPaused) session.setPaused(true);
    chainP = chainP.then(async () => {
      try { await castJob(e, seq, speed, origin); } catch (err) { console.error(err); }
      commitUpTo(seq); flushLater();
      castActive--;
      ui.aimed = null; root.querySelectorAll('.casting, .targeted, .aimed').forEach((n) => n.classList.remove('casting', 'targeted', 'aimed'));
      if (!castActive) { if (session.setPaused && !disposed) session.setPaused(false); commitUpTo(Infinity); }
    });
    setTimeout(() => { if (waiting.length && !disposed) commitUpTo(Infinity); }, 5000);      // watchdog: never stay behind the server
  }

  const IMPACT = {
    curse: ['Cursed', '#d9443f'], restrain: ['Restrained', '#d9443f'], dread: ['Forced draw', '#d9443f'], remove: ['Card removed', '#d9443f'],
    pickpocket: ['Robbed', '#d9443f'], barter: ['Swap', null], trade: ['Swap', null], duel: ['Duel', '#d9443f'], prophecy: ['Revealed', null], helping_hand: ['Protected', '#6fd08c'],
  };
  /** What a targeted rune flies to: 'runes' = the target's rune hand, 'latest' = their latest unit card, 'hidden' = their face-down card. Anything else = their seat. */
  const AIM = { pickpocket: 'runes', trade: 'runes', barter: 'latest', remove: 'latest', prophecy: 'hidden' };
  const castBanner = (e, d, accent, who, tgt) => {
    castLayer.querySelectorAll('.cbanner').forEach((n) => n.remove());
    const el = document.createElement('div');
    el.className = `cbanner t${d.tier}`; el.style.setProperty('--accent', accent);
    el.innerHTML = `<span class="cb-bar"></span><div class="cb-main"><b>${esc(d.name)}</b><span>${esc(who)}${tgt ? ` \u2192 ${esc(tgt)}` : ''}</span></div><p>${esc(d.text)}</p>`;
    const st = R('stage') && R('stage').getBoundingClientRect();     // sit over the table's feed line, never over the seats
    if (st) el.style.top = Math.max(60, st.top + 6) + 'px';
    castLayer.appendChild(el);
    if (!reduced && el.animate) el.animate([{ transform: 'translate(-50%,-12px) scale(.96)', opacity: 0 }, { transform: 'translate(-50%,0) scale(1)', opacity: 1 }], { duration: DUR.med, easing: EASE.spring });
    const life = d.tier >= 4 ? DUR.bannerBig : DUR.banner;
    setTimeout(() => { if (disposed) return; if (!reduced && el.animate) el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%,-6px)' }], { duration: DUR.med, easing: EASE.out, fill: 'forwards' }).onfinish = () => el.remove(); else el.remove(); }, life);
  };

  async function castJob(e, seq, speed, origin) {
    const d = RUNES[e.runeId], accent = runeAccent(e.runeId), mine = e.pid === view.you, special = d.tier >= 4;
    const spec = { kind: 'rune', runeId: e.runeId }, P = e.params || {}, fm = (ms) => dur(ms, speed, reduced);
    const tgtId = e.targetId && e.targetId !== e.pid ? e.targetId : null;
    showSeats([e.pid, tgtId]);                              // caster and target must both be on screen (the strip scrolls)
    const rects = new Map(lastRects);                       // the board as it was before this cast's result is committed
    const key = 'rune:' + e.uid, gh = ghosts.get(key); ghosts.delete(key);
    const from = gh ? gh.rect() : (e.pid === view.you && origin ? origin : originOf(e.pid));      // opponents: measured now, after any seat paging
    const staged = special && !reduced;                       // Special runes get the full stage instead of the small banner
    if (!staged) castBanner(e, d, accent, mine ? 'You' : nameOf(e.pid), tgtId ? (tgtId === view.you ? 'You' : nameOf(tgtId)) : '');
    const sEl = mine ? null : seatEl(e.pid); if (sEl) { sEl.classList.add('casting'); sEl.style.setProperty('--ca', accent); }
    if (!gh) fx.ring(from.x, from.y, accent, { r1: 60, life: 0.5, size: 2.5 });
    sfx.flip();

    // what does it hit?
    const snap = (uid) => (uid != null ? rects.get(String(uid)) : null);
    const killUid = e.runeId === 'rebuke' ? e.lastActive : e.runeId === 'retaliation' ? P.active : null;
    let hit = null;
    if (snap(killUid)) hit = { rect: snap(killUid).rect, kind: 'shatter', card: snap(killUid) };
    else if (snap(P.ownActive)) hit = { rect: snap(P.ownActive).rect, kind: 'pull', card: snap(P.ownActive) };
    else if (snap(P.ownCard)) hit = { rect: snap(P.ownCard).rect, kind: 'pulse' };
    else if (e.runeId === 'hush') {                          // draws from the unit deck: the rune goes to the deck, the card comes out of it
      const r = unitDeckRect(); hit = { rect: { x: r.x, y: r.y, w: 54 }, kind: 'deck' };
    } else if (tgtId) {
      const seat = tgtId === view.you ? R('you') : seatEl(tgtId), mode = AIM[e.runeId];
      let r = null, kind = 'seat', els = [];
      if (mode === 'runes') { r = runeIconRect(tgtId, 50); }                                       // Pickpocket / Trade: their rune hand
      else if (mode === 'latest') {                                                                   // Barter / Remove: the card it acts on
        const t = latestCardEl(tgtId); if (t) { r = cardAim(t); kind = 'card'; els = [t]; }
        if (e.runeId === 'barter') { const m = latestCardEl(e.pid); if (m) els.push(m); }
      } else if (mode === 'hidden') {                                                                 // Prophecy: straight to the card that gets revealed
        els = hiddenCardEls(tgtId); if (els.length) { r = cardAim(els[0]); kind = 'reveal'; }
      }
      if (!r) { const tr = targetRect(tgtId); if (tr) { r = { x: tr.x, y: tr.y, w: 62 }; kind = 'seat'; els = []; } }
      if (r) hit = { rect: r, kind, pid: tgtId, el: seat, els };
    }
    if (hit && hit.els && hit.els.length) { ui.aimed = { uids: hit.els.map((c) => String(c.dataset.uid)), accent }; paintAimed(); }      // light up what is about to be hit
    const trayEl = root.querySelector('.tray .active-row') || root.querySelector('.tray');
    const tableTo = trayEl ? { ...rectOf(trayEl), w: 54 } : { x: fx.size().W / 2, y: 120, w: 54 };
    const isActive = d.kind === 'active';
    if (isActive && !hit && !staged) commitUpTo(seq);       // its tray slot has to exist (hidden) before the card flies to it
    const dest = hit ? hit.rect : tableTo;

    // 1) source -> target
    const f1 = { ms: fm(DUR.fly + 120), lift: 1.5, arc: 0.14, glow: accent, spin: -10 };
    const aim = { x: dest.x, y: dest.y, w: Math.max(54, dest.w || 54) };
    if (staged) {
      // the card rises to the middle of the screen, charges, and shows its name; then it whooshes to what it hits
      let cfrom = from; if (gh) { cfrom = gh.rect() || from; gh.el.remove(); }
      const st = cinema.stage({
        spec, from: cfrom, accent, runeId: e.runeId, kicker: mine ? 'You cast' : `${nameOf(e.pid)} casts`, name: d.name,
        sub: tgtId ? `\u2192 ${tgtId === view.you ? 'You' : nameOf(tgtId)}` : '', desc: d.text, speed,
        on: { charge: () => sfx.charge(), flip: () => { sfx.boom(); audio.haptic([30, 40, 60]); } },
      });
      try {
        await st.ready;
        if (isActive && !hit) commitUpTo(seq);
        if (tgtId || (hit && hit.kind === 'deck')) flights.trail({ from: st.center, to: aim, color: accent, arc: 0.14, ms: fm(DUR.fly + 900) });
        sfx.flip();
        await st.launch(aim, { ms: fm(DUR.fly + 240) });
      } catch (err) { st.abort(); throw err; }
    } else {
      if (tgtId || (hit && hit.kind === 'deck')) flights.trail({ from, to: aim, color: accent, arc: 0.14, ms: fm(DUR.fly + 700) });     // an arrow from caster to what it hits
      if (gh) await gh.land(aim, { ...f1, faceDown: false });
      else await flights.fly({ spec, from, to: aim, hold: fm(150), pop: 0.25, ...f1 });
    }

    // 2) impact: the board now shows the result
    sfx.rune(e.runeId, d.tier); audio.haptic(special ? [30, 40, 60] : 18);
    if (hit || !isActive) {
      // a rune changing hands: tell the UI who took from whom while the result is committed, so the flights start at the right seat
      ui.xfer = (e.runeId === 'pickpocket' || e.runeId === 'trade') && tgtId ? { runeId: e.runeId, thief: e.pid, victim: tgtId } : null;
      ui.aimed = null; root.querySelectorAll('.aimed').forEach((c) => c.classList.remove('aimed'));        // the hit lands: the highlight has done its job
      try { commitUpTo(seq); } finally { ui.xfer = null; }
    }
    const ix = aim.x, iy = aim.y;
    fx.ring(ix, iy, accent, { r1: 70 + d.tier * 16, life: 0.55, size: 2 + d.tier * 0.6 });
    fx.burst(ix, iy, { color: accent, n: 10 + d.tier * 10, speed: 240 + d.tier * 50, life: 0.7 });
    if (special) { fx.flash(hexA(accent, 0.28), 650); fx.shake(shell, 6); if (!reduced) cinema.impact(e.runeId, ix, iy, accent, 0.8); }
    let leg = Promise.resolve();
    const imp = IMPACT[e.runeId], col = (imp && imp[1]) || accent;
    if (hit && hit.kind === 'shatter') {
      const hv = flights.hover({ spec: hit.card.spec, at: hit.rect, glow: '#d9443f', pop: 0.1, ms: 120 });
      fx.burst(ix, iy, { color: '#d9443f', n: 34, speed: 360, life: 0.8 }); fx.flash('rgba(217,68,63,.18)', 450);
      setTimeout(() => { if (!reduced && hv.el.animate) hv.el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.22) rotate(5deg)', filter: 'brightness(2)' }], { duration: 320, easing: EASE.out, fill: 'forwards' }); setTimeout(hv.end, 340); }, 120);
    } else if (hit && hit.kind === 'pull') {
      const to = e.pid === view.you ? (root.querySelector('.rune-handle .rh-ic') ? { ...rectOf(root.querySelector('.rune-handle .rh-ic')), w: 30 } : null) : originRect(e.pid);
      if (to) leg = flights.fly({ spec: hit.card.spec, from: hit.rect, to, ms: fm(DUR.fly), arc: 0.15, glow: accent });
    } else if (hit && hit.kind === 'deck') {
      const dk = root.querySelector('[data-deck]'); if (dk && !reduced && dk.animate) dk.animate([{ transform: 'scale(1.18)', filter: 'brightness(1.8)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: DUR.slow, easing: EASE.spring });
    } else if (hit && hit.el) {                              // a seat, one of its cards, its rune hand or its hidden card
      hit.el.classList.add('targeted'); hit.el.style.setProperty('--ca', col);
      if (!reduced) { fx.shake(hit.el, hit.kind === 'seat' ? 7 : 4); fx.flash(hexA(col, 0.16), 500); }
      if (imp) fx.floatText(imp[0], Math.max(44, Math.min(fx.size().W - 44, ix)), iy - (hit.kind === 'reveal' ? 34 : 6), { cls: 'chip tag', ms: 1300 });
    }
    flushLater();
    await flights.sleep(fm(isActive ? 120 : 260));

    // 3) active runes settle into their slot on the table
    if (isActive) {
      const slot = root.querySelector(`.active-item .card[data-uid="${e.uid}"]`), to = slot ? rectOf(slot) : tableTo;
      await flights.fly({ spec, from: aim, to, ms: fm(DUR.fly), arc: 0.1, glow: accent, onLand: () => { hold.delete(e.uid); rerender(); } });
      if (slot) fx.ring(to.x, to.y, accent, { r1: 54, life: 0.5, size: 2 });
    } else {
      fx.burst(ix, iy, { color: accent, n: 12, speed: 150, life: 0.6 });
    }
    hold.delete(e.uid); rerender();                          // repaint even if the settle flight never reported in
    await leg;
  }

  // ------------------------------------------------------------ diff flights (swap / steal / return / remove)
  /** One unit card changes owner: it flies from where it was to where it is now. Hidden -> visible flips on arrival. */
  function moveCard(m, o = {}) {
    // a swapped card travels face-UP, as everybody can already see it. Only a card that is hidden (face-down) at either end flies as a back, so a swap never shows what it should not.
    const spec = !m.secret && m.fromSpec && m.fromSpec.kind === 'unit' ? m.fromSpec : { kind: 'unit-back' };
    return flights.fly({ spec, from: m.from, to: m.to, ms: DUR.swap, arc: 0.3, lift: 1.25, glow: colorOf(m.toPid), spin: -6, ...o }).then(() => land(m.uid));
  }
  /**
   * Barter: the two cards are lit where they sit and named ("Mara -> You"), an arrow is drawn for each, then they loop
   * past each other (opposite sides, so the paths never overlap) and land with a ring in their new owner's colour.
   */
  function swapCards(a, b) {
    const hold = 320, ms = 900, total = hold + ms;
    sfx.flip();
    for (const m of [a, b]) {
      const c = colorOf(m.fromPid);
      fx.ring(m.from.x, m.from.y, c, { r1: 52, life: 0.55, size: 2.5 });
      fx.floatText(`${who(m.fromPid)} \u2192 ${who(m.toPid)}`, Math.max(60, Math.min(fx.size().W - 60, m.from.x)), m.from.y - m.from.w * 0.95, { cls: 'chip tag', ms: total + 500 });
      flights.trail({ from: m.from, to: m.to, color: c, arc: 0.3, side: 1, ms: total + 250 });
    }
    Promise.all([a, b].map((m) => moveCard(m, { hold, pop: 0.22, ms, side: 1, glow: colorOf(m.fromPid) }))).then(() => {
      if (disposed) return;
      sfx.deal();
      for (const m of [a, b]) { const c = colorOf(m.toPid); fx.ring(m.to.x, m.to.y, c, { r1: 56, life: 0.55, size: 2.5 }); fx.burst(m.to.x, m.to.y, { color: c, n: 12, speed: 170, life: 0.55 }); }
      const mx = (a.to.x + b.to.x) / 2, my = (a.to.y + b.to.y) / 2;
      fx.floatText('Swapped', Math.max(44, Math.min(fx.size().W - 44, mx)), my, { cls: 'chip tag', ms: 1000 });
    });
  }
  function diffFlights(old, prevRects) {
    if (reduced) return;
    const now = new Map(); view.players.forEach((p) => p.cards.forEach((c) => now.set(String(c.uid), { pid: p.id, c })));
    const moves = [];
    for (const op of old.players) for (const c of op.cards) {
      const uid = String(c.uid); if (inFlight.has(uid)) continue;
      const nw = now.get(uid), np = nw && nw.pid; if (np === op.id) continue;
      const snap = prevRects.get(uid); if (!snap) continue;
      const spec = c.value != null ? { kind: 'unit', value: c.value } : { kind: 'unit-back' };
      if (np) {                                              // another player has it now: swap or steal
        const el = root.querySelector(`.card[data-uid="${CSS.escape(uid)}"]`), to = el && rectOf(el); if (!to) continue;
        let toSpec = spec; try { toSpec = JSON.parse(el.dataset.spec); } catch { /* keep the old face */ }
        holdCard(el, uid);
        moves.push({ uid, from: snap.rect, to, fromSpec: snap.spec.kind === 'unit' ? snap.spec : spec, toSpec, fromPid: op.id, toPid: np, secret: (c.faceDown && !c.revealed) || (nw.c.faceDown && !nw.c.revealed) });
      } else if (ui.lastCast && ui.lastCast.runeId === 'remove' && performance.now() - ui.lastCast.t < 4000) {   // removed from play
        fx.burst(snap.rect.x, snap.rect.y, { color: '#d9443f', n: 26, speed: 300, life: 0.8 }); fx.embers(snap.rect.x, snap.rect.y, '#d9443f', 10);
        const hv = flights.hover({ spec: snap.spec, at: snap.rect, glow: '#d9443f', pop: 0.04, ms: 90 });
        if (hv.el.animate) hv.el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.8) rotate(-8deg)' }], { duration: 480, easing: EASE.out, fill: 'forwards' });
        setTimeout(hv.end, 520);
      } else {                                               // back into the deck
        flights.fly({ spec: snap.spec, from: snap.rect, to: { ...unitDeckRect(), w: snap.rect.w * 0.8 }, ms: DUR.fly, arc: 0.12, glow: 'rgba(205,178,123,.5)', fade: true });
      }
    }
    if (moves.length === 2 && moves[0].fromPid === moves[1].toPid && moves[1].fromPid === moves[0].toPid) swapCards(moves[0], moves[1]);
    else for (const m of moves) {                            // a steal / one-way move: still shown with an arrow
      flights.trail({ from: m.from, to: m.to, color: colorOf(m.fromPid), arc: 0.3, ms: DUR.swap + 400 });
      moveCard(m, { glow: colorOf(m.fromPid) });
    }
  }

  // ------------------------------------------------------------ runes changing hands (Pickpocket, Trade)
  /**
   * The cast landed and the new state is committed: show where each rune went. `xf` = { runeId, thief, victim }.
   *  - a rune you lost flies from your hand to the player who got it (face-up: you see exactly what was taken)
   *  - a rune you gained is flown in by startReveals() from the player it came from (see trackCards)
   *  - two other players trading: two rune backs loop past each other between their seats
   */
  function runeTransfers(old, prevRects, xf) {
    if (reduced || !xf) return;
    const mineOld = (old.players.find((p) => p.id === view.you) || {}).runes || [], mineNow = you().runes || [];
    const lost = mineOld.filter((r) => !mineNow.some((n) => n.uid === r.uid));
    const iThief = xf.thief === view.you, iVictim = xf.victim === view.you, other = iThief ? xf.victim : iVictim ? xf.thief : null;
    const label = xf.runeId === 'trade' ? 'Traded' : 'Stolen';
    if (lost.length && other) {
      const r = lost[0], snap = prevRects.get(String(r.uid)), handle = runeIconEl(view.you);
      const from = snap ? snap.rect : handle ? { ...rectOf(handle), w: 46 } : null, to = runeIconRect(other, 44);
      if (from && to) {
        const c = colorOf(other);
        flights.trail({ from, to, color: c, arc: 0.18, ms: DUR.fly + 700 });
        flights.fly({ spec: { kind: 'rune-back' }, from, to, hold: 200, pop: 0.2, ms: DUR.fly + 140, arc: 0.18, glow: c, lift: 1.4 }).then(() => {
          if (disposed) return;
          fx.ring(to.x, to.y, c, { r1: 50, life: 0.5, size: 2.5 }); fx.burst(to.x, to.y, { color: c, n: 12, speed: 180, life: 0.55 });
          fx.floatText(`${label} \u2192 ${who(other)}`, Math.max(70, Math.min(fx.size().W - 70, to.x)), to.y - 30, { cls: 'chip tag', ms: 1400 });
        });
      }
    }
    if (xf.runeId === 'trade' && !iThief && !iVictim) {      // two other players: a rune back each way
      const a = runeIconRect(xf.thief, 34), b = runeIconRect(xf.victim, 34);
      if (a && b) {
        const ca = colorOf(xf.thief), cb = colorOf(xf.victim);
        flights.trail({ from: a, to: b, color: ca, arc: 0.3, side: 1, ms: DUR.fly + 700 }); flights.trail({ from: b, to: a, color: cb, arc: 0.3, side: 1, ms: DUR.fly + 700 });
        flights.fly({ spec: { kind: 'rune-back' }, from: a, to: b, hold: 200, pop: 0.2, ms: DUR.fly + 140, arc: 0.3, side: 1, glow: ca });
        flights.fly({ spec: { kind: 'rune-back' }, from: b, to: a, hold: 200, pop: 0.2, ms: DUR.fly + 140, arc: 0.3, side: 1, glow: cb });
      }
    }
  }

  // ------------------------------------------------------------ own rune draws: fly into the hand, rarity sets the fanfare
  const TIER_LABEL = { 1: 'Common', 2: 'Rare', 3: 'Epic', 4: 'Special' };
  const REVEAL = { 1: { fly: 520, lift: 1.5 }, 2: { fly: 600, lift: 1.9 }, 3: { fly: 700, lift: 2.3 }, 4: { fly: 820, lift: 2.7 } };
  const pendingReveals = [];
  /** Where a rune you just got should land: its slot in the open drawer, or the rune handle. */
  function revealTarget(r) {
    const real = ui.drawer ? root.querySelector(`.dr-cards .card[data-uid="${r.uid}"]`) : null;
    const handle = root.querySelector('.rune-handle .rh-ic');
    const to = real ? rectOf(real) : handle ? { ...rectOf(handle), w: 30 } : { x: fx.size().W / 2, y: fx.size().H - 30, w: 30 };
    return { to, handle };
  }
  /** The card has arrived in your hand: the rarity decides how loud it is. */
  function revealLanded(r, to, handle) {
    if (disposed) return;
    const d = RUNES[r.runeId], t = d.tier, accent = runeAccent(r.runeId);
    sfx.rune(r.runeId, t); audio.haptic(t >= 4 ? [30, 40, 70] : t === 3 ? [25, 30] : 10);
    fx.ring(to.x, to.y, accent, { r1: 40 + t * 22, life: 0.5 + t * 0.08, size: 1.5 + t });
    fx.burst(to.x, to.y, { color: accent, n: [0, 8, 20, 44, 80][t], speed: [0, 160, 240, 340, 440][t], life: 0.6 + t * 0.15 });
    if (t >= 3) fx.flash(hexA(accent, t >= 4 ? 0.3 : 0.16), 600);
    if (t >= 4) { fx.shake(shell, 5); cinema.impact(r.runeId, to.x, to.y, accent, 0.5); }
    if (t >= 2) fx.floatText(`${TIER_LABEL[t]} \u00b7 ${d.name}`, Math.max(80, Math.min(fx.size().W - 80, to.x)), to.y - 46, { cls: 'chip tag', ms: 1700 });
    if (handle && !reduced && handle.animate) handle.animate([{ transform: 'scale(1.6)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: DUR.slow, easing: EASE.spring });
  }
  /** A Special rune is drawn: the screen gives it the full stage (rise, charge, turn over, name), then it flies into your hand. One at a time. */
  let cineQ = Promise.resolve();
  async function specialReveal(r) {
    if (disposed) { runeHold.delete(r.uid); return; }
    const d = RUNES[r.runeId], accent = runeAccent(r.runeId), spec = { kind: 'rune', runeId: r.runeId };
    const from = (r.from ? runeIconRect(r.from, 46) : null) || runeDeckRect();
    const st = cinema.stage({
      spec, from, faceDown: true, accent, runeId: r.runeId, kicker: 'Special rune', name: d.name,
      sub: r.from ? `Taken from ${nameOf(r.from)}` : 'Added to your hand', desc: d.text,
      on: { charge: () => { sfx.deal(); sfx.charge(); }, flip: () => { sfx.flip(); sfx.boom(); audio.haptic([30, 40, 70]); }, land: () => { runeHold.delete(r.uid); rerender(); } },
    });
    try {
      await st.ready;
      if (!disposed) {
        const { to, handle } = revealTarget(r);
        await st.launch(to, { ms: 820 });
        revealLanded(r, to, handle);
      } else st.abort();
    } catch (err) { st.abort(); throw err; } finally { runeHold.delete(r.uid); rerender(); }
  }
  function startReveals() {
    let i = 0;
    for (const r of pendingReveals.splice(0)) {
      const d = RUNES[r.runeId], t = d.tier, accent = runeAccent(r.runeId), spec = { kind: 'rune', runeId: r.runeId }, cfg = REVEAL[t] || REVEAL[1];
      if (t >= 4 && !reduced) { cineQ = cineQ.then(() => specialReveal(r)).catch((err) => { console.error(err); runeHold.delete(r.uid); rerender(); }); continue; }
      const { to, handle } = revealTarget(r);
      const fromSeat = r.from ? runeIconRect(r.from, 46) : null, from = fromSeat || runeDeckRect();
      if (fromSeat) flights.trail({ from, to, color: accent, arc: 0.12, ms: cfg.fly + 600 });
      sfx.deal();
      flights.fly({
        spec, from, to, faceDown: true, flipAt: 0.45, ms: cfg.fly, delay: i++ * 170, lift: cfg.lift, arc: 0.12, spin: -10, glow: accent,
        onLand: () => { runeHold.delete(r.uid); rerender(); },
      }).then(() => revealLanded(r, to, handle));
    }
  }
  const pendingOpp = [];
  function trackCards() {
    for (const p of view.players) for (const c of p.cards) {
      const id = String(c.uid);
      if (!knownUnits.has(id)) { knownUnits.add(id); freshUnits.add(id); }
    }
    const me = you(), xf = ui.xfer;
    // a rune that arrived by Pickpocket / Trade comes from the other player's seat, not from the deck
    const srcOf = xf ? (xf.thief === view.you && xf.victim !== view.you ? xf.victim : xf.victim === view.you && xf.runeId === 'trade' ? xf.thief : null) : null;
    for (const r of (me && me.runes) || []) {
      if (knownRunes.has(r.uid)) continue;
      knownRunes.add(r.uid);
      if (reduced) continue;
      runeHold.add(r.uid); pendingReveals.push(srcOf ? { ...r, from: srcOf } : r);
    }
    for (const p of oppList()) {
      const before = oppRunes.get(p.id) || 0;
      if (p.runeCount > before) {
        const stolen = xf && xf.runeId === 'pickpocket' && xf.thief === p.id;               // it came out of someone's hand
        if (!(stolen && xf.victim === view.you)) pendingOpp.push({ pid: p.id, n: p.runeCount - before, from: stolen ? xf.victim : null });      // (from you: runeTransfers() already flies it)
      }
      oppRunes.set(p.id, p.runeCount);
    }
  }
  function flyOppRunes() {
    let i = 0;
    for (const { pid, n, from: fromPid } of pendingOpp.splice(0)) {
      const icon = seatEl(pid) && seatEl(pid).querySelector('[data-rc] .card');
      if (!icon || reduced) continue;
      const to = { ...rectOf(icon), w: 30 }, from = (fromPid && runeIconRect(fromPid, 30)) || runeDeckRect();
      if (fromPid) flights.trail({ from, to, color: colorOf(fromPid), arc: 0.14, ms: DUR.fly + 700 });
      for (let k = 0; k < n; k++) flights.fly({ spec: { kind: 'rune-back' }, from, to, ms: DUR.fly, delay: 120 + (i++) * 140, arc: 0.12, glow: colorOf(pid) }).then(() => { if (!disposed && icon.animate) icon.animate([{ transform: 'scale(1.7)' }, { transform: 'scale(1)' }], { duration: DUR.med, easing: EASE.spring }); });
    }
  }

  // ------------------------------------------------------------ round start banner (non-blocking)
  /** The round's twist is a secret until now: it slams onto the screen. */
  function twistSlam(t) {
    const { W } = fx.size(), el = document.createElement('div');
    el.className = 'twistslam'; el.innerHTML = `<b aria-hidden="true">${esc(t.icon)}</b><div class="ts-k">Twist</div><div class="ts-n">${esc(t.name)}</div><p>${esc(t.desc)}</p>`;
    castLayer.appendChild(el);
    fx.flash('rgba(25,194,201,.4)', 900); fx.shake(shell, 9); fx.ring(W / 2, fx.size().H * 0.4, '#19c2c9', { r1: Math.min(W, 700), life: 0.9, size: 4 }); audio.haptic([40, 30, 90]);
    setTimeout(() => { if (disposed) return; if (!reduced && el.animate) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: EASE.out, fill: 'forwards' }).onfinish = () => el.remove(); else el.remove(); }, 2300);
  }
  /** Anyone on their last life is called out at the start of a round. */
  function lastLives() {
    setTimeout(() => {
      if (disposed) return;
      for (const p of view.players) {
        if (!p.alive || p.lives !== 1) continue;
        const tile = p.id === view.you ? R('you') : seatEl(p.id), r = tile && rectOf(tile); if (!r) continue;
        fx.floatText('Last life', Math.max(60, Math.min(fx.size().W - 60, r.x)), r.y, { cls: 'chip lose', ms: 1800 }); fx.embers(r.x, r.y, '#d9443f', 14);
        if (p.id === view.you) { fx.flash('rgba(217,68,63,.45)', 1100); audio.haptic([60, 40, 60]); }
      }
    }, 900);
  }
  function bannerRound(e) {
    const el = document.createElement('div');
    el.className = 'rbanner';
    const tw = e.twist ? `<span class="rb-tw"><b aria-hidden="true">${esc(e.twist.icon)}</b>${esc(e.twist.name)}</span>` : '';
    el.innerHTML = `<span class="rb-r">Round ${e.round}</span><span class="rb-b">Bet <b>${e.bet}</b></span>${tw}`;
    const st = R('stage') && R('stage').getBoundingClientRect();
    if (st) el.style.top = Math.max(70, st.top + 10) + 'px';
    castLayer.appendChild(el); sfx.roundStart();
    if (e.twist) twistSlam(e.twist);
    lastLives();
    const life = e.twist ? 2600 : 1700;
    if (!reduced && el.animate) el.animate([{ opacity: 0, transform: 'translate(-50%,-14px) scale(.94)' }, { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: 0.14 }, { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%,-8px) scale(.98)' }], { duration: life, easing: EASE.out, fill: 'forwards' });
    setTimeout(() => el.remove(), life + 60);
  }

  // ------------------------------------------------------------ round end: reveal -> rank-by-rank verdicts -> lives drain -> verdict slam -> results
  let outcomeTok = 0, skipOutcome = () => {};
  function drain(row) {
    if (row.livesBefore == null || row.livesAfter == null) return;
    const mine = row.id === view.you, tile = mine ? R('you') : seatEl(row.id); if (!tile) return;
    const bar = tile.querySelector(mine ? '.y-life' : '.lifebar span'), num = tile.querySelector(mine ? '.y-life b' : '.life i');
    const pct = (n) => Math.max(0, Math.min(100, (n / view.config.startingLives) * 100));
    if (!mine && bar && bar.animate) bar.animate([{ width: pct(row.livesBefore) + '%' }, { width: pct(row.livesAfter) + '%' }], { duration: 760, easing: EASE.inOut, fill: 'forwards' });
    if (num) { const t0 = performance.now(); const step = (t) => { const k = Math.min(1, (t - t0) / 760); num.textContent = Math.round(row.livesBefore + (row.livesAfter - row.livesBefore) * k); if (k < 1 && !disposed) requestAnimationFrame(step); }; requestAnimationFrame(step); }
    tile.classList.add('hurt'); fx.shake(tile, 7);
    const r = rectOf(tile); fx.embers(r.x, r.y, '#d9443f', 10);
  }
  function verdictAt(row, place) {
    const mine = row.id === view.you, tile = mine ? R('you') : seatEl(row.id); if (!tile) return;
    const r = rectOf(tile), x = Math.max(44, Math.min(fx.size().W - 44, r.x)), y = mine ? r.y - r.h * 0.42 : r.y;
    tile.classList.add(row.safe ? 'v-safe' : 'v-lost'); if (row.winner) tile.classList.add('v-best');
    if (row.safe) { fx.floatText(row.winner ? 'Closest' : 'Safe', x, y, { cls: 'chip win', ms: 1600 }); if (row.winner) fx.burst(r.x, r.y, { color: '#f2d24a', n: 26, speed: 300 }); sfx.flip(); }
    else { fx.floatText(`\u2212${row.loss} \u2665`, x, y, { cls: 'chip lose', ms: 1600 }); drain(row); }
  }
  function slam(o) {
    if (!o) return;
    const { W, H } = fx.size(), el = document.createElement('div');
    el.className = `verdict ${o.kind}`; el.innerHTML = `<div class="v-word">${esc(o.word)}</div><div class="v-sub">${esc(o.sub)}</div>`;
    castLayer.appendChild(el);
    if (o.kind === 'victory') { sfx.victory(); fx.confetti(undefined, 160); audio.haptic([40, 40, 40, 40, 120]); }
    else if (o.kind === 'safe') { sfx.win(); fx.confetti(undefined, 70); fx.burst(W / 2, H * 0.38, { color: '#f2d24a', n: 50, speed: 420 }); audio.haptic([30, 30, 60]); }
    else if (o.kind === 'out') { sfx.eliminate(); fx.flash('rgba(217,68,63,.55)', 1200); fx.shake(shell, 12); fx.embers(W / 2, H * 0.5, '#d9443f', 40); audio.haptic([80, 40, 160]); if (view.phase === 'gameOver') setTimeout(() => sfx.defeat(), 600); }
    else if (o.kind === 'bust') { sfx.bust(); setTimeout(sfx.lose, 250); fx.flash('rgba(217,68,63,.5)', 1000); fx.shake(shell, 11); fx.embers(W / 2, H * 0.5, '#d9443f', 30); audio.haptic([60, 30, 120]); }
    else if (o.kind === 'lost') { sfx.lose(); fx.flash('rgba(217,68,63,.35)', 900); fx.shake(shell, 6); fx.embers(W / 2, H * 0.5, '#d9443f', 18); audio.haptic(70); }
    fx.ring(W / 2, H * 0.38, o.kind === 'safe' || o.kind === 'victory' ? '#f2d24a' : '#d9443f', { r1: Math.min(W, H) * 0.7, life: 0.9, size: 4 });
    setTimeout(() => { if (!reduced && el.animate) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: EASE.out, fill: 'forwards' }).onfinish = () => el.remove(); else el.remove(); }, 1500);
    return el;
  }
  function runOutcome() {
    const tok = ++outcomeTok, r = view.roundResult; if (!r) return;
    const o = myOutcome(), final = view.phase === 'gameOver', rows = [...r.rows].sort((a, b) => a.rank - b.rank);
    ui.outcomePending = true; shell.classList.add('rend');
    const live = () => !disposed && tok === outcomeTok && ui.outcomePending;
    let fin = false;
    const finish = () => {
      if (fin || tok !== outcomeTok) return; fin = true;
      ui.outcomePending = false; lifeHold.clear(); shell.classList.remove('rend'); render();
    };
    skipOutcome = finish;
    const beat = reduced ? 120 : 170, t1 = reduced ? 200 : 700;
    rows.forEach((row, i) => setTimeout(() => { if (live()) verdictAt(row, i); }, t1 + i * beat));
    const t2 = Math.min(t1 + rows.length * beat + 220, 2000);
    setTimeout(() => { if (live()) slam(o); }, t2);
    setTimeout(finish, t2 + (final ? 2700 : 1500));
  }

  // ------------------------------------------------------------ timers
  const tmr = { ref: null, end: 0, raf: 0, s: -1 };
  function paintTimer() {
    const el = R('timer'), t = view.timer;
    if (!t || view.phase === 'gameOver') { el.classList.remove('on'); shell.style.removeProperty('--tf'); tmr.ref = null; return; }
    if (tmr.ref !== t) { tmr.ref = t; tmr.end = performance.now() + t.left; tmr.total = Math.max(1, t.total); }     // re-sync to the server on every view
    el.classList.add('on');
    if (!tmr.raf) tmr.raf = requestAnimationFrame(tickTimer);
  }
  function tickTimer() {
    tmr.raf = 0; if (disposed || !view.timer || view.phase === 'gameOver') return;
    const left = Math.max(0, tmr.end - performance.now()), f = Math.min(1, left / tmr.total), s = Math.ceil(left / 1000);
    const mine = (view.pending ? view.pending.playerId : view.turn) === view.you || (view.pending && view.pending.kind === 'vote');
    const el = R('timer'), low = s <= 10, urgent = s <= 5;
    el.style.setProperty('--f', f); el.classList.toggle('low', low); el.classList.toggle('urgent', urgent);
    shell.style.setProperty('--tf', low ? 1 - Math.min(1, left / 10000) : 0);
    const ring = mine ? root.querySelector('#r-you .coach') : root.querySelector('.seat.turn');
    root.querySelectorAll('.tring').forEach((n) => { if (n !== ring) { n.classList.remove('tring'); n.style.removeProperty('--tp'); } });
    if (ring) { ring.classList.add('tring'); ring.style.setProperty('--tp', f); ring.classList.toggle('low', low); ring.classList.toggle('urgent', urgent); }
    root.querySelectorAll('.tcount').forEach((n) => { if (n.__s !== s) { n.__s = s; n.textContent = s; } n.classList.toggle('low', low); n.classList.toggle('urgent', urgent); n.classList.toggle('mine', !!mine); });
    if (s !== tmr.s) { if (mine && urgent && left > 0) sfx.click(); tmr.s = s; }
    if (left > 0) tmr.raf = requestAnimationFrame(tickTimer);
  }

  // ------------------------------------------------------------ reacting to engine events and view changes
  function handleEvent(e) {
    switch (e.t) {
      case 'draw': if (actChip(e.pid, 'draw')) (e.pid === view.you ? sfx.draw() : sfx.deal()); break;
      case 'stand': if (actChip(e.pid, 'stand')) sfx.stand(); break;
      case 'roundStart': bannerRound(e); break;
      case 'roundEnd': runOutcome(); break;
      case 'eliminated': { const el = seatEl(e.pid), r = el && rectOf(el); if (r) fx.floatText('Out', r.x, r.y, { cls: 'chip lose', ms: 1500 }); break; }
      default:
    }
  }
  function castEvent(e) {
    if (e.kind === 'active') hold.add(e.uid);
    const o = ui.playRect && ui.playRect.uid === e.uid ? ui.playRect.rect : (e.pid === view.you ? null : originRect(e.pid));
    ui.playRect = null; ui.lastCast = { runeId: e.runeId, t: performance.now() };
    enqueueCast(e, o);
  }

  /** Effects that depend on how the new view differs from the old one (run after render). */
  function afterViewEffects(old) {
    const me = you();
    if (old.bet !== view.bet) defer(() => {
      const el = root.querySelector('.stake.bet .bnum'); if (!el) return;
      const up = view.bet > old.bet, c = fx.center(el), col = up ? '#ff9b6b' : '#6fe3d0';
      if (!reduced && el.animate) el.animate([{ transform: 'scale(1.6)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 600, easing: EASE.spring });
      fx.floatText(`${up ? '+' : '\u2212'}${Math.abs(view.bet - old.bet)}`, c.x, c.y + 6, { cls: up ? 'up' : 'down' });
      fx.ring(c.x, c.y, col, { r1: 64, life: 0.55, size: 2.5 });
      if (old.round === view.round) (up ? sfx.betUp : sfx.betDown)();
    });
    if (old.target !== view.target) defer(() => {
      const el = root.querySelector('.stake.target .num'); if (!el) return;
      const c = fx.center(el);
      if (!reduced && el.animate) el.animate([{ transform: 'scale(1.5)', filter: 'brightness(2.2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 700, easing: EASE.spring });
      fx.ring(c.x, c.y, '#19c2c9', { r1: 110, life: 0.8, size: 3 }); fx.burst(c.x, c.y, { color: '#19c2c9', n: 18, speed: 220 });
    });
    if (!ui.outcomePending && view.phase === 'turn') for (const p of view.players) {       // damage / heal from the authoritative lives
      const o = old.players.find((x) => x.id === p.id);
      if (!o || o.lives == null || p.lives == null || o.lives === p.lives) continue;
      const tile = p.id === view.you ? R('you') : seatEl(p.id), r = tile && rectOf(tile); if (!r) continue;
      const dl = p.lives - o.lives;
      fx.floatText(`${dl > 0 ? '+' : '\u2212'}${Math.abs(dl)} \u2665`, r.x, r.y, { cls: `chip ${dl > 0 ? 'win' : 'lose'}`, ms: 1400 });
      if (dl < 0) { tile.classList.add('hurt'); fx.shake(tile, 6); }
    }
    const om = old.players.find((x) => x.id === view.you);
    if (om && !reduced) for (const c of me.cards) {           // Prophecy on you: your face-down card is now shown to everyone
      const oc = om.cards.find((x) => x.uid === c.uid);
      if (!(oc && oc.faceDown && !oc.revealed && c.revealed)) continue;
      const el = root.querySelector(`#r-you .card[data-uid="${CSS.escape(String(c.uid))}"]`), r = el && rectOf(el); if (!r) continue;
      if (el.animate) el.animate([{ transform: 'scale(1.35)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 600, easing: EASE.spring });
      fx.ring(r.x, r.y, '#8a6cf5', { r1: 70, life: 0.6, size: 2.5 }); fx.floatText('Revealed to all', Math.max(70, Math.min(fx.size().W - 70, r.x)), r.y - 46, { cls: 'chip tag', ms: 1400 });
    }
    const yt = !!view.legal.yourTurn;
    if (yt && !prev.turnYou) { sfx.turn(); audio.haptic(20); }
    prev.turnYou = yt;
    const over = me.alive && view.phase === 'turn' && view.myTotal > view.target;
    if (over && !prev.over) {
      sfx.bust(); audio.haptic([50, 30, 90]);
      const t = root.querySelector('#mytotal');
      if (t) { const c = fx.center(t); fx.shake(R('you'), 6); fx.floatText(`Over ${view.target}`, c.x, c.y - 10, { cls: 'chip lose' }); fx.burst(c.x, c.y, { color: '#d9443f', n: 14, speed: 180 }); }
    }
    prev.over = over;
    const needVote = !!(view.pending && view.pending.kind === 'vote' && view.pending.voters.includes(view.you) && !view.pending.voted.includes(view.you));
    if (needVote && !prev.voteShown) sfx.vote();
    prev.voteShown = needVote;
  }

  // ------------------------------------------------------------ Exile reveal: stays on the vote screen, counts the votes, then names who is exiled
  let revealTok = 0;
  const canSkipReveal = () => !!ui.reveal && performance.now() - ui.reveal.t0 > (revealTiming(ui.reveal.v).T + 1.1) * 1000;
  function startReveal(v) {
    const tok = ++revealTok, { order, T } = revealTiming(v);
    ui.reveal = { v, t0: performance.now() }; ui.myVote = null;
    if (session.setPaused) session.setPaused(true);                   // the table waits for the reveal
    const live = () => !disposed && tok === revealTok && ui.reveal;
    order.forEach((_, k) => setTimeout(() => { if (live()) sfx.vote(); }, (0.55 + k * 0.3) * 1000));
    setTimeout(() => {
      if (!live()) return;
      sfx.eliminate(); audio.haptic([80, 40, 160]); fx.flash('rgba(217,68,63,.5)', 1100); fx.shake(shell, 12);
      const w = root.querySelector('.vr-c.win'), c = w && fx.center(w);
      if (c) { fx.ring(c.x, c.y, '#d9443f', { r1: 220, life: 0.9, size: 4 }); fx.embers(c.x, c.y, '#d9443f', 32); }
    }, (T + 0.05) * 1000);
    setTimeout(() => endReveal(tok), (T + 4.4) * 1000);
  }
  function endReveal(tok) {
    if (tok !== revealTok || !ui.reveal) return;
    const v = ui.reveal.v; ui.reveal = null;
    if (session.setPaused && !disposed && castActive === 0) session.setPaused(false);
    render();
    setTimeout(() => {                                               // point at the exiled player once the table is back
      if (disposed) return;
      const id = v.exiledId, tile = id === view.you ? R('you') : seatEl(id), r = tile && rectOf(tile);
      if (id !== view.you) showSeat(id, { instant: true });
      if (!r) return;
      fx.floatText('Exiled', Math.max(50, Math.min(fx.size().W - 50, r.x)), r.y, { cls: 'chip lose', ms: 1600 }); fx.ring(r.x, r.y, '#d9443f', { r1: 90, life: 0.6, size: 3 });
    }, 80);
  }

  /** Commit a view to the screen (immediately, or at the moment a cast lands). */
  function applyView(v, events = []) {
    if (disposed) return;
    const old = view, prevRects = new Map(lastRects), xf = ui.xfer;
    view = v; ui.busy = false;
    if (old.round !== v.round) for (const n of Object.values(ui.notes)) { n.c = {}; n.t = []; }       // card / play guesses are per round (rune guesses carry over)
    const oldMe = old.players.find((x) => x.id === v.you);
    if (old.pending && old.pending.kind === 'vote' && !(v.pending && v.pending.kind === 'vote') && v.lastVote && oldMe && oldMe.alive && old.pending.voters.includes(v.you)) startReveal(v.lastVote);
    if (events.some((e) => e.t === 'roundEnd')) { ui.outcomePending = true; lifeHold.clear(); old.players.forEach((p) => { if (p.lives != null) lifeHold.set(p.id, p.lives); }); }
    trackCards();
    render();
    for (const e of events) handleEvent(e);
    afterViewEffects(old);
    flyOppRunes();
    if (old.round === v.round && v.phase === 'turn') { diffFlights(old, prevRects); runeTransfers(old, prevRects, xf); }
  }
  let latest = view;
  function onView(v) {
    if (disposed) return;
    latest = v; ui.busy = false;
    const fresh = v.log.filter((l) => l.id > prev.lastLog);
    if (fresh.length) prev.lastLog = fresh[fresh.length - 1].id;
    const events = [];
    for (const l of fresh) { const e = l.ev; if (!e) continue; if (e.t === 'rune') castEvent(e); else events.push(e); }
    if (castActive > 0) { waiting.push({ v, events, seq: castSeq }); return; }
    applyView(v, events);
  }

  // ----------------------------------------------------------------- input
  function send(action) {
    const res = session.send(action);
    if (!res.ok) { sfx.error(); toast(res.error, true); cancelGhosts(); render(); }
    return res;
  }
  const findOpt = (step, id) => step.options.find((o) => String(o.id) === String(id));
  const QUIET = new Set(['draw', 'stand', 'play', 'pick', 'vote', 'ready', 'scrim', 'tog-sfx', 'tog-amb', 'reveal-end']);

  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const a = el.dataset.act;
    if (!QUIET.has(a)) sfx.click();
    switch (a) {
      case 'draw': return void doDraw();
      case 'stand': return void doStand();
      case 'ready': return void send({ type: 'ready' });
      case 'vote': {
        if (!view.pending || view.pending.kind !== 'vote' || view.pending.voted.includes(view.you) || ui.myVote != null) return;
        ui.myVote = el.dataset.id; render();
        const res = send({ type: 'vote', target: view.pending.candidates.find((c) => String(c) === el.dataset.id) });
        if (!res.ok) { ui.myVote = null; render(); }
        return;
      }
      case 'reveal-end': if (canSkipReveal()) endReveal(revealTok); return;
      case 'note-open': ui.noteOpen = ui.noteOpen === el.dataset.id ? null : el.dataset.id; return render();
      case 'note-card': { const n = noteOf(el.dataset.id), v = el.dataset.v, c = n.c[v]; if (!c) n.c[v] = 'm'; else if (c === 'm') n.c[v] = 'x'; else delete n.c[v]; return render(); }
      case 'note-tag': { const n = noteOf(el.dataset.id), t = el.dataset.t, i = n.t.indexOf(t); if (i < 0) n.t.push(t); else n.t.splice(i, 1); return render(); }
      case 'note-rune': { const n = noteOf(el.dataset.id), r = el.dataset.r, i = n.r.indexOf(r); if (i < 0) n.r.push(r); else n.r.splice(i, 1); return render(); }
      case 'note-runes': ui.runePick = !ui.runePick; return render();
      case 'note-clear': ui.notes[el.dataset.id] = { c: {}, t: [], r: [] }; return render();
      case 'pick': return void send({ type: 'pick', cardUid: view.pending.cards.find((c) => String(c.uid) === el.dataset.id).uid });
      case 'menu': ui.panel = 'menu'; return render();
      case 'fs': return void toggleFs();
      case 'drawer': return void setDrawer(!ui.drawer);
      case 'rune-nav': return void browseRunes(+el.dataset.d || 1);
      case 'status': { ui.stOpen = ui.stOpen === el.dataset.k ? null : el.dataset.k; sfx.click(); return render(); }
      case 'twist': ui.pop = ui.pop === 'twist' ? null : 'twist'; if (ui.panel === 'menu') ui.panel = null; return render();
      case 'close-dock': ui.panel = null; return render();
      case 'play-sel': { const r = runesOf()[ui.runeSel]; if (r) playRune(r.uid); return; }
      case 'panel-players': ui.panel = ui.panel === 'players' ? null : 'players'; return render();
      case 'seat-go': if (el.dataset.id) showSeat(el.dataset.id, { user: true }); return;
      case 'panel-keys': ui.panel = 'keys'; return render();
      case 'tog-follow': setPref('follow', el.checked); return;
      case 'sound': audio.set('sfx', !audio.settings().sfx); if (audio.settings().sfx) sfx.click(); return render();
      case 'tog-sfx': audio.set('sfx', el.checked); return render();
      case 'tog-amb': audio.set('amb', el.checked); return render();
      case 'panel-menu': ui.panel = 'menu'; ui.inspect = null; return render();
      case 'panel-log': ui.panel = 'log'; return render();
      case 'panel-rules': ui.panel = 'rules'; return render();
      case 'panel-gallery': ui.panel = 'gallery'; return render();
      case 'inspect-unit': ui.inspect = { unit: +el.dataset.v }; return render();
      case 'inspect-rune-id': ui.inspect = { runeId: el.dataset.id }; return render();
      case 'inspect-rune': {
        const i = runesOf().findIndex((x) => String(x.uid) === el.dataset.uid);      // select + preview in place: the drawer never gets a modal on top of it
        if (i >= 0) {
          const was = ui.preview, d = i - ui.runeSel;
          ui.runeSel = i; ui.preview = true; ui.pvFx = { dir: was ? Math.sign(d) : 0, enter: !was };
          sfx.click(); render(); paintSel({ scroll: true });
        }
        return;
      }
      case 'play': { const i = ui.inspect; if (i && i.uid != null) playRune(i.uid); return; }
      case 'choose': {
        const ch = ui.choose; if (!ch) return;
        const info = view.legal.runes[ch.runeUid], step = info.steps[ch.step];
        const opt = findOpt(step, el.dataset.id); if (!opt) return;
        ch.params[step.kind] = opt.id;
        if (ch.step + 1 < info.steps.length) { ch.step += 1; return render(); }
        const action = { type: 'playRune', runeUid: ch.runeUid, params: ch.params };
        ui.choose = null; predictRune(ch.runeUid); render();
        return void send(action);
      }
      case 'choose-back': if (ui.choose && ui.choose.step > 0) ui.choose.step -= 1; else ui.choose = null; return render();
      case 'dev-give': return void send({ type: 'debugGiveRune', runeId: root.querySelector('#devrune').value });
      case 'close': if (ui.inspect) ui.inspect = null; else ui.panel = null; ui.pop = null; return render();
      case 'scrim':
        if (e.target !== el) return;
        if (ui.choose) ui.choose = null; else if (ui.inspect) ui.inspect = null; else ui.panel = null;
        return render();
      case 'exit': return onExit();
      default:
    }
  }
  // ------------------------------------------------------------ drawer + play helpers
  const wrap = root.querySelector('#r-wrap');
  const runesOf = () => you().runes || [];
  const clampSel = () => { ui.runeSel = Math.max(0, Math.min(ui.runeSel, runesOf().length - 1)); };
  function setDrawer(on) { if (ui.drawer === on) return; ui.drawer = on; if (on) { clampSel(); ui.fan = true; } else ui.preview = false; render(); paintSel({ scroll: on }); trackClip(); }
  function playRune(uid) {
    const info = view.legal.runes[uid];
    if (!info) return;
    if (info.reason) { sfx.error(); toast(info.reason, true); return; }
    const ce = ui.drawer ? root.querySelector(`.dr-cards .card[data-uid="${uid}"]`) : null;
    const from = ce ? rectOf(ce) : null;
    ui.playRect = from ? { uid, rect: from } : null;         // the card is seen leaving your drawer
    ui.inspect = null; ui.drawer = false; ui.preview = false;
    if (!info.steps.length) { predictRune(uid, from); render(); return void send({ type: 'playRune', runeUid: uid, params: {} }); }
    ui.choose = { runeUid: uid, step: 0, params: {} };
    render();
  }
  /** Keyboard / list focus inside whichever sheet is open. */
  function focusSheet() {
    const sh = root.querySelector('.sheet'); if (!sh || sh.contains(document.activeElement)) return;
    const b = sh.querySelector('button:not(:disabled)'); if (b) b.focus({ preventScroll: true });
  }
  const modalOpen = () => !!root.querySelector('.scrim');

  // ------------------------------------------- Draw / Stand: two plain buttons. One click or tap does it (keyboard: D and S).
  function paintGo() { const b = root.querySelector('.acts'); if (b) b.classList.toggle('busy', !!ui.busy); }
  function doDraw() {
    const L = latest.legal;
    if (!L.yourTurn) { toast('Not your turn yet'); return; }
    if (ui.busy) return;
    if (!L.canDraw) { sfx.error(); toast(L.drawReason || 'You can\u2019t draw right now', true); return; }
    ui.busy = true; paintGo();
    predictDraw(); if (actChip(view.you, 'draw')) sfx.draw();        // predicted: it moves now, the server confirms a moment later
    send({ type: 'draw' });
  }
  function doStand() {
    const L = latest.legal;
    if (!L.yourTurn) { toast('Not your turn yet'); return; }
    if (ui.busy || !L.canStand) return;
    ui.busy = true; paintGo();
    if (actChip(view.you, 'stand')) sfx.stand();
    send({ type: 'stand' });
  }

  function onDown(e) {
    if (ui.outcomePending && !(e.target.closest && e.target.closest('button'))) return void skipOutcome();
    if (ui.pop && !(e.target.closest && e.target.closest('.twistpop, [data-act="twist"]'))) { ui.pop = null; render(); }
    if (ui.stOpen && !(e.target.closest && e.target.closest('.st, .st-pop'))) { ui.stOpen = null; render(); }
    if (ui.drawer && !wrap.contains(e.target) && !e.target.closest('.scrim, .dock')) setDrawer(false);
  }

  // ------------------------------------------------------------------ keyboard
  //   Left (or D) = Draw, Right (or S) = Stand (or just click the buttons)        Drawer open: Left / Right browse the runes, Space plays the selected one
  //   Up: open the rune drawer, then preview the selected card       Down: close the drawer
  //   Tab: players panel     T: round twist     Esc: close the topmost thing     Space / Enter / click: skip the round-end show
  //   Inside a sheet: arrows move between options, Space / Enter picks.   Nothing here is blocked by animations.
  /** Arrow keys move focus the way the buttons are laid out: Down goes to the row below, Right to the next one on the row.
   *  Nothing below / beside? Wrap to the far end of that column / row. */
  function arrowFocus(list, key) {
    const dx = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0, dy = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
    const cur = list.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) { (dx + dy > 0 ? list[0] : list[list.length - 1]).focus(); return; }
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; };
    const c = box(cur); let best = null, bs = Infinity, far = null, fs = -1;
    for (const el of list) {
      if (el === cur) continue;
      const r = box(el), vx = r.x - c.x, vy = r.y - c.y;
      const along = dx ? vx * dx : vy * dy, across = Math.abs(dx ? vy : vx);
      if (dx && across > c.h * 0.6) continue;                         // Left / Right never leave the row
      if (along > 4) { const sc = along + across * 2.5; if (sc < bs) { bs = sc; best = el; } }   // Up / Down: nearest in that direction, prefer the same column
      else if (along < -4 && across <= (dx ? c.h : c.w) * 0.6 && -along > fs) { fs = -along; far = el; }   // wrap to the far end of this row / column
    }
    const t = best || far;
    if (t) t.focus();                                                 // (a lone button in its row / column simply stays focused)
  }
  let eatSpace = false, spaceOwned = false;
  function onKey(e) {
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    const k = e.key, isSpace = k === ' ';
    if ((isSpace || k === 'Enter') && ui.outcomePending && !modalOpen()) { e.preventDefault(); eatSpace = true; skipOutcome(); return; }
    if (eatSpace && (isSpace || k === 'Enter')) { e.preventDefault(); return; }
    if (k === 'Tab') {
      if (ui.panel === 'players') { e.preventDefault(); ui.panel = null; render(); }
      else if (!modalOpen()) { e.preventDefault(); ui.panel = 'players'; render(); }
      return;
    }
    if (k === 'Escape') {
      if (ui.reveal) { if (canSkipReveal()) endReveal(revealTok); return; }
      if (ui.choose) ui.choose = null; else if (ui.inspect) ui.inspect = null; else if (ui.pop) ui.pop = null; else if (ui.panel) ui.panel = null; else if (ui.stOpen) ui.stOpen = null;
      else if (ui.drawer && ui.preview) ui.preview = false; else if (ui.drawer) ui.drawer = false; else return;
      render(); return;
    }
    if (modalOpen()) {
      if (!k.startsWith('Arrow')) return;                       // Space / Enter act on the focused button natively
      const f = [...root.querySelectorAll('.sheet button:not(:disabled)')]; if (!f.length) return;
      e.preventDefault();
      arrowFocus(f, k);
      return;
    }
    if (k.startsWith('Arrow') && ui.panel === 'players' && document.activeElement && document.activeElement.closest && document.activeElement.closest('.dock')) {
      const f = [...root.querySelectorAll('.dock button:not(:disabled)')];
      if (f.length) { e.preventDefault(); arrowFocus(f, k); return; }
    }
    if (k === 'd' || k === 'D') { e.preventDefault(); if (!e.repeat) doDraw(); return; }
    if (k === 's' || k === 'S') { e.preventDefault(); if (!e.repeat) doStand(); return; }
    if (k === '?') { e.preventDefault(); ui.panel = ui.panel === 'keys' ? null : 'keys'; render(); return; }
    if (k === 'l' || k === 'L') { e.preventDefault(); ui.panel = 'log'; render(); return; }
    if (k === 'm' || k === 'M') { audio.set('sfx', !audio.settings().sfx); toast(audio.settings().sfx ? 'Sound on' : 'Sound off'); render(); return; }
    if (k === 't' || k === 'T') { if (view.twist || ui.pop) { e.preventDefault(); ui.pop = ui.pop ? null : 'twist'; render(); } return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (ui.drawer && runesOf().length) { const t = performance.now(); if (!e.repeat || t - (ui.navKey || 0) > 110) { ui.navKey = t; browseRunes(k === 'ArrowLeft' ? -1 : 1); } return; }   // runes open: browse them (an empty drawer leaves the keys as Draw / Stand)
      if (!e.repeat) { if (k === 'ArrowLeft') doDraw(); else doStand(); }
      return;
    }
    if (k === 'ArrowUp') {
      e.preventDefault();
      if (!ui.drawer) setDrawer(true);
      else if (runesOf().length && !ui.preview) { ui.preview = true; ui.pvFx = { dir: 0, enter: true }; sfx.click(); render(); paintSel({ scroll: true }); }       // Up inside the drawer = preview the selected card
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); if (ui.drawer && ui.preview) { ui.preview = false; sfx.click(); render(); } else setDrawer(false); return; }   // Down: close the preview first, then the drawer
    if (isSpace) {
      e.preventDefault(); spaceOwned = true;
      if (e.repeat) return;
      if (ui.drawer) { const r = runesOf()[ui.runeSel]; if (r) playRune(r.uid); else toast('No runes in your hand yet'); }
    }
  }
  function onKeyUp(e) {
    if ((e.key === ' ' || e.key === 'Enter') && (eatSpace || spaceOwned)) { e.preventDefault(); eatSpace = false; spaceOwned = false; }
  }
  /** While your rune drawer is open, cast banners, flying cards and effects are cut out over it, so what other players do never covers your runes. */
  const OVERLAYS = ['cast', 'cinema', 'flights', 'floaters', 'fx'].map((id) => document.getElementById(id)).filter(Boolean);
  let clipRaf = 0;
  function clipOverlays() {
    const dr = R('drawer'), r = ui.drawer ? dr.getBoundingClientRect() : null;
    const cp = r && r.height > 8
      ? `polygon(evenodd, 0 0, ${innerWidth}px 0, ${innerWidth}px ${innerHeight}px, 0 ${innerHeight}px, 0 0, ${r.left}px ${r.top}px, ${r.right}px ${r.top}px, ${r.right}px ${r.bottom}px, ${r.left}px ${r.bottom}px, ${r.left}px ${r.top}px)` : '';
    for (const o of OVERLAYS) o.style.clipPath = cp;
  }
  function trackClip() {                                          // follow the drawer while it slides open / closed
    cancelAnimationFrame(clipRaf); const t0 = performance.now();
    const step = () => { clipOverlays(); if (!disposed && performance.now() - t0 < 520) clipRaf = requestAnimationFrame(step); };
    clipRaf = requestAnimationFrame(step);
  }
  window.addEventListener('resize', clipOverlays);

  // ------------------------------------------------------------ scroll rails: the table's active runes, your rune drawer, the notes' rune picker
  const RAIL_SCROLLER = '.active-row, .dr-cards, .np-runes';
  function paintRail(box) {
    const sc = box.querySelector(RAIL_SCROLLER); if (!sc) return;
    const max = sc.scrollWidth - sc.clientWidth, over = max > 4;
    box.dataset.over = over ? '1' : '';
    if (!over) { box.dataset.l = ''; box.dataset.r = ''; return; }
    const tr = box.querySelector('.rtrack'), th = box.querySelector('.rthumb'); if (!tr || !th) return;
    const tw = tr.clientWidth, size = Math.max(32, Math.min(tw, tw * sc.clientWidth / sc.scrollWidth));
    th.style.width = size + 'px'; th.style.transform = `translateX(${(tw - size) * Math.max(0, Math.min(1, sc.scrollLeft / max))}px)`;
    box.dataset.l = sc.scrollLeft > 4 ? '1' : ''; box.dataset.r = sc.scrollLeft < max - 4 ? '1' : '';
  }
  const paintRails = () => root.querySelectorAll('.railed').forEach(paintRail);
  const onRailScroll = (e) => { const b = e.target.closest && e.target.closest('.railed'); if (b && e.target.matches && e.target.matches(RAIL_SCROLLER)) paintRail(b); };
  const onRailClick = (e) => {
    const b = e.target.closest && e.target.closest('[data-rail]'); if (!b || !root.contains(b)) return;
    const sc = b.closest('.railed').querySelector(RAIL_SCROLLER); if (!sc) return;
    sfx.click(); sc.scrollBy({ left: +b.dataset.rail * Math.max(90, sc.clientWidth * 0.7), behavior: reduced ? 'instant' : 'smooth' });
  };
  let railDrag = null;
  const onRailDown = (e) => {
    const tr = e.target.closest && e.target.closest('.rtrack'); if (!tr || !root.contains(tr) || (e.pointerType === 'mouse' && e.button)) return;
    const box = tr.closest('.railed'), sc = box.querySelector(RAIL_SCROLLER), th = tr.querySelector('.rthumb'); if (!sc || !th) return;
    e.preventDefault();
    const tw = tr.clientWidth, size = th.offsetWidth, max = sc.scrollWidth - sc.clientWidth;
    if (e.target.closest('.rthumb')) { railDrag = { sc, box, x: e.clientX, l: sc.scrollLeft, k: max / Math.max(1, tw - size) }; box.classList.add('dragging'); }
    else { const r = tr.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left - size / 2) / Math.max(1, tw - size))); sc.scrollTo({ left: f * max, behavior: reduced ? 'instant' : 'smooth' }); }
  };
  const onRailMove = (e) => { if (railDrag) railDrag.sc.scrollLeft = railDrag.l + (e.clientX - railDrag.x) * railDrag.k; };
  const onRailUp = () => { if (railDrag) { railDrag.box.classList.remove('dragging'); railDrag = null; } };
  root.addEventListener('scroll', onRailScroll, true);
  root.addEventListener('click', onRailClick);
  root.addEventListener('pointerdown', onRailDown);
  document.addEventListener('pointermove', onRailMove); document.addEventListener('pointerup', onRailUp); document.addEventListener('pointercancel', onRailUp);
  window.addEventListener('resize', paintRails);

  // ------------------------------------------------------------ scrolling: opponents, hand, runes
  // wheel -> sideways, mouse drag on the opponent strip, edge cues / dots follow the scroll, a gentle tilt + glare on cards you hover
  const SCROLLERS = '.seats, .hand, .dr-cards, .active-row, .np-runes';
  const onWheel = (e) => {
    const sc = e.target.closest && e.target.closest(SCROLLERS);
    if (!sc || sc.scrollWidth <= sc.clientWidth + 2 || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.ctrlKey) return;
    e.preventDefault(); sc.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 32 : 1);
    if (sc === strip()) ui.userScroll = performance.now();
  };
  let drag = null, swallow = false;
  const onStripDown = (e) => {
    const st = e.pointerType === 'mouse' && !e.button && e.target.closest && e.target.closest('.seats');
    if (st && st.scrollWidth > st.clientWidth + 4) drag = { st, x: e.clientX, l: st.scrollLeft, moved: false };
    else if (e.target.closest && e.target.closest('.seats')) ui.userScroll = performance.now();
  };
  const onStripMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; drag.st.classList.add('drag'); ui.userScroll = performance.now(); }
    if (drag.moved) drag.st.scrollLeft = drag.l - dx;
  };
  const onStripUp = () => {
    if (!drag) return;
    const d = drag; drag = null; d.st.classList.remove('drag');
    if (d.moved) { swallow = true; setTimeout(() => { swallow = false; }, 60); }
  };
  const onSwallow = (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); } };
  let strPaint = 0;
  const onStripScroll = () => { if (!strPaint) strPaint = requestAnimationFrame(() => { strPaint = 0; if (!disposed) paintStrip(); }); };
  const TILT = '.hand > button .card, .dr-cards > button .card, .active-item .card';
  let tilted = null;
  const untilt = () => { if (tilted) { tilted.style.removeProperty('--rx'); tilted.style.removeProperty('--ry'); tilted.removeAttribute('data-tilt'); tilted = null; } };
  const onTilt = (e) => {
    if (e.pointerType !== 'mouse' || reduced) return;
    const c = e.target.closest && e.target.closest(TILT);
    if (tilted && tilted !== c) untilt();
    if (!c) return;
    const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    tilted = c; c.dataset.tilt = '1';
    c.style.setProperty('--ry', ((px - 0.5) * 16).toFixed(1) + 'deg'); c.style.setProperty('--rx', ((0.5 - py) * 16).toFixed(1) + 'deg');
    c.style.setProperty('--gx', (px * 100).toFixed(0) + '%'); c.style.setProperty('--gy', (py * 100).toFixed(0) + '%');
  };
  const onAnimEnd = (e) => { if (e.animationName === 'hurtFlash') e.target.classList.remove('hurt'); else if (e.animationName === 'acted') e.target.classList.remove('acted'); };
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('click', onSwallow, true);
  root.addEventListener('animationend', onAnimEnd);
  strip().addEventListener('scroll', onStripScroll, { passive: true });
  document.addEventListener('pointerdown', onStripDown); document.addEventListener('pointermove', onStripMove); document.addEventListener('pointerup', onStripUp); document.addEventListener('pointercancel', onStripUp);
  document.addEventListener('pointermove', onTilt);
  window.addEventListener('resize', onStripScroll);
  document.addEventListener('pointerdown', onDown);
  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  const offFs = onFsChange(() => render());
  const unsub = session.subscribe(onView);

  // Opening: show the round-1 title card, then draw the board (cards deal in from the deck).
  view.log.filter((l) => l.ev && l.ev.t === 'roundStart').slice(-1).forEach((l) => handleEvent(l.ev));
  trackCards();
  render();
  flyOppRunes();

  return () => {
    disposed = true; unsub(); cinema.clear();
    cancelAnimationFrame(tmr.raf); window.removeEventListener('solace:reject', cancelGhosts);
    for (const g of ghosts.values()) g.cancel();
    document.removeEventListener('pointerdown', onDown);
    root.removeEventListener('wheel', onWheel); root.removeEventListener('click', onSwallow, true); root.removeEventListener('animationend', onAnimEnd);
    document.removeEventListener('pointerdown', onStripDown); document.removeEventListener('pointermove', onStripMove); document.removeEventListener('pointerup', onStripUp); document.removeEventListener('pointercancel', onStripUp);
    document.removeEventListener('pointermove', onTilt); window.removeEventListener('resize', onStripScroll); cancelAnimationFrame(strPaint);
    root.removeEventListener('scroll', onRailScroll, true); root.removeEventListener('click', onRailClick); root.removeEventListener('pointerdown', onRailDown);
    document.removeEventListener('pointermove', onRailMove); document.removeEventListener('pointerup', onRailUp); document.removeEventListener('pointercancel', onRailUp); window.removeEventListener('resize', paintRails);
    revealTok++; cancelAnimationFrame(clipRaf); window.removeEventListener('resize', clipOverlays); for (const o of OVERLAYS) o.style.clipPath = '';
    delete document.documentElement.dataset.mood; delete document.documentElement.dataset.life;
    offFs(); root.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp);
    if (session.setPaused) session.setPaused(false);
    castLayer.innerHTML = ''; root.innerHTML = '';
  };
}
