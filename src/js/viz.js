/**
 * viz.js — drawing sound.
 *
 * Every take in the game gets a waveform: the one you recorded, the same thing
 * backwards, your imitation, and your imitation flipped back. Seeing the shape
 * flip is half of what makes the trick click, and on the final screen the two
 * waveforms are drawn on top of each other so you can see how close you got
 * rather than just being handed a number.
 */

/**
 * Reduces an AudioBuffer to one peak amplitude per horizontal bar.
 * A few hundred buckets is plenty; the canvas is a couple hundred pixels wide.
 */
export function computePeaks(buffer, buckets = 220) {
  const data = buffer.getChannelData(0);
  const peaks = new Float32Array(buckets);
  const per = data.length / buckets;
  let loudest = 0;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(data.length, Math.floor((b + 1) * per));
    let peak = 0;
    // Stride through very long buckets rather than reading every sample; the
    // result is visually identical and it keeps this cheap on a phone.
    const step = Math.max(1, Math.floor((end - start) / 512));
    for (let i = start; i < end; i += step) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
    peaks[b] = peak;
    if (peak > loudest) loudest = peak;
  }
  // Normalise so a quietly-spoken take still fills the box. The waveform is a
  // picture of the shape of what you said, not a calibrated meter.
  if (loudest > 0) for (let b = 0; b < buckets; b++) peaks[b] /= loudest;
  return peaks;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * A canvas waveform. Handles device pixel ratio, resizing, an optional
 * playhead, and an optional second "ghost" waveform drawn behind for comparison.
 */
export class Waveform {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.peaks = null;
    this.ghost = null;
    this.duel = null;
    this.progress = 0;
    this.live = null;
    this.colors = { bar: '#888', played: '#fff', ghost: 'rgba(255,255,255,.22)' };
    this._frame = null;
    this._resize = () => this.draw();
    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(this._resize);
      this._observer.observe(canvas);
    } else {
      window.addEventListener('resize', this._resize);
    }
  }

  setColors(colors) {
    Object.assign(this.colors, colors);
    this.draw();
  }

  /** Shows a finished recording. `mirrored` flips it left-to-right. */
  setBuffer(buffer, { mirrored = false } = {}) {
    this.live = null;
    this.duel = null;
    this.peaks = buffer ? computePeaks(buffer) : null;
    if (this.peaks && mirrored) this.peaks = Float32Array.from(this.peaks).reverse();
    this.progress = 0;
    this.draw();
  }

  /**
   * Comparison mode: two takes mirrored around a centre line — the first
   * drawn upward, the second downward, like a reflection. Overlaying them in
   * the same slots was tried first and painted one on top of the other, so
   * wherever the attempt had energy the original was simply invisible.
   *
   * Widths are proportional to duration (both left-aligned), so a short take
   * no longer gets silently stretched to match a long one.
   */
  setDuel(topBuffer, bottomBuffer) {
    this.live = null;
    this.peaks = null;
    this.progress = 0;
    if (!topBuffer || !bottomBuffer) { this.duel = null; this.draw(); return; }
    const longest = Math.max(topBuffer.duration, bottomBuffer.duration);
    const buckets = (b) => Math.max(24, Math.round(220 * (b.duration / longest)));
    this.duel = {
      top: computePeaks(topBuffer, buckets(topBuffer)),
      bottom: computePeaks(bottomBuffer, buckets(bottomBuffer)),
    };
    this.draw();
  }

  /** Switches to live mode: a meter that scrolls while you are recording. */
  startLive(buckets = 220) {
    this.peaks = null;
    this.ghost = null;
    this.duel = null;
    this.live = new Float32Array(buckets);
    this._liveCount = 0;
    this.draw();
  }

  /** Feed one level reading (0..1) from the recorder. */
  pushLevel(value) {
    if (!this.live) return;
    this.live.copyWithin(0, 1);
    this.live[this.live.length - 1] = clamp01(value);
    this._liveCount++;
    this._schedule();
  }

  stopLive() {
    this.live = null;
  }

  /** Moves the playhead. 0..1. */
  setProgress(p) {
    this.progress = clamp01(p);
    this._schedule();
  }

  _schedule() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this.draw();
    });
  }

  draw() {
    const { canvas, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = canvas.clientWidth || 300;
    const cssHeight = canvas.clientHeight || 72;
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);

    const series = this.live || this.peaks;
    const mid = height / 2;

    if (this.duel) {
      const half = height * 0.46;
      const lane = (peaks, color, dir) => {
        const slot = width / 220;
        const barWidth = Math.max(dpr, slot * 0.62);
        ctx.fillStyle = color;
        for (let i = 0; i < peaks.length; i++) {
          const h = Math.max(dpr * 1.5, peaks[i] * half);
          const x = i * slot + (slot - barWidth) / 2;
          const y = dir < 0 ? mid - 2 * dpr - h : mid + 2 * dpr;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x, y, barWidth, h, barWidth / 2);
          else ctx.rect(x, y, barWidth, h);
          ctx.fill();
        }
      };
      lane(this.duel.top, this.colors.ghost, -1);
      lane(this.duel.bottom, this.colors.bar, 1);
      ctx.fillStyle = this.colors.played;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(0, mid - dpr / 2, width, dpr);
      ctx.globalAlpha = 1;
      return;
    }

    if (!series) {
      // Resting state: a flat line, so the box never looks broken.
      ctx.fillStyle = this.colors.bar;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, mid - dpr, width, dpr * 2);
      ctx.globalAlpha = 1;
      return;
    }

    const count = series.length;
    const slot = width / count;
    const barWidth = Math.max(dpr, slot * 0.62);
    const radius = barWidth / 2;
    const maxHeight = height * 0.86;

    const bar = (index, value, style, alpha) => {
      const h = Math.max(dpr * 1.5, value * maxHeight);
      const x = index * slot + (slot - barWidth) / 2;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = style;
      ctx.beginPath();
      // roundRect is well supported now, but fall back rather than throw.
      if (ctx.roundRect) ctx.roundRect(x, mid - h / 2, barWidth, h, radius);
      else ctx.rect(x, mid - h / 2, barWidth, h);
      ctx.fill();
    };

    if (this.ghost) {
      const gslot = width / this.ghost.length;
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.colors.ghost;
      for (let i = 0; i < this.ghost.length; i++) {
        const h = Math.max(dpr, this.ghost[i] * maxHeight);
        const x = i * gslot + (gslot - Math.max(dpr, gslot * 0.62)) / 2;
        ctx.beginPath();
        const w = Math.max(dpr, gslot * 0.62);
        if (ctx.roundRect) ctx.roundRect(x, mid - h / 2, w, h, w / 2);
        else ctx.rect(x, mid - h / 2, w, h);
        ctx.fill();
      }
    }

    const playedUpTo = this.progress * count;
    for (let i = 0; i < count; i++) {
      const played = this.progress > 0 && i < playedUpTo;
      bar(i, series[i], played ? this.colors.played : this.colors.bar, played ? 1 : 0.75);
    }
    ctx.globalAlpha = 1;
  }

  destroy() {
    if (this._frame) cancelAnimationFrame(this._frame);
    if (this._observer) this._observer.disconnect();
    else window.removeEventListener('resize', this._resize);
  }
}
