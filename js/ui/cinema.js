// ---------------------------------------------------------------------------
// CINEMA: the big-screen moment for Special runes.
//
//   const cinema = createCinema({ layer, fx, shell });
//   const st = cinema.stage({ spec, from, faceDown, accent, runeId, kicker, name, sub, desc, speed, on });
//   await st.ready;                      // the card has risen, turned over (if it was face-down), and been shown off
//   await st.launch(to, { ms });         // the stage clears while the card whooshes to `to` (your hand, a target, the table)
//
// It is a picture, never a gate: the layer ignores the pointer, keys keep working, and a click anywhere skips the pause
// on the hero card. `on` = { charge(), flip(), land() } lets the caller add sound at the three beats.
//   cinema.impact(runeId, x, y, accent)  flavoured particles for each special rune (used on arrival and on impact)
// ---------------------------------------------------------------------------
import { cardHTML } from './cards.js';
import { EASE } from './motion.js';

const RATIO = 1.4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function hexA(hex, a) {
  const h = String(hex).replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

export function createCinema({ layer, fx, shell }) {
  const reduced = !!fx.reduced;

  /** Each special rune gets its own kind of fireworks. k scales the size (bigger on the stage, smaller on impact). */
  function impact(id, x, y, accent, k = 1) {
    const ring = (c, o) => fx.ring(x, y, c, o);
    switch (id) {
      case 'duel':
        ring('#ff6b5e', { r1: 280 * k, life: 0.85, size: 6 }); ring(accent, { r0: 30, r1: 170 * k, life: 0.6, size: 3 });
        fx.burst(x, y, { color: '#ff8a70', n: 80, speed: 560 * k, life: 0.95, g: 140 }); fx.embers(x, y, '#ff6b5e', 30);
        break;
      case 'wrap':
        ring(accent, { r1: 240 * k, life: 0.8, size: 5 });
        fx.embers(x, y, '#f29a3c', 46); fx.burst(x, y, { color: '#ffc27a', n: 56, speed: 380 * k, life: 1.1, g: -30 });
        break;
      case 'restrain':
        ring('#cfeaf5', { r0: 320 * k, r1: 24, life: 0.75, size: 4 }); setTimeout(() => ring('#9fc3cf', { r0: 220 * k, r1: 20, life: 0.6, size: 3 }), 140);
        fx.burst(x, y, { color: '#bfe3f0', n: 60, speed: 300 * k, life: 1.25, g: 0, size: 2.6 });
        break;
      case 'bless':
        ring('#f2d24a', { r1: 300 * k, life: 1, size: 5 }); ring('#fff1c9', { r1: 160 * k, life: 0.7, size: 3 });
        fx.embers(x, y + 30, '#f2d24a', 54); fx.burst(x, y, { color: '#fff1c9', n: 50, speed: 260 * k, life: 1.2, g: -70 });
        break;
      case 'exile':
        ring('#b98467', { r1: 270 * k, life: 0.9, size: 5 }); ring('#3a1a14', { r1: 340 * k, life: 1.1, size: 9 });
        fx.embers(x, y, '#8a4a36', 40); fx.burst(x, y, { color: '#d9a07f', n: 48, speed: 340 * k, life: 1, g: 200 });
        break;
      case 'jackpot':
        ring('#3ddc84', { r1: 280 * k, life: 0.9, size: 5 }); ring('#f2d24a', { r1: 180 * k, life: 0.7, size: 3 });
        fx.burst(x, y, { color: '#f2d24a', n: 70, speed: 520 * k, life: 1.1, g: 380 }); fx.confetti(['#f2d24a', '#3ddc84', '#fff1c9', '#19c2c9'], 90);
        break;
      default:
        ring(accent, { r1: 240 * k, life: 0.8, size: 5 }); fx.burst(x, y, { color: accent, n: 60, speed: 420 * k, life: 0.9 });
    }
  }

  function stage(o) {
    const { spec, from, faceDown = false, accent = '#cdb27b', runeId = '', kicker = '', name = '', sub = '', desc = '', speed = 1, on = {} } = o;
    const T = (ms) => Math.round(ms * Math.max(0.55, speed));
    const vw = window.innerWidth, vh = window.innerHeight;
    const side = vh < 520 && vw > vh * 1.2;                                   // landscape phone: title beside the card
    const heroW = Math.max(104, Math.min(250, vw * (side ? 0.26 : 0.5), (vh * (side ? 0.62 : 0.42)) / RATIO));
    const heroH = heroW * RATIO;
    const cx = side ? vw * 0.34 : vw / 2, cy = side ? vh * 0.5 : vh * 0.39;
    const f0 = from || { x: vw / 2, y: vh * 0.15, w: 40 };

    let dead = false, skipped = false, wake = null;
    const nap = (ms) => new Promise((r) => { const t = setTimeout(r, ms); wake = () => { clearTimeout(t); r(); }; }).then(() => { wake = null; });
    const onSkip = () => { skipped = true; if (wake) wake(); };
    let bail = 0;
    const stop = () => { dead = true; clearTimeout(bail); document.removeEventListener('pointerdown', onSkip, true); };

    const root = document.createElement('div');
    root.className = 'cn' + (side ? ' side' : '');
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--cx', cx + 'px'); root.style.setProperty('--cy', cy + 'px'); root.style.setProperty('--hh', heroH + 'px');
    const txt = (cls, t) => { const e = document.createElement(cls[0]); e.className = cls[1]; e.textContent = t; return e; };
    const dim = txt(['div', 'cn-dim'], ''), rays = txt(['div', 'cn-rays'], ''), halo = txt(['div', 'cn-halo'], '');
    const barT = txt(['div', 'cn-bar t'], ''), barB = txt(['div', 'cn-bar b'], '');
    const title = document.createElement('div'); title.className = 'cn-title';
    const kEl = txt(['i', 'cn-k'], kicker), nEl = document.createElement('b'), sEl = txt(['em', 'cn-s'], sub), dEl = txt(['p', 'cn-d'], desc);
    nEl.className = 'cn-n';
    const letters = [...name].map((ch) => { const s = document.createElement('span'); s.textContent = ch === ' ' ? '\u00a0' : ch; s.style.opacity = '0'; nEl.appendChild(s); return s; });
    title.append(kEl, nEl, sEl, dEl);
    for (const e of [kEl, sEl, dEl]) e.style.opacity = '0';

    const el = document.createElement('div');
    el.className = 'flight cn-card';
    el.innerHTML = `<div class="fl-in"><div class="fl-face">${cardHTML(spec)}</div><div class="fl-back">${cardHTML({ kind: 'rune-back' })}</div></div><div class="cn-sheen"><i></i></div>`;
    el.style.cssText = `width:${heroW}px;height:${heroH}px;left:${cx - heroW / 2}px;top:${cy - heroH / 2}px;`;
    el.style.setProperty('--glow', accent);
    el.querySelectorAll('.card').forEach((c) => c.style.setProperty('--w', heroW + 'px'));
    const inner = el.firstElementChild, sheen = el.querySelector('.cn-sheen i');
    if (faceDown) inner.style.transform = 'rotateY(180deg)';
    const s0 = Math.max(0.06, (f0.w || 40) / heroW), dx0 = f0.x - cx, dy0 = f0.y - cy;
    el.style.transform = `translate(${dx0}px,${dy0}px) scale(${s0})`;               // never show the hero at full size for a frame
    const live = txt(['span', 'sr'], `${kicker}: ${name}. ${sub} ${desc}`); live.setAttribute('role', 'status');
    root.append(dim, rays, halo, el, title, barT, barB, live);
    layer.appendChild(root);
    bail = setTimeout(() => { if (!dead) abort(); }, 14000);                 // safety net: a stage can never stay on screen
    document.addEventListener('pointerdown', onSkip, true);

    const A = (node, kf, opt) => (node.animate ? node.animate(kf, { fill: 'both', ...opt }) : null);
    const pulses = [];
    const rings = (n = 3, gap = 150) => { for (let i = 0; i < n; i++) pulses.push(setTimeout(() => { if (!dead) fx.ring(cx, cy, accent, { r0: heroW * (2.4 - i * 0.3), r1: 18, life: 0.62, size: 2.5 + i }); }, i * gap)); };

    function showTitle() {
      A(kEl, [{ opacity: 0, transform: 'translateY(8px)', letterSpacing: '.7em' }, { opacity: 1, transform: 'none', letterSpacing: '.34em' }], { duration: T(520), easing: EASE.out });
      letters.forEach((s, i) => A(s, [{ opacity: 0, transform: 'translateY(.45em) scale(1.35)', filter: 'blur(10px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: T(520), delay: T(120 + i * 48), easing: EASE.out }));
      const late = T(160 + letters.length * 48);
      A(sEl, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: T(420), delay: late, easing: EASE.out });
      A(dEl, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: T(460), delay: late + T(140), easing: EASE.out });
    }

    // ------------------------------------------------------------ the sequence
    const ready = (async () => {
      if (reduced || !el.animate) return;
      // 1) the stage dims, bars slide in, the card rises from where it was to the middle
      A(dim, [{ opacity: 0 }, { opacity: 1 }], { duration: T(520), easing: 'ease-out' });
      A(barT, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: T(560), easing: EASE.out });
      A(barB, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: T(560), easing: EASE.out });
      A(rays, [{ opacity: 0, transform: 'translate(-50%,-50%) rotate(0deg) scale(.5)' }, { opacity: 1, transform: 'translate(-50%,-50%) rotate(60deg) scale(1)' }], { duration: T(1100), easing: EASE.out });
      A(halo, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.4)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: T(820), easing: EASE.out });
      if (on.charge) on.charge();
      const mx = dx0 * 0.4, my = dy0 * 0.5 - Math.min(90, vh * 0.12);
      const arrive = A(el, [
        { transform: `translate(${dx0}px,${dy0}px) scale(${s0}) rotate(-14deg)` },
        { transform: `translate(${mx}px,${my}px) scale(${(s0 + 1) / 2 * 1.1}) rotate(6deg)`, offset: 0.55 },
        { transform: 'translate(0,0) scale(1.07) rotate(-1.5deg)', offset: 0.86 },
        { transform: 'translate(0,0) scale(1) rotate(0deg)' },
      ], { duration: T(900), easing: 'cubic-bezier(.2,.8,.2,1)' });
      try { await arrive.finished; } catch { return; }
      if (dead) return;
      arrive.cancel(); el.style.transform = 'none';

      // 2) it hums with power: rings pull inward, the card trembles
      rings(3, T(150));
      A(el, [{ transform: 'translate(0,0) scale(1)', filter: 'brightness(1)' }, { transform: 'translate(-2px,1px) scale(1.01)', filter: 'brightness(1.25)', offset: 0.2 }, { transform: 'translate(2px,-1px) scale(1.02)', offset: 0.4 }, { transform: 'translate(-2px,0) scale(1.03)', filter: 'brightness(1.5)', offset: 0.7 }, { transform: 'translate(0,0) scale(1.06)', filter: 'brightness(1.7)' }], { duration: T(faceDown ? 620 : 420), easing: 'ease-in' });
      showTitle();
      await sleep(T(faceDown ? 640 : 440)); if (dead) return;

      // 3) the turn-over (draw) or the cast pose (play): light, shock, fireworks
      if (on.flip) on.flip();
      if (faceDown) A(inner, [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(-14deg)', offset: 0.72 }, { transform: 'rotateY(0deg)' }], { duration: T(760), easing: 'cubic-bezier(.3,.1,.2,1)' });
      A(el, [{ transform: 'scale(1.06)', filter: 'brightness(1.7)' }, { transform: 'scale(1.22)', filter: 'brightness(2.4)', offset: 0.35 }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: T(760), easing: EASE.spring });
      A(sheen, [{ transform: 'translateX(-130%)' }, { transform: 'translateX(130%)' }], { duration: T(900), delay: T(220), easing: 'ease-in-out' });
      await sleep(T(faceDown ? 330 : 120)); if (dead) return;
      fx.flash(hexA(accent, 0.38), T(760)); fx.shake(shell, 8);
      impact(runeId, cx, cy, accent, 1.15);
      await sleep(T(faceDown ? 480 : 520)); if (dead) return;

      // 4) it floats and is admired (a click skips this)
      A(el, [{ transform: 'translateY(0) rotate(-.7deg)' }, { transform: 'translateY(-8px) rotate(.9deg)' }], { duration: 1500, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
      if (!skipped) await nap(T(faceDown ? 1250 : 950));
    })();
    const watchdog = new Promise((r) => setTimeout(r, 9000));
    const readyP = Promise.race([ready.catch(() => {}), watchdog]);

    async function launch(to, { ms = 780, trail = true } = {}) {
      await readyP;
      if (dead) return;
      stop();
      pulses.forEach(clearTimeout);
      if (reduced || !el.animate || !to) { root.remove(); return; }
      // where is the card right now (the idle float moved it a little)?
      const r = el.getBoundingClientRect();
      el.getAnimations().forEach((a) => a.cancel());
      el.style.transform = 'none';
      const fx0 = r.left + r.width / 2 - cx, fy0 = r.top + r.height / 2 - cy;
      const dx = to.x - cx, dy = to.y - cy, s1 = Math.max(0.06, (to.w || heroW) / heroW);
      const dur = Math.max(260, ms);
      // the stage clears while the card leaves
      for (const n of [title, rays, halo]) A(n, [{ opacity: 1 }, { opacity: 0 }], { duration: T(320), easing: 'ease-out' });
      for (const n of [dim]) A(n, [{ opacity: 1 }, { opacity: 0 }], { duration: Math.min(dur, T(560)), easing: 'ease-out' });
      A(barT, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], { duration: T(460), easing: EASE.out });
      A(barB, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], { duration: T(460), easing: EASE.out });
      const dist = Math.hypot(dx - fx0, dy - fy0) || 1, bow = Math.min(120, dist * 0.2);
      const mx = (fx0 + dx) / 2 + (-(dy - fy0) / dist) * bow, my = (fy0 + dy) / 2 + ((dx - fx0) / dist) * bow;
      const a = A(el, [
        { transform: `translate(${fx0}px,${fy0}px) scale(${r.width / heroW}) rotate(0deg)`, filter: 'brightness(1.4)' },
        { transform: `translate(${mx}px,${my}px) scale(${(r.width / heroW + s1) / 2 * 1.05}) rotate(-9deg)`, filter: 'brightness(1.6)', offset: 0.5 },
        { transform: `translate(${dx}px,${dy}px) scale(${s1}) rotate(0deg)`, filter: 'brightness(1)' },
      ], { duration: dur, easing: 'cubic-bezier(.6,.02,.2,1)' });
      // a comet tail of sparks follows the card
      let raf = 0;
      if (trail) {
        let n = 0;
        const tick = () => {
          if (dead === 'done') return;
          const b = el.getBoundingClientRect();
          if (b.width && (n++ % 2 === 0)) fx.burst(b.left + b.width / 2, b.top + b.height / 2, { color: accent, n: 3, speed: 70, life: 0.55, size: 2.2, g: 0 });
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }
      try { await a.finished; } catch { /* cancelled */ }
      cancelAnimationFrame(raf); dead = 'done';
      if (on.land) on.land();
      return new Promise((res) => { requestAnimationFrame(() => { el.style.visibility = 'hidden'; res(); setTimeout(() => root.remove(), 600); }); });
    }
    function abort() { stop(); pulses.forEach(clearTimeout); root.remove(); }
    return { ready: readyP, launch, abort, center: { x: cx, y: cy, w: heroW } };
  }

  /** Drop anything still on screen (the game was left mid-cast). */
  function clear() { layer.replaceChildren(); }
  return { stage, impact, clear };
}
