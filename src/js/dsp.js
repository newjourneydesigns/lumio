/**
 * dsp.js — the signal utilities behind the recorder.
 *
 * This file once held a full similarity scorer: a hand-written FFT, a log-mel
 * filterbank, banded dynamic time warping and a chance-baseline score. The
 * game dropped scoring on purpose — hearing your gibberish walk back out IS
 * the payoff, and a number after the punchline just graded the joke — so all
 * of that went with it (it lives in git history if a scored mode ever returns:
 * see the commits around "chance baseline"). What remains is what capture
 * still needs: silence trimming, and resampling kept for its tests.
 */

export const ANALYSIS_RATE = 16000;

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

