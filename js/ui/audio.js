// ---------------------------------------------------------------------------
// SOUND DESIGN — everything is synthesised with WebAudio, so there are no
// audio files to host. Tuned around one key (D minor pentatonic-ish) so
// overlapping sounds stay consonant.
//
//   audio.unlock()          call from any user gesture (browsers require it)
//   audio.sfx.draw() ...    one function per game moment
//   audio.sfx.rune(id,tier) each rune gets a sound "style" (see STYLE below)
//   audio.set('sfx'|'amb', bool), audio.settings()
// ---------------------------------------------------------------------------
const KEY = 'solace.audio';
const S = { sfx: true, amb: true };
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }

let ctx = null, master, sfxBus, ambBus, conv, noiseBuf, amb = null;
const n = (semi) => 261.63 * Math.pow(2, semi / 12);          // semitones above middle C

function build() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
  master = ctx.createGain(); master.gain.value = 0.8;
  master.connect(comp); comp.connect(ctx.destination);

  conv = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 2.6), imp = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = imp.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
  conv.buffer = imp;
  const wet = ctx.createGain(); wet.gain.value = 0.34; conv.connect(wet); wet.connect(master);

  sfxBus = ctx.createGain(); sfxBus.connect(master); sfxBus.connect(conv);
  ambBus = ctx.createGain(); ambBus.gain.value = 0; ambBus.connect(master);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return true;
}

// ------------------------------------------------------------- primitives
function tone({ f = 440, f2 = null, type = 'sine', t = 0, dur = 0.3, vol = 0.2, a = 0.005, detune = 0, lp = null, bus = sfxBus }) {
  const t0 = ctx.currentTime + t;
  const o = ctx.createOscillator(); o.type = type; o.detune.value = detune;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); fl.connect(g); } else o.connect(g);
  g.connect(bus); o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise({ t = 0, dur = 0.2, vol = 0.2, type = 'bandpass', f = 1000, f2 = null, q = 1, a = 0.004, bus = sfxBus }) {
  const t0 = ctx.currentTime + t;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t0);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(fl); fl.connect(g); g.connect(bus);
  src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
}
const PARTIALS = [[1, 1, 1], [2.76, 0.45, 0.6], [5.4, 0.2, 0.35], [8.9, 0.08, 0.2]];
function bell(f, t = 0, vol = 0.14, dur = 1.6) { PARTIALS.forEach(([m, v, d]) => { if (f * m < 15000) tone({ f: f * m, t, dur: dur * d, vol: vol * v, a: 0.003 }); }); }
function pad(freqs, { t = 0, dur = 2, vol = 0.1, type = 'sawtooth', lp = 900, a = 0.7 } = {}) {
  freqs.forEach((f) => [-8, 8].forEach((d) => tone({ f, type, t, dur, vol: vol / (freqs.length * 1.4), a: Math.min(a, dur * 0.6), detune: d, lp })));
}

