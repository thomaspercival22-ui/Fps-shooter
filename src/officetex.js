// Procedural interior textures for the office tower: carpet tiles, a mineral
// fibre suspended ceiling, walnut veneer, polished limestone, wall paint,
// monitor screens, signage and artwork. All tileable, generated on a canvas.
import * as THREE from 'three';
import { fbm } from './textures.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const rng = (seed) => { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); };
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/** Carpet tiles (0.5 m, four across), laid quarter-turn: alternating pile sheen, tufted fleck. Returns colour + bump. */
export function carpetTextures(base = 0x4a4f57, fleck = 0x2f343c, S = 512) {
  const c = canvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  const b = canvas(S), bctx = b.getContext('2d'), bimg = bctx.createImageData(S, S);
  const A = hex(base), F = hex(fleck), R = rng(7);
  const tone = []; for (let i = 0; i < 16; i++) tone.push(0.94 + R() * 0.1);
  const tile = S / 4;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ti = Math.floor(x / tile), tj = Math.floor(y / tile), turn = (ti + tj) & 1;
    // tufts: rows along the pile direction
    const u = turn ? x : y, v = turn ? y : x;
    const tuft = 0.5 + 0.5 * Math.sin(u * 1.9 + Math.sin(v * 0.7) * 0.8) * Math.sin(v * 1.9);
    const n = fbm(x / 9, y / 9, 3, 3, S / 9);
    const f = R() < 0.18 + n * 0.1 ? 1 : 0;
    let k = tone[tj * 4 + ti] * (0.86 + tuft * 0.1 + (n - 0.5) * 0.12) * (turn ? 1.03 : 0.97);
    const edge = Math.min(x % tile, tile - 1 - (x % tile), y % tile, tile - 1 - (y % tile));
    if (edge < 1) k *= 0.8;
    const o = (y * S + x) * 4;
    for (let ch = 0; ch < 3; ch++) img.data[o + ch] = Math.min(255, (f ? F[ch] : A[ch]) * k);
    img.data[o + 3] = 255;
    const hgt = 128 + tuft * 60 + (R() - 0.5) * 70 - (edge < 1 ? 60 : 0);
    bimg.data[o] = bimg.data[o + 1] = bimg.data[o + 2] = hgt; bimg.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); bctx.putImageData(bimg, 0, 0);
  return { map: tex(c), bump: tex(b, false) };
}

/** Suspended ceiling: two 600 mm fissured mineral tiles each way, with the white T-bar grid. */
export function ceilingTexture(S = 512) {
  const c = canvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S), R = rng(3);
  const tile = S / 2, bar = Math.max(2, Math.round(S * 0.02));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x / 6, y / 6, 11, 3, S / 6), w = fbm(x / 3 + 40, y / 3, 5, 2, S / 3);
    let k = 0.93 + (n - 0.5) * 0.06;
    if (w > 0.62 && n > 0.45) k -= 0.28 * (w - 0.62) / 0.38 + 0.08;     // fissures
    if (R() < 0.02) k -= 0.12;                                        // pinholes
    const ex = x % tile, ey = y % tile;
    const onBar = ex < bar / 2 || ex >= tile - bar / 2 || ey < bar / 2 || ey >= tile - bar / 2;
    const nearBar = !onBar && (ex < bar || ex >= tile - bar || ey < bar || ey >= tile - bar);
    if (onBar) k = 0.99; else if (nearBar) k *= 0.72;                  // grid, shadowed tile edge
    const o = (y * S + x) * 4;
    img.data[o] = 238 * k; img.data[o + 1] = 236 * k; img.data[o + 2] = 230 * k; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

