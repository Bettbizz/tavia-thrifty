// Six home-screen layout ideas for the Tavia tablet (800 x 1280), with made-up sample numbers.
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const OUT = process.argv[2];
const C = { night: '#0D1B17', card: '#13241F', line: '#2A3B35', ivory: '#F4EDE1', gold: '#C9A25E', gl: '#F3E2B8', tag: '#D9BF86', muted: '#8FA39B', red: '#E07A5F', green: '#7FC8A0' };
const ring = `M100,500 a400,400 0 1,0 800,0 a400,400 0 1,0 -800,0 Z M128,490 a372,372 0 1,1 744,0 a372,372 0 1,1 -744,0 Z`;
const T = `M250,260 H750 V352 Q744,326 712,322 H536 L540,738 Q542,756 590,760 H600 V782 H400 V760 H410 Q458,756 460,738 L464,322 H288 Q256,326 250,352 Z`;
const pol = (r, d, cx = 500, cy = 500) => [cx + r * Math.cos(d * Math.PI / 180), cy + r * Math.sin(d * Math.PI / 180)];
let uid = 0;
const seal = (x, y, size, op = 1, stitch = true) => {
  const id = 'g' + (uid++); const [ax, ay] = pol(640, -152), [bx, by] = pol(640, -116), [dx, dy] = pol(386, -134);
  return `<g transform="translate(${x - size / 2},${y - size / 2}) scale(${size / 1000})" opacity="${op}">
  <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000"><rect width="1000" height="1000" fill="#fff"/><path d="M500,500 L${ax},${ay} L${bx},${by} Z"/></mask>
  <g mask="url(#${id})"><path d="${ring}" fill-rule="evenodd" fill="url(#gold)"/>${stitch ? `<circle cx="500" cy="494" r="338" fill="none" stroke="url(#gold)" stroke-width="4.5" stroke-dasharray="17 11" opacity=".7"/>` : ''}</g>
  <path d="M${dx},${dy - 22} l22,22 l-22,22 l-22,-22 Z" fill="url(#gold)"/>
  <path d="${T}" fill="url(#gold)" transform="translate(500,494) scale(.76) translate(-500,-521)"/></g>`;
};
const tee = (x, y, size) => `<path d="${T}" fill="url(#gold)" transform="translate(${x},${y}) scale(${size / 1000}) translate(-500,-521)"/>`;
const tx = (x, y, s, size, o = {}) => (/[✓⚠]/.test(s) ? `<circle cx="${o.a === 'end' ? x - (String(s).length - 1) * size * .55 - 12 : o.a === 'middle' ? x - String(s).length * size * .29 - 12 : x - 14}" cy="${y - size * .35}" r="${size * .28}" fill="${o.c || C.ivory}"/>` : '') + `<text x="${x}" y="${y}" font-family="${o.serif ? 'Cinzel' : 'Montserrat'}" font-weight="${o.w || 500}" font-size="${size}"
  fill="${o.c || C.ivory}" text-anchor="${o.a || 'start'}" letter-spacing="${o.ls || 0}" opacity="${o.op ?? 1}">${String(s).replace(/\s*[✓⚠]\s*/g, ' ').trim()}</text>`;
const card = (x, y, w, h, o = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r ?? 26}" fill="${o.fill || C.card}" fill-opacity="${o.fo ?? .94}" stroke="${o.stroke || C.gold}" stroke-opacity="${o.so ?? .5}" stroke-width="${o.sw || 2}"/>`;
// line icons in a 100 box
const icon = (kind, x, y, s, color = 'url(#goldS)') => {
  const st = `fill="none" stroke="${color}" stroke-width="${6.5}" stroke-linecap="round" stroke-linejoin="round"`;
  const body = {
    bag: `<rect x="19" y="36" width="62" height="54" rx="6" ${st}/><path d="M34,45 V31 a16,18 0 0 1 32,0 V45" ${st}/>`,
    chat: `<rect x="13" y="17" width="74" height="54" rx="15" ${st}/><path d="M30,70 L23,88 L45,71" ${st}/><g fill="${color}"><circle cx="33" cy="44" r="4.5"/><circle cx="50" cy="44" r="4.5"/><circle cx="67" cy="44" r="4.5"/></g>`,
    coin: `<rect x="25" y="9" width="44" height="82" rx="8" ${st}/><path d="M41,80 H53" ${st}/><circle cx="70" cy="64" r="21" fill="${color}"/><text x="70" y="72" font-family="Montserrat" font-weight="700" font-size="24" fill="${C.card}" text-anchor="middle">M</text>`,
  }[kind];
  return `<g transform="translate(${x - s / 2},${y - s / 2}) scale(${s / 100})">${body}</g>`;
};
const topbar = (title = 'TAVIA THRIFTY') => `${seal(42, 40, 44, 1, false)}${tx(76, 49, title, 22, { serif: true, ls: 3 })}
  <g transform="translate(616,28)" fill="none" stroke="${C.gold}" stroke-width="3.2" stroke-linecap="round"><path d="M2,10 a16,16 0 0 1 22,0"/><path d="M6,15 a10,10 0 0 1 14,0"/><circle cx="13" cy="20" r="2" fill="${C.gold}"/></g>
  ${tx(700, 48, '10:24', 21, { w: 700, a: 'end' })}
  <circle cx="752" cy="40" r="15" fill="none" stroke="#1B332C" stroke-width="4.5"/><circle cx="752" cy="40" r="15" fill="none" stroke="${C.gold}" stroke-width="4.5" stroke-dasharray="${2 * Math.PI * 15 * .78} 999" transform="rotate(-90 752 40)"/>
  ${tx(752, 45, '78', 11, { w: 700, a: 'middle' })}`;
