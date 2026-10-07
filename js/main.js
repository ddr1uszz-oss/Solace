import { LocalSession } from './engine/session.js';
import { mountGame } from './ui/game-ui.js';
import { esc } from './ui/cards.js';
import { audio } from './ui/audio.js';
import { createFx } from './ui/fx.js';
import { fsSupported, toggleFs } from './ui/fullscreen.js';
import { NetworkSession } from './net/client.js';
import { TWIST_PRESETS } from './engine/twists.js';
import { OPTIONS } from './engine/options.js';
import { DEFAULT_CONFIG } from './engine/config.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const fx = createFx({ fg: document.getElementById('fx'), bg: document.getElementById('bg'), floaters: document.getElementById('floaters') });
audio.init();

let toastTimer;
function toast(text, isErr = false) {
  toastEl.textContent = text;
  toastEl.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = ''; }, isErr ? 2600 : 2400);
}

const SPEEDS = { fast: 600, normal: 1000, slow: 1600 };
const defaults = { name: 'You', opponents: 3, lives: 10, speed: 'normal', test: false, turnDirection: 'alternate', showDirection: true, showLives: true, showRuneCount: true, twistPreset: 'mild', runeHandLimit: 6, turnTimer: 0, runeDrawChance: 0.25, ...Object.fromEntries(OPTIONS.map((o) => [o.key, DEFAULT_CONFIG[o.key]])) };

