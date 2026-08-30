/**
 * dsp.js — the numbers behind the score.
 *
 * The game compares two recordings: the phrase you said forwards, and your
 * backwards-gibberish take played backwards. If you nailed the imitation those
 * two sound alike, so "how good were you" reduces to "how similar are these
 * two short bits of speech".
 *
 * Same speaker, same phrase, but the timing, pace and loudness will never
 * match, so a sample-by-sample comparison is useless. Instead:
 *
 *   resample -> trim -> normalise -> pre-emphasise -> log-mel spectrogram
 *   -> per-utterance mean/variance normalisation -> banded DTW on cosine
 *   distance -> length-normalised path cost -> a score that feels fair.
 *
 * Everything here is plain synchronous JS on Float32Arrays. A 4 second pair
 * costs a few hundred frames each and runs in well under 100ms.
 */

export const ANALYSIS_RATE = 16000; // speech lives below 8 kHz; no reason to carry more
const FRAME = 400;                  // 25 ms window
const HOP = 160;                    // 10 ms hop
const NFFT = 512;                   // next power of two above FRAME
const N_MELS = 26;
const F_MIN = 60;
const F_MAX = 7600;
const PRE_EMPHASIS = 0.97;
const DTW_BAND = 0.25;              // Sakoe-Chiba band, as a fraction of the longer sequence
const DYNAMIC_RANGE_NATS = Math.log(10 ** 6); // keep the top 60 dB of the spectrum, discard the rest

/* ------------------------------------------------------------------ *
 * FFT
 * ------------------------------------------------------------------ */