const bg = `<defs>
  <linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="140" y1="100" x2="860" y2="900"><stop offset="0" stop-color="#F3E2B8"/><stop offset=".42" stop-color="#D2AE6A"/><stop offset=".72" stop-color="#B08840"/><stop offset="1" stop-color="#E6CC92"/></linearGradient>
  <linearGradient id="goldS" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3E2B8"/><stop offset=".5" stop-color="#C9A25E"/><stop offset="1" stop-color="#B08840"/></linearGradient>
  <linearGradient id="goldBtn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3E2B8"/><stop offset=".55" stop-color="#C9A25E"/><stop offset="1" stop-color="#B08840"/></linearGradient>
  <radialGradient id="vig" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#16302A"/><stop offset="1" stop-color="#08130F"/></radialGradient>
  <linearGradient id="photo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3B2F25"/><stop offset=".5" stop-color="#6B4E37"/><stop offset="1" stop-color="#2A3B35"/></linearGradient>
</defs><rect width="800" height="1280" fill="url(#vig)"/>`;
const shot = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1280" width="800" height="1280">${bg}${body}</svg>`;
const dock = (y = 1090, style = 'raised') => {
  if (style === 'flat') return `${card(24, y, 752, 150, { r: 34, so: .55 })}
    ${[['bag', 'Uza', 'Sell'], ['chat', 'WhatsApp', 'Messages'], ['coin', 'M-Pesa', 'Payments']].map(([k, t, s], i) => {
      const cx = 150 + i * 250; return `${icon(k, cx, y + 52, 58)}${tx(cx, y + 108, t, 22, { serif: true, a: 'middle' })}${tx(cx, y + 132, s, 14, { c: C.tag, a: 'middle' })}`; }).join('')}
    ${i2badge(375 + 38, y + 22, '2')}`;
  return `${card(24, y + 20, 752, 150, { r: 40, so: .55 })}
    ${icon('chat', 150, y + 78, 56)}${tx(150, y + 136, 'WhatsApp', 20, { serif: true, a: 'middle' })}${i2badge(188, y + 50, '2')}
    ${icon('coin', 650, y + 78, 56)}${tx(650, y + 136, 'M-Pesa', 20, { serif: true, a: 'middle' })}
    <circle cx="400" cy="${y + 40}" r="92" fill="url(#goldBtn)" stroke="${C.night}" stroke-width="10"/>
    ${icon('bag', 400, y + 22, 62, C.night)}${tx(400, y + 92, 'UZA', 26, { serif: true, a: 'middle', c: C.night, w: 600 })}`;
};
const i2badge = (x, y, n) => `<rect x="${x - 17}" y="${y - 17}" width="34" height="34" rx="17" fill="${C.gl}"/>${tx(x, y + 7, n, 18, { w: 700, a: 'middle', c: C.night })}`;
const ruleD = (x1, x2, y) => `<path d="M${x1},${y} H${(x1 + x2) / 2 - 14} M${(x1 + x2) / 2 + 14},${y} H${x2}" stroke="${C.gold}" stroke-width="1.6"/><path d="M${(x1 + x2) / 2},${y - 7} l7,7 l-7,7 l-7,-7 Z" fill="${C.gold}"/>`;

