// ---------------------------------------------------------------------------
// FLIGHTS
//
// A flight is a card clone on a fixed layer above the table that travels from one
// real screen position to another, so every action has spatial continuity: you can
// always see where a card started, where it went, and who it belongs to.
//
//   const flights = createFlights({ layer, reduced });
//   await flights.fly({ spec, from, to, ms, flipAt, ... })
//
// `from` / `to` are rects { x, y, w } (centre point + card width), see rectOf().
// Respects reduced motion: no clone is drawn, the promise just resolves.
// ---------------------------------------------------------------------------
import { cardHTML } from './cards.js';
import { EASE } from './motion.js';

const BACK = { kind: 'unit-back' };

/** Centre + width of an element, in viewport pixels. */
export function rectOf(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

/**
 * Where the middle of a curved path sits, relative to its start. fly() and trail() share this so an arrow
 * always follows the exact path its card takes. `side` (+1 / -1) picks which way the path bows; with the
 * same `side`, a flight A->B and a flight B->A bow to opposite sides, so a swap draws a clean loop.
 */
export function curveMid(dx, dy, arc = 0.14, side = 0) {
  const dist = Math.hypot(dx, dy) || 1;
  const sgn = side || (dx < 0 ? -1 : 1);
  const bulge = dist * arc * sgn;
  return { mx: dx / 2 + (-dy / dist) * bulge, my: dy / 2 + (dx / dist) * bulge };
}

export function createFlights({ layer, reduced }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * opts:
   *   spec       face of the card ({kind:'unit',value} | {kind:'rune',runeId} | back)
   *   backSpec   what the hidden side looks like (default unit-back)
   *   from, to   rects { x, y, w }
   *   ms, delay  duration / start delay
   *   faceDown   start showing the back; flip to `spec` at `flipAt` (0..1 of the flight)
   *   keepBack   never flip (card stays face-down the whole way)
   *   arc        sideways bulge of the path, as a fraction of distance (default .14)
   *   side       +1 / -1: which way the path bows (default: depends on direction). Two swapping cards use the same side so they loop past each other
   *   spin       degrees of tilt at the start (default -8)
   *   glow       css colour for a halo around the card
   *   hold       ms to rest at the start position before moving (so the origin is clearly seen)
   *   pop        scale overshoot at the start (card "pops" in before leaving)
   *   ease       css easing for the travel
   * Returns a promise that resolves when the card lands. The clone is removed on the next frame.
   */
  async function fly(opts) {
    const { spec, backSpec = BACK, from, to, ms = 700, delay = 0, faceDown = false, keepBack = false, flipAt = 0.5, arc = 0.14, spin = -8, glow = '', hold = 0, pop = 0, ease = EASE.out, fade = false, lift = 1.06, side = 0 } = opts;
    if (!from || !to) return;
    if (reduced || !layer.animate) { await sleep(Math.min(ms, 220)); if (opts.onLand) opts.onLand(); return; }

    const W = Math.max(24, to.w || from.w || 60);
    const H = W * 1.4;
    const el = document.createElement('div');
    el.className = 'flight';
    el.innerHTML = `<div class="fl-in"><div class="fl-face">${cardHTML(spec)}</div><div class="fl-back">${cardHTML(backSpec)}</div></div>`;
    el.style.cssText = `width:${W}px;height:${H}px;left:${from.x - W / 2}px;top:${from.y - H / 2}px;`;
    if (glow) el.style.setProperty('--glow', glow);
    el.querySelectorAll('.card').forEach((c) => { c.style.setProperty('--w', W + 'px'); });
    const inner = el.firstElementChild;
    if (faceDown || keepBack) inner.style.transform = 'rotateY(180deg)';
    const s0 = Math.max(0.08, (from.w || W) / W), s1 = Math.max(0.08, (to.w || W) / W);
    el.style.transform = `scale(${s0}) rotate(${spin * 0.5}deg)`;      // never show the clone at its landing size, even for a frame
    if (delay > 0) el.style.visibility = 'hidden';
    layer.appendChild(el);

    const dx = to.x - from.x, dy = to.y - from.y;
    const { mx, my } = curveMid(dx, dy, arc, side);
    const tilt = (to.tilt != null ? to.tilt : 0);

    // 1) rest at the origin so the source is unmistakable
    const restMs = hold > 0 ? hold : 0;
    if (restMs || pop) {
      const peak = s0 * (1 + pop);
      el.animate([
        { transform: `translate(0,0) scale(${s0 * 0.5}) rotate(${spin}deg)`, opacity: 0 },
        { transform: `translate(0,0) scale(${peak}) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(0,0) scale(${s0}) rotate(${spin * 0.5}deg)`, opacity: 1 },
      ], { duration: Math.max(180, Math.min(restMs || 260, 320)), easing: 'cubic-bezier(.2,1.2,.3,1)', delay, fill: 'both' });
      await sleep(delay + (restMs || 260));
    } else {
      await sleep(delay);
      el.style.visibility = '';
    }

    // 2) travel (with an arc), flipping part-way if needed
    el.getAnimations().forEach((a) => a.cancel());
    const travel = el.animate([
      { transform: `translate(0,0) scale(${s0}) rotate(${spin * 0.5}deg)`, opacity: 1 },
      { transform: `translate(${mx}px,${my}px) scale(${(s0 + s1) / 2 * lift}) rotate(${(spin * 0.5 + tilt) / 2 - 3}deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px,${dy}px) scale(${s1}) rotate(${tilt}deg)`, opacity: fade ? 0 : 1 },
    ], { duration: ms, easing: ease, fill: 'forwards' });
    if (faceDown && !keepBack && inner.animate) {
      const a = Math.max(0.05, Math.min(0.9, flipAt));
      inner.animate([
        { transform: 'rotateY(180deg)' }, { transform: 'rotateY(180deg)', offset: Math.max(0, a - 0.22) }, { transform: 'rotateY(0deg)' },
      ], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    }
    try { await travel.finished; } catch { /* cancelled */ }
    // The caller swaps in the real card first (same frame), then the clone goes away.
    if (opts.onLand) opts.onLand();
    requestAnimationFrame(() => el.remove());
  }

  /** Same as fly(), but the clone stays where it lands until the returned `end()` is called. */
  function hover(opts) {
    const { spec, backSpec = BACK, at, glow = '', pop = 0.12, ms = 420, faceDown = false, flip = false, spin = 0, cls = '' } = opts;
    const W = Math.max(24, at.w), H = W * 1.4;
    const el = document.createElement('div');
    el.className = 'flight ' + cls;
    el.innerHTML = `<div class="fl-in"><div class="fl-face">${cardHTML(spec)}</div><div class="fl-back">${cardHTML(backSpec)}</div></div>`;
    el.style.cssText = `width:${W}px;height:${H}px;left:${at.x - W / 2}px;top:${at.y - H / 2}px;`;
    if (glow) el.style.setProperty('--glow', glow);
    el.querySelectorAll('.card').forEach((c) => c.style.setProperty('--w', W + 'px'));
    const inner = el.firstElementChild;
    if (faceDown) inner.style.transform = 'rotateY(180deg)';
    layer.appendChild(el);
    if (!reduced && el.animate) {
      el.animate([
        { transform: `scale(.4) rotate(${spin - 10}deg)`, opacity: 0 },
        { transform: `scale(${1 + pop}) rotate(${spin}deg)`, opacity: 1, offset: 0.6 },
        { transform: `scale(1) rotate(${spin}deg)`, opacity: 1 },
      ], { duration: ms, easing: 'cubic-bezier(.2,1.1,.3,1)', fill: 'both' });
      if (flip && faceDown) inner.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], { duration: ms * 1.3, easing: 'ease-in-out', fill: 'forwards' });
    } else if (faceDown && flip) inner.style.transform = 'none';
    return { el, end: () => el.remove() };
  }

  /**
   * A predicted card: leaves its source the moment the player acts (before the server has answered) and
   * waits near its destination. land() finishes the trip once the real state arrives; cancel() sends it
   * home if the action was rejected. This is how clicks feel instant while the server stays authoritative.
   */
  function ghost({ spec, backSpec = BACK, from, toward, frac = 0.78, ms = 420, faceDown = false, glow = '' }) {
    if (reduced || !from || !toward || !layer.animate) return null;
    const W = Math.max(24, from.w), H = W * 1.4;
    const el = document.createElement('div');
    el.className = 'flight ghost';
    el.innerHTML = `<div class="fl-in"><div class="fl-face">${cardHTML(spec)}</div><div class="fl-back">${cardHTML(backSpec)}</div></div>`;
    el.style.cssText = `width:${W}px;height:${H}px;left:${from.x - W / 2}px;top:${from.y - H / 2}px;`;
    if (glow) el.style.setProperty('--glow', glow);
    el.querySelectorAll('.card').forEach((c) => c.style.setProperty('--w', W + 'px'));
    if (faceDown) el.firstElementChild.style.transform = 'rotateY(180deg)';
    layer.appendChild(el);
    const k = (toward.w || W) / W;
    el.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${(toward.x - from.x) * frac}px,${(toward.y - from.y) * frac}px) scale(${1 + (k - 1) * frac})` }],
      { duration: ms, easing: EASE.out, fill: 'forwards' });
    let done = false;
    return {
      el, spec,
      rect: () => rectOf(el),
      /** Continue from wherever the ghost is now to the real destination. */
      land(to, o = {}) {
        if (done) return Promise.resolve(); done = true;
        const from2 = rectOf(el);
        const p = fly({ spec: o.spec || spec, backSpec, from: from2, to, faceDown, flipAt: 0.4, ms: 300, arc: 0.06, glow, ...o });
        el.remove();
        return p;
      },
      /** The action was rejected: slide back and fade. */
      cancel() {
        if (done) return; done = true;
        const cur = rectOf(el), dx = from.x - cur.x, dy = from.y - cur.y;
        const a = el.animate([{ transform: getComputedStyle(el).transform, opacity: 1 }, { transform: `${getComputedStyle(el).transform} translate(${dx}px,${dy}px)`, opacity: 0 }], { duration: 260, easing: EASE.out, fill: 'forwards' });
        a.onfinish = () => el.remove(); setTimeout(() => el.remove(), 400);
      },
    };
  }

  /**
   * A thin arrow that draws itself from `from` to `to`, then fades: "this is going there".
   * Follows the same curve a fly() with the same arc / side takes. Returns a promise that resolves when it is gone.
   *   color  stroke colour     arc, side  as fly()     ms  how long it stays      delay  ms before it starts
   */
  function trail({ from, to, color = '#cdb27b', arc = 0.14, side = 0, ms = 1100, delay = 0, width = 2.6 }) {
    if (reduced || !from || !to || !layer.animate) return Promise.resolve();
    const NS = 'http://www.w3.org/2000/svg';
    const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
    if (dist < 12) return Promise.resolve();
    const { mx, my } = curveMid(dx, dy, arc, side);
    const cx = 2 * mx - dx / 2, cy = 2 * my - dy / 2;                       // quadratic control point that passes through the same middle
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'trail');
    svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
    svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;';
    // stop a little short of the target so the arrowhead does not sit under the card that lands there (de Casteljau split at t)
    const t = Math.max(0.6, 1 - Math.min(0.16, 22 / dist)), u = 1 - t;
    const c1x = from.x + t * cx, c1y = from.y + t * cy;
    const ex = from.x + 2 * u * t * cx + t * t * dx, ey = from.y + 2 * u * t * cy + t * t * dy;
    const d = `M${from.x},${from.y} Q${c1x},${c1y} ${ex},${ey}`;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(width)); path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-dasharray', '1 7'); path.style.filter = `drop-shadow(0 0 5px ${color})`;
    // arrowhead: points along the last stretch of the curve
    const ax = ex - c1x, ay = ey - c1y, al = Math.hypot(ax, ay) || 1, ux = ax / al, uy = ay / al;
    const head = document.createElementNS(NS, 'path');
    const hs = 11;
    head.setAttribute('d', `M${ex + ux * 2},${ey + uy * 2} L${ex - ux * hs - uy * hs * 0.62},${ey - uy * hs + ux * hs * 0.62} L${ex - ux * hs + uy * hs * 0.62},${ey - uy * hs - ux * hs * 0.62} Z`);
    head.setAttribute('fill', color); head.style.filter = `drop-shadow(0 0 5px ${color})`; head.style.opacity = '0';
    svg.append(path, head); layer.appendChild(svg);
    let len = 0; try { len = path.getTotalLength(); } catch { /* not measurable: skip the draw-on */ }
    const grow = Math.round(ms * 0.45);
    if (len) {
      path.setAttribute('stroke-dasharray', `${len}`);
      path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: grow, delay, easing: EASE.out, fill: 'both' });
    }
    head.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 160, delay: delay + grow * 0.7, easing: EASE.spring, fill: 'both' });
    const life = svg.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: ms, delay, easing: 'linear', fill: 'both' });
    return life.finished.catch(() => {}).then(() => svg.remove());
  }

  return { fly, hover, ghost, trail, sleep };
}