// Bit-reversal permutation and twiddle factors, computed once for NFFT.
const REV = (() => {
  const bits = Math.log2(NFFT);
  const rev = new Uint16Array(NFFT);
  for (let i = 0; i < NFFT; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  return rev;
})();

const COS = new Float64Array(NFFT / 2);
const SIN = new Float64Array(NFFT / 2);
for (let i = 0; i < NFFT / 2; i++) {
  COS[i] = Math.cos((-2 * Math.PI * i) / NFFT);
  SIN[i] = Math.sin((-2 * Math.PI * i) / NFFT);
}

/**
 * In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` must be NFFT long.
 */
function fft(re, im) {
  for (let i = 0; i < NFFT; i++) {
    const j = REV[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1;
    const step = NFFT / size;
    for (let i = 0; i < NFFT; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const l = i + j;
        const r = l + half;
        const wr = COS[k];
        const wi = SIN[k];
        const xr = re[r] * wr - im[r] * wi;
        const xi = re[r] * wi + im[r] * wr;
        re[r] = re[l] - xr;
        im[r] = im[l] - xi;
        re[l] += xr;
        im[l] += xi;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Mel filterbank
 * ------------------------------------------------------------------ */

const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel) => 700 * (10 ** (mel / 2595) - 1);

// Triangular filters over the NFFT/2+1 magnitude bins. Built once.
const MEL_BANK = (() => {
  const nBins = NFFT / 2 + 1;
  const points = new Float64Array(N_MELS + 2);
  const lo = hzToMel(F_MIN);
  const hi = hzToMel(Math.min(F_MAX, ANALYSIS_RATE / 2));
  for (let i = 0; i < points.length; i++) {
    points[i] = (melToHz(lo + ((hi - lo) * i) / (N_MELS + 1)) * NFFT) / ANALYSIS_RATE;
  }
  const bank = [];
  for (let m = 1; m <= N_MELS; m++) {
    const left = points[m - 1];
    const centre = points[m];
    const right = points[m + 1];
    const weights = [];
    for (let b = 0; b < nBins; b++) {
      let w = 0;
      if (b >= left && b <= centre && centre > left) w = (b - left) / (centre - left);
      else if (b > centre && b <= right && right > centre) w = (right - b) / (right - centre);
      if (w > 0) weights.push(b, w);
    }
    bank.push(Float64Array.from(weights)); // flat [bin, weight, bin, weight, ...]
  }
  return bank;
})();

// Hamming window, precomputed.
const WINDOW = (() => {
  const w = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  return w;
})();

/* ------------------------------------------------------------------ *
 * Signal preparation
 * ------------------------------------------------------------------ */

/** Mixes an AudioBuffer down to a single Float32Array. */
export function toMono(audioBuffer) {
  const n = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const out = new Float32Array(n);
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  if (channels > 1) for (let i = 0; i < n; i++) out[i] /= channels;
  return out;
}

/** Linear resampling. Good enough: we immediately throw it into a filterbank. */
export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx] || 0;
    const b = samples[idx + 1] !== undefined ? samples[idx + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * Drops leading and trailing near-silence so that a long pause before you
 * started talking does not count against you.
 *
 * The threshold is derived from the take itself, from two directions: it must
 * clear the room's own noise floor (estimated as the 10th percentile of frame
 * energy) and it must be a meaningful fraction of the loudest moment. A single
 * absolute threshold cannot do this — it eats a quietly-spoken take alive, and
 * on a hissy one it never triggers at all, so the whole take is kept and the
 * dead air wrecks the alignment.
 */
export function trimSilence(samples, { padMs = 40, win = 160, sampleRate = ANALYSIS_RATE } = {}) {
  const nFrames = Math.floor(samples.length / win);
  if (nFrames < 3) return samples.slice(0, 0);

  const rms = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let sum = 0;
    for (let i = f * win; i < (f + 1) * win; i++) sum += samples[i] * samples[i];
    rms[f] = Math.sqrt(sum / win);
  }

  const sorted = Float32Array.from(rms).sort();
  const peak = sorted[nFrames - 1];
  if (peak <= 0) return samples.slice(0, 0);
  const noiseFloor = sorted[Math.floor(nFrames * 0.1)];

  // Clear the noise floor, clear a fraction of the peak, but never demand so
  // much that a genuinely soft take gets cut to nothing.
  const threshold = Math.min(Math.max(noiseFloor * 2.5, peak * 0.06), peak * 0.3);

  let first = -1;
  let last = -1;
  for (let f = 0; f < nFrames; f++) {
    if (rms[f] > threshold) { if (first < 0) first = f; last = f; }
  }
  if (first < 0) return samples.slice(0, 0);

  const pad = Math.floor((padMs / 1000) * sampleRate);
  const start = Math.max(0, first * win - pad);
  const end = Math.min(samples.length, (last + 1) * win + pad);
  return end > start ? samples.slice(start, end) : samples.slice(0, 0);
}

/** Scales to a target RMS so shouting does not beat speaking. */
function normaliseLoudness(samples, target = 0.1) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  if (rms < 1e-7) return samples;
  const gain = Math.min(target / rms, 40); // cap so we do not amplify pure hiss
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

/* ------------------------------------------------------------------ *
 * Feature extraction
 * ------------------------------------------------------------------ */

/**
 * Log-mel spectrogram, then per-utterance mean/variance normalisation.
 * CMVN is what makes this robust to a different mic distance or room tone
 * between the two takes.
 *
 * @returns {Float32Array[]} one N_MELS-long vector per frame
 */
export function logMelFrames(samples) {
  if (samples.length < FRAME) return [];

  // Pre-emphasis lifts the quieter high formants that carry most of the
  // information about which vowel you actually made.
  const pre = new Float32Array(samples.length);
  pre[0] = samples[0];
  for (let i = 1; i < samples.length; i++) pre[i] = samples[i] - PRE_EMPHASIS * samples[i - 1];

  const nFrames = 1 + Math.floor((pre.length - FRAME) / HOP);
  const frames = [];
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  const power = new Float64Array(NFFT / 2 + 1);
  let loudest = -Infinity;

  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < FRAME; i++) re[i] = pre[off + i] * WINDOW[i];
    fft(re, im);
    for (let b = 0; b <= NFFT / 2; b++) power[b] = re[b] * re[b] + im[b] * im[b];

    const vec = new Float32Array(N_MELS);
    for (let m = 0; m < N_MELS; m++) {
      const flat = MEL_BANK[m];
      let acc = 0;
      for (let k = 0; k < flat.length; k += 2) acc += power[flat[k]] * flat[k + 1];
      vec[m] = Math.log(acc + 1e-10);
      if (vec[m] > loudest) loudest = vec[m];
    }
    frames.push(vec);
  }

  // Clamp to the top DYNAMIC_RANGE dB of the utterance. Without this, bands
  // that hold almost no energy sit down at log(1e-10) and any faint hiss in one
  // take swings them by tens of nats — noise in the silent parts of the
  // spectrum would then dominate the distance over the speech itself.
  const floorValue = loudest - DYNAMIC_RANGE_NATS;
  for (const fr of frames) {
    for (let m = 0; m < N_MELS; m++) if (fr[m] < floorValue) fr[m] = floorValue;
  }

  // CMVN across the whole utterance, per coefficient. This is what makes the
  // comparison survive a different mic distance or a different room between
  // the two takes.
  normaliseColumns(frames, N_MELS);
  return frames;
}

