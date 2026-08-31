// Checks for the capture-side signal utilities. The scoring maths that used to
// live here was removed along with the score itself — the reveal is the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimSilence, resample } from '../src/js/dsp.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function readWav(name) {
  const buf = readFileSync(join(HERE, 'fixtures', name));
  const rate = buf.readUInt32LE(24);
  const n = (buf.length - 44) / 2;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = buf.readInt16LE(44 + i * 2) / 32768;
  return { data, rate };
}

const forward = readWav('phrase-forward.wav');
const reversed = readWav('phrase-reversed.wav');

test('reversing the reversed fixture recovers the original', () => {
  const back = Float32Array.from(reversed.data).reverse();
  let maxDiff = 0;
  for (let i = 0; i < forward.data.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(forward.data[i] - back[i]));
  }
  assert.ok(maxDiff < 1e-4, `round trip drifted by ${maxDiff}`);
});

test('trimSilence drops the dead air and keeps the speech', () => {
  const at16k = resample(forward.data, forward.rate, 16000);
  const trimmed = trimSilence(at16k);
  assert.ok(trimmed.length < at16k.length, 'nothing was trimmed');
  assert.ok(trimmed.length > at16k.length * 0.4, 'trimmed too aggressively');
});

test('trimSilence never returns audio for pure silence', () => {
  assert.equal(trimSilence(new Float32Array(32000)).length, 0);
});

test('trimSilence survives a take with no pauses', () => {
  // Continuous tone: nothing is quiet, so nothing should be cut to nothing.
  const tone = new Float32Array(16000).map((_, i) => Math.sin(i * 0.09) * 0.4);
  assert.ok(trimSilence(tone).length > tone.length * 0.8);
});

test('resample preserves duration proportionally', () => {
  const out = resample(forward.data, 48000, 16000);
  assert.ok(Math.abs(out.length - forward.data.length / 3) < 4);
});
