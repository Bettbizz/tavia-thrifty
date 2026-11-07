// App icons and the tablet wallpaper for Tavia Home (from the seal in brand/source/seal.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const RES = process.argv[2];   // app/src/main/res
const ring = `M100,500 a400,400 0 1,0 800,0 a400,400 0 1,0 -800,0 Z M128,490 a372,372 0 1,1 744,0 a372,372 0 1,1 -744,0 Z`;
const T = `M250,260 H750 V352 Q744,326 712,322 H536 L540,738 Q542,756 590,760 H600 V782 H400 V760 H410 Q458,756 460,738 L464,322 H288 Q256,326 250,352 Z`;
const gold = `<linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="140" y1="100" x2="860" y2="900">
  <stop offset="0" stop-color="#F3E2B8"/><stop offset=".42" stop-color="#D2AE6A"/><stop offset=".72" stop-color="#B08840"/><stop offset="1" stop-color="#E6CC92"/></linearGradient>`;
const bd = (-134 * Math.PI) / 180, bx = 500 + 386 * Math.cos(bd), by = 500 + 386 * Math.sin(bd);
const polar = (r, d) => [500 + r * Math.cos((d * Math.PI) / 180), 500 + r * Math.sin((d * Math.PI) / 180)];
const [ax, ay] = polar(640, -152), [cx, cy] = polar(640, -116);
const seal = (id, stitch = true, opacity = 1) => `<g opacity="${opacity}">
  <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000"><rect width="1000" height="1000" fill="#fff"/>
    <path d="M500,500 L${ax},${ay} L${cx},${cy} Z" fill="#000"/></mask>
  <g mask="url(#${id})"><path d="${ring}" fill-rule="evenodd" fill="url(#gold)"/>
  ${stitch ? `<circle cx="500" cy="494" r="338" fill="none" stroke="url(#gold)" stroke-width="4.5" stroke-dasharray="17 11" stroke-linecap="round" opacity=".7"/>` : ''}</g>
  <path d="M${bx},${by - 22} l22,22 l-22,22 l-22,-22 Z" fill="url(#gold)"/>
  <path d="${T}" fill="url(#gold)" transform="translate(500,494) scale(.76) translate(-500,-521)"/></g>`;
const png = (svg, w) => new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();

// Launcher icon: seal on night green, rounded square.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs>${gold}</defs>
  <rect width="1000" height="1000" rx="220" fill="#062F2D"/><g transform="translate(90,90) scale(.82)">${seal('m', false)}</g></svg>`;
for (const [d, w] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  fs.writeFileSync(path.join(RES, `mipmap-${d}`, 'ic_launcher.png'), png(icon, w));
}

// Wallpaper 800 x 1280: night green, soft vignette, a large faint seal. Android 14 takes its accent colours from it.
const wall = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1280"><defs>${gold}
  <radialGradient id="v" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#0B4441"/><stop offset="1" stop-color="#031A19"/></radialGradient></defs>
  <rect width="800" height="1280" fill="url(#v)"/>
  </svg>`;
fs.mkdirSync(path.join(RES, 'drawable-nodpi'), { recursive: true });
fs.writeFileSync(path.join(RES, 'drawable-nodpi', 'wallpaper.png'), png(wall, 800));
console.log('icons + wallpaper done');
