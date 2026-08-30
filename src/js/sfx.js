/**
 * sfx.js — small synthesised interface sounds. No audio files to load, and
 * they share the game's one AudioContext so they never fight it for the
 * device on iOS.
 */
export function makeSfx(engine) {
  let muted = false;

  function tone({ freq = 440, to = freq, duration = 0.12, type = 'sine', gain = 0.06 }) {
    const ctx = engine.ctx;
    if (muted || !ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, now);
    if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
    // A quick attack and a smooth tail: a raw gate would click.
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.onended = () => { osc.disconnect(); amp.disconnect(); };
  }

  return {
    set muted(value) { muted = value; },
    get muted() { return muted; },
    recordStart: () => tone({ freq: 520, to: 780, duration: 0.1, type: 'triangle' }),
    recordStop: () => tone({ freq: 700, to: 380, duration: 0.13, type: 'triangle' }),
    // Rising for a normal advance, falling-then-rising for the big reveal.
    advance: () => tone({ freq: 440, to: 660, duration: 0.14, type: 'sine', gain: 0.05 }),
    reveal: () => { tone({ freq: 300, to: 900, duration: 0.28, type: 'sawtooth', gain: 0.04 }); },
    error: () => tone({ freq: 220, to: 140, duration: 0.2, type: 'square', gain: 0.04 }),
  };
}
