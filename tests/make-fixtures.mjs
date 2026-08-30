// Generates deterministic WAV fixtures for the tests.
// Chromium's --use-file-for-fake-audio-capture reads these as the "microphone",
// and the Node scoring tests read them directly.
//
// These are formant-synthesised rather than tonal: a glottal pulse train plus
// aspiration noise, run through three resonators whose centre frequencies glide
// over each syllable. That gives the broadband, formant-shaped spectrum real
// speech has — tuning a scorer against pure tones would tune it against the
// wrong thing entirely.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(OUT, { recursive: true });

const RATE = 48000;

function encodeWav(samples, rate = RATE) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);   // PCM
  buf.writeUInt16LE(1, 22);   // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

// Deterministic uniform noise so every run produces byte-identical fixtures.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000 - 0.5;
  };
}

// A classic two-pole resonator: the building block of formant synthesis.
function resonator(freq, bw) {
  const r = Math.exp((-Math.PI * bw) / RATE);
  const theta = (2 * Math.PI * freq) / RATE;
  const b = 2 * r * Math.cos(theta);
  const c = -r * r;
  const a = 1 - b - c;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = a * x + b * y1 + c * y2;
    y2 = y1;
    y1 = y;
    return y;
  };
}

/**
 * One syllable: a voiced source through three gliding formants.
 * `f1`/`f2` may be a number (steady) or [start, end] (a glide, which is what
 * makes a syllable sound like a consonant-vowel rather than a hum).
 */
function syllable(out, noise, startSec, durSec, { f0, f1, f2, f3 = 2700, aspiration = 0.35, gain = 1 }) {
  const s0 = Math.floor(startSec * RATE);
  const n = Math.floor(durSec * RATE);
  const at = (v, p) => (Array.isArray(v) ? v[0] + (v[1] - v[0]) * p : v);

  let phase = 0;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    // Rebuild the resonators as the formants glide. Cheap and stable enough
    // for a fixture; a real synthesiser would interpolate coefficients.
    const r1 = at(f1, p);
    const r2 = at(f2, p);
    const env = Math.sin(Math.PI * p) ** 0.6;

    // Glottal source: a buzzy pulse train with a little jitter, plus breath.
    const f = at(f0, p) * (1 + noise() * 0.02);
    phase += f / RATE;
    let src = 0;
    if (phase >= 1) { phase -= 1; src = 1; }
    src = src - 0.02 + noise() * aspiration * 0.35;

    if (!syllable._cache || syllable._cache.k !== `${Math.round(r1)}_${Math.round(r2)}`) {
      syllable._cache = {
        k: `${Math.round(r1)}_${Math.round(r2)}`,
        a: resonator(r1, 80),
        b: resonator(r2, 110),
        c: resonator(f3, 160),
      };
    }
    const { a, b, c } = syllable._cache;
    const v = a(src) * 1.0 + b(src) * 0.7 + c(src) * 0.3;
    if (s0 + i < out.length) out[s0 + i] += v * env * gain * 0.9;
  }
  syllable._cache = null;
}

function phrase(totalSec, syllables, seed) {
  const noise = rng(seed);
  const out = new Float32Array(Math.floor(totalSec * RATE));
  for (const s of syllables) syllable(out, noise, s.at, s.dur, s);
  // A faint, constant room floor, as any real mic would pick up.
  for (let i = 0; i < out.length; i++) out[i] += noise() * 0.0025;
  // Normalise to a comfortable peak.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] / peak) * 0.7;
  return out;
}

// Three clearly different syllables with formant glides — reversing this is
// plainly audible and plainly measurable.
const PHRASE = [
  { at: 0.35, dur: 0.34, f0: [125, 118], f1: [320, 700], f2: [2200, 1150] }, // "yah"
  { at: 0.80, dur: 0.30, f0: [140, 132], f1: 400, f2: [1900, 2450] },        // "ee"
  { at: 1.22, dur: 0.38, f0: [110, 96], f1: [850, 500], f2: [1300, 900] },   // "ow"
];

const forward = phrase(2.0, PHRASE, 7);
const reversed = Float32Array.from(forward).reverse();

// A different phrase entirely: what a botched attempt sounds like.
const WRONG = [
  { at: 0.30, dur: 0.50, f0: [95, 90], f1: [600, 280], f2: [1000, 800] },
  { at: 1.05, dur: 0.45, f0: [190, 205], f1: [300, 450], f2: [2600, 3100] },
];

writeFileSync(join(OUT, 'phrase-forward.wav'), encodeWav(forward));
writeFileSync(join(OUT, 'phrase-reversed.wav'), encodeWav(reversed));
writeFileSync(join(OUT, 'phrase-wrong.wav'), encodeWav(phrase(2.0, WRONG, 11)));
writeFileSync(join(OUT, 'silence.wav'), encodeWav(new Float32Array(RATE * 2)));

console.log('wrote fixtures to', OUT);