// ----------------------------------------------------------- rune styles
const RUNE_STYLES = {
  up() {      // bet goes up: rising whoosh and bright bells
    noise({ dur: 0.38, vol: 0.16, f: 500, f2: 3600, q: 0.8 });
    tone({ f: 180, f2: 380, dur: 0.32, vol: 0.12 });
    [12, 16, 19, 24].forEach((s, i) => bell(n(s), i * 0.07, 0.085, 1.3));
  },
  down() {    // bet goes down: soft shield clang and falling tone
    tone({ f: 520, f2: 190, dur: 0.42, vol: 0.13 });
    noise({ dur: 0.3, vol: 0.12, type: 'lowpass', f: 1000, f2: 200 });
    bell(n(5), 0, 0.12, 1.6); bell(n(-2), 0.1, 0.1, 1.8);
  },
  target() {  // win condition changes: a sweep, then a held chord
    noise({ dur: 0.7, vol: 0.18, f: 300, f2: 4200, q: 0.7 });
    pad([n(0), n(7), n(12)], { dur: 1.8, vol: 0.12, lp: 1500, type: 'triangle' });
    bell(n(24), 0.35, 0.1, 2); bell(n(31), 0.5, 0.08, 2);
  },
  cards() {   // card flurry
    [0, 0.09, 0.18].forEach((t) => { noise({ t, dur: 0.1, vol: 0.15, f: 2400, f2: 5200, q: 1.2 }); tone({ t, f: 170, f2: 100, dur: 0.07, vol: 0.1 }); });
    bell(n(19), 0.2, 0.06, 1.2);
  },
  swap() {
    tone({ f: 330, f2: 660, dur: 0.26, vol: 0.11 }); tone({ t: 0.14, f: 660, f2: 330, dur: 0.26, vol: 0.09 });
    bell(n(14), 0.1, 0.1, 1.2); bell(n(21), 0.26, 0.09, 1.4);
  },
  dark() {    // curses, theft, restraints: low and uneasy
    tone({ f: 98, f2: 62, type: 'sawtooth', dur: 1, vol: 0.17, lp: 280 });
    pad([n(-14), n(-8), n(-2)], { type: 'sawtooth', dur: 1.5, vol: 0.14, lp: 520 });
    noise({ dur: 0.7, vol: 0.14, type: 'lowpass', f: 320, f2: 90 });
    bell(n(6), 0.08, 0.05, 1.6);
  },
  destroy() { // shatter
    for (let i = 0; i < 5; i++) noise({ t: i * 0.035, dur: 0.12, vol: 0.2, type: 'highpass', f: 1800 - i * 200, f2: 400 });
    tone({ f: 240, f2: 60, type: 'square', dur: 0.3, vol: 0.07, lp: 900 });
    bell(n(-5), 0.05, 0.1, 1.4);
  },
  mystic() {
    pad([n(2), n(9), n(14)], { dur: 2, vol: 0.14, type: 'triangle', lp: 1900, a: 0.8 });
    bell(n(26), 0.3, 0.08, 2); noise({ dur: 0.6, vol: 0.07, f: 800, f2: 2600, q: 1 });
  },
  bless() {   // warm, choir-like
    pad([n(0), n(4), n(7), n(12)], { dur: 2.8, vol: 0.2, type: 'sine', lp: 3200, a: 1.1 });
    [24, 28, 31, 36].forEach((s, i) => bell(n(s), 0.15 + i * 0.12, 0.07, 2.2));
  },
  duel() {    // two shots and a ring-out
    noise({ dur: 0.35, vol: 0.5, type: 'lowpass', f: 5200, f2: 180, q: 0.5, a: 0.002 }); tone({ f: 130, f2: 40, dur: 0.35, vol: 0.4 });
    noise({ t: 0.4, dur: 0.3, vol: 0.28, type: 'lowpass', f: 4200, f2: 160, a: 0.002 }); tone({ t: 0.4, f: 110, f2: 38, dur: 0.3, vol: 0.25 });
    bell(n(-7), 0.15, 0.08, 2.4);
  },
  exile() {
    tone({ f: 70, f2: 44, type: 'sawtooth', dur: 1.4, vol: 0.2, lp: 200 });
    pad([n(-12), n(-6)], { type: 'sawtooth', dur: 1.8, vol: 0.16, lp: 420 });
    noise({ dur: 1.2, vol: 0.18, type: 'lowpass', f: 220, f2: 70 }); bell(n(-2), 0.4, 0.07, 2);
  },
  jackpot() { // slot-machine ladder
    [12, 14, 16, 19, 21, 24, 26, 28].forEach((s, i) => bell(n(s), i * 0.07, 0.1, 0.9));
    noise({ t: 0.1, dur: 0.7, vol: 0.1, type: 'highpass', f: 6000, q: 0.5 });
    [24, 28, 31].forEach((s) => bell(n(s), 0.62, 0.12, 2));
  },
  chime() { bell(n(19), 0, 0.12, 1.4); bell(n(24), 0.08, 0.09, 1.4); },
  shimmer() {
    pad([n(7), n(14)], { dur: 1.4, vol: 0.12, type: 'triangle', lp: 2400, a: 0.4 });
    bell(n(19), 0.05, 0.1, 1.6); bell(n(26), 0.2, 0.08, 1.8);
  },
};
const STYLE = {
  elevate: 'up', elevate2: 'up', gambit: 'up', shield: 'down', shield2: 'down',
  target17: 'target', target24: 'target', target27: 'target',
  hush: 'cards', twin_draw: 'cards', double_draw: 'cards', unity: 'cards', return: 'cards', reset: 'cards',
  barter: 'swap', trade: 'swap',
  curse: 'dark', restrain: 'dark', dread: 'dark', remove: 'dark', pickpocket: 'dark', disrupt: 'dark',
  rebuke: 'destroy', retaliation: 'destroy', mischief: 'cards',
  stall: 'mystic', vow: 'mystic', wrap: 'mystic', underdog: 'bless', reverse: 'swap', wager: 'mystic', prophecy: 'mystic', helping_hand: 'bless',
  duel: 'duel', bless: 'bless', exile: 'exile', jackpot: 'jackpot',
};