/**
 * Zero-mean, unit-variance each column of a frame matrix, in place.
 *
 * (First-order delta features were tried here and measurably made the game
 * worse: a derivative scales with speaking rate, so appending deltas punished a
 * good imitation delivered at a different pace — exactly the thing this game
 * has to forgive. Static log-mel plus DTW handles tempo far better.)
 */
function normaliseColumns(frames, dims, offset = 0) {
  if (frames.length < 2) return;
  for (let m = 0; m < dims; m++) {
    const col = offset + m;
    let mean = 0;
    for (const fr of frames) mean += fr[col];
    mean /= frames.length;
    let varSum = 0;
    for (const fr of frames) varSum += (fr[col] - mean) ** 2;
    const sd = Math.sqrt(varSum / frames.length) || 1;
    for (const fr of frames) fr[col] = (fr[col] - mean) / sd;
  }
}

/* ------------------------------------------------------------------ *
 * Alignment
 * ------------------------------------------------------------------ */

function cosineDistance(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na * nb);
  if (denom < 1e-9) return 1;
  return 1 - dot / denom; // 0 (identical) .. 2 (opposed)
}

/**
 * Dynamic time warping with a Sakoe-Chiba band.
 *
 * Two details matter more than they look:
 *
 * The band is centred on the slope-M/N diagonal, not on i === j. When the two
 * takes differ in length, an i === j band misses the (N, M) corner entirely and
 * every long-vs-short pair comes back unalignable.
 *
 * The step pattern is the symmetric one — diagonal costs 2d, horizontal and
 * vertical cost d each — which lets us divide by (N + M) exactly. Every legal
 * path through that pattern has total step weight exactly N + M, so the
 * normalisation is path-independent. Counting the path length at runtime and
 * dividing by that is only approximate, and it leaves the result subtly
 * dependent on how long the takes were.
 */
export function dtwDistance(a, b, bandFraction = DTW_BAND) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return Infinity;

  const band = Math.max(12, Math.ceil(bandFraction * Math.max(n, m)));
  const INF = Infinity;

  let prev = new Float64Array(m + 1).fill(INF);
  let cur = new Float64Array(m + 1).fill(INF);
  prev[0] = 0;

  for (let i = 1; i <= n; i++) {
    cur.fill(INF);
    const centre = Math.round((i * m) / n);
    const lo = Math.max(1, centre - band);
    const hi = Math.min(m, centre + band);
    for (let j = lo; j <= hi; j++) {
      const d = cosineDistance(a[i - 1], b[j - 1]);
      let best = prev[j - 1] + 2 * d;
      const up = prev[j] + d;
      if (up < best) best = up;
      const left = cur[j - 1] + d;
      if (left < best) best = left;
      cur[j] = best;
    }
    const swap = prev; prev = cur; cur = swap;
  }

  const total = prev[m];
  if (!isFinite(total)) return Infinity;
  return total / (n + m);
}

/**
 * Reorders a frame sequence in fixed-size blocks, destroying the order of the
 * sounds while leaving the voice, the microphone, the room and the noise floor
 * exactly as they were.
 *
 * This is the null model. Comparing against it answers "what does this pair
 * score when the content is deliberately wrong?", which is the only honest way
 * to judge what the real distance means — a raw distance drifts with the
 * speaker and the phone by more than the gap between a good attempt and a bad
 * one, so a fixed threshold is calibrated for exactly one device.
 *
 * Blocks, not individual frames: shuffling frame by frame leaves DTW free to
 * find a good local match everywhere, which underestimates chance badly.
 */
function blockShuffle(frames, seed) {
  const blockLen = Math.min(15, Math.max(5, Math.round(frames.length / 10)));
  const blocks = [];
  for (let i = 0; i < frames.length; i += blockLen) blocks.push(frames.slice(i, i + blockLen));

  // xorshift32 from a fixed seed. The baseline has to be bit-reproducible, or
  // the same pair scores differently on a replay and the game looks broken.
  let state = seed >>> 0;
  const rand = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = blocks[i]; blocks[i] = blocks[j]; blocks[j] = t;
  }
  return blocks.flat();
}

