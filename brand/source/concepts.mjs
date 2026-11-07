// Six T ideas side by side, on the night green background.
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
  let x = cx - (adv.reduce((a, b) => a + b, 0) - track * size) / 2, d = '';
  gl.forEach((g, i) => { d += g.getPath(x, baseline, size).toPathData(2); x += adv[i]; });
  return d;
}
const BG = '#0D1B17', G = 'url(#gold)', IV = '#F4EDE1';

// Each mark is drawn in a 1000 x 1000 box.
const marks = {
  // A. Needle and thread (first draft)
  A: `<g transform="rotate(-7 500 318)"><path fill-rule="evenodd" fill="${G}" d="M200,318 a300,66 0 1,0 600,0 a300,66 0 1,0 -600,0 Z M224,308 a276,40 0 1,1 552,0 a276,40 0 1,1 -552,0 Z"/></g>
      <path d="M462,262 C462,214 538,214 538,262 L538,330 C538,520 520,700 500,880 C480,700 462,520 462,330 Z" fill="${G}" stroke="${BG}" stroke-width="26" paint-order="stroke"/>
      <path d="M491,262 C491,250 509,250 509,262 L509,372 C509,384 491,384 491,372 Z" fill="${BG}"/>
      <g transform="rotate(-7 500 318)"><path fill="${G}" stroke="${BG}" stroke-width="26" paint-order="stroke" d="M200,318 a300,66 0 0,0 600,0 L776,308 a276,40 0 0,1 -552,0 Z" clip-path="url(#front)"/></g>`,

  // B. Hanger: sloping shoulders for the crossbar, the hook on top
  B: `<path d="M500,322 C500,262 566,246 566,192 C566,150 534,124 500,124 C464,124 440,150 440,182" fill="none" stroke="${G}" stroke-width="24" stroke-linecap="round"/>
      <path d="M176,436 C300,386 420,346 500,334 C580,346 700,386 824,436" fill="none" stroke="${G}" stroke-width="46" stroke-linecap="round"/>
      <path d="M470,346 H530 L524,846 Q540,872 566,876 H434 Q460,872 476,846 Z" fill="${G}"/>`,

  // C. Orbit: one line draws the T and keeps going round it (second time around)
  C: `<path d="M414.6,211.2 A330,330 0 1,1 247.2,317.9" fill="none" stroke="${G}" stroke-width="22" stroke-linecap="round"/>
      <circle cx="296.8" cy="270.0" r="11" fill="${G}"/>
      <path d="M262,330 H738 V392 H262 Z M466,392 H534 V790 H466 Z" fill="${G}"/>
      <path d="M262,330 V420 L292,392 Z M738,330 V420 L708,392 Z M440,790 H560 V812 H440 Z" fill="${G}"/>`,

  // D. Price tag: the crossbar is a clothes tag with its punched hole and string
  D: `<path fill-rule="evenodd" fill="${G}" d="M168,330 L258,258 H812 Q842,258 842,288 V372 Q842,402 812,402 H258 Z M250,330 m-20,0 a20,20 0 1,0 40,0 a20,20 0 1,0 -40,0 Z"/>
      <path d="M232,318 C190,250 150,230 120,262 C92,292 120,330 160,318" fill="none" stroke="${G}" stroke-width="8" stroke-linecap="round"/>
      <path d="M462,402 H538 V836 L500,872 L462,836 Z" fill="${G}"/>`,

  // E. Ribbon label: a woven garment label folded into a T, swallowtail ends
  E: `<path d="M150,262 H850 L812,316 L850,370 H150 L188,316 Z" fill="${G}"/>
      <path d="M464,370 H536 V880 L500,840 L464,880 Z" fill="${G}"/>
      <path d="M464,370 H536 V408 L464,388 Z" fill="#000" opacity=".35"/>
      <path d="M188,284 H812 M188,348 H812" stroke="${BG}" stroke-width="3" stroke-dasharray="14 10" opacity=".55"/>
      <path d="M482,410 V820 M518,410 V820" stroke="${BG}" stroke-width="3" stroke-dasharray="14 10" opacity=".55"/>`,

  // F. Button: a classic serif T held together by a sewn button
  F: `<path d="M170,272 H830 V344 H170 Z M462,344 H538 V850 H462 Z" fill="${G}"/>
      <path d="M170,272 V372 L198,344 M830,272 V372 L802,344" fill="${G}"/>
      <path d="M430,850 H570 V872 H430 Z" fill="${G}"/>
      <circle cx="500" cy="308" r="96" fill="${BG}"/>
      <circle cx="500" cy="308" r="80" fill="${G}"/>
      <circle cx="500" cy="308" r="58" fill="none" stroke="${BG}" stroke-width="5" opacity=".6"/>
      <g fill="${BG}"><circle cx="478" cy="286" r="11"/><circle cx="522" cy="286" r="11"/><circle cx="478" cy="330" r="11"/><circle cx="522" cy="330" r="11"/></g>
      <path d="M478,286 L522,330 M522,286 L478,330" stroke="${IV}" stroke-width="5" stroke-linecap="round" opacity=".85"/>`,
};
const names = {
  A: 'Needle & thread', B: 'Hanger', C: 'Round seal',
  D: 'Price tag', E: 'Ribbon label', F: 'Sewn button',
};

const CW = 700, CH = 820, cols = 3;
let cells = '';
Object.keys(marks).forEach((k, i) => {
  const x = (i % cols) * CW, y = Math.floor(i / cols) * CH;
  cells += `<g transform="translate(${x},${y})">
    <rect x="14" y="14" width="${CW - 28}" height="${CH - 28}" rx="18" fill="${BG}" stroke="#2A3B35" stroke-width="2"/>
    <g transform="translate(${CW / 2 - 250},60) scale(.5)">${marks[k]}</g>
    <path d="${textPath(cinzel, 'TAVIA THRIFTY', 46, CW / 2, 640, 0.16)}" fill="${IV}" stroke="${IV}" stroke-width=".5"/>
    <path d="${textPath(mont, 'FASHION FINDS SECOND TIME AROUND', 14, CW / 2, 680, 0.34)}" fill="#D9BF86" stroke="#D9BF86" stroke-width=".7"/>
    <path d="${textPath(mont, k + '.  ' + names[k].toUpperCase(), 20, CW / 2, 770, 0.12)}" fill="#8FA39B" stroke="#8FA39B" stroke-width=".9"/>
  </g>`;
});
const W = CW * cols, H = CH * 2;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs><linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="150" y1="120" x2="850" y2="880">
<stop offset="0" stop-color="#F3E2B8"/><stop offset=".45" stop-color="#D2AE6A"/><stop offset=".75" stop-color="#B08840"/><stop offset="1" stop-color="#E6CC92"/></linearGradient>
<clipPath id="front"><rect x="0" y="316" width="1000" height="400"/></clipPath></defs>
<rect width="${W}" height="${H}" fill="#07110E"/>${cells}</svg>`;
fs.writeFileSync(path.join(OUT, 'tavia-logo-ideas.svg'), svg);
fs.writeFileSync(path.join(OUT, 'tavia-logo-ideas.png'), new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng());
console.log('done');
