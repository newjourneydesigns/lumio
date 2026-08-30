/**
 * End-to-end: drives a real Chromium through a whole round with a fake
 * microphone, so the parts that only exist in a browser — permissions, the
 * AudioWorklet, playback, the DOM flow — are actually exercised.
 *
 *   node tests/e2e.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 8123;
const FIXTURE = join(HERE, 'fixtures', 'phrase-forward.wav');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const server = spawn(process.execPath, [join(ROOT, 'scripts/serve.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({
  executablePath: CHROME,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${FIXTURE}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  // Script errors are always a failure. Failed network requests are tracked
  // separately: web fonts are expected to be unreachable in a sandbox, but a
  // missing asset of our own is a real bug.
  const errors = [];
  const badRequests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => {
    if (new URL(r.url()).host.startsWith('localhost')) badRequests.push(r.url());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && new URL(r.url()).host.startsWith('localhost')) {
      badRequests.push(`${r.status()} ${r.url()}`);
    }
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

  const stepBtn = (n) => page.locator(`.step[data-step="${n}"] .step-primary`);
  const stepState = (n) => page.getAttribute(`.step[data-step="${n}"]`, 'data-state');

  check('page renders four steps', (await page.locator('.step').count()) === 4);
  check('step 1 starts active', (await stepState(1)) === 'active');
  check('step 2 starts locked', (await stepState(2)) === 'locked');
  check('a phrase is suggested', (await page.locator('#phrase-word').textContent()).trim().length > 0);

  // Buttons must not repeat the original app's two identical PLAY BACKWARDS.
  const labels = await page.locator('.step-primary').allTextContents();
  check('all four button labels are distinct', new Set(labels).size === 4, labels.join(' / '));

  async function record(n, ms) {
    await stepBtn(n).click();
    await page.waitForSelector(`.step[data-step="${n}"] .step-primary.is-live`, { timeout: 8000 });
    await page.waitForTimeout(ms);
    await stepBtn(n).click();
    await page.waitForFunction(
      (step) => document.querySelector(`.step[data-step="${step}"]`).dataset.state === 'done',
      n, { timeout: 8000 },
    );
  }

  async function playThrough(n) {
    await stepBtn(n).click();
    await page.waitForFunction(() => !window.__sdrawkcab.busy, null, { timeout: 15000 });
  }

  // ---- step 1
  await record(1, 1600);
  check('step 1 captured a take', await page.evaluate(() => !!window.__sdrawkcab.takes.original));
  check('step 2 unlocked', (await stepState(2)) === 'active');

  const takeInfo = await page.evaluate(() => {
    const g = window.__sdrawkcab;
    return { duration: g.takes.original.buffer.duration, rate: g.takes.original.sampleRate };
  });
  check('take has real duration', takeInfo.duration > 0.5 && takeInfo.duration < 9,
    `${takeInfo.duration.toFixed(2)}s @ ${takeInfo.rate}Hz`);

  // The identity the whole game rests on, verified on real browser audio.
  const identity = await page.evaluate(() => {
    const g = window.__sdrawkcab;
    const original = g.takes.original.buffer.getChannelData(0);
    const back = g.reversed.original.getChannelData(0);
    let maxDiff = 0;
    for (let i = 0; i < original.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(original[i] - back[back.length - 1 - i]));
    }
    return { maxDiff, sameLength: original.length === back.length };
  });
  check('reversal is sample-exact', identity.sameLength && identity.maxDiff === 0,
    `maxDiff ${identity.maxDiff}`);

  const drew = await page.evaluate(() => {
    const c = document.querySelector('.step[data-step="1"] canvas');
    const ctx = c.getContext('2d');
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
    return lit;
  });
  check('step 1 waveform is drawn', drew > 200, `${drew} lit pixels`);

  // ---- step 2
  await playThrough(2);
  check('step 3 unlocked after listening', (await stepState(3)) === 'active');

  // ---- step 3
  await record(3, 1600);
  check('step 3 captured a mimic', await page.evaluate(() => !!window.__sdrawkcab.takes.mimic));
  check('step 4 unlocked', (await stepState(4)) === 'active');
  check('a score was computed', await page.evaluate(() => !!window.__sdrawkcab.result));

  // ---- step 4
  await playThrough(4);
  await page.waitForSelector('#result:not([hidden])', { timeout: 8000 });
  // The number counts up over about a second; wait for it to settle rather
  // than catching it mid-animation.
  await page.waitForFunction(
    () => Number(document.getElementById('score-number').textContent) === window.__sdrawkcab.result.score,
    null, { timeout: 5000 },
  );
  const shown = await page.evaluate(() => ({
    score: Number(document.getElementById('score-number').textContent),
    title: document.getElementById('result-title').textContent,
    quip: document.getElementById('result-quip').textContent,
    stored: localStorage.getItem('sdrawkcab:v1'),
  }));
  check('result panel shows a score', shown.score >= 18 && shown.score <= 99, String(shown.score));
  check('result has a rank and a quip', !!shown.title && !!shown.quip, shown.title);
  check('the round was saved', !!shown.stored && JSON.parse(shown.stored).rounds === 1);

  check('microphone released after the round',
    await page.evaluate(() => !window.__sdrawkcab.engine.stream));

  // ---- a finished record step replays; it must never quietly re-record
  const before = await page.evaluate(() => window.__sdrawkcab.takes.original.duration);
  await playThrough(1);
  const after = await page.evaluate(() => window.__sdrawkcab.takes.original.duration);
  check('tapping a finished record step replays it', before === after,
    `${before} -> ${after}`);

  // ---- replaying the reveal must not count a second round
  await playThrough(4);
  await page.waitForTimeout(300);
  check('replaying the reveal does not re-count the round',
    await page.evaluate(() => JSON.parse(localStorage.getItem('sdrawkcab:v1')).rounds === 1));

  // ---- go again resets cleanly
  await page.locator('#again-btn').click();
  check('reset returns to step 1', (await stepState(1)) === 'active');
  check('reset clears the takes', await page.evaluate(() => !window.__sdrawkcab.takes.original));
  check('reset hides the result', await page.locator('#result').isHidden());

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('every local asset loads', badRequests.length === 0, badRequests.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