/** Walnut veneer, grain along v. */
export function woodTexture(light = false, S = 512) {
  const c = canvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  const A = light ? [168, 124, 84] : [92, 60, 38], B = light ? [128, 88, 56] : [58, 36, 22];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const warp = fbm(x / 60, y / 400, 21, 3, 0) * 18;
    const ring = Math.sin((x + warp) * 0.33 + fbm(x / 20, y / 90, 9, 2) * 6);
    const fine = fbm(x / 2, y / 40, 4, 2);
    const k = Math.min(1, Math.max(0, 0.5 + ring * 0.3 + (fine - 0.5) * 0.6));
    const o = (y * S + x) * 4;
    for (let ch = 0; ch < 3; ch++) img.data[o + ch] = A[ch] + (B[ch] - A[ch]) * k;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

/** Polished limestone tiles (600 mm) with soft veins and hairline grout. */
export function stoneTexture(S = 512) {
  const c = canvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  const tile = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ti = Math.floor(x / tile) + Math.floor(y / tile) * 2;
    const n = fbm(x / 70 + ti * 3.1, y / 70, 31 + ti, 4);
    const vein = Math.abs(fbm(x / 110 + ti, y / 45, 17 + ti, 4) - 0.5);
    let k = 0.9 + (n - 0.5) * 0.12 - Math.max(0, 0.04 - vein) * 3;
    const ex = x % tile, ey = y % tile;
    if (ex < 1 || ey < 1) k = 0.62;
    const o = (y * S + x) * 4;
    img.data[o] = 226 * k; img.data[o + 1] = 219 * k; img.data[o + 2] = 204 * k; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

/** Fine orange-peel roller texture, used as a bump map on painted walls. */
export function paintBump(S = 256) {
  const c = canvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = 128 + (fbm(x / 3, y / 3, 13, 3, S / 3) - 0.5) * 120;
    const o = (y * S + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, false);
}

/** A desktop on a monitor: windows, text lines, a chart. */
export function screenTexture(seed = 1) {
  const c = canvas(256, 160), ctx = c.getContext('2d'), R = rng(seed * 97 + 5);
  const g = ctx.createLinearGradient(0, 0, 256, 160);
  g.addColorStop(0, '#1d3a5a'); g.addColorStop(1, '#0b1a2c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 160);
  for (let w = 0; w < 2; w++) {
    const x = 10 + R() * 90, y = 10 + R() * 40, ww = 110 + R() * 40, hh = 80 + R() * 30;
    ctx.fillStyle = '#e8ecf1'; ctx.fillRect(x, y, ww, hh);
    ctx.fillStyle = '#3a6ea5'; ctx.fillRect(x, y, ww, 9);
    ctx.fillStyle = '#9aa5b1';
    for (let l = 0; l < 7; l++) ctx.fillRect(x + 6, y + 16 + l * 9, (0.4 + R() * 0.55) * (ww - 12), 3);
    if (R() < 0.6) {
      ctx.strokeStyle = '#2f9e62'; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i < 12; i++) ctx.lineTo(x + ww * 0.55 + i * 3.5, y + hh - 12 - R() * 30);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#10151c'; ctx.fillRect(0, 150, 256, 10);
  return tex(c, true, false);
}

/** Text sign (exit signs, floor numbers, company name). */
export function signTexture(text, { w = 512, h = 128, bg = '#1a7a3c', fg = '#ffffff', font = 'bold 84px sans-serif' } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  return tex(c, true, false);
}

/** Abstract canvas painting for the walls. */
export function artTexture(seed = 1) {
  const c = canvas(256, 192), ctx = c.getContext('2d'), R = rng(seed * 31 + 9);
  const pal = [['#e8e1d3', '#c65b3c', '#2d4a63', '#d9a441'], ['#f0ece4', '#1f2d3a', '#8aa3a8', '#b8433a'], ['#ebe6dc', '#3b5c45', '#c9b37e', '#222']][seed % 3];
  ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, 256, 192);
  for (let i = 0; i < 9; i++) {
    ctx.globalAlpha = 0.55 + R() * 0.4;
    ctx.fillStyle = pal[1 + Math.floor(R() * 3)];
    if (R() < 0.5) ctx.fillRect(R() * 200, R() * 150, 20 + R() * 90, 10 + R() * 70);
    else { ctx.beginPath(); ctx.arc(R() * 256, R() * 192, 10 + R() * 50, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  return tex(c, true, false);
}
