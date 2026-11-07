// Tavia Thrifty splash animation. One function draws any moment as an SVG, so the same code
// makes the Android boot frames and the browser preview.
// Parts: intro (ring draws itself, plays once) -> loop (T spins, then the logo booms; repeats while
// the tablet boots) -> outro (logo rises, the words come in; plays once at the end of boot).

export const FPS = 30;
export const PARTS = { intro: 1.2, loop: 3.9, outro: 2.8 };

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const out = (t) => 1 - Math.pow(1 - t, 3);
const outBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const f = (n) => Number(n).toFixed(2);

const NIGHT = '#062F2D', IVORY = '#F4EDE1', GOLD = '#C9A25E', TAG = '#D9BF86';
const S0 = 0.62;                       // seal size while booting (ring is 800 wide in its own box)
const END = { x: 500, y: 355, s: 0.44 }; // seal size and place once the words are in

const defs = `
<linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="140" y1="100" x2="860" y2="900">
  <stop offset="0" stop-color="#F3E2B8"/><stop offset=".42" stop-color="#D2AE6A"/>
  <stop offset=".72" stop-color="#B08840"/><stop offset="1" stop-color="#E6CC92"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="#E9CF93" stop-opacity=".4"/>
  <stop offset=".55" stop-color="#C9A25E" stop-opacity=".16"/><stop offset="1" stop-color="#C9A25E" stop-opacity="0"/></radialGradient>
<linearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#FFF6DD" stop-opacity=".85"/>
  <stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;

// The seal in its own 1000 box. o = { draw, bead, tx (T width -1..1), tAlpha, tScale, glow, wave, shine }
function seal(D, o) {
  const draw = o.draw ?? 1, arc = 2 * Math.PI * 370 * (324 / 360);
  const tW = 0.76 * (o.tScale ?? 1), sx = o.tx ?? 1;
  const tT = `translate(500,494) scale(${f(tW * Math.max(Math.abs(sx), 0.02) * Math.sign(sx || 1))},${f(tW)}) translate(-500,-521)`;
  const edge = 1 - Math.abs(sx);       // darker when the T is side-on, a little darker on its back
  const shade = clamp(edge * 0.55, 0, 0.7);   // the T looks the same from both sides
  let s = '';
  if (o.glow) s += `<circle cx="500" cy="500" r="560" fill="url(#glow)" opacity="${f(o.glow)}"/>`;
  if (o.wave) s += `<circle cx="500" cy="500" r="${f(o.wave.r)}" fill="none" stroke="${GOLD}" stroke-width="${f(o.wave.w)}" opacity="${f(o.wave.a)}"/>`;
  s += `<mask id="rd" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
    <circle cx="500" cy="500" r="370" fill="none" stroke="#fff" stroke-width="130"
      stroke-dasharray="${f(arc * draw)} 4000" transform="rotate(-116 500 500)"/></mask>
  <g mask="url(#rd)"><path d="${D.ring}" fill-rule="evenodd" fill="url(#gold)"/>
    <circle cx="500" cy="494" r="338" fill="none" stroke="url(#gold)" stroke-width="4.5" stroke-dasharray="17 11" stroke-linecap="round" opacity=".7"/></g>`;
  const b = o.bead ?? 1;
  if (b > 0) s += `<path d="M0,-22 L22,0 L0,22 L-22,0 Z" fill="url(#gold)" transform="translate(${D.bead[0]},${D.bead[1]}) scale(${f(b)})"/>`;
  const ta = o.tAlpha ?? 1;
  if (ta > 0) {
    s += `<g opacity="${f(ta)}"><path d="${D.T}" fill="url(#gold)" transform="${tT}"/>`;
    if (shade > 0.01) s += `<path d="${D.T}" fill="${NIGHT}" opacity="${f(shade)}" transform="${tT}"/>`;
    if (o.shine != null) {
      const x = -300 + 1600 * o.shine;
      s += `<clipPath id="tc"><path d="${D.T}" transform="${tT}"/></clipPath>
        <g clip-path="url(#tc)"><rect x="${f(x - 180)}" y="0" width="360" height="1000" fill="url(#shine)" transform="skewX(-18)" opacity=".75"/></g>`;
    }
    s += '</g>';
  }
  return s;
}

const place = (x, y, sc, inner) => `<g transform="translate(${f(x)},${f(y)}) scale(${f(sc)}) translate(-500,-500)">${inner}</g>`;

// The boom: quick swell, glow and a ring of light, then settle. k: 0..1
function boom(k) {
  const amp = k < 0.28 ? out(k / 0.28) : 1 - inOut((k - 0.28) / 0.72);
  return {
    scale: 1 + 0.085 * amp,
    glow: amp,
    wave: k < 0.95 ? { r: 400 + 190 * out(k), w: 10 * (1 - k) + 1, a: 0.85 * (1 - k) } : null,
    shine: k < 0.85 ? k / 0.85 : null,
  };
}

/** SVG for one moment of a part. W/H: output size in pixels (the art is centred in a 1000 box). */
export function frame(D, part, t, W = 1000, H = 1000) {
  let body = '';
  if (part === 'intro') {
    const tin = seg(t, 0.35, 1.0);
    body = place(500, 500, S0, seal(D, {
      draw: inOut(seg(t, 0, 0.85)), bead: outBack(seg(t, 0.78, 1.1)),
      tAlpha: out(tin), tScale: 0.9 + 0.1 * out(tin),
    }));
  } else if (part === 'loop') {
    const spin = inOut(seg(t, 0, 3.0)) * 3 * Math.PI;      // one and a half turns in 3 s, starting and stopping softly
    const k = seg(t, 3.0, 3.65);
    const bm = t >= 3.0 && t < 3.65 ? boom(k) : { scale: 1 };
    body = place(500, 500, S0 * bm.scale, seal(D, { tx: Math.cos(spin), glow: bm.glow, wave: bm.wave, shine: bm.shine }));
  } else {                                                    // outro: the words arrive
    const m = inOut(seg(t, 0, 0.9));
    const x = 500 + (END.x - 500) * m, y = 500 + (END.y - 500) * m, sc = S0 + (END.s - S0) * m;
    const k = seg(t, 0.85, 1.45);                             // a last soft boom as it settles
    const bm = t > 0.85 && t < 1.45 ? boom(k) : { scale: 1 };
    body = place(x, y, sc * (1 + (bm.scale - 1) * 0.6), seal(D, { glow: (bm.glow || 0) * 0.7, wave: bm.wave, shine: bm.shine }));
    // name, letter by letter
    D.name.forEach((g, i) => {
      const a = out(seg(t, 0.55 + i * 0.055, 1.05 + i * 0.055));
      if (a > 0) body += `<path d="${g}" fill="${IVORY}" stroke="${IVORY}" stroke-width=".66" opacity="${f(a)}" transform="translate(0,${f(22 * (1 - a))})"/>`;
    });
    // rule grows out from the diamond
    const r = inOut(seg(t, 1.35, 1.95)), dk = outBack(seg(t, 1.25, 1.6));
    if (dk > 0) body += `<path d="M500,${D.ruleY - 7.4} l7.4,7.4 l-7.4,7.4 l-7.4,-7.4 Z" fill="${GOLD}" transform="translate(500,${D.ruleY}) scale(${f(dk)}) translate(-500,${-D.ruleY})"/>`;
    if (r > 0) {
      const L = (D.ruleHalf - 20) * r;
      body += `<path d="M${f(480 - L)},${D.ruleY} H480 M520,${D.ruleY} H${f(520 + L)}" stroke="${GOLD}" stroke-width="1.7"/>`;
    }
    // tagline opens out
    const g = out(seg(t, 1.75, 2.45));
    if (g > 0) body += `<path d="${D.tag}" fill="${TAG}" stroke="${TAG}" stroke-width="1" opacity="${f(g)}" transform="translate(500,0) scale(${f(0.9 + 0.1 * g)},1) translate(-500,0)"/>`;
  }
  const side = Math.min(W, H), ox = (W - side) / 2, oy = (H - side) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>${defs}</defs><rect width="${W}" height="${H}" fill="${NIGHT}"/>
<g transform="translate(${ox},${oy}) scale(${side / 1000})">${body}</g></svg>`;
}
