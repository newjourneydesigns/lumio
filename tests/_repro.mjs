import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const ROOT = '/home/user/lumio';
const PORT = 8231;
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'phrase-forward.wav');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium/chrome-linux/chrome';

const server = spawn(process.execPath, [join(ROOT, 'scripts/serve.js')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
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

const sizes = [ {width:390,height:844}, {width:320,height:568}, {width:844,height:390} ];

for (const viewport of sizes) {
  const context = await browser.newContext({ permissions: ['microphone'], viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const stepBtn = (n) => page.locator(`.step[data-step="${n}"] .step-primary`);
  async function record(n, ms) {
    await stepBtn(n).click();
    await page.waitForSelector(`.step[data-step="${n}"] .step-primary.is-live`, { timeout: 8000 });
    await page.waitForTimeout(ms);
    await stepBtn(n).click();
    await page.waitForFunction((s) => document.querySelector(`.step[data-step="${s}"]`).dataset.state === 'done', n, { timeout: 8000 });
  }
  async function playThrough(n) {
    await stepBtn(n).click();
    await page.waitForFunction(() => !window.__sdrawkcab.busy, null, { timeout: 15000 });
  }

  await record(1, 1600);
  await playThrough(2);
  await record(3, 1600);

  // let the smooth scroll settle
  await page.waitForTimeout(1500);

  const m = await page.evaluate(() => {
    const b = document.querySelector('.step[data-step="4"] .step-primary').getBoundingClientRect();
    const extras = document.querySelector('.step[data-step="4"] .step-extras');
    const eb = extras && extras.children.length ? extras.getBoundingClientRect() : null;
    return {
      scrollY: Math.round(window.scrollY),
      maxScroll: Math.round(document.documentElement.scrollHeight - window.innerHeight),
      innerHeight: window.innerHeight,
      btnTop: Math.round(b.top), btnBottom: Math.round(b.bottom),
      extrasTop: eb ? Math.round(eb.top) : null,
      extrasBottom: eb ? Math.round(eb.bottom) : null,
      step3ExtrasCount: document.querySelector('.step[data-step="3"] .step-extras').children.length,
      step4ExtrasCount: extras ? extras.children.length : 0,
      docH: document.documentElement.scrollHeight,
    };
  });
  console.log(JSON.stringify({ viewport, ...m }));
  await context.close();
}

await browser.close();
server.kill();
