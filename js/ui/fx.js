// ---------------------------------------------------------------------------
// VISUAL FX
//   burst / ring / confetti / embers   particles on a full-screen canvas
//   motes                              faint drifting dust behind the UI
//   floatText / shake / flash          DOM effects
// Everything honours prefers-reduced-motion (fewer particles, no shake).
// ---------------------------------------------------------------------------
export function createFx({ fg, bg, floaters }) {
  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const fctx = fg.getContext('2d'), bctx = bg.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    for (const c of [fg, bg]) { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; }
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0); bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------ particles
  const P = [];
  let raf = 0, last = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function spawn(o) { if (P.length < 900) P.push({ life: 0, rot: 0, vr: 0, drag: 1.5, g: 0, size: 3, alpha: 1, shape: 'dot', ...o }); }
  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  function frame(t) {
    const dt = Math.max(0, Math.min(0.05, (t - last) / 1000)); last = t;   // rAF timestamps can precede performance.now()
    fctx.clearRect(0, 0, W, H);
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life += dt;
      if (p.life >= p.max) { P.splice(i, 1); continue; }
      const k = Math.min(1, Math.max(0, p.life / p.max));
      p.vx *= Math.exp(-p.drag * dt); p.vy *= Math.exp(-p.drag * dt); p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const a = p.alpha * (k < 0.12 ? k / 0.12 : 1 - Math.pow((k - 0.12) / 0.88, 1.6));
      fctx.globalAlpha = Math.max(0, a);
      if (p.shape === 'ring') {
        const r = Math.max(0.1, p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - k, 3)));
        fctx.globalCompositeOperation = 'lighter'; fctx.strokeStyle = p.color; fctx.lineWidth = p.size * (1 - k) + 0.5;
        fctx.beginPath(); fctx.arc(p.x, p.y, r, 0, 6.2832); fctx.stroke();
      } else if (p.shape === 'spark') {
        fctx.globalCompositeOperation = 'lighter'; fctx.strokeStyle = p.color; fctx.lineWidth = p.size * (1 - k * 0.6); fctx.lineCap = 'round';
        fctx.beginPath(); fctx.moveTo(p.x, p.y); fctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); fctx.stroke();
      } else if (p.shape === 'rect') {
        fctx.globalCompositeOperation = 'source-over'; fctx.fillStyle = p.color;
        fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.scale(1, Math.cos(p.life * 7 + p.rot)); fctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2); fctx.restore();
      } else {                       // soft glowing dot
        fctx.globalCompositeOperation = 'lighter';
        const r = Math.max(0.1, p.size * (1 - k * 0.5));
        const g = fctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
        g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
        fctx.fillStyle = g; fctx.beginPath(); fctx.arc(p.x, p.y, r * 3, 0, 6.2832); fctx.fill();
      }
    }
    fctx.globalAlpha = 1; fctx.globalCompositeOperation = 'source-over';
    if (P.length) raf = requestAnimationFrame(frame); else { raf = 0; fctx.clearRect(0, 0, W, H); }
  }

  const count = (n) => (reduced ? Math.ceil(n * 0.25) : n);

  function burst(x, y, { color = '#cdb27b', n = 26, speed = 260, size = 2.4, life = 0.9, g = 260, shape = 'spark' } = {}) {
    for (let i = 0; i < count(n); i++) {
      const a = rnd(0, 6.2832), s = rnd(speed * 0.25, speed);
      spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, max: rnd(life * 0.6, life), size: rnd(size * 0.6, size * 1.4), color, g, shape });
    }
    kick();
  }
  function ring(x, y, color = '#cdb27b', { r0 = 8, r1 = 150, life = 0.75, size = 3 } = {}) {
    spawn({ shape: 'ring', x, y, vx: 0, vy: 0, drag: 0, r0, r1, max: life, size, color }); kick();
  }
  function embers(x, y, color = '#d9443f', n = 22) {
    for (let i = 0; i < count(n); i++) spawn({ x: x + rnd(-40, 40), y: y + rnd(-10, 20), vx: rnd(-30, 30), vy: rnd(-150, -40), g: -40, drag: 0.6, max: rnd(1, 1.9), size: rnd(1.6, 3.4), color });
    kick();
  }
  function confetti(colors = ['#cdb27b', '#f2d24a', '#19c2c9', '#8a6cf5', '#dcd5c6'], n = 80) {
    for (let i = 0; i < count(n); i++) {
      spawn({ shape: 'rect', x: rnd(0, W), y: rnd(-40, H * 0.15), vx: rnd(-60, 60), vy: rnd(60, 220), g: 160, drag: 0.8, vr: rnd(-6, 6), rot: rnd(0, 6), max: rnd(2, 3.4), size: rnd(3, 6), color: colors[(Math.random() * colors.length) | 0] });
    }
    kick();
  }

  // ---------------------------------------------------------------- motes
  const motes = reduced ? [] : Array.from({ length: 28 }, () => ({ x: Math.random(), y: Math.random(), r: rnd(0.6, 1.8), v: rnd(0.004, 0.012), ph: rnd(0, 6.28), a: rnd(0.06, 0.2) }));
  let lastM = 0;
  function moteFrame(t) {
    requestAnimationFrame(moteFrame);
    if (t - lastM < 33) return; const dt = (t - lastM) / 1000; lastM = t;
    bctx.clearRect(0, 0, W, H);
    for (const m of motes) {
      m.y -= m.v * dt * 4; if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
      const x = (m.x + Math.sin(t / 2600 + m.ph) * 0.012) * W, y = m.y * H;
      bctx.fillStyle = `rgba(205,178,123,${m.a * (0.6 + 0.4 * Math.sin(t / 900 + m.ph))})`;
      bctx.beginPath(); bctx.arc(x, y, m.r, 0, 6.2832); bctx.fill();
    }
  }
  if (motes.length) requestAnimationFrame(moteFrame);

  // ----------------------------------------------------------- DOM effects
  function floatText(text, x, y, { cls = '', ms = 1400 } = {}) {
    const el = document.createElement('div');
    el.className = 'floater ' + cls; el.textContent = text;
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.animationDuration = ms + 'ms';
    floaters.appendChild(el);
    setTimeout(() => el.remove(), ms + 100);
  }
  function shake(el, amp = 8) {
    if (reduced || !el || !el.animate) return;
    el.animate([
      { transform: 'translate(0,0)' }, { transform: `translate(${-amp}px,${amp * 0.4}px)` }, { transform: `translate(${amp}px,${-amp * 0.5}px)` },
      { transform: `translate(${-amp * 0.6}px,${-amp * 0.3}px)` }, { transform: `translate(${amp * 0.4}px,${amp * 0.3}px)` }, { transform: 'translate(0,0)' },
    ], { duration: 420, easing: 'ease-out' });
  }
  function flash(color = 'rgba(217,68,63,.5)', ms = 700) {
    if (!document.body.animate) return;
    const el = document.createElement('div');
    el.className = 'fxflash'; el.style.background = `radial-gradient(closest-side at 50% 50%, transparent 35%, ${color} 130%)`;
    floaters.appendChild(el);
    const an = el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
    an.onfinish = () => el.remove();
  }
  const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

  return { reduced, burst, ring, embers, confetti, floatText, shake, flash, center, size: () => ({ W, H }) };
}
