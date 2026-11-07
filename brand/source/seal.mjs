// Tavia Thrifty logo: the Round Seal (a Roman T inside an open ring with a stitched inner line).
// All text is turned into shapes, so the files need no fonts.
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const cinzel = opentype.loadSync('fonts/Cinzel%5Bwght%5D.ttf');
const mont = opentype.loadSync('fonts/Montserrat%5Bwght%5D.ttf');

function textPath(f, str, size, cx, baseline, track = 0) {
  const s = size / f.unitsPerEm, gl = f.stringToGlyphs(str);
  const adv = gl.map((g) => g.advanceWidth * s + track * size);
  const width = adv.reduce((a, b) => a + b, 0) - track * size;
  let x = cx - width / 2, d = '';
  gl.forEach((g, i) => { d += g.getPath(x, baseline, size).toPathData(2); x += adv[i]; });
  return { d, width };
}

export const COLORS = { night: '#062F2D', ivory: '#F4EDE1', ink: '#13241F', gold: '#C9A25E' };
const gold = (id) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="140" y1="100" x2="860" y2="900">
  <stop offset="0" stop-color="#F3E2B8"/><stop offset=".42" stop-color="#D2AE6A"/>
  <stop offset=".72" stop-color="#B08840"/><stop offset="1" stop-color="#E6CC92"/></linearGradient>`;

// ---- geometry, 1000 x 1000 box ----
const CX = 500, CY = 500;
const polar = (r, deg) => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)];
const GAP = [-152, -116];          // the opening, upper left (degrees; -90 is the top)
const BEAD = -134;                 // the diamond that sits in the opening
const ring = `M${CX - 400},${CY} a400,400 0 1,0 800,0 a400,400 0 1,0 -800,0 Z
              M${CX - 372},${CY - 10} a372,372 0 1,1 744,0 a372,372 0 1,1 -744,0 Z`;   // thick at the bottom, fine at the top
const T = `M250,260 H750 V352 Q744,326 712,322 H536 L540,738 Q542,756 590,760 H600 V782 H400 V760 H410
           Q458,756 460,738 L464,322 H288 Q256,326 250,352 Z`;

function mark(id, fill, { stitch = true, stitchColor = fill } = {}) {
  const [ax, ay] = polar(640, GAP[0]), [bx, by] = polar(640, GAP[1]);
  const [dx, dy] = polar(386, BEAD);
  const d = 22;
  return `
  <mask id="${id}-gap" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
    <rect width="1000" height="1000" fill="#fff"/>
    <path d="M${CX},${CY} L${ax.toFixed(1)},${ay.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)} Z" fill="#000"/>
  </mask>
  <g mask="url(#${id}-gap)">
    <path d="${ring}" fill-rule="evenodd" fill="${fill}"/>
    ${stitch ? `<circle cx="${CX}" cy="${CY - 6}" r="338" fill="none" stroke="${stitchColor}" stroke-width="4.5" stroke-dasharray="17 11" stroke-linecap="round" opacity=".7"/>` : ''}
  </g>
  <path d="M${dx.toFixed(1)},${(dy - d).toFixed(1)} l${d},${d} l${-d},${d} l${-d},${-d} Z" fill="${fill}"/>
  <path d="${T}" fill="${fill}" transform="translate(500,494) scale(.76) translate(-500,-521)"/>`;
}

const svg = (w, h, bg, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs>${gold('gold')}</defs>${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ''}${body}
</svg>`;

function words(theme, cx, nameY, size) {
  const dark = theme === 'dark';
  const word = dark ? COLORS.ivory : COLORS.ink, acc = dark ? COLORS.gold : '#A9853F';
  const tagC = dark ? '#D9BF86' : COLORS.ink;
  const name = textPath(cinzel, 'TAVIA THRIFTY', size, cx, nameY, 0.16);
  const ruleY = nameY + size * 0.52, half = name.width / 2, k = size * 0.09;
  const tag = textPath(mont, 'FASHION FINDS SECOND TIME AROUND', size * 0.268, cx, ruleY + size * 0.63, 0.36);
  return `
  <path d="${name.d}" fill="${word}" stroke="${word}" stroke-width="${size / 124}"/>
  <path d="M${cx - half},${ruleY} H${cx - 2.4 * k} M${cx + 2.4 * k},${ruleY} H${cx + half}" stroke="${acc}" stroke-width="${size / 50}"/>
  <path d="M${cx},${ruleY - k} l${k},${k} l${-k},${k} l${-k},${-k} Z" fill="${acc}"/>
  <path d="${tag.d}" fill="${tagC}" stroke="${tagC}" stroke-width="${size / 78}" stroke-linejoin="round"/>`;
}

function write(name, s, widths = []) {
  fs.writeFileSync(path.join(OUT, name + '.svg'), s);
  for (const w of widths) {
    fs.writeFileSync(path.join(OUT, `${name}-${w}.png`), new Resvg(s, { fitTo: { mode: 'width', value: w } }).render().asPng());
  }
}

for (const theme of ['dark', 'light']) {
  const dark = theme === 'dark';
  const fill = dark ? 'url(#gold)' : COLORS.ink;
  const stitchColor = dark ? 'url(#gold)' : '#A9853F';
  const bg = dark ? COLORS.night : COLORS.ivory;
  // Stacked: seal on top, name and tagline below.
  const W = 1400, H = 1200;
  const stacked = `<g transform="translate(${W / 2 - 340},60) scale(.68)">${mark('s' + theme, fill, { stitchColor })}</g>${words(theme, W / 2, 900, 124)}`;
  write(`tavia-logo-${theme}`, svg(W, H, bg, stacked), [1400]);
  write(`tavia-logo-${theme}-transparent`, svg(W, H, null, stacked), [1400]);
  // Wide: seal on the left, words on the right (receipts, headers).
  const WW = 2300, WH = 700;
  const wide = `<g transform="translate(70,50) scale(.6)">${mark('w' + theme, fill, { stitchColor })}</g>${words(theme, 1460, 360, 118)}`;
  write(`tavia-logo-wide-${theme}`, svg(WW, WH, bg, wide), [2300]);
}
write('tavia-mark-gold', svg(1000, 1000, null, mark('mg', 'url(#gold)')), [1024]);
write('tavia-mark-ink', svg(1000, 1000, null, mark('mk', COLORS.ink, { stitchColor: '#A9853F' })), [1024]);
// App icon: no stitching (too small to see), seal fills the square.
write('tavia-icon', svg(1000, 1000, COLORS.night, `<g transform="translate(70,70) scale(.86)">${mark('ic', 'url(#gold)', { stitch: false })}</g>`), [512, 192]);
console.log('done');