// ---- table rules (shared by the start screen and the online lobby; stored as game config) ----
const DIRS = { cw: 'Clockwise', ccw: 'Counter', alternate: 'Alternate' };
const TIMERS = [0, 15, 30, 45, 60, 90, 120];
const fmtTimer = (v) => (v ? v + 's' : 'Off');
const fmtChance = (v) => (v ? Math.round(v * 100) + '%' : 'Off');
const onOff = (v) => (v ? 'On' : 'Off');
/** The data-driven options from engine/options.js (scoring, deck sizes, disconnects). `online` also shows the online-only ones. */
function optionsHTML(r, dis, online) {
  return OPTIONS.filter((o) => online || !o.online).map((o) => {
    const cur = r[o.key] === undefined ? DEFAULT_CONFIG[o.key] : r[o.key];
    const help = o.help ? `<p class=\"mp-note\">${o.help}</p>` : '';
    if (o.kind === 'choice') {
      return `<div><span class=\"lbl\">${o.label}</span><div class=\"seg\" role=\"group\" aria-label=\"${o.label}\">${o.values.map(([v, l]) => `<button data-opt=\"${o.key}\" data-v=\"${v}\" aria-pressed=\"${cur === v}\"${dis}>${l}</button>`).join('')}</div>${help}</div>`;
    }
    return `<div><span class=\"lbl\">${o.label}</span><div class=\"stepper\"><button data-optstep=\"${o.key}:-1\" aria-label=\"Lower: ${o.label}\"${dis}>&minus;</button><output id=\"o-opt-${o.key}\">${o.fmt(cur)}</output><button data-optstep=\"${o.key}:1\" aria-label=\"Higher: ${o.label}\"${dis}>+</button></div>${help}</div>`;
  }).join('');
}
function rulesHTML(r, ro = false, online = false) {
  const dis = ro ? ' disabled' : '';
  return `
      <div><span class="lbl">Turn direction</span>
        <div class="seg" role="group" aria-label="Turn direction">${Object.entries(DIRS).map(([k, v]) => `<button data-dir="${k}" aria-pressed="${r.turnDirection === k}"${dis}${k === 'ccw' ? ' aria-label="Counter-clockwise"' : ''}>${v}</button>`).join('')}</div></div>
      <div><span class="lbl">Show turn direction</span>
        <div class="seg" role="group" aria-label="Show turn direction">${[true, false].map((v) => `<button data-toggle="showDirection" data-v="${v}" aria-pressed="${r.showDirection !== false === v}"${dis}>${onOff(v)}</button>`).join('')}</div></div>
      <div><span class="lbl">Show opponents\u2019 lives</span>
        <div class="seg" role="group" aria-label="Show opponents lives">${[true, false].map((v) => `<button data-toggle="showLives" data-v="${v}" aria-pressed="${r.showLives !== false === v}"${dis}>${onOff(v)}</button>`).join('')}</div></div>
      <div><span class="lbl">Show opponents\u2019 rune card count</span>
        <div class="seg" role="group" aria-label="Show how many rune cards opponents hold">${[true, false].map((v) => `<button data-toggle="showRuneCount" data-v="${v}" aria-pressed="${(r.showRuneCount !== false) === v}"${dis}>${onOff(v)}</button>`).join('')}</div>
        <p class="mp-note">On: you see how many rune cards each opponent holds. Off: that number is hidden.</p></div>
      <div><span class="lbl">Round twists</span>
        <div class="seg" role="group" aria-label="Round twists">${Object.entries(TWIST_PRESETS).map(([k, v]) => `<button data-twist="${k}" aria-pressed="${(r.twistPreset || 'off') === k}" title="${v.blurb}"${dis}>${v.label}</button>`).join('')}</div>
        <p class="mp-note" id="twist-blurb">${(TWIST_PRESETS[r.twistPreset] || TWIST_PRESETS.off).blurb}</p></div>
      <div><span class="lbl">Turn timer</span>
        <div class="stepper"><button data-rule="turnTimer:-1" aria-label="Shorter timer"${dis}>&minus;</button><output id="o-turnTimer">${fmtTimer(r.turnTimer)}</output><button data-rule="turnTimer:1" aria-label="Longer timer"${dis}>+</button></div></div>
      <div><span class="lbl">Rune cards each player can hold</span>
        <div class="stepper"><button data-rule="runeHandLimit:-1" aria-label="Smaller rune hand"${dis}>&minus;</button><output id="o-runeHandLimit">${r.runeHandLimit ?? 6}</output><button data-rule="runeHandLimit:1" aria-label="Larger rune hand"${dis}>+</button></div></div>
      <div><span class="lbl">Free rune when drawing a card</span>
        <div class="stepper"><button data-rule="runeDrawChance:-1" aria-label="Lower chance"${dis}>&minus;</button><output id="o-runeDrawChance">${fmtChance(r.runeDrawChance)}</output><button data-rule="runeDrawChance:1" aria-label="Higher chance"${dis}>+</button></div></div>
      ${optionsHTML(r, dis, online)}`;
}
/** Wire the controls from rulesHTML. `r` is updated in place; onChange(key, value) fires after each change. */
function bindRules(root, r, onChange) {
  root.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => {
    r.turnDirection = b.dataset.dir;
    root.querySelectorAll('[data-dir]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    onChange('turnDirection', r.turnDirection);
  }));
  root.querySelectorAll('[data-twist]').forEach((b) => b.addEventListener('click', () => {
    r.twistPreset = b.dataset.twist;
    root.querySelectorAll('[data-twist]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const nb = root.querySelector('#twist-blurb'); if (nb) nb.textContent = TWIST_PRESETS[r.twistPreset].blurb;
    onChange('twistPreset', r.twistPreset);
  }));
  root.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.toggle;
    r[k] = b.dataset.v === 'true';
    root.querySelectorAll(`[data-toggle="${k}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    onChange(k, r[k]);
  }));
  root.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.opt, o = OPTIONS.find((x) => x.key === k), v = o.values.map(([x]) => x).find((x) => String(x) === b.dataset.v);
    r[k] = v;
    root.querySelectorAll(`[data-opt="${k}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    onChange(k, v);
  }));
  root.querySelectorAll('[data-optstep]').forEach((b) => b.addEventListener('click', () => {
    const [k, d] = b.dataset.optstep.split(':'), o = OPTIONS.find((x) => x.key === k);
    const cur = r[k] === undefined ? DEFAULT_CONFIG[k] : r[k];
    let i = o.values.findIndex((x) => x === cur);
    if (i < 0) i = Math.max(0, o.values.findIndex((x) => typeof x === 'number' && x >= cur));
    r[k] = o.values[Math.max(0, Math.min(o.values.length - 1, i + +d))];
    root.querySelector('#o-opt-' + k).textContent = o.fmt(r[k]);
    onChange(k, r[k]);
  }));
  root.querySelectorAll('[data-rule]').forEach((b) => b.addEventListener('click', () => {
    const [k, d] = b.dataset.rule.split(':');
    if (k === 'turnTimer') { const i = Math.max(0, TIMERS.indexOf(r.turnTimer)); r.turnTimer = TIMERS[Math.max(0, Math.min(TIMERS.length - 1, i + +d))]; root.querySelector('#o-turnTimer').textContent = fmtTimer(r.turnTimer); }
    else if (k === 'runeHandLimit') { r.runeHandLimit = Math.max(2, Math.min(10, (r.runeHandLimit ?? 6) + +d)); root.querySelector('#o-runeHandLimit').textContent = r.runeHandLimit; }
    else { r.runeDrawChance = Math.max(0, Math.min(1, Math.round((r.runeDrawChance + 0.05 * +d) * 100) / 100)); root.querySelector('#o-runeDrawChance').textContent = fmtChance(r.runeDrawChance); }
    onChange(k, r[k]);
  }));
}
function loadSettings() { try { return { ...defaults, ...JSON.parse(localStorage.getItem('solace.settings') || '{}') }; } catch { return { ...defaults }; } }
function saveSettings(s) { try { localStorage.setItem('solace.settings', JSON.stringify(s)); } catch { /* private mode */ } }