// ---------------------------------------------------------- game moments
const SFX = {
  click() { tone({ f: 1400, f2: 900, type: 'triangle', dur: 0.04, vol: 0.05 }); },
  error() { tone({ f: 150, type: 'square', dur: 0.07, vol: 0.06, lp: 700 }); tone({ t: 0.09, f: 130, type: 'square', dur: 0.09, vol: 0.06, lp: 700 }); },
  draw() {
    noise({ dur: 0.13, vol: 0.24, f: 1700, f2: 4600, q: 1 });
    tone({ t: 0.06, f: 170, f2: 90, dur: 0.1, vol: 0.2 });
  },
  deal() {
    noise({ dur: 0.1, vol: 0.12, f: 1900, f2: 4200, q: 1 });
    tone({ t: 0.05, f: 150, f2: 90, dur: 0.08, vol: 0.1 });
  },
  flip() { noise({ dur: 0.05, vol: 0.1, f: 3200, q: 2 }); },
  stand() {
    tone({ f: 130, f2: 70, dur: 0.2, vol: 0.34 });
    noise({ dur: 0.05, vol: 0.1, type: 'lowpass', f: 420 });
  },
  turn() { bell(n(16), 0, 0.09, 1.2); bell(n(21), 0.13, 0.09, 1.5); },
  betUp() {
    [19, 24, 28].forEach((s, i) => tone({ t: i * 0.06, f: n(s), type: 'triangle', dur: 0.22, vol: 0.09 }));
    bell(n(31), 0.18, 0.08, 1.2); noise({ t: 0.05, dur: 0.25, vol: 0.06, type: 'highpass', f: 5000 });
  },
  betDown() {
    tone({ f: 640, f2: 220, type: 'triangle', dur: 0.34, vol: 0.11, lp: 1800 }); bell(n(5), 0.05, 0.09, 1.2);
  },
  bust() {    // you went over
    tone({ f: 110, type: 'sawtooth', dur: 0.55, vol: 0.13, lp: 600 }); tone({ f: 116.5, type: 'sawtooth', dur: 0.55, vol: 0.13, lp: 600 });
    tone({ f: 85, f2: 40, dur: 0.4, vol: 0.3 });
  },
  vote() { bell(n(9), 0, 0.09, 1.2); bell(n(2), 0.15, 0.09, 1.6); },
  roundStart() { bell(n(-12), 0, 0.2, 3); bell(n(-5), 0.05, 0.12, 3); noise({ dur: 0.9, vol: 0.06, f: 400, f2: 2200, q: 0.8 }); },
  win() {
    [0, 4, 7, 12, 16, 19].forEach((s, i) => bell(n(s + 12), i * 0.09, 0.1, 1.6));
    pad([n(0), n(4), n(7)], { dur: 2, vol: 0.14, type: 'triangle', lp: 2000, a: 0.3 });
    noise({ t: 0.3, dur: 0.8, vol: 0.05, type: 'highpass', f: 6500 });
  },
  lose() {
    bell(n(7), 0, 0.12, 2); bell(n(3), 0.22, 0.11, 2); bell(n(0), 0.44, 0.1, 2.4);
    tone({ f: 120, f2: 55, dur: 0.9, vol: 0.18 });
  },
  eliminate() {
    tone({ f: 60, f2: 36, type: 'sawtooth', dur: 1.8, vol: 0.2, lp: 180 });
    noise({ dur: 1.4, vol: 0.2, type: 'lowpass', f: 300, f2: 60 }); bell(n(-5), 0.1, 0.1, 3);
  },
  victory() {
    [0, 4, 7, 12, 16, 19, 24, 28].forEach((s, i) => bell(n(s + 12), i * 0.11, 0.11, 2));
    pad([n(0), n(4), n(7), n(12)], { dur: 3.5, vol: 0.2, type: 'triangle', lp: 2600, a: 0.8 });
  },
  defeat() {
    [7, 3, 0, -5].forEach((s, i) => bell(n(s), i * 0.3, 0.12, 2.6));
    pad([n(-12), n(-9), n(-5)], { dur: 3, vol: 0.14, type: 'sawtooth', lp: 500, a: 1 });
  },
  charge() {    // a special rune rises: a swelling sweep
    tone({ f: 70, f2: 640, type: 'sawtooth', dur: 1.1, vol: 0.06, lp: 1500 }); noise({ dur: 1.1, vol: 0.05, f: 300, f2: 5200, q: 0.8 });
    pad([n(-12), n(-5)], { dur: 1.6, vol: 0.06, type: 'triangle', lp: 1200, a: 0.5 });
  },
  boom() {      // ... and lands: a low hit with a shimmer on top
    tone({ f: 72, f2: 36, dur: 0.9, vol: 0.34 }); noise({ dur: 0.55, vol: 0.14, type: 'lowpass', f: 900, f2: 120 });
    bell(n(12), 0.02, 0.1, 3); bell(n(19), 0.09, 0.08, 3); bell(n(24), 0.16, 0.06, 3);
  },
  rune(runeId, tier = 1) {
    const style = STYLE[runeId] || (tier >= 3 ? 'mystic' : tier === 2 ? 'shimmer' : 'chime');
    // Everything gets an opening "whoosh" so a cast always feels like an event.
    noise({ dur: 0.28, vol: 0.1, f: 600, f2: 3000, q: 0.7 });
    RUNE_STYLES[style]();
  },
};

