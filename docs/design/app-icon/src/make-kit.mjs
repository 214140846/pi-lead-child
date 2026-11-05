// Bytezard Lead app icon kit: the π jellyfish ("deep-sea π", F3) and its flat silhouette (G without the star).
// Writes one SVG per target. render.sh turns them into PNG and .icns.
//
//   node make-kit.mjs <out-dir>
//
// Geometry is on a 1024 canvas. The macOS tile follows the Big Sur grid: an 824 superellipse body at 100, with a baked shadow.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node make-kit.mjs <out-dir>');
mkdirSync(OUT, { recursive: true });

const C = 512;

function squircle(cx = C, cy = C, a = 412, n = 5, steps = 240) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push(`${(cx + a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n)).toFixed(2)} ${(cy + a * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

// A tapered stroke along a cubic Bézier, as a filled outline (w0 at the root, w1 at the tip).
function tentacle([p0, p1, p2, p3], w0, w1, steps = 80) {
  const L = [], R = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = bez(p0, p1, p2, p3, Math.max(0, t - 0.001));
    const b = bez(p0, p1, p2, p3, Math.min(1, t + 0.001));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const p = bez(p0, p1, p2, p3, t);
    const w = (w0 + (w1 - w0) * Math.pow(t, 0.9)) / 2;
    L.push(`${(p[0] + nx * w).toFixed(1)} ${(p[1] + ny * w).toFixed(1)}`);
    R.push(`${(p[0] - nx * w).toFixed(1)} ${(p[1] - ny * w).toFixed(1)}`);
  }
  return `M${L.join(' L')} L${R.reverse().join(' L')} Z`;
}

// The π: the bell is the top bar (with a soft lappet rim), the left leg drops, the right leg kicks out.
const BELL = (() => {
  const seg1 = [[798, 432], [736, 414], [640, 408], [512, 412]];
  const seg2 = [[512, 412], [384, 408], [288, 414], [226, 432]];
  const pts = [];
  for (const [si, seg] of [seg1, seg2].entries()) {
    for (let i = si === 0 ? 0 : 1; i <= 5; i++) pts.push(bez(...seg, i / 5));
  }
  let rim = '';
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    rim += ` Q${((a[0] + b[0]) / 2).toFixed(1)} ${((a[1] + b[1]) / 2 + 13).toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  }
  return `M226 432 C232 318 356 262 512 262 C668 262 792 318 798 432${rim} Z`;
})();
const SUB_BELL = `M282 420 C296 342 390 302 512 302 C634 302 728 342 742 420 C660 404 600 400 512 402 C424 400 364 404 282 420 Z`;
const LEG_L = [[420, 410], [424, 540], [384, 640], [398, 790]];
const LEG_R = [[604, 410], [598, 560], [612, 700], [770, 780]];
const THIN = [
  [[500, 414], [492, 520], [532, 600], [508, 700]],
  [[330, 420], [322, 500], [292, 560], [302, 640]],
  [[694, 420], [706, 500], [724, 560], [716, 630]],
];

const GLOW_DEFS = `
  <radialGradient id="bell" cx="512" cy="282" r="330" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.35" stop-color="#C9D8FF"/><stop offset="0.75" stop-color="#5B8BFF"/><stop offset="1" stop-color="#2F6AFF"/></radialGradient>
  <linearGradient id="sub" x1="0" y1="300" x2="0" y2="420" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.35"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
  <linearGradient id="tent" x1="0" y1="400" x2="0" y2="820" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#C9D8FF"/><stop offset="0.5" stop-color="#5B8BFF" stop-opacity="0.85"/><stop offset="1" stop-color="#2F6AFF" stop-opacity="0"/></linearGradient>
  <linearGradient id="thin" x1="0" y1="400" x2="0" y2="720" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8AA9F0" stop-opacity="0.7"/><stop offset="1" stop-color="#2F6AFF" stop-opacity="0"/></linearGradient>
  <filter id="soft" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="22"/></filter>`;
const SEA_DEFS = `
  <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16214A"/><stop offset="1" stop-color="#060914"/></linearGradient>
  <radialGradient id="halo" cx="512" cy="350" r="400" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2F6AFF" stop-opacity="0.4"/><stop offset="1" stop-color="#2F6AFF" stop-opacity="0"/></radialGradient>`;