const L = [];
// 1. Shop window + dock (the user's idea): the home is a calm "shop window"; three buttons sit in a dock at the bottom.
L.push(['Shop window + dock', shot(`${topbar()}
  ${tx(40, 160, 'Habari ya asubuhi', 42, { serif: true })}${tx(40, 198, 'Friday, 6 November · Duka liko wazi hadi 8 PM', 17, { c: C.tag })}
  ${card(40, 236, 720, 190)}${tx(70, 282, 'LEO · TODAY', 15, { c: C.tag, ls: 3, w: 600 })}
  ${[['14', 'Mauzo · Sales'], ['KES 8,450', 'M-Pesa'], ['KES 3,200', 'Cash']].map(([v, l], i) => `${tx(70 + i * 236, 350, v, i ? 30 : 46, { serif: true, c: i ? C.gl : C.ivory })}${tx(70 + i * 236, 392, l, 15, { c: C.muted })}`).join('')}
  ${card(40, 452, 720, 560)}<rect x="62" y="474" width="676" height="400" rx="18" fill="url(#photo)"/>
  ${seal(400, 674, 150, .35, false)}${tx(400, 850, 'photo of the new bale', 15, { c: C.ivory, a: 'middle', op: .6 })}
  ${tx(70, 918, 'MZIGO MPYA · NEW ARRIVALS', 15, { c: C.tag, ls: 3, w: 600 })}${tx(70, 962, 'Ladies tops, grade A · from KES 300', 24, { serif: true })}
  ${[0, 1, 2, 3].map((i) => `<circle cx="${352 + i * 32}" cy="992" r="5" fill="${i ? C.line : C.gold}"/>`).join('')}
  ${dock(1070)}`)]);

// 2. Seal dial: the seal is the screen; its ring fills with today's sales toward a daily goal; buttons orbit it.
L.push(['Seal dial (daily goal)', shot(`${topbar()}
  ${tx(400, 170, 'Lengo la leo · Today\'s goal', 20, { c: C.tag, a: 'middle' })}
  <circle cx="400" cy="520" r="260" fill="none" stroke="#1B332C" stroke-width="30"/>
  <circle cx="400" cy="520" r="260" fill="none" stroke="url(#goldS)" stroke-width="30" stroke-linecap="round" stroke-dasharray="${2 * Math.PI * 260 * .62} 9999" transform="rotate(-90 400 520)"/>
  <circle cx="400" cy="520" r="222" fill="none" stroke="${C.gold}" stroke-width="3" stroke-dasharray="12 9" opacity=".55"/>
  ${tee(400, 440, 190)}${tx(400, 600, 'KES 12,400', 46, { serif: true, a: 'middle' })}${tx(400, 640, 'of KES 20,000 · 62%', 18, { c: C.tag, a: 'middle' })}
  <circle cx="160" cy="910" r="96" fill="${C.card}" stroke="${C.gold}" stroke-opacity=".6" stroke-width="2"/>${icon('chat', 160, 890, 64)}${tx(160, 955, 'WhatsApp', 19, { serif: true, a: 'middle' })}${i2badge(222, 836, '2')}
  <circle cx="640" cy="910" r="96" fill="${C.card}" stroke="${C.gold}" stroke-opacity=".6" stroke-width="2"/>${icon('coin', 640, 890, 64)}${tx(640, 955, 'M-Pesa', 19, { serif: true, a: 'middle' })}
  <circle cx="400" cy="1010" r="128" fill="url(#goldBtn)"/>${icon('bag', 400, 985, 80, C.night)}${tx(400, 1072, 'UZA', 30, { serif: true, a: 'middle', c: C.night, w: 600 })}
  ${tx(400, 1222, 'Last payment KES 500 · 10:21 AM', 16, { c: C.muted, a: 'middle' })}`)]);

