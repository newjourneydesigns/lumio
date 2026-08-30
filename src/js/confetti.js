/**
 * confetti.js — the reward for a good round. Deliberately tiny: a few hundred
 * rectangles under gravity, one rAF loop, and it stops itself.
 */
const REDUCED = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

export function burst(canvas, { count = 130, colors = ['#ff4d6d', '#4de1ff', '#ffc94d', '#58e08b'] } = {}) {
  if (REDUCED.matches) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = (canvas.width = canvas.clientWidth * dpr);
  const h = (canvas.height = canvas.clientHeight * dpr);

  const parts = Array.from({ length: count }, () => ({
    x: w * (0.25 + Math.random() * 0.5),
    y: h * 0.34,
    vx: (Math.random() - 0.5) * 13 * dpr,
    vy: (Math.random() * -13 - 4) * dpr,
    size: (4 + Math.random() * 6) * dpr,
    spin: (Math.random() - 0.5) * 0.34,
    angle: Math.random() * Math.PI,
    color: colors[(Math.random() * colors.length) | 0],
    life: 1,
  }));

  let raf = 0;
  const tick = () => {
    ctx.clearRect(0, 0, w, h);
    let alive = false;
    for (const p of parts) {
      p.vy += 0.42 * dpr;
      p.vx *= 0.992;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      p.life -= 0.008;
      if (p.life <= 0 || p.y > h + 40) continue;
      alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62);
      ctx.restore();
    }
    if (alive) raf = requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, w, h);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}