let teardown = null;
function showStart() {
  if (teardown) { teardown(); teardown = null; }
  const s = loadSettings();
  const snd = audio.settings();
  app.innerHTML = `
  ${fsSupported() ? '<button class="txtbtn fs-start" id="fs">Full screen</button>' : ''}
  <div class="start"><div class="start-in">
    <div class="logo"><h1>SOLACE</h1><p>Reach the number. Keep your lives.</p></div>
    <div class="setup">
      <div><label for="name">Your name</label><input id="name" type="text" maxlength="14" value="${esc(s.name)}" autocomplete="off"></div>
      <div><span class="lbl">Opponents (computer players)</span>
        <div class="stepper"><button data-step="opponents:-1" aria-label="Fewer opponents">&minus;</button><output id="o-opponents">${s.opponents}</output><button data-step="opponents:1" aria-label="More opponents">+</button></div></div>
      <div><span class="lbl">Starting lives</span>
        <div class="stepper"><button data-step="lives:-1" aria-label="Fewer lives">&minus;</button><output id="o-lives">${s.lives}</output><button data-step="lives:1" aria-label="More lives">+</button></div></div>
      <div><span class="lbl">Opponent speed</span>
        <div class="seg">${Object.keys(SPEEDS).map((k) => `<button data-speed="${k}" aria-pressed="${s.speed === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
      ${rulesHTML(s)}
      <label class="check"><input type="checkbox" id="snd" ${snd.sfx ? 'checked' : ''}> Sound</label>
      <label class="check"><input type="checkbox" id="amb" ${snd.amb ? 'checked' : ''}> Ambient music</label>
      <label class="check"><input type="checkbox" id="test" ${s.test ? 'checked' : ''}> Test mode: add any rune to my hand from the menu</label>
    </div>
    <button class="btn primary" id="begin">Begin</button>
    <button class="btn" id="multi" style="margin-top:10px">Play online with friends</button>
  </div></div>`;

  const fsb = app.querySelector('#fs'); if (fsb) fsb.addEventListener('click', toggleFs);
  app.querySelector('#multi').addEventListener('click', () => { audio.unlock(); showMulti(); });
  const bounds = { opponents: [1, 9], lives: [3, 30] };
  app.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const [k, d] = b.dataset.step.split(':');
    s[k] = Math.max(bounds[k][0], Math.min(bounds[k][1], s[k] + +d));
    app.querySelector('#o-' + k).textContent = s[k];
  }));
  bindRules(app, s, () => {});
  app.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    s.speed = b.dataset.speed;
    app.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  app.querySelector('#begin').addEventListener('click', () => {
    s.name = (app.querySelector('#name').value.trim() || 'You').slice(0, 14);
    s.test = app.querySelector('#test').checked;
    saveSettings(s);
    audio.set('sfx', app.querySelector('#snd').checked);
    audio.set('amb', app.querySelector('#amb').checked);
    audio.unlock();                                  // this click is the user gesture browsers require
    startGame(s);
  });
}

function startGame(s) {
  const session = new LocalSession({
    humanName: s.name, aiCount: s.opponents, aiDelay: SPEEDS[s.speed],
    config: { startingLives: s.lives, devMode: s.test, turnDirection: s.turnDirection, showDirection: s.showDirection !== false, showLives: s.showLives !== false, showRuneCount: s.showRuneCount !== false, twistPreset: s.twistPreset, runeHandLimit: s.runeHandLimit, turnTimer: s.turnTimer, runeDrawChance: s.runeDrawChance, ...Object.fromEntries(OPTIONS.filter((o) => !o.online).map((o) => [o.key, s[o.key]])) },
  });
  window.solace = { session, game: session.game };       // handy for poking around in the browser console
  const unmount = mountGame(app, session, { onExit: showStart, toast, audio, fx });
  teardown = () => { unmount(); session.destroy(); };
}

// ------------------------------------------------------------------ multiplayer
let net = null;
function leaveNet() { if (net) { net.destroy(); net = null; } }

function showMulti(note = '') {
  leaveNet();
  const s = loadSettings();
  app.innerHTML = `
  <div class="start"><div class="start-in">
    <div class="logo"><h1>SOLACE</h1><p>Play online</p></div>
    <div class="setup">
      <div><label for="name">Your name</label><input id="name" type="text" maxlength="14" value="${esc(s.name)}" autocomplete="off"></div>
      <button class="btn primary" id="create">Create a room</button>
      <div><label for="code">Or join a friend\u2019s room</label>
        <div class="join-row"><input id="code" type="text" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn" id="join">Join</button></div></div>
      <p class="mp-note" id="note" role="status">${esc(note)}</p>
    </div>
    <button class="btn" id="back">Back</button>
  </div></div>`;
  const note$ = app.querySelector('#note'), name$ = app.querySelector('#name'), code$ = app.querySelector('#code');
  const go = async (fn) => {
    const name = (name$.value.trim() || 'You').slice(0, 14); saveSettings({ ...s, name });
    note$.textContent = 'Connecting\u2026';
    net = new NetworkSession().on(netHandlers());
    try { await fn(net, name); } catch (e) { leaveNet(); note$.textContent = e.message; }
  };
  app.querySelector('#create').addEventListener('click', () => go((n, name) => n.create(name)));
  app.querySelector('#join').addEventListener('click', () => go((n, name) => n.join(name, code$.value)));
  code$.addEventListener('input', () => { code$.value = code$.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  code$.addEventListener('keydown', (e) => { if (e.key === 'Enter') app.querySelector('#join').click(); });
  app.querySelector('#back').addEventListener('click', showStart);
}

function netHandlers() {
  return {
    lobby: (m) => { if (!m.started && !teardown) renderLobby(m); },
    start: () => startNetGame(),
    error: (msg) => { toast(msg, true); window.dispatchEvent(new CustomEvent('solace:reject')); },   // predicted draws / casts slide back
    status: (st) => {
      if (st === 'reconnecting') toast('Connection lost \u2014 reconnecting\u2026');
      else if (st === 'online' && net && net.started) toast('Back online');
      else if (st === 'gone') { toast('That room no longer exists.', true); showStart(); }
    },
  };
}

function renderLobby(m) {
  const me = m.players.find((p) => p.id === m.you), host = m.hostId === m.you;
  const rows = m.players.map((p) => `<li class="${p.connected ? '' : 'off'}"><span class="nm">${esc(p.name)}</span>
    ${p.id === m.you ? '<span class="chip">you</span>' : ''}${p.host ? '<span class="chip">host</span>' : ''}${p.isAI ? '<span class="chip">computer</span>' : ''}${p.connected ? '' : '<span class="chip warn">offline</span>'}</li>`).join('');
  app.innerHTML = `
  <div class="start"><div class="start-in">
    <div class="logo"><h1>SOLACE</h1><p>Room code \u2014 share it with friends</p></div>
    <div class="roomcode" id="rc" title="Click to copy" aria-label="Room code ${esc(m.code)}">${esc(m.code)}</div>
    <ul class="plist-lobby" aria-label="Players">${rows}</ul>
    ${host ? `<div class="setup">
      <div class="seg"><button id="addbot">+ Computer</button><button id="rmbot">\u2212 Computer</button></div>
      <div><span class="lbl">Starting lives</span><div class="stepper"><button id="lives-dn" aria-label="Fewer lives">&minus;</button><output>${m.lives}</output><button id="lives-up" aria-label="More lives">+</button></div></div>
      ${rulesHTML(m.rules, false, true)}
    </div><button class="btn primary" id="start" ${m.players.length < 2 ? 'disabled' : ''}>Start game</button>`
    : `<p class="mp-note">${m.lives} lives \u00b7 ${m.rules.showDirection === false ? 'hidden' : DIRS[m.rules.turnDirection]} turns \u00b7 opponents\u2019 lives ${m.rules.showLives === false ? 'hidden' : 'visible'} \u00b7 opponents\u2019 rune count ${m.rules.showRuneCount === false ? 'hidden' : 'visible'} \u00b7 twists ${(TWIST_PRESETS[m.rules.twistPreset] || TWIST_PRESETS.off).label} \u00b7 rune hand ${m.rules.runeHandLimit ?? 6} \u00b7 timer ${fmtTimer(m.rules.turnTimer)} \u00b7 free rune ${fmtChance(m.rules.runeDrawChance)} \u00b7 losers ${OPTIONS[0].fmt(m.rules.lossFrac ?? null)} \u00b7 rune deck ${OPTIONS.find((o) => o.key === 'runeDeckMultiplier').fmt(m.rules.runeDeckMultiplier ?? 'auto')} \u00b7 on timeout ${m.rules.timeoutAction === 'lose' ? 'lose the round' : 'stand'} \u00b7 rarity W${m.rules.rarityWhite ?? 1} C${m.rules.rarityCyan ?? 1} V${m.rules.rarityViolet ?? 1} S${m.rules.raritySpecial ?? 1} \u00b7 disconnect ${m.rules.onDisconnect === 'bot' ? 'computer takes over' : 'eliminated'}</p><p class="mp-note">Waiting for the host to start\u2026</p>`}
    <button class="btn" id="leave" style="margin-top:10px">Leave room</button>
  </div></div>`;
  const q = (id) => app.querySelector(id);
  q('#rc').addEventListener('click', () => { try { navigator.clipboard.writeText(m.code); toast('Code copied'); } catch { /* clipboard blocked */ } });
  q('#leave').addEventListener('click', () => { leaveNet(); showStart(); });
  if (host) {
    q('#addbot').addEventListener('click', () => net.addBot());
    q('#rmbot').addEventListener('click', () => net.removeBot());
    q("#lives-dn").addEventListener('click', () => net.setLives(m.lives - 1));
    q("#lives-up").addEventListener('click', () => net.setLives(m.lives + 1));
    bindRules(app, { ...m.rules }, (k, v) => net.setRule(k, v));
    q('#start').addEventListener('click', () => net.startGame());
  }
  void me;
}

function startNetGame() {
  if (teardown) { teardown(); teardown = null; }
  const session = net;
  const unmount = mountGame(app, session, { onExit: () => { leaveNet(); showStart(); }, toast, audio, fx });
  teardown = () => unmount();
}

// A refresh (or a dropped phone) puts you back in your seat.
async function resume() {
  const saved = NetworkSession.saved();
  if (!saved) return showStart();
  net = new NetworkSession().on(netHandlers());
  try { await net.rejoin(saved); } catch { leaveNet(); showStart(); }
}

if (NetworkSession.saved()) resume(); else showStart();
