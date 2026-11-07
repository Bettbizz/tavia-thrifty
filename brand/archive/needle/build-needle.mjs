// Builds the Tavia Thrifty logo files (all text turned into shapes, so no fonts are needed to show them).
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const font = (f) => opentype.loadSync(path.join('fonts', f));
const cinzel = font('Cinzel%5Bwght%5D.ttf');
const mont = font('Montserrat%5Bwght%5D.ttf');

// Text -> one SVG path, centred on cx, with extra letter spacing (in em).
function textPath(f, str, size, cx, baseline, track = 0) {
  const scale = size / f.unitsPerEm;
  const glyphs = f.stringToGlyphs(str);
  const adv = glyphs.map((g) => g.advanceWidth * scale + (str ? track * size : 0));
  const width = adv.reduce((a, b) => a + b, 0) - track * size;
  let x = cx - width / 2, d = '';
  glyphs.forEach((g, i) => { d += g.getPath(x, baseline, size).toPathData(2); x += adv[i]; });
  return { d, width };
}

const C = {
  night: '#0D1B17', ivory: '#F4EDE1', ink: '#13241F',
};
const goldDefs = (id) => `
  <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#F3E2B8"/><stop offset=".45" stop-color="#D2AE6A"/>
    <stop offset=".75" stop-color="#B08840"/><stop offset="1" stop-color="#E6CC92"/>
  </linearGradient>`;

// ---- The mark: a needle (the T's stem) wrapped by a loop of thread (the T's crossbar) ----
// Drawn in a 1000 x 1000 box.
const RING = { cx: 500, cy: 318, rx: 300, ry: 66, irx: 276, iry: 40, lift: 10, tilt: -7 };
const ringPath = (() => {
  const { cx, cy, rx, ry, irx, iry, lift } = RING;
  // outer ellipse clockwise, inner ellipse (raised a little) anticlockwise -> a ribbon thick at the front
  return `M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${2 * rx},0 a${rx},${ry} 0 1,0 ${-2 * rx},0 Z
          M${cx - irx},${cy - lift} a${irx},${iry} 0 1,1 ${2 * irx},0 a${irx},${iry} 0 1,1 ${-2 * irx},0 Z`;
})();
const needle = 'M462,262 C462,214 538,214 538,262 L538,330 C538,520 520,700 500,880 C480,700 462,520 462,330 Z';
const eye = 'M491,262 C491,250 509,250 509,262 L509,372 C509,384 491,384 491,372 Z';
const GAP = 14;

function mark(id, fill) {
  const t = `rotate(${RING.tilt} ${RING.cx} ${RING.cy})`;
  return `
  <defs>
    <mask id="${id}-ring" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
      <rect width="1000" height="1000" fill="#fff"/>
      <!-- back half of the thread goes behind the needle -->
      <clipPath id="${id}-top"><rect x="0" y="0" width="1000" height="${RING.cy}"/></clipPath>
      <g clip-path="url(#${id}-top)"><path d="${needle}" fill="#000" stroke="#000" stroke-width="${GAP * 2}" stroke-linejoin="round" transform="rotate(${-RING.tilt} ${RING.cx} ${RING.cy})"/></g>
    </mask>
    <mask id="${id}-needle" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
      <rect width="1000" height="1000" fill="#fff"/>
      <path d="${eye}" fill="#000"/>
      <!-- front half of the thread passes over the needle -->
      <g transform="${t}"><path d="${ringPath}" fill="#000" stroke="#000" stroke-width="${GAP * 2}" fill-rule="evenodd" clip-path="url(#${id}-bot)"/></g>
      <clipPath id="${id}-bot"><rect x="0" y="${RING.cy - 2}" width="1000" height="1000"/></clipPath>
    </mask>
  </defs>
  <g transform="${t}"><path d="${ringPath}" fill-rule="evenodd" fill="${fill}" mask="url(#${id}-ring)"/></g>
  <path d="${needle}" fill="${fill}" mask="url(#${id}-needle)"/>`;
}

function svg(w, h, bg, body, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>${goldDefs('gold')}${defs}</defs>
  ${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ''}
  ${body}
</svg>`;
}

// Full logo: mark, name, rule, tagline.
function lockup(theme) {
  const W = 1400, H = 1300, cx = W / 2;
  const dark = theme === 'dark';
  const fill = dark ? 'url(#gold)' : C.ink;
  const word = dark ? C.ivory : C.ink;
  const accent = dark ? 'url(#gold)' : '#A9853F';
  const name = textPath(cinzel, 'TAVIA THRIFTY', 124, cx, 975, 0.16);
  const tag = textPath(mont, 'FASHION FINDS SECOND TIME AROUND', 33, cx, 1118, 0.36);
  const ruleY = 1040, half = name.width / 2;
  const body = `
  <g transform="translate(${cx - 400},40) scale(.8)">${mark('m-' + theme, fill)}</g>
  <path d="${name.d}" fill="${word}" stroke="${word}" stroke-width="1" />
  <path d="M${cx - half},${ruleY} H${cx - 26} M${cx + 26},${ruleY} H${cx + half}" stroke="${dark ? '#C9A25E' : '#A9853F'}" stroke-width="2.5"/>
  <path d="M${cx},${ruleY - 11} L${cx + 11},${ruleY} L${cx},${ruleY + 11} L${cx - 11},${ruleY} Z" fill="${accent}"/>
  <path d="${tag.d}" fill="${dark ? '#D9BF86' : C.ink}" stroke="${dark ? '#D9BF86' : C.ink}" stroke-width="1.6" stroke-linejoin="round"/>`;
  return { W, H, body, bg: dark ? C.night : C.ivory };
}

function write(name, s, pngWidths = []) {
  fs.writeFileSync(path.join(OUT, name + '.svg'), s);
  for (const w of pngWidths) {
    const png = new Resvg(s, { fitTo: { mode: 'width', value: w } }).render().asPng();
    fs.writeFileSync(path.join(OUT, `${name}-${w}.png`), png);
  }
}

for (const theme of ['dark', 'light']) {
  const L = lockup(theme);
  write(`tavia-logo-${theme}`, svg(L.W, L.H, L.bg, L.body), [1400]);
  write(`tavia-logo-${theme}-transparent`, svg(L.W, L.H, null, L.body), [1400]);
}
// The mark on its own (app icon, small places).
write('tavia-mark-gold', svg(1000, 1000, null, mark('mg', 'url(#gold)')), [1024]);
write('tavia-icon', svg(1000, 1000, C.night, `<g transform="translate(110,95) scale(.78)">${mark('mi', 'url(#gold)')}</g>`), [512, 192]);
console.log('done');