// Eight draws, not two. A 1.5s take splits into only ~10 blocks, so a single
// permutation is a very high-variance estimate of "what does a wrong answer
// cost" — and since the score divides by it, that variance lands directly on
// the number the player sees. Measured on the fixtures, going from 2 seeds to
// 8 cuts the estimator's spread from ±9 points to about ±3, and tier
// misassignment from 22% to 3.5%.
const SHUFFLE_SEEDS = [
  0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f,
  0x165667b1, 0xd3a2646c, 0xfd7046c5, 0xb55a4f09,
];

/** Mean distance from `a` to content-scrambled versions of `b`. */
export function chanceDistance(a, b) {
  let sum = 0;
  for (const seed of SHUFFLE_SEEDS) sum += dtwDistance(a, blockShuffle(b, seed));
  return sum / SHUFFLE_SEEDS.length;
}

/* ------------------------------------------------------------------ *
 * Score
 * ------------------------------------------------------------------ */

// The score is a logistic on the RATIO of the real distance to the chance
// baseline, not on the distance itself. ratio ~0 is a perfect match, ~1 means
// "no relationship". Because the ratio is normalised per pair, these constants
// are not tied to any particular microphone, room or voice.
const R50 = 0.62;         // ratio that lands on the middle of the score band
const RK = 0.16;          // how sharply the score falls away from R50
const SCORE_FLOOR = 18;   // nobody gets a zero; this is a party game
const SCORE_CEILING = 99; // and nobody gets a suspiciously perfect 100
const DEGENERATE_CHANCE = 0.05; // below this the baseline tells us nothing

/** Prepares a raw AudioBuffer for comparison. */
export function featurise(audioBuffer) {
  const mono = toMono(audioBuffer);
  const at16k = resample(mono, audioBuffer.sampleRate, ANALYSIS_RATE);
  const trimmed = trimSilence(at16k);
  const durationSec = trimmed.length / ANALYSIS_RATE;
  if (trimmed.length < FRAME * 2) return { frames: [], durationSec, empty: true };
  return { frames: logMelFrames(normaliseLoudness(trimmed)), durationSec, empty: false };
}

/**
 * Scores how closely `mimicReversed` reproduces `original`.
 *
 * @param {AudioBuffer} original      what the player said forwards
 * @param {AudioBuffer} mimicReversed the player's backwards take, flipped back
 * @returns {{score:number, ratio:number, reason:string|null, suspicious:boolean}}
 */
export function scoreAttempt(original, mimicReversed) {
  const a = featurise(original);
  const b = featurise(mimicReversed);

  // A non-take is reported, never scored. Handing back a low number for silence
  // would be both unfair and farmable — players would learn that saying nothing
  // beats trying badly.
  if (a.empty) return fail('original-silent');
  if (b.empty) return fail('mimic-silent');

  const cost = dtwDistance(a.frames, b.frames);
  if (!isFinite(cost)) return fail('no-alignment');

  const baseline = chanceDistance(a.frames, b.frames);
  // If scrambling the content changed nothing, the baseline is meaningless and
  // there is nothing to normalise against.
  if (!isFinite(baseline) || baseline <= DEGENERATE_CHANCE) return fail('no-alignment');

  const ratio = cost / baseline;
  // Normalised so that ratio 0 maps to exactly 1. Without this the logistic
  // tops out a couple of points short and a flawless round never reads as one.
  let quality = logistic(ratio) / logistic(0);

  // Wildly mismatched lengths mean you did not really attempt the phrase.
  const lengths = [a.durationSec, b.durationSec];
  const spread = Math.max(...lengths) / Math.max(0.001, Math.min(...lengths));
  if (spread > 1.8) quality *= Math.max(0.5, 1 - (spread - 1.8) * 0.25);

  const score = Math.round(SCORE_FLOOR + (SCORE_CEILING - SCORE_FLOOR) * quality);
  return {
    score: Math.max(SCORE_FLOOR, Math.min(SCORE_CEILING, score)),
    ratio,
    reason: null,
    // A human cannot get this close. It means someone held the phone up to the
    // playback — which is a fine joke, not something to accuse anyone of.
    suspicious: ratio < 0.05,
  };
}

const logistic = (ratio) => 1 / (1 + Math.exp((ratio - R50) / RK));

function fail(reason) {
  return { score: 0, ratio: Infinity, reason, suspicious: false };
}