function guard(fn) {
  return (...args) => {
    if (!S.sfx || !ctx || ctx.state !== 'running') return;
    try { fn(...args); } catch (e) { console.warn('audio', e); }
  };
}
const sfx = Object.fromEntries(Object.entries(SFX).map(([k, fn]) => [k, guard(fn)]));

// -------------------------------------------------------------- ambience
function startAmb() {
  if (!ctx || amb || !S.amb) return;
  const nodes = [];
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.connect(ambBus);
  [[55, 'sine', 0.5], [82.41, 'sine', 0.3], [110.2, 'triangle', 0.16], [164.8, 'sine', 0.05]].forEach(([f, type, v]) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = v; o.connect(g); g.connect(lp); o.start(); nodes.push(o);
  });
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lg = ctx.createGain(); lg.gain.value = 150; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); nodes.push(lfo);

  const wind = ctx.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.8;
  const wg = ctx.createGain(); wg.gain.value = 0.035;
  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.045;
  const lg2 = ctx.createGain(); lg2.gain.value = 260; lfo2.connect(lg2); lg2.connect(bp.frequency); lfo2.start();
  wind.connect(bp); bp.connect(wg); wg.connect(ambBus); wind.start(); nodes.push(wind, lfo2);

  ambBus.gain.cancelScheduledValues(ctx.currentTime);
  ambBus.gain.setValueAtTime(ambBus.gain.value, ctx.currentTime);
  ambBus.gain.linearRampToValueAtTime(0.17, ctx.currentTime + 4);
  amb = { nodes };
}
function stopAmb() {
  if (!ctx || !amb) return;
  const cur = amb; amb = null;
  ambBus.gain.cancelScheduledValues(ctx.currentTime);
  ambBus.gain.setValueAtTime(ambBus.gain.value, ctx.currentTime);
  ambBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
  setTimeout(() => cur.nodes.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } }), 1000);
}

// ------------------------------------------------------------------- API
function unlock() {
  try {
    if (!ctx && !build()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (S.amb && S.sfx) startAmb();
  } catch (e) { console.warn('audio unlock failed', e); }
}
function set(key, val) {
  S[key] = !!val;
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* private mode */ }
  if (key === 'sfx') { if (S.sfx) { unlock(); } else { stopAmb(); } }
  if (key === 'amb') { if (S.amb && S.sfx) { unlock(); startAmb(); } else stopAmb(); }
}
function haptic(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* unsupported */ } }

let hooked = false;
function init() {
  if (hooked) return; hooked = true;
  const go = () => unlock();
  window.addEventListener('pointerdown', go, { passive: true });
  window.addEventListener('keydown', go);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });
}

export const audio = { init, unlock, set, settings: () => ({ ...S }), sfx, haptic };
