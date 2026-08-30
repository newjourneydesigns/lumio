#!/usr/bin/env node
/**
 * Renders the app icons and the share card.
 *
 * The artwork is authored as HTML/SVG and screenshotted with the same engine
 * that renders the game, so what ships is exactly what the design says. Re-run
 * after changing the mark:
 *
 *   node scripts/make-icons.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/assets');
mkdirSync(OUT, { recursive: true });

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';

const INK = '#f6f4ff';
const BG = '#12101a';

const fontFace = (family, file, weight) => `@font-face{font-family:'${family}';font-weight:${weight};src:url('data:font/woff2;base64,${
  readFileSync(join(ROOT, 'src/assets/fonts', file)).toString('base64')
}') format('woff2');}`;

const FONTS = [
  fontFace('Archivo Black', 'archivo-black-latin.woff2', 400),
  fontFace('Space Grotesk', 'space-grotesk-latin.woff2', 400),
].join('\n');

/**
 * The mark: a reverse-play triangle with a waveform running through it, the
 * bars mirrored either side of the tip. `scale` shrinks the artwork for the
 * maskable variant, whose outer 20% can be cropped to any shape.
 */
function mark(scale = 1) {
  const bars = [];
  // Heights chosen to mirror around the centre, so the mark itself reads as
  // something being flipped.
  const heights = [0.32, 0.58, 0.82, 0.58, 0.32];
  heights.forEach((h, i) => {
    const x = 298 + i * 47;
    bars.push(`<rect x="${x}" y="${256 - (h * 196) / 2}" width="25" height="${h * 196}" rx="12" fill="${INK}" opacity="${1 - i * 0.09}"/>`);
  });
  return `
<svg viewBox="0 0 512 512" width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0" y1="0.1" x2="1" y2="0.9">
      <!-- A saturated violet mid-stop. Interpolating pink straight to cyan in
           sRGB passes through a desaturated grey, which reads as dirty at
           launcher size. -->
      <stop offset="0" stop-color="#ff3d63"/>
      <stop offset="0.5" stop-color="#c14ff0"/>
      <stop offset="1" stop-color="#35ddff"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="12%" r="78%">
      <stop offset="0" stop-color="#3a2c58"/>
      <stop offset="1" stop-color="${BG}"/>
    </radialGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#ff4d6d" flood-opacity="0.34"/>
    </filter>
  </defs>
  <rect width="512" height="512" fill="url(#glow)"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <!-- reverse-play triangle -->
    <path d="M266 120 L266 392 L66 262 Z" fill="url(#grad)" filter="url(#soft)" stroke-linejoin="round" stroke-width="26" stroke="url(#grad)"/>
    ${bars.join('\n    ')}
  </g>
</svg>`;
}

const page = (body, css = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
${FONTS}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:${BG};color:${INK};font-family:'Space Grotesk',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
${css}
</style></head><body>${body}</body></html>`;

const browser = await chromium.launch({ executablePath: CHROME });

async function shoot(html, { width, height, path, scale = 1 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const p = await ctx.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path, omitBackground: false });
  await ctx.close();
  console.log('wrote', path.replace(ROOT + '/', ''));
}

// ---- app icons -------------------------------------------------------------
const iconHtml = (scale) => page(
  `<div class="wrap">${mark(scale)}</div>`,
  `.wrap{width:100vw;height:100vh;display:grid;place-items:center;overflow:hidden}
   .wrap svg{width:100%;height:100%;display:block}`,
);

for (const size of [192, 512]) {
  await shoot(iconHtml(1), { width: size, height: size, path: join(OUT, `icon-${size}.png`) });
}
// Maskable: the launcher may crop to a circle, so keep everything important
// inside the middle 80%.
await shoot(iconHtml(0.72), { width: 512, height: 512, path: join(OUT, 'icon-maskable-512.png') });
// iOS applies its own rounded mask and never uses the manifest, so it gets a
// full-bleed square of its own.
await shoot(iconHtml(0.82), { width: 180, height: 180, path: join(OUT, 'apple-touch-icon.png'), scale: 2 });

// ---- share card ------------------------------------------------------------
const wave = (flip) => {
  const bars = Array.from({ length: 34 }, (_, i) => {
    // Deliberately lopsided — quiet at the start, loud at the end. A symmetric
    // envelope would look identical once mirrored, and the mirroring is the
    // entire point of the picture.
    const t = i / 33;
    const hump = Math.sin(t * Math.PI * 3.1) ** 2;
    const ramp = 0.18 + 0.82 * t;
    const h = 6 + hump * ramp * 52 * (0.6 + 0.4 * Math.sin(i * 2.7));
    return `<rect x="${i * 12}" y="${30 - Math.abs(h) / 2}" width="6" height="${Math.abs(h)}" rx="3"/>`;
  }).join('');
  return `<svg class="wave ${flip ? 'flip' : ''}" viewBox="0 0 408 60" width="340" height="50">${bars}</svg>`;
};

const ogHtml = page(`
  <div class="card">
    <div class="glow"></div>
    <header>
      <div class="badge">${mark(1)}</div>
      <div>
        <h1>Sdrawkcab</h1>
        <p class="tag">Talk backwards. Badly.</p>
      </div>
    </header>
    <ol class="steps">
      <li><span>1</span> Say a phrase ${wave(false)}</li>
      <li class="rev"><span>2</span> Hear it backwards ${wave(true)}</li>
      <li class="rev"><span>3</span> Say the gibberish ${wave(true)}</li>
      <li><span>4</span> Flip it back ${wave(false)}</li>
    </ol>
    <p class="foot">sdrawkcab.netlify.app</p>
  </div>`,
  `.card{position:relative;width:1200px;height:630px;padding:50px 62px;display:flex;flex-direction:column;overflow:hidden}
   .glow{position:absolute;inset:-40% -10% auto;height:120%;background:radial-gradient(60% 60% at 50% 0,#3a2c58 0,transparent 70%);pointer-events:none}
   header{display:flex;align-items:center;gap:28px;position:relative}
   .badge{width:112px;height:112px;border-radius:28px;overflow:hidden;flex:none;box-shadow:0 18px 44px rgba(0,0,0,.5)}
   .badge svg{width:100%;height:100%;display:block}
   h1{font-family:'Archivo Black',sans-serif;font-size:76px;line-height:1;letter-spacing:-.02em;
      background:linear-gradient(92deg,#ff4d6d 8%,#4de1ff 88%);-webkit-background-clip:text;background-clip:text;color:transparent}
   .tag{font-size:28px;color:#a9a3c4;margin-top:10px}
   .steps{list-style:none;margin:38px 0 0;display:grid;gap:12px;position:relative}
   .steps li{display:flex;align-items:center;gap:18px;font-size:27px;color:${INK};
     background:#1c1a29;border:1px solid #322e46;border-radius:18px;padding:11px 22px}
   .steps li span{width:38px;height:38px;border-radius:50%;background:#ff4d6d;color:#2a0410;
     display:grid;place-items:center;font-weight:700;font-size:20px;flex:none}
   .steps li.rev span{background:#4de1ff;color:#062630}
   .wave{margin-left:auto;fill:#ff4d6d;opacity:.92;flex:none}
   .steps li.rev .wave{fill:#4de1ff}
   .wave.flip{transform:scaleX(-1)}
   .foot{margin-top:auto;padding-top:18px;font-size:24px;color:#6f6a8a;letter-spacing:.04em}`);

await shoot(ogHtml, { width: 1200, height: 630, path: join(OUT, 'og.png') });

await browser.close();
