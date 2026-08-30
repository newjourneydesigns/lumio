// Node-side checks for the scoring maths. No browser needed: we shim the two
// AudioBuffer methods dsp.js actually touches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAttempt, dtwDistance, chanceDistance, featurise, logMelFrames, trimSilence, resample } from '../src/js/dsp.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (n) => join(HERE, 'fixtures', n);

function readWav(path) {
  const buf = readFileSync(path);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const channels = buf.readUInt16LE(22);
  assert.equal(bits, 16, 'fixtures are 16-bit');
  const n = (buf.length - 44) / 2;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = buf.readInt16LE(44 + i * 2) / 32768;
  return audioBuffer(data, rate, channels);
}

function audioBuffer(data, sampleRate, numberOfChannels = 1) {
  return { length: data.length, sampleRate, numberOfChannels, getChannelData: () => data };
}

const reverse = (ab) => audioBuffer(Float32Array.from(ab.getChannelData(0)).reverse(), ab.sampleRate);

// Deterministic pseudo-noise, so runs are reproducible.
function jitter(ab, { noise = 0, rate = 1, gain = 1 } = {}) {
  const src = ab.getChannelData(0);
  const out = new Float32Array(Math.floor(src.length / rate));
  let seed = 12345;
  for (let i = 0; i < out.length; i++) {
    const pos = i * rate;
    const k = Math.floor(pos);
    const f = pos - k;
    const v = (src[k] || 0) * (1 - f) + (src[k + 1] || 0) * f;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = v * gain + (seed / 0x7fffffff - 0.5) * 2 * noise;
  }
  return audioBuffer(out, ab.sampleRate);
}

const forward = readWav(fx('phrase-forward.wav'));
const reversed = readWav(fx('phrase-reversed.wav'));
const wrong = readWav(fx('phrase-wrong.wav'));
const silence = readWav(fx('silence.wav'));

test('reversing the reversed fixture recovers the original', () => {
  const back = reverse(reversed).getChannelData(0);
  const orig = forward.getChannelData(0);
  let maxDiff = 0;
  for (let i = 0; i < orig.length; i++) maxDiff = Math.max(maxDiff, Math.abs(orig[i] - back[i]));
  assert.ok(maxDiff < 1e-4, `round trip drifted by ${maxDiff}`);
});

test('a perfect mimic scores near the ceiling', () => {
  const { score } = scoreAttempt(forward, reverse(reversed));
  console.log('   perfect mimic ->', score);
  assert.ok(score >= 90, `expected >= 90, got ${score}`);
});

// Absolute score bands cannot be pinned down against synthetic fixtures — that
// needs real voices. What must hold, and what these assert, is the ORDERING and
// the invariances: better attempts always score higher, and the things a player
// cannot control (loudness, room noise, speaking pace) must not move the score.
test('a good-but-human mimic still scores well', () => {
  // Noisier, 12% slower, quieter — what a real decent attempt looks like.
  const attempt = reverse(jitter(reversed, { noise: 0.012, rate: 0.88, gain: 0.55 }));
  const { score } = scoreAttempt(forward, attempt);
  console.log('   good mimic    ->', score);
  assert.ok(score >= 60, `expected >= 60, got ${score}`);
});

test('scores are ordered: perfect > good > sloppy, and good > wrong phrase', () => {
  const perfect = scoreAttempt(forward, reverse(reversed)).score;
  const good = scoreAttempt(forward, reverse(jitter(reversed, { noise: 0.012, rate: 0.88, gain: 0.55 }))).score;
  const sloppy = scoreAttempt(forward, reverse(jitter(reversed, { noise: 0.03, rate: 0.72, gain: 0.4 }))).score;
  const wrongScore = scoreAttempt(forward, wrong).score;
  console.log('   perfect/good/sloppy/wrong ->', perfect, good, sloppy, wrongScore);
  assert.ok(perfect > good, `perfect ${perfect} should beat good ${good}`);
  assert.ok(good > sloppy, `good ${good} should beat sloppy ${sloppy}`);
  assert.ok(good - wrongScore >= 15, `good ${good} should clear wrong ${wrongScore} by 15+`);
});

test('nobody is ever told they scored zero for trying', () => {
  const sloppy = scoreAttempt(forward, jitter(wrong, { noise: 0.05, rate: 0.6 })).score;
  console.log('   worst case    ->', sloppy);
  assert.ok(sloppy >= 18, `floor breached: ${sloppy}`);
});