// The glowing jellyfish, no background.
const glowGlyph = `
  ${THIN.map((c) => `<path d="${tentacle(c, 20, 2)}" fill="url(#thin)"/>`).join('')}
  <path d="${tentacle(LEG_L, 66, 6)}" fill="url(#tent)"/>
  <path d="${tentacle(LEG_R, 66, 6)}" fill="url(#tent)"/>
  <path d="${BELL}" fill="#5B8BFF" fill-opacity="0.55" filter="url(#soft)"/>
  <path d="${BELL}" fill="url(#bell)"/>
  <path d="${SUB_BELL}" fill="url(#sub)"/>`;

// The flat silhouette: bell and the two π legs only, one colour.
const flatGlyph = (fill) => `
  <path d="${BELL}" fill="${fill}"/>
  <path d="${tentacle(LEG_L, 74, 16)}" fill="${fill}"/>
  <path d="${tentacle(LEG_R, 74, 16)}" fill="${fill}"/>`;

// Scale a glyph about the canvas centre; dy moves the glyph's optical centre (about y 526) onto the canvas centre.
const place = (s, inner, dy = -14) => `<g transform="translate(512 512) scale(${s}) translate(-512 ${-512 + dy})">${inner}</g>`;

const svg = (w, h, viewBox, defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}"><defs>${defs}</defs>${body}</svg>\n`;

const BODY = squircle();
const SHADOW = `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000" flood-opacity="0.28"/></filter>`;
const full = '0 0 1024 1024';

const files = {
  // macOS app icon (.icns source): superellipse tile, baked shadow, transparent outside.
  'macos.svg': svg(1024, 1024, full, SEA_DEFS + GLOW_DEFS + SHADOW + `<clipPath id="clip"><path d="${BODY}"/></clipPath>`,
    `<g filter="url(#shadow)"><path d="${BODY}" fill="url(#sea)"/></g>
     <g clip-path="url(#clip)"><circle cx="512" cy="350" r="400" fill="url(#halo)"/>${glowGlyph}</g>
     <path d="${BODY}" fill="none" stroke="#FFFFFF" stroke-opacity="0.10" stroke-width="3"/>`),

  // Full-bleed square for iOS / Expo icon.png: the platform applies its own mask. Opaque, no shadow.
  'fullbleed.svg': svg(1024, 1024, full, SEA_DEFS + GLOW_DEFS,
    `<rect width="1024" height="1024" fill="url(#sea)"/>
     ${place(1.243, `<circle cx="512" cy="350" r="400" fill="url(#halo)"/>${glowGlyph}`, 0)}`),

  // Favicon: the full-bleed art in a rounded square, so it reads on light and dark browser tabs.
  'favicon.svg': svg(1024, 1024, full, SEA_DEFS + GLOW_DEFS + `<clipPath id="r"><rect width="1024" height="1024" rx="226"/></clipPath>`,
    `<g clip-path="url(#r)"><rect width="1024" height="1024" fill="url(#sea)"/>
     ${place(1.3, `<circle cx="512" cy="350" r="400" fill="url(#halo)"/>${glowGlyph}`, 0)}</g>`),

  // Android adaptive icon: foreground inside the 66% safe zone, background is the sea, monochrome is the silhouette.
  'android-foreground.svg': svg(1024, 1024, full, GLOW_DEFS, place(1.0, glowGlyph)),
  'android-background.svg': svg(1024, 1024, full, SEA_DEFS, `<rect width="1024" height="1024" fill="url(#sea)"/><circle cx="512" cy="350" r="400" fill="url(#halo)"/>`),
  'android-monochrome.svg': svg(1024, 1024, full, '', place(0.92, flatGlyph('#FFFFFF'))),

  // Splash (Expo splash on #10131A): the glowing jellyfish cropped to its own bounds.
  'splash.svg': svg(672, 620, '176 220 672 620', GLOW_DEFS, glowGlyph),

  // Flat mark (G without the star): ink on a white tile, for light surfaces and docs.
  'flat-tile.svg': svg(1024, 1024, full, SHADOW + `<linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#ECEEF2"/></linearGradient><clipPath id="clip"><path d="${BODY}"/></clipPath>`,
    `<g filter="url(#shadow)"><path d="${BODY}" fill="url(#paper)"/></g>
     <g clip-path="url(#clip)">${flatGlyph('#10131A')}</g>
     <path d="${BODY}" fill="none" stroke="#10131A" stroke-opacity="0.08" stroke-width="3"/>`),

  // Silhouette alone, black on transparent: a macOS menu-bar template image or an in-app mark.
  'silhouette.svg': svg(1024, 1024, full, '', place(1.0, flatGlyph('#000000'))),
};

for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content);
console.log(Object.keys(files).join(' '));