// 3. Tags on a rail: three clothing tags hang from a gold rail, like a thrift rack.
const tagShape = (x, y, w, h, rot, k, title, sub, extra = '') => `<g transform="rotate(${rot} ${x + w / 2} ${y - 60})">
  <path d="M${x + w / 2},${y - 60} L${x + w / 2},${y + 18}" stroke="${C.tag}" stroke-width="3"/>
  <path d="M${x + 24},${y} H${x + w - 24} Q${x + w},${y} ${x + w},${y + 24} V${y + h - 24} Q${x + w},${y + h} ${x + w - 24},${y + h} H${x + 24} Q${x},${y + h} ${x},${y + h - 24} V${y + 24} Q${x},${y} ${x + 24},${y} Z" fill="${C.card}" stroke="${C.gold}" stroke-width="2.5"/>
  <circle cx="${x + w / 2}" cy="${y + 34}" r="12" fill="${C.night}" stroke="${C.gold}" stroke-width="2.5"/>
  <rect x="${x + 14}" y="${y + 14}" width="${w - 28}" height="${h - 28}" rx="16" fill="none" stroke="${C.gold}" stroke-opacity=".5" stroke-width="2" stroke-dasharray="10 7"/>
  ${icon(k, x + w / 2, y + 150, 92)}${tx(x + w / 2, y + 262, title, 34, { serif: true, a: 'middle' })}${tx(x + w / 2, y + 296, sub, 15, { c: C.tag, a: 'middle' })}${extra}</g>`;
L.push(['Tags on a rail', shot(`${topbar()}
  ${tx(400, 160, 'Karibu Tavia', 44, { serif: true, a: 'middle' })}${tx(400, 196, 'Chagua · Choose', 17, { c: C.tag, a: 'middle' })}
  <path d="M30,262 H770" stroke="url(#goldS)" stroke-width="10" stroke-linecap="round"/>
  ${[120, 400, 680].map((x) => `<circle cx="${x}" cy="262" r="9" fill="${C.gl}"/>`).join('')}
  ${tagShape(30, 330, 220, 420, -4, 'chat', 'WhatsApp', 'Messages', i2badge(230, 360, '2'))}
  ${tagShape(275, 330, 250, 470, 0, 'bag', 'Uza', 'Sell')}
  ${tagShape(550, 330, 220, 420, 4, 'coin', 'M-Pesa', 'Payments', tx(660, 690, 'KES 8,450', 22, { w: 700, a: 'middle', c: C.gl }))}
  ${card(40, 1020, 720, 120, { r: 22, so: .35 })}${tx(70, 1070, 'Last payment', 15, { c: C.tag })}${tx(70, 1110, 'KES 500 · 10:21 AM', 26, { serif: true })}
  ${tx(400, 1230, 'FASHION FINDS SECOND TIME AROUND', 13, { c: C.tag, a: 'middle', ls: 4 })}`)]);

// 4. Live till counter: the top half is a live view of the till; three big buttons in a row below.
L.push(['Live till counter', shot(`${topbar()}
  ${card(30, 100, 740, 660, { so: .7 })}${tx(64, 156, 'TILL YA M-PESA · LIVE', 15, { c: C.tag, ls: 3, w: 600 })}
  <circle cx="712" cy="150" r="8" fill="${C.green}"/>${tx(696, 156, 'live', 14, { c: C.green, a: 'end' })}
  ${tx(64, 250, 'KES 8,450', 74, { serif: true })}${tx(64, 290, '12 payments today · all match the sales ✓', 18, { c: C.green })}
  ${[['KES 500', '10:21 AM', '✓ on sale'], ['KES 1,200', '10:04 AM', '✓ on sale'], ['KES 350', '9:47 AM', '⚠ not on a sale'], ['KES 800', '9:30 AM', '✓ on sale']].map(([a, t, s], i) => `
    <rect x="56" y="${330 + i * 102}" width="688" height="88" rx="16" fill="${C.night}" fill-opacity=".7" stroke="${s[0] === '⚠' ? C.red : C.line}" stroke-width="2"/>
    ${tx(82, 384 + i * 102, a, 28, { w: 700 })}${tx(300, 384 + i * 102, t, 19, { c: C.tag })}${tx(718, 384 + i * 102, s, 18, { a: 'end', c: s[0] === '⚠' ? C.red : C.green, w: 600 })}`).join('')}
  ${[['bag', 'Uza', 'Sell', true], ['chat', 'WhatsApp', 'Messages'], ['coin', 'M-Pesa', 'All payments']].map(([k, t, s, big], i) => {
    const x = 30 + i * 252; return `${big ? `<rect x="${x}" y="790" width="236" height="300" rx="28" fill="url(#goldBtn)"/>` : card(x, 790, 236, 300, { r: 28, so: .6 })}
    ${icon(k, x + 118, 890, 92, big ? C.night : 'url(#goldS)')}${tx(x + 118, 990, t, 32, { serif: true, a: 'middle', c: big ? C.night : C.ivory, w: big ? 600 : 500 })}${tx(x + 118, 1024, s, 15, { a: 'middle', c: big ? C.night : C.tag })}`; }).join('')}
  ${i2badge(460, 820, '2')}
  ${tx(400, 1180, 'FASHION FINDS SECOND TIME AROUND', 13, { c: C.tag, a: 'middle', ls: 4 })}`)]);