test('silence is not a winning strategy', () => {
  const { score, reason } = scoreAttempt(forward, silence);
  console.log('   silence       ->', score, reason);
  assert.equal(reason, 'mimic-silent');
  assert.equal(score, 0);
});

test('shouting does not beat speaking', () => {
  const quiet = scoreAttempt(forward, reverse(jitter(reversed, { gain: 0.15 }))).score;
  const loud = scoreAttempt(forward, reverse(jitter(reversed, { gain: 3.5 }))).score;
  console.log('   quiet/loud    ->', quiet, loud);
  assert.ok(Math.abs(quiet - loud) <= 6, `loudness moved the score by ${Math.abs(quiet - loud)}`);
});

test('speaking faster or slower is forgiven', () => {
  const base = scoreAttempt(forward, reverse(reversed)).score;
  for (const rate of [0.8, 0.9, 1.1, 1.25]) {
    const s = scoreAttempt(forward, reverse(jitter(reversed, { rate }))).score;
    assert.ok(base - s <= 25, `rate ${rate} cost ${base - s} points`);
  }
});

test('room noise is forgiven', () => {
  const base = scoreAttempt(forward, reverse(reversed)).score;
  const noisy = scoreAttempt(forward, reverse(jitter(reversed, { noise: 0.012 }))).score;
  console.log('   clean/noisy   ->', base, noisy);
  assert.ok(base - noisy <= 15, `noise cost ${base - noisy} points`);
});

test('scoring is deterministic', () => {
  const a = scoreAttempt(forward, reverse(reversed)).score;
  const b = scoreAttempt(forward, reverse(reversed)).score;
  assert.equal(a, b);
});

test('trimSilence drops the dead air and keeps the speech', () => {
  const at16k = resample(forward.getChannelData(0), forward.sampleRate, 16000);
  const trimmed = trimSilence(at16k);
  assert.ok(trimmed.length < at16k.length, 'nothing was trimmed');
  assert.ok(trimmed.length > at16k.length * 0.4, 'trimmed too aggressively');
});

test('an empty take is reported, not crashed on', () => {
  const empty = audioBuffer(new Float32Array(0), 48000);
  assert.equal(scoreAttempt(empty, forward).reason, 'original-silent');
  assert.equal(featurise(empty).empty, true);
  assert.equal(dtwDistance([], []), Infinity);
});

test('the chance baseline is deterministic and beats the real distance', () => {
  const a = featurise(forward).frames;
  const b = featurise(reverse(reversed)).frames;
  const first = chanceDistance(a, b);
  const second = chanceDistance(a, b);
  assert.equal(first, second, 'baseline must be bit-reproducible across runs');
  assert.ok(first > dtwDistance(a, b), 'scrambled content should cost more than the real thing');
});

test('a wrong phrase lands near the floor, not mid-table', () => {
  const { score, ratio } = scoreAttempt(forward, wrong);
  console.log('   wrong phrase  ->', score, 'ratio', ratio.toFixed(3));
  assert.ok(score <= 30, `a wrong phrase should not score ${score}`);
});

test('holding the phone up to the playback is flagged, not punished', () => {
  const cheated = scoreAttempt(forward, reverse(reversed));
  assert.equal(cheated.suspicious, true);
  assert.ok(cheated.score >= 95, 'still award the points, just flag it');
  const honest = scoreAttempt(forward, reverse(jitter(reversed, { noise: 0.012, rate: 0.88 })));
  assert.equal(honest.suspicious, false);
});

test('every mel filter holds at least one FFT bin', () => {
  // An empty filter emits a constant and quietly poisons every frame.
  const frames = logMelFrames(new Float32Array(16000).map((_, i) => Math.sin(i * 0.05) * 0.3));
  assert.ok(frames.length > 0);
  for (const frame of frames) {
    for (let m = 0; m < frame.length; m++) {
      assert.ok(Number.isFinite(frame[m]), `mel band ${m} produced ${frame[m]}`);
    }
  }
});

test('scoring a pair costs well under the frame budget', () => {
  const attempt = reverse(jitter(reversed, { noise: 0.012, rate: 0.9 }));
  const start = performance.now();
  for (let i = 0; i < 5; i++) scoreAttempt(forward, attempt);
  const each = (performance.now() - start) / 5;
  console.log('   score time    ->', each.toFixed(1), 'ms');
  assert.ok(each < 300, `scoring took ${each.toFixed(0)}ms`);
});
