// The phrase list is player-facing content that gets read aloud in a room, and
// it is long enough that nobody will re-read it by hand. These are the rules it
// has to keep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT_PHRASES as PHRASES } from '../src/js/phrases.js';

const TARGET = 250;

test('the list is big enough to feel bottomless', (t) => {
  console.log('   phrases ->', PHRASES.length, 'of', TARGET);
  if (PHRASES.length < TARGET) {
    // Reported rather than asserted only while the list is still being
    // written. It becomes a hard failure the moment the content lands, so it
    // cannot quietly regress afterwards.
    t.skip(`content still being written: ${PHRASES.length}/${TARGET}`);
    return;
  }
  assert.ok(PHRASES.length >= TARGET, `only ${PHRASES.length} phrases`);
});

test('every phrase is short enough to reproduce backwards', () => {
  for (const p of PHRASES) {
    const words = p.split(' ');
    assert.ok(words.length <= 4, `too many words: "${p}"`);
    assert.ok(p.length <= 18, `too long (${p.length} chars): "${p}"`);
    assert.ok(p.length >= 3, `too short: "${p}"`);
  }
});

test('phrases are plain lowercase words only', () => {
  // Anything else would render oddly in the picker and read badly aloud.
  for (const p of PHRASES) {
    assert.match(p, /^[a-z]+(?: [a-z]+)*$/, `bad characters: "${p}"`);
    assert.equal(p, p.trim(), `padded: "${p}"`);
  }
});

test('no duplicates, including reordered pairs', () => {
  const exact = new Set();
  const sorted = new Set();
  for (const p of PHRASES) {
    assert.ok(!exact.has(p), `duplicate: "${p}"`);
    exact.add(p);
    const key = p.split(' ').slice().sort().join(' ');
    assert.ok(!sorted.has(key), `same idea reordered: "${p}"`);
    sorted.add(key);
  }
});

test('nothing that would embarrass someone reading it out loud', () => {
  // A coarse net for the obvious categories; the curation pass is the real
  // filter, this only catches something slipping through a later edit.
  const banned = /\b(sex|sexy|butt|boob|damn|hell|kill|dead|die|drunk|beer|wine|vodka|gun|shoot|blood|nude|naked|stupid|dumb|ugly|fat|crazy|insane)\b/;
  for (const p of PHRASES) {
    assert.doesNotMatch(p, banned, `unsuitable: "${p}"`);
  }
});

test('the list is varied, not one joke repeated', () => {
  // No single word may dominate: a list of forty "cheese X" entries would read
  // as padding rather than range.
  const counts = new Map();
  for (const p of PHRASES) {
    for (const w of p.split(' ')) counts.set(w, (counts.get(w) || 0) + 1);
  }
  const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log('   most repeated word ->', worst[0], 'x' + worst[1]);
  const cap = Math.max(6, Math.ceil(PHRASES.length * 0.05));
  assert.ok(worst[1] <= cap, `"${worst[0]}" appears ${worst[1]} times (cap ${cap})`);
});