// 5. Today's story: a timeline of the day (payments, messages, sales) with the dock below.
L.push(['Today\'s timeline', shot(`${topbar()}
  <rect x="40" y="96" width="330" height="44" rx="22" fill="${C.green}" fill-opacity=".14" stroke="${C.green}" stroke-opacity=".6"/>
  <circle cx="64" cy="118" r="7" fill="${C.green}"/>${tx(80, 125, 'Duka liko wazi · Open till 8 PM', 16, { c: C.green, w: 600 })}
  ${tx(40, 200, 'Leo kwa Tavia', 40, { serif: true })}${tx(40, 236, 'Today at the shop', 17, { c: C.tag })}
  <path d="M84,280 V1030" stroke="${C.gold}" stroke-opacity=".4" stroke-width="3"/>
  ${[['10:21', 'coin', 'M-Pesa KES 500', 'Matched to a sale ✓', C.green], ['10:12', 'chat', '2 new WhatsApp messages', 'Tap WhatsApp to reply', C.tag],
     ['10:04', 'bag', 'Sale KES 1,200 · 3 items', 'by Mercy', C.tag], ['9:47', 'coin', 'M-Pesa KES 350', 'Not on a sale yet ⚠', C.red],
     ['9:30', 'bag', 'Sale KES 800', 'Cash', C.tag], ['8:00', 'tee', 'Shop opened', 'Have a good day!', C.tag]].map(([t, k, a, b, col], i) => {
    const y = 300 + i * 122; return `<circle cx="84" cy="${y + 40}" r="26" fill="${C.card}" stroke="${C.gold}" stroke-width="2"/>
    ${k === 'tee' ? tee(84, y + 40, 46) : icon(k, 84, y + 40, 32)}
    ${card(128, y, 632, 92, { r: 18, so: .3 })}${tx(150, y + 38, a, 22, { w: 600 })}${tx(150, y + 70, b, 16, { c: col })}${tx(738, y + 38, t, 16, { c: C.muted, a: 'end' })}`; }).join('')}
  ${dock(1070, 'flat')}`)]);

// 6. Minimal luxury: a near-empty boutique screen, the seal, the time, and three words at the bottom.
L.push(['Minimal luxury', shot(`${topbar('')}
  ${seal(400, 420, 400)}
  ${tx(400, 760, '10:24', 120, { serif: true, a: 'middle' })}${tx(400, 812, 'FRIDAY · 6 NOVEMBER', 18, { c: C.tag, a: 'middle', ls: 6 })}
  ${tx(400, 900, 'M-Pesa today  KES 8,450', 18, { c: C.muted, a: 'middle' })}
  ${ruleD(70, 730, 1040)}
  ${tx(160, 1118, 'UZA', 36, { serif: true, a: 'middle', c: C.gl })}${tx(400, 1118, 'WHATSAPP', 30, { serif: true, a: 'middle' })}${tx(640, 1118, 'M-PESA', 30, { serif: true, a: 'middle' })}
  <path d="M280,1106 l7,7 l-7,7 l-7,-7 Z M520,1106 l7,7 l-7,7 l-7,-7 Z" fill="${C.gold}"/>
  ${tx(160, 1150, 'Sell', 15, { c: C.tag, a: 'middle' })}${tx(400, 1150, 'Messages · 2 new', 15, { c: C.tag, a: 'middle' })}${tx(640, 1150, 'Payments', 15, { c: C.tag, a: 'middle' })}
  ${tx(400, 1236, 'FASHION FINDS SECOND TIME AROUND', 13, { c: C.tag, a: 'middle', ls: 4, op: .8 })}`)]);

const fonts = ['Cinzel%5Bwght%5D.ttf', 'Montserrat-Medium.ttf', 'Montserrat-SemiBold.ttf', 'Montserrat-Bold.ttf'].map((f) => 'fonts/' + f);
fs.mkdirSync(OUT, { recursive: true });
L.forEach(([name, svg], i) => {
  const png = new Resvg(svg, { font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Montserrat' }, fitTo: { mode: 'width', value: 800 } }).render().asPng();
  fs.writeFileSync(`${OUT}/home-${i + 1}.png`, png);
  console.log(i + 1, name);
});
