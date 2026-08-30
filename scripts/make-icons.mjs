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

// Palette mirrors src/styles.css. Flat fills only — the gradient the icon used
// to carry is exactly what made the app look machine-generated.
const BG = '#16305C';        // navy ground: an icon needs to hold up on any wallpaper
const MARK = '#D6392E';      // tomato
const BARS = '#FFF3D2';      // butter
const PAGE_BG = '#FFF3D2';
const PAGE_INK = '#16305C';
const PAGE_SURFACE = '#FFFDF7';
const PAGE_BORDER = '#EBD79C';
const PAGE_MUTED = '#4A5F87';
const TEAL = '#0C8076';

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
    bars.push(`<rect x="${x}" y="${256 - (h * 196) / 2}" width="25" height="${h * 196}" rx="12" fill="${BARS}"/>`);
  });
  return `
<svg viewBox="0 0 512 512" width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="${BG}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <!-- reverse-play triangle -->
    <path d="M266 120 L266 392 L66 262 Z" fill="${MARK}" stroke="${MARK}" stroke-width="26" stroke-linejoin="round"/>
    ${bars.join('\n    ')}
  </g>
</svg>`;
}

const page = (body, css = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
${FONTS}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:${PAGE_BG};color:${PAGE_INK};font-family:'Space Grotesk',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
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
// One idea, readable at chat-bubble size: a waveform and its exact reflection.
// The mirror IS the game — say something (tomato, above the line), and the
// game hands it back reversed (teal, below). Everything else on the card is
// just the name and where to play.

// A speech-like envelope: quiet lead-in, three growing syllable humps, hard
// stop. Deliberately lopsided so the mirror image is unmistakably different
// from the original — a symmetric blob would mirror into itself and the whole
// point would vanish.
const ENVELOPE = [
  4, 6, 10, 18, 30, 44, 38, 26, 14, 8,
  12, 34, 62, 88, 74, 52, 30, 16, 10, 22,
  48, 92, 128, 142, 118, 84, 54, 30, 14, 6,
];
const OG_BAR = 24;
const OG_GAP = 14;
const ogWaveWidth = ENVELOPE.length * (OG_BAR + OG_GAP) - OG_GAP;
const ogWave = (fill, cls) => {
  const rects = ENVELOPE.map((h, i) =>
    `<rect x="${i * (OG_BAR + OG_GAP)}" y="${150 - h}" width="${OG_BAR}" height="${h}" rx="${OG_BAR / 2}" fill="${fill}"/>`
  ).join('');
  return `<svg class="wave ${cls}" viewBox="0 0 ${ogWaveWidth} 150" width="${ogWaveWidth}" height="150" preserveAspectRatio="none">${rects}</svg>`;
};

const ogHtml = page(`
  <div class="card">
    <header>
      <h1>Sdrawkcab</h1>
      <p class="tag">Talk backwards. Badly.</p>
    </header>
    <div class="mirror">
      <div class="row fwd">${ogWave(MARK, '')}<span class="lbl lbl-fwd">you</span></div>
      <div class="line"></div>
      <div class="row rev">${ogWave(TEAL, 'flip')}<span class="lbl lbl-rev">the game</span></div>
    </div>
    <p class="foot">sdrawkcab.netlify.app</p>
  </div>`,
  `.card{position:relative;width:1200px;height:630px;background:${PAGE_BG};overflow:hidden;
     display:flex;flex-direction:column;padding:56px 64px 40px}
   h1{font-family:'Archivo Black',sans-serif;font-size:126px;line-height:.94;letter-spacing:-.02em;
     color:${PAGE_INK};text-shadow:5px 5px 0 ${MARK}}
   .tag{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:37px;color:${PAGE_MUTED};margin-top:16px}
   .mirror{flex:1;display:flex;flex-direction:column;justify-content:center;margin-top:8px}
   .row{position:relative;height:130px;display:flex;align-items:flex-end}
   .row.rev{align-items:flex-start}
   .wave{width:100%;height:130px;display:block}
   /* Reflection through the line = flipped in both axes: horizontally because
      the audio is reversed in time, vertically because it hangs below. */
   .wave.flip{transform:scale(-1,-1)}
   .line{height:4px;background:${PAGE_INK};border-radius:2px;margin:10px 0}
   .lbl{position:absolute;right:0;font:700 27px 'Space Grotesk',sans-serif;
     padding:6px 18px;border-radius:999px;color:#FFFDF7}
   .lbl-fwd{top:-12px;background:${MARK}}
   .lbl-rev{bottom:-12px;background:${TEAL}}
   .foot{font:500 26px 'Space Grotesk',sans-serif;color:${PAGE_MUTED};letter-spacing:.03em;text-align:right}`);

await shoot(ogHtml, { width: 1200, height: 630, path: join(OUT, 'og.png') });

await browser.close();
