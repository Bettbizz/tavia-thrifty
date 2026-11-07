// WhatsApp in Tavia colours: a chat wallpaper (teal, faint seals and stitching) and a profile photo (the seal).
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const ring = `M100,500 a400,400 0 1,0 800,0 a400,400 0 1,0 -800,0 Z M128,490 a372,372 0 1,1 744,0 a372,372 0 1,1 -744,0 Z`;
const T = `M250,260 H750 V352 Q744,326 712,322 H536 L540,738 Q542,756 590,760 H600 V782 H400 V760 H410 Q458,756 460,738 L464,322 H288 Q256,326 250,352 Z`;
const gold = `<linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="140" y1="100" x2="860" y2="900">
  <stop offset="0" stop-color="#F3E2B8"/><stop offset=".42" stop-color="#D2AE6A"/><stop offset=".72" stop-color="#B08840"/><stop offset="1" stop-color="#E6CC92"/></linearGradient>`;
const pol = (r, d) => [500 + r * Math.cos(d * Math.PI / 180), 500 + r * Math.sin(d * Math.PI / 180)];
let n = 0;
const seal = (x, y, size, op, stitch = true) => {
  const id = 'm' + n++; const [ax, ay] = pol(640, -152), [bx, by] = pol(640, -116), [dx, dy] = pol(386, -134);
  return `<g transform="translate(${x - size / 2},${y - size / 2}) scale(${size / 1000})" opacity="${op}">
    <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000"><rect width="1000" height="1000" fill="#fff"/><path d="M500,500 L${ax},${ay} L${bx},${by} Z"/></mask>
    <g mask="url(#${id})"><path d="${ring}" fill-rule="evenodd" fill="url(#gold)"/>${stitch ? `<circle cx="500" cy="494" r="338" fill="none" stroke="url(#gold)" stroke-width="5" stroke-dasharray="17 11" opacity=".7"/>` : ''}</g>
    <path d="M${dx},${dy - 22} l22,22 l-22,22 l-22,-22 Z" fill="url(#gold)"/>
    <path d="${T}" fill="url(#gold)" transform="translate(500,494) scale(.76) translate(-500,-521)"/></g>`;
};
const png = (svg, w) => new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();

// Chat wallpaper 1080 x 1920: deep teal, a soft light, a scatter of small faint seals (WhatsApp dims wallpapers a bit).
let pattern = '';
for (let row = 0; row < 9; row++) for (let col = 0; col < 5; col++) {
  const x = 110 + col * 215 + (row % 2) * 107, y = 120 + row * 215;
  pattern += seal(x, y, 92, 0.085, false);
}
const wall = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920"><defs>${gold}
  <radialGradient id="v" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="#0B4441"/><stop offset="1" stop-color="#031A19"/></radialGradient></defs>
  <rect width="1080" height="1920" fill="url(#v)"/>${pattern}</svg>`;
fs.writeFileSync(path.join(OUT, 'Tavia-WhatsApp-wallpaper.png'), png(wall, 1080));

// Profile photo 640 x 640 (WhatsApp crops it to a circle): the seal on teal.
const photo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs>${gold}
  <radialGradient id="p" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="#0B4441"/><stop offset="1" stop-color="#062F2D"/></radialGradient></defs>
  <rect width="1000" height="1000" fill="url(#p)"/>${seal(500, 500, 760, 1)}</svg>`;
fs.writeFileSync(path.join(OUT, 'Tavia-WhatsApp-profile.png'), png(photo, 640));
console.log('done');
