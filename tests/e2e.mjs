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
  // Requests are only expected to succeed while the network is up; the offline
  // section below deliberately fails everything the service worker has not
  // precached, which is not a bug.
  let expectNetwork = true;
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => {
    if (expectNetwork && new URL(r.url()).host.startsWith('localhost')) badRequests.push(r.url());
  });
  page.on('response', (r) => {
    if (expectNetwork && r.status() >= 400 && new URL(r.url()).host.startsWith('localhost')) {
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

  // Double-tapping the big button is normal play, and iOS reads it as
  // double-tap-to-zoom unless touch-action says otherwise.
  const touch = await page.evaluate(() => {
    const btn = document.querySelector('.step-primary');
    const meta = document.querySelector('meta[name="viewport"]').content;
    return {
      body: getComputedStyle(document.body).touchAction,
      button: getComputedStyle(btn).touchAction,
      buttonSelect: getComputedStyle(btn).webkitUserSelect || getComputedStyle(btn).userSelect,
      overscroll: getComputedStyle(document.body).overscrollBehaviorY,
      // Pinch-zoom must survive: disabling it locks out anyone who needs to magnify.
      blocksPinch: /user-scalable\s*=\s*no|maximum-scale/.test(meta),
    };
  });
  check('double-tap zoom is disabled on the page', touch.body === 'manipulation', touch.body);
  check('double-tap zoom is disabled on buttons', touch.button === 'manipulation', touch.button);
  check('buttons do not select text on long press', touch.buttonSelect === 'none', touch.buttonSelect);
  check('the page does not rubber-band', touch.overscroll === 'none', touch.overscroll);
  check('pinch-zoom is still allowed', touch.blocksPinch === false);

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

  // A fast double-tap must not race two recordings into getUserMedia.
  const races = await page.evaluate(async () => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let calls = 0;
    navigator.mediaDevices.getUserMedia = (c) => { calls++; return real(c); };
    const btn = document.querySelector('.step[data-step="1"] .step-primary');
    btn.click();
    btn.click();
    btn.click();
    await new Promise((r) => setTimeout(r, 700));
    const streams = window.__sdrawkcab.engine.stream
      ? window.__sdrawkcab.engine.stream.getAudioTracks().length : 0;
    window.__sdrawkcab.engine.stopRecording();
    await new Promise((r) => setTimeout(r, 300));
    navigator.mediaDevices.getUserMedia = real;
    return { calls, streams };
  });
  check('three fast taps open the mic once, not three times', races.calls === 1,
    `${races.calls} getUserMedia calls`);
  await page.evaluate(() => window.__sdrawkcab.redoFrom(1));
  await page.waitForTimeout(200);

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

  // A microphone revoked mid-session must not be handed back from cache: a
  // dead track records digital silence forever, with no error to explain it.
  const revoked = await page.evaluate(async () => {
    const engine = window.__sdrawkcab.engine;
    await engine.acquireMic();
    const first = engine.stream;
    first.getAudioTracks().forEach((t) => t.stop()); // simulate the OS revoking it
    const reused = await engine.acquireMic();
    const live = reused.getAudioTracks().every((t) => t.readyState === 'live');
    engine.releaseMic();
    return { replaced: reused !== first, live };
  });
  check('a revoked microphone is replaced, not reused', revoked.replaced && revoked.live);

  // ---- step 2: prove playback actually carries signal.
  // "I can't hear it" has two very different causes — the app emitting silence,
  // or the device swallowing real audio — and only one of them is ours. Tapping
  // the output bus with an analyser tells them apart.
  const heard = await page.evaluate(async () => {
    const g = window.__sdrawkcab;
    const ctx = g.engine.ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    g.engine.out.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    let sum = 0;
    let frames = 0;
    const done = g.engine.play(g.reversed.original);
    await new Promise((resolve) => {
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) {
          const a = Math.abs(buf[i]);
          if (a > peak) peak = a;
          sum += buf[i] * buf[i];
          frames++;
        }
        if (g.engine.isPlaying) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    await done;
    g.engine.out.disconnect(analyser);
    return { peak: +peak.toFixed(4), rms: +Math.sqrt(sum / Math.max(1, frames)).toFixed(4) };
  });
  check('playback puts real signal on the output bus', heard.peak > 0.01,
    `peak ${heard.peak}, rms ${heard.rms}`);
  check('the output bus is not muted', await page.evaluate(() => window.__sdrawkcab.engine.out.gain.value === 1));

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

  // "Go again" used to scroll and reshuffle while quietly declining to reset,
  // because redoFrom() bails on `busy`. It should look as disabled as it acts.
  const busyUi = await page.evaluate(async () => {
    const g = window.__sdrawkcab;
    const p = g.playBuffer(4, g.reversed.mimic);
    await new Promise((r) => setTimeout(r, 120));
    const state = {
      again: document.getElementById('again-btn').disabled,
      share: document.getElementById('share-btn').disabled,
    };
    g.engine.stopPlayback();
    await p;
    return state;
  });
  check('result buttons disable while audio is playing', busyUi.again && busyUi.share);

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

  // ---- installable as an app, and shareable
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    const m = await (await fetch(href)).json();
    const abs = (u) => new URL(u, href).href;
    const head = (u) => fetch(abs(u)).then((r) => ({ ok: r.ok, type: r.headers.get('content-type') }));
    const icons = await Promise.all(m.icons.map((i) => head(i.src).then((r) => ({ ...r, src: i.src, purpose: i.purpose }))));
    const apple = document.querySelector('link[rel="apple-touch-icon"]');
    const appleOk = apple ? (await fetch(apple.href)).ok : false;
    const og = document.querySelector('meta[property="og:image"]');
    return {
      name: m.name,
      display: m.display,
      hasStart: !!m.start_url,
      themeMatches: m.theme_color === document.querySelector('meta[name=theme-color]').content,
      icons,
      hasMaskable: m.icons.some((i) => (i.purpose || '').includes('maskable')),
      has192: m.icons.some((i) => i.sizes === '192x192'),
      has512: m.icons.some((i) => i.sizes === '512x512'),
      appleOk,
      ogAbsolute: !!og && og.content.startsWith('http'),
      ogW: document.querySelector('meta[property="og:image:width"]').content,
      ogH: document.querySelector('meta[property="og:image:height"]').content,
      twitterCard: document.querySelector('meta[name="twitter:card"]').content,
    };
  });
  check('manifest declares a standalone app', manifest.display === 'standalone' && manifest.hasStart);
  check('manifest theme matches the page theme', manifest.themeMatches);
  check('manifest has 192 and 512 icons', manifest.has192 && manifest.has512);
  check('manifest has a maskable icon', manifest.hasMaskable);
  check('every manifest icon actually loads', manifest.icons.every((i) => i.ok),
    manifest.icons.filter((i) => !i.ok).map((i) => i.src).join(' '));
  check('apple-touch-icon loads', manifest.appleOk);
  check('og:image is an absolute url', manifest.ogAbsolute);
  check('og:image is declared 1200x630', manifest.ogW === '1200' && manifest.ogH === '630');
  check('twitter card is summary_large_image', manifest.twitterCard === 'summary_large_image');

  // The share card must be the size it claims, or it crops badly in a chat.
  const ogReal = await page.evaluate(() => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = './assets/og.png';
  }));
  check('the share card really is 1200x630', ogReal.w === 1200 && ogReal.h === 630,
    `${ogReal.w}x${ogReal.h}`);

  // ---- offline: an installed game must survive a dead signal
  await page.evaluate(() => navigator.serviceWorker.ready);
  check('service worker takes control', await page.evaluate(() => !!navigator.serviceWorker.controller));

  // Everything needed to play a round must be in the cache before we cut the
  // network, or "works offline" is luck rather than design.
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names[0]);
    const keys = await cache.keys();
    return keys.map((r) => new URL(r.url).pathname);
  });
  const mustHave = ['/index.html', '/styles.css', '/fonts.css', '/js/main.js', '/js/game.js',
    '/js/audio.js', '/js/dsp.js', '/js/viz.js', '/js/copy.js', '/audio/take-capture.worklet.js',
    '/assets/fonts/space-grotesk-latin.woff2'];
  const missing = mustHave.filter((m) => !cached.includes(m));
  check('the whole playable shell is precached', missing.length === 0, missing.join(' '));

  expectNetwork = false;
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  const offline = await page.evaluate(() => ({
    steps: document.querySelectorAll('.step').length,
    label: document.querySelector('.step-primary')?.textContent || '',
    font: !!document.fonts,
  }));
  check('the game still loads with no network', offline.steps === 4 && offline.label.length > 0,
    `${offline.steps} steps, "${offline.label}"`);
  await context.setOffline(false);
  expectNetwork = true;

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('every local asset loads', badRequests.length === 0, badRequests.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
