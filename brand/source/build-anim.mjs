// Makes the splash: shape data, a browser preview page, and Android boot-animation frames.
// node build-anim.mjs <out> [size]
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';
import { frame, PARTS, FPS } from './anim-core.mjs';

const OUT = process.argv[2], SIZE = Number(process.argv[3] || 900);
fs.mkdirSync(OUT, { recursive: true });
const cinzel = opentype.loadSync('fonts/Cinzel%5Bwght%5D.ttf');
const mont = opentype.loadSync('fonts/Montserrat%5Bwght%5D.ttf');

function glyphs(f, str, size, cx, baseline, track) {
  const s = size / f.unitsPerEm, gl = f.stringToGlyphs(str);
  const adv = gl.map((g) => g.advanceWidth * s + track * size);
  const width = adv.reduce((a, b) => a + b, 0) - track * size;
  let x = cx - width / 2; const ds = [];
  gl.forEach((g, i) => { const d = g.getPath(x, baseline, size).toPathData(2); if (d) ds.push(d); x += adv[i]; });
  return { ds, width };
}

// Same seal as brand/source/seal.mjs.
const ring = `M100,500 a400,400 0 1,0 800,0 a400,400 0 1,0 -800,0 Z M128,490 a372,372 0 1,1 744,0 a372,372 0 1,1 -744,0 Z`;
const T = `M250,260 H750 V352 Q744,326 712,322 H536 L540,738 Q542,756 590,760 H600 V782 H400 V760 H410 Q458,756 460,738 L464,322 H288 Q256,326 250,352 Z`;
const bd = (-134 * Math.PI) / 180;
const name = glyphs(cinzel, 'TAVIA THRIFTY', 82, 500, 725, 0.16);
const ruleY = 768;
const tag = glyphs(mont, 'FASHION FINDS SECOND TIME AROUND', 22, 500, 820, 0.36);
const D = {
  ring, T, bead: [+(500 + 386 * Math.cos(bd)).toFixed(1), +(500 + 386 * Math.sin(bd)).toFixed(1)],
  name: name.ds, ruleY, ruleHalf: name.width / 2, tag: tag.ds.join(''),
};
fs.writeFileSync(path.join(OUT, 'splash-data.json'), JSON.stringify(D));

// Preview page: plays intro, the loop a few times (as if booting), then the words.
const core = fs.readFileSync(new URL('./anim-core.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
fs.writeFileSync(path.join(OUT, 'splash-preview.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Tavia Splash</title>
<style>:root{color-scheme:dark}html,body{margin:0;height:100%;background:#0D1B17;color:#D9BF86;font:14px system-ui,sans-serif}
#stage{position:fixed;inset:0;display:grid;place-items:center}#stage svg{width:min(100vw,100vh);height:min(100vw,100vh)}
#bar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:10px;align-items:center;justify-content:center;padding:12px 16px;flex-wrap:wrap}
button{background:#1B2E28;color:#F4EDE1;border:1px solid #3A5049;border-radius:8px;padding:8px 14px;font:inherit;cursor:pointer}
#st{opacity:.75;min-width:12ch;text-align:center}</style></head><body>
<div id="stage"></div><div id="bar"><button id="replay">Replay</button><button id="loops">Boot length: 2 loops</button><span id="st"></span></div>
<script>${core}
const D=${JSON.stringify(D)};
let loops=2, t0=0;
const stage=document.getElementById('stage'), st=document.getElementById('st');
function plan(){const p=[['intro',PARTS.intro]];for(let i=0;i<loops;i++)p.push(['loop',PARTS.loop]);p.push(['outro',PARTS.outro]);return p;}
function tick(now){if(!t0)t0=now;let t=(now-t0)/1000;let shown=false;
 for(const [part,len] of plan()){if(t<len){stage.innerHTML=frame(D,part,t);st.textContent=part==='intro'?'Starting':part==='loop'?'Booting…':'Boot finished';shown=true;break;}t-=len;}
 if(!shown){stage.innerHTML=frame(D,'outro',PARTS.outro);st.textContent='→ launcher opens';}
 requestAnimationFrame(tick);}
document.getElementById('replay').onclick=()=>{t0=0;};
document.getElementById('loops').onclick=(e)=>{loops=loops%4+1;e.target.textContent='Boot length: '+loops+' loop'+(loops>1?'s':'');t0=0;};
requestAnimationFrame(tick);</script></body></html>`);

// Boot animation frames (Android bootanimation.zip layout).
if (process.argv.includes('--frames')) {
  const dirs = { intro: 'part0', loop: 'part1', outro: 'part2' };
  for (const [part, dir] of Object.entries(dirs)) {
    const d = path.join(OUT, 'bootanimation', dir); fs.mkdirSync(d, { recursive: true });
    const n = Math.round(PARTS[part] * FPS);
    for (let i = 0; i < n; i++) {
      const png = new Resvg(frame(D, part, i / FPS, SIZE, SIZE)).render().asPng();
      fs.writeFileSync(path.join(d, String(i).padStart(4, '0') + '.png'), png);
    }
    console.log(dir, n, 'frames');
  }
  // c = always play fully; p 0 = repeat until the system has booted. Last part holds on its final frame.
  fs.writeFileSync(path.join(OUT, 'bootanimation', 'desc.txt'),
    `${SIZE} ${SIZE} ${FPS}\nc 1 0 part0 #0D1B17\np 0 0 part1 #0D1B17\nc 1 15 part2 #0D1B17\n`);
}
console.log('done');
