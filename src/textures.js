// Procedurally generated textures (canvas). These cover things no photo
// texture was downloaded for: soldier uniforms, HESCO barriers, sandbags,
// bullet holes, smoke, muzzle flashes, sight reticles...
import * as THREE from 'three';

// ---------- noise ----------
function hash(i, j, seed) {
  let h = (i * 374761393 + j * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, seed, period = 0) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const w = (a) => (period ? ((a % period) + period) % period : a);
  const a = hash(w(i), w(j), seed), b = hash(w(i + 1), w(j), seed);
  const c = hash(w(i), w(j + 1), seed), d = hash(w(i + 1), w(j + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, seed = 1, oct = 4, period = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(x * f, y * f, seed + o * 17, period ? period * f : 0) * a;
    n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function tex(c, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Normal map from a height function sampled on a w×h grid (tileable when the function is). */
function normalFromHeight(hgt, w, h, strength = 2) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const H = (x, y) => hgt[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const k = (y * w + x) * 4;
    img.data[k] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[k + 1] = (dy / l * 0.5 + 0.5) * 255;
    img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat: true });
}

// ---------- environment ----------
export function hescoTextures() {
  const S = 256;
  const c = canvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const hgt = new Float32Array(S * S);
  const mesh = 18; // px per wire square
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x / 22, y / 22, 3, 4, S / 22);
    const fine = hash(x, y, 9);
    // bulge between the vertical posts
    const bulge = Math.sin((x / S) * Math.PI) * 0.6 + 0.4;
    let r = 176 + n * 40 + fine * 14, g = 160 + n * 36 + fine * 12, b = 124 + n * 30 + fine * 10;
    r *= 0.75 + bulge * 0.3; g *= 0.75 + bulge * 0.3; b *= 0.75 + bulge * 0.3;
    // dirt stains toward the bottom
    const dirt = Math.max(0, (y / S - 0.55)) * 1.6 * (0.6 + n * 0.6);
    r -= dirt * 60; g -= dirt * 55; b -= dirt * 45;
    const wx = x % mesh, wy = y % mesh;
    const onWire = wx < 2 || wy < 2;
    let hh = bulge * 0.5 + n * 0.3;
    if (onWire) { r = 70 + fine * 30; g = 72 + fine * 30; b = 70 + fine * 28; hh += 0.6; }
    // coil posts at edges
    if (x < 5 || x > S - 6) { const s = (y % 7) < 4 ? 1 : 0.6; r = 80 * s + 20; g = 82 * s + 20; b = 80 * s + 20; hh = 1; }
    const k = (y * S + x) * 4;
    img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    hgt[y * S + x] = hh;
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c, { repeat: true }), normalMap: normalFromHeight(hgt, S, S, 3) };
}

export function burlapTexture() {
  const S = 256;
  const c = canvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x / 40, y / 40, 5, 4, S / 40);
    const weave = (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.5 + 0.5;
    const f = hash(x, y, 2);
    const v = 0.78 + n * 0.3 + weave * 0.1 + f * 0.06;
    const k = (y * S + x) * 4;
    img.data[k] = 150 * v; img.data[k + 1] = 128 * v; img.data[k + 2] = 90 * v; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { repeat: true });
}

/** Large-scale variation texture used to break up tiling on the ground. */
export function macroNoiseTexture() {
  const S = 256;
  const c = canvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x / 32, y / 32, 11, 5, S / 32);
    const m = fbm(x / 9, y / 9, 23, 3, S / 9);
    const k = (y * S + x) * 4;
    img.data[k] = n * 255; img.data[k + 1] = m * 255; img.data[k + 2] = 0; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat: true });
}

// ---------- soldier atlas ----------
// Regions are in canvas pixels on a 512×512 atlas; converted to UV rects.
export const ATLAS = {
  camo: [0, 0, 256, 256],
  vest: [256, 0, 256, 128],
  face: [256, 128, 128, 128],
  black: [384, 128, 128, 64],
  helmet: [384, 192, 128, 64],
  pants: [0, 256, 256, 256],
  pouch: [256, 256, 128, 128],
  skin: [384, 256, 128, 128],
  metal: [256, 384, 128, 128],
  furniture: [384, 384, 128, 128],
};
export function atlasUV(name) {
  const [x, y, w, h] = ATLAS[name];
  const S = 512, pad = 2;
  return [(x + pad) / S, 1 - (y + h - pad) / S, (x + w - pad) / S, 1 - (y + pad) / S];
}

export const KITS = {
  olive: { camo: ['#5d6348', '#434a35', '#7b7657', '#2f3428'], vest: '#4d5439', helmet: '#5a5f47', face: '#6d6552', pants: ['#595f47', '#3f4533', '#6f6c52', '#2e3227'], pouch: '#474e36', furniture: '#2a2a28' },
  black: { camo: ['#2e3033', '#222325', '#3d4044', '#18191a'], vest: '#262729', helmet: '#2b2c2e', face: '#3e3f42', pants: ['#2f3134', '#232426', '#3a3d40', '#1a1b1c'], pouch: '#2a2b2d', furniture: '#1c1c1c' },
  tan: { camo: ['#8d7f60', '#6d6046', '#a59776', '#564b37'], vest: '#76674b', helmet: '#80735a', face: '#8c7a5c', pants: ['#86795b', '#665a41', '#9d8f70', '#51472f'], pouch: '#6f6147', furniture: '#6e5d43' },
  heavy: { camo: ['#3a3d37', '#2a2c28', '#4a4d45', '#1f201d'], vest: '#2c2e2a', helmet: '#34372f', face: '#3b3d38', pants: ['#3a3d37', '#2a2c28', '#4a4d45', '#1f201d'], pouch: '#2f312c', furniture: '#1f1f1f' },
};

function camoRegion(ctx, x0, y0, w, h, cols, seed) {
  const img = ctx.createImageData(w, h);
  const c = cols.map(hexRgb);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n1 = fbm(x / 26, y / 34, seed, 4);
    const n2 = fbm(x / 20, y / 16, seed + 50, 4);
    const n3 = fbm(x / 12, y / 30, seed + 90, 3);
    let col = c[0];
    if (n1 > 0.56) col = c[1];
    if (n2 > 0.6) col = c[2];
    if (n3 > 0.64) col = c[3];
    // thin dark branches and pale highlights (MultiCam-style layering)
    if (Math.abs(fbm(x / 22, y / 22, seed + 130, 3) - 0.5) < 0.03 && fbm(x / 60, y / 60, seed + 170, 2) > 0.45) col = c[3].map((v) => v * 0.6);
    if (fbm(x / 8, y / 8, seed + 210, 3) > 0.72) col = col.map((v) => Math.min(255, v * 1.22 + 12));
    const f = 0.9 + hash(x, y, seed) * 0.12 + ((x + y) % 3 === 0 ? -0.03 : 0); // weave grain
    const k = (y * w + x) * 4;
    img.data[k] = col[0] * f; img.data[k + 1] = col[1] * f; img.data[k + 2] = col[2] * f; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, x0, y0);
}
function solidRegion(ctx, rect, hex, noise = 0.12, seed = 1) {
  const [x0, y0, w, h] = rect;
  const img = ctx.createImageData(w, h);
  const c = hexRgb(hex);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const f = 1 - noise / 2 + (fbm(x / 10, y / 10, seed, 3) * 0.6 + hash(x, y, seed) * 0.4) * noise;
    const k = (y * w + x) * 4;
    img.data[k] = c[0] * f; img.data[k + 1] = c[1] * f; img.data[k + 2] = c[2] * f; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, x0, y0);
}

export function soldierAtlas(kitName) {
  const kit = KITS[kitName] || KITS.olive;
  const c = canvas(512), ctx = c.getContext('2d');
  camoRegion(ctx, ...ATLAS.camo.slice(0, 2), 256, 256, kit.camo, 7);
  camoRegion(ctx, ...ATLAS.pants.slice(0, 2), 256, 256, kit.pants, 13);
  solidRegion(ctx, ATLAS.vest, kit.vest, 0.16, 3);
  // MOLLE webbing rows on the vest
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 10; y < 128; y += 14) ctx.fillRect(256, y, 256, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 262; x < 512; x += 18) ctx.fillRect(x, 0, 2, 128);
  solidRegion(ctx, ATLAS.face, kit.face, 0.2, 4);
  // goggles / eye slot band on the face region
  const [fx, fy, fw, fh] = ATLAS.face;
  ctx.fillStyle = '#0c0d0e';
  ctx.fillRect(fx, fy + fh * 0.36, fw, fh * 0.14);
  ctx.fillStyle = 'rgba(120,140,150,0.35)';
  ctx.fillRect(fx, fy + fh * 0.38, fw, fh * 0.04);
  solidRegion(ctx, ATLAS.black, '#1b1c1d', 0.14, 5);
  solidRegion(ctx, ATLAS.helmet, kit.helmet, 0.22, 6);
  solidRegion(ctx, ATLAS.pouch, kit.pouch, 0.18, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 256 + 12; y < 384; y += 22) ctx.fillRect(256, y, 128, 3);
  solidRegion(ctx, ATLAS.skin, '#8d6a52', 0.1, 9);
  solidRegion(ctx, ATLAS.metal, '#26272a', 0.1, 10);
  solidRegion(ctx, ATLAS.furniture, kit.furniture, 0.14, 12);
  const t = tex(c);
  t.anisotropy = 2;
  return t;
}

// ---------- effects ----------
export function bulletHoleTexture() {
  const S = 64;
  const c = canvas(S), ctx = c.getContext('2d');
  const cx = S / 2;
  // chipped ring
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 16;
    ctx.fillStyle = `rgba(${40 + Math.random() * 30},${35 + Math.random() * 25},${30 + Math.random() * 20},${0.15 + Math.random() * 0.25})`;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.6, cx + Math.sin(a) * r * 0.6, 1 + Math.random() * 3.5, 0, Math.PI * 2); ctx.fill();
  }
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, 14);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.35, 'rgba(10,8,6,0.95)');
  g.addColorStop(0.6, 'rgba(40,34,28,0.55)');
  g.addColorStop(1, 'rgba(60,50,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI * 2, r = 11 + Math.random() * 4;
    ctx.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
  }
  ctx.fill();
  // radial cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 5, cx + Math.sin(a) * 5);
    ctx.lineTo(cx + Math.cos(a + 0.2) * (14 + Math.random() * 12), cx + Math.sin(a + 0.2) * (14 + Math.random() * 12));
    ctx.stroke();
  }
  return tex(c);
}

export function scorchTexture() {
  const S = 128;
  const c = canvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
    const n = fbm(x / 10, y / 10, 31, 4);
    const a = Math.max(0, 1 - d * (0.8 + n * 0.6)) ** 1.2;
    const k = (y * S + x) * 4;
    img.data[k] = 12; img.data[k + 1] = 10; img.data[k + 2] = 8; img.data[k + 3] = a * 235;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

export function smokeTexture() {
  const S = 128;
  const c = canvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
    const n = fbm(x / 14, y / 14, 41, 5);
    const a = Math.max(0, 1 - d) ** 1.6 * (0.55 + n * 0.9);
    const k = (y * S + x) * 4;
    const v = 200 + n * 55;
    img.data[k] = v; img.data[k + 1] = v; img.data[k + 2] = v; img.data[k + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

export function glowTexture() {
  const S = 64;
  const c = canvas(S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c);
}

/**
 * Muzzle flash seen down the bore: a white-hot core and ragged, turbulent
 * lobes of burning gas (no hard star edges). Variants differ in lobe count and noise.
 */
export function muzzleFlashTexture(seed = 0) {
  const S = 256, c = canvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  const lobes = 4 + (seed % 3), ph = seed * 1.7;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
    const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const lobe = 0.45 + 0.55 * Math.pow(Math.abs(Math.cos(a * lobes / 2 + ph)), 2.2);
    const turb = fbm(Math.cos(a) * 2.2 + seed * 3.1, Math.sin(a) * 2.2 + r * 2.5, 17 + seed, 4);
    const edge = lobe * (0.42 + 0.7 * turb);
    const k = Math.max(0, 1 - r / edge);                  // 0 at the flame edge, 1 at the centre
    const fine = fbm(dx * 9 + seed, dy * 9, 5 + seed, 3);
    const core = Math.exp(-(r * r) / 0.018);
    const heat = Math.min(1, k * k * 1.6 + core);
    // colour temperature: white core, yellow, orange, deep red fringe
    const R = 255, G = 110 + 145 * Math.pow(heat, 0.6), B = 25 + 230 * Math.pow(heat, 2.2);
    const alpha = Math.min(1, Math.pow(k, 0.8) * (0.55 + 0.6 * fine) + core);
    const o = (y * S + x) * 4;
    img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = alpha * 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

/**
 * Side-on flame plume (muzzle at the left edge, travelling right): the bright
 * primary flash at the muzzle, a darker gap, then the ball of intermediate
 * flash where the gas re-ignites, all with turbulent edges.
 */
export function muzzleSideTexture(seed = 0) {
  const W = 256, H = 128, c = canvas(W, H), ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = (y - H / 2) / (H / 2);
    // radius profile: narrow at the muzzle, a bulb at ~40 %, tapering tail
    const bulb = Math.exp(-(((u - 0.42) / 0.2) ** 2));
    const rad = (0.16 + 0.1 * u + 0.5 * bulb) * (1 - Math.pow(u, 3));
    const turb = fbm(u * 6 + seed * 2.3, v * 3, 29 + seed, 4);
    const edge = rad * (0.65 + 0.7 * turb);
    const k = Math.max(0, 1 - Math.abs(v) / Math.max(0.01, edge));
    // brightness along the plume: primary flash, a dim gap, the intermediate flash
    const along = Math.exp(-u / 0.06) * 1.0 + 0.35 + 0.75 * bulb;
    const fine = fbm(u * 20 + seed, v * 10, 7 + seed, 3);
    const heat = Math.min(1, k * along * (0.7 + 0.5 * fine));
    const o = (y * W + x) * 4;
    img.data[o] = 255; img.data[o + 1] = 105 + 150 * Math.pow(heat, 0.7); img.data[o + 2] = 20 + 220 * Math.pow(heat, 2.4);
    img.data[o + 3] = Math.min(1, Math.pow(k, 0.9) * along * (0.5 + 0.6 * fine)) * 255 * (1 - Math.pow(u, 4));
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

/** M-LOK style slots as an alpha map (white = solid, black = hole). */
export function mlokAlphaTexture() {
  const W = 256, H = 512;
  const c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  const faces = 8, fw = W / faces;
  for (let f = 0; f < faces; f += 2) {
    for (let y = 40; y < H - 40; y += 58) {
      const x = f * fw + fw * 0.3, w = fw * 0.4, h = 36;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, h, w / 2) : ctx.rect(x, y, w, h);
      ctx.fill();
    }
  }
  const t = tex(c, { srgb: false });
  t.anisotropy = 4;
  return t;
}

/** Grippy stipple normal map for polymer grips / slide serrations. */
export function stippleNormal() {
  const S = 128;
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] = hash(x >> 1, y >> 1, 77) * 0.6 + fbm(x / 6, y / 6, 3, 2, S / 6) * 0.4;
  return normalFromHeight(hgt, S, S, 1.6);
}

/** Subtle wear/roughness variation for weapon metal. */
export function wearRoughness() {
  const S = 128;
  const c = canvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x / 12, y / 12, 55, 4, S / 12);
    const s = hash(x, y, 56);
    const v = 150 + n * 70 + s * 25; // green channel = roughness
    const k = (y * S + x) * 4;
    img.data[k] = 255; img.data[k + 1] = v; img.data[k + 2] = 0; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat: true });
}

/** Holographic sight reticle: 65 MOA ring with a centre dot. */
export function holoReticleTexture() {
  const S = 128;
  const c = canvas(S), ctx = c.getContext('2d');
  ctx.shadowColor = 'rgba(255,40,30,1)';
  ctx.shadowBlur = 6;
  ctx.strokeStyle = 'rgba(255,70,50,0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,90,70,1)';
  ctx.beginPath(); ctx.arc(S / 2, S / 2, 3.2, 0, Math.PI * 2); ctx.fill();
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a) * S * 0.36, S / 2 + Math.sin(a) * S * 0.36);
    ctx.lineTo(S / 2 + Math.cos(a) * S * 0.44, S / 2 + Math.sin(a) * S * 0.44);
    ctx.stroke();
  }
  return tex(c);
}

/** Small tritium-style sight dot. */
export function dotTexture(color = 'rgba(120,255,140,1)') {
  const S = 32;
  const c = canvas(S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, color); g.addColorStop(0.4, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c);
}

// ---------- night ----------
/** Equirectangular night sky: gradient, milky band, stars and a moon. */
export function nightSkyTexture() {
  const W = 2048, H = 1024;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#02040a'); g.addColorStop(0.42, '#070c1a'); g.addColorStop(0.5, '#141b2a'); g.addColorStop(0.53, '#0b0f17'); g.addColorStop(1, '#050608');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // milky way band
  const img = ctx.getImageData(0, 0, W, H);
  for (let y = 0; y < H * 0.5; y++) for (let x = 0; x < W; x++) {
    const band = Math.exp(-(((y - 150 - Math.sin(x / W * Math.PI * 2) * 120) / 70) ** 2));
    if (band < 0.02) continue;
    const n = fbm(x / 60, y / 60, 71, 4) * band;
    const k = (y * W + x) * 4;
    img.data[k] += n * 38; img.data[k + 1] += n * 38; img.data[k + 2] += n * 48;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 4200; i++) {
    const x = Math.random() * W, y = Math.random() ** 1.4 * H * 0.5;
    const b = Math.random() ** 3;
    ctx.fillStyle = `rgba(${220 + Math.random() * 35},${225 + Math.random() * 30},255,${0.25 + b * 0.75})`;
    const s = b > 0.85 ? 1.6 : b > 0.5 ? 1.1 : 0.7;
    ctx.fillRect(x, y, s, s);
  }
  // moon
  const mx = W * 0.62, my = H * 0.22;
  const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 60);
  mg.addColorStop(0, 'rgba(255,255,245,1)'); mg.addColorStop(0.2, 'rgba(240,242,235,1)'); mg.addColorStop(0.24, 'rgba(160,170,190,0.35)'); mg.addColorStop(1, 'rgba(60,70,100,0)');
  ctx.fillStyle = mg; ctx.fillRect(mx - 60, my - 60, 120, 120);
  const t = tex(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

/** Fabric weave + MOLLE webbing normal map matching the soldier atlas layout. */
export function soldierNormalMap() {
  const S = 512;
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let h = (Math.sin(x * 2.1) * Math.sin(y * 2.1)) * 0.25 + hash(x, y, 91) * 0.15 + fbm(x / 14, y / 14, 93, 3) * 0.5;
    // vest region: MOLLE rows
    if (x >= 256 && y < 128) h += ((y - 10) % 14 < 4 ? 0.8 : 0) + ((x - 262) % 18 < 2 ? 0.4 : 0);
    // pouch region: flap seams
    if (x >= 256 && x < 384 && y >= 256 && y < 384) h += ((y - 268) % 22 < 3 ? 0.9 : 0);
    // helmet: smooth with a few scuffs
    if (x >= 384 && y >= 192 && y < 256) h = fbm(x / 20, y / 20, 5, 3) * 0.3;
    hgt[y * S + x] = h;
  }
  return normalFromHeight(hgt, S, S, 1.4);
}

/** Dry desert grass tuft (alpha texture for crossed quads). */
export function grassTexture() {
  const W = 128, H = 128;
  const c = canvas(W, H), ctx = c.getContext('2d');
  for (let i = 0; i < 70; i++) {
    const x0 = W / 2 + (Math.random() - 0.5) * 50, h = 40 + Math.random() * 80, lean = (Math.random() - 0.5) * 50;
    const t = Math.random();
    ctx.strokeStyle = `rgb(${150 + t * 60},${130 + t * 50},${80 + t * 30})`;
    ctx.lineWidth = 1 + Math.random() * 1.6;
    ctx.beginPath(); ctx.moveTo(x0, H); ctx.quadraticCurveTo(x0 + lean * 0.3, H - h * 0.6, x0 + lean, H - h); ctx.stroke();
  }
  const t = tex(c);
  t.anisotropy = 2;
  return t;
}

// ---------- weapon finishes ----------
/**
 * A worn weapon finish: base colour with grain, fine scratches through to
 * bare metal, dust in low areas and handling smudges. Returns colour,
 * roughness and normal maps, tiling at `metresPerTile` in world units.
 */
export function weaponFinish({ base, wear, dust = 0.35, scratches = 70, rough = [0.55, 0.3], size = 512, seed = 1 }) {
  const S = size;
  const rnd = (() => { let a = seed * 9301 + 49297; return () => ((a = (a * 9301 + 49297) % 233280) / 233280); })();
  const col = canvas(S), cx = col.getContext('2d');
  const hc = canvas(S), hx = hc.getContext('2d');
  const rc = canvas(S), rx = rc.getContext('2d');
  cx.fillStyle = base; cx.fillRect(0, 0, S, S);
  hx.fillStyle = '#808080'; hx.fillRect(0, 0, S, S);
  const r0 = Math.round(rough[0] * 255);
  rx.fillStyle = `rgb(255,${r0},0)`; rx.fillRect(0, 0, S, S);
  // handling smudges / oil: slightly glossier blotches
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 70;
    const g = rx.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.round((rough[0] - 0.12 * rnd()) * 255);
    g.addColorStop(0, `rgba(255,${v},0,0.55)`); g.addColorStop(1, 'rgba(255,0,0,0)');
    rx.fillStyle = g; rx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // dust settling
  const w = hexRgb(wear);
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S, y = rnd() * S, r = 15 + rnd() * 60;
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150,132,105,${dust * (0.2 + rnd() * 0.25)})`); g.addColorStop(1, 'rgba(150,132,105,0)');
    cx.fillStyle = g; cx.fillRect(x - r, y - r, r * 2, r * 2);
    const g2 = rx.createRadialGradient(x, y, 0, x, y, r);
    g2.addColorStop(0, `rgba(255,235,0,${dust * 0.4})`); g2.addColorStop(1, 'rgba(255,235,0,0)');
    rx.fillStyle = g2; rx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // scratches through the finish
  for (let i = 0; i < scratches; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, len = 8 + rnd() ** 2 * 90;
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    const alpha = 0.25 + rnd() * 0.5;
    cx.strokeStyle = `rgba(${w[0]},${w[1]},${w[2]},${alpha})`; cx.lineWidth = 0.6 + rnd() * 0.9;
    cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x2, y2); cx.stroke();
    hx.strokeStyle = `rgba(40,40,40,${alpha})`; hx.lineWidth = 0.8;
    hx.beginPath(); hx.moveTo(x, y); hx.lineTo(x2, y2); hx.stroke();
    rx.strokeStyle = `rgba(255,${Math.round(rough[1] * 255)},0,${alpha})`; rx.lineWidth = 1;
    rx.beginPath(); rx.moveTo(x, y); rx.lineTo(x2, y2); rx.stroke();
  }
  // fine grain (bead blast / cerakote texture)
  const img = cx.getImageData(0, 0, S, S), him = hx.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    const n = (hash(i % S, (i / S) | 0, seed + 7) - 0.5);
    img.data[i * 4] += n * 10; img.data[i * 4 + 1] += n * 10; img.data[i * 4 + 2] += n * 10;
    him.data[i * 4] += n * 40;
  }
  cx.putImageData(img, 0, 0);
  const hgt = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) hgt[i] = him.data[i * 4] / 255;
  const map = tex(col, { repeat: true });
  const roughness = tex(rc, { srgb: false, repeat: true });
  return { map, roughness, normal: normalFromHeight(hgt, S, S, 1.2) };
}

/** Engraved roll marks for the lower receiver (white on transparent, used as an alpha-tested decal). */
export function rollMarkTexture() {
  const c = canvas(512, 218), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 218);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px "Arial Narrow", Arial, sans-serif';
  ctx.fillText('M4A1 CARBINE', 18, 44);
  ctx.font = 'bold 38px "Arial Narrow", Arial, sans-serif';
  ctx.fillText('CAL 5.56 MM', 18, 104);
  ctx.font = '34px "Arial Narrow", Arial, sans-serif';
  ctx.fillText('SER  W  457213', 18, 164);
  // pitted, worn engraving fill
  const img = ctx.getImageData(0, 0, 512, 218);
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0 && Math.random() < 0.18) img.data[i] = 0;
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** OCP / MultiCam-style camouflage: soft tan and olive blobs with dark brown branches and cream highlights. */
export function ocpCamoTexture(S = 512) {
  const c = canvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const P = S / 64;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / 64, v = y / 64;
    const n = (k, seed, oct = 4) => fbm(u * k + seed * 0.37, v * k + seed * 0.19, seed, oct, P * k);
    let col = [166, 150, 118];                                        // tan base
    if (n(0.75, 31) > 0.56) col = [120, 118, 86];                      // olive
    if (n(1.25, 37) > 0.6) col = [187, 172, 138];                      // light khaki
    if (n(1.0, 41) > 0.63) col = [107, 88, 66];                        // brown
    if (Math.abs(n(2.0, 43, 3) - 0.5) < 0.035 && n(0.5, 47, 2) > 0.45) col = [66, 54, 42]; // branches
    if (n(2.5, 53, 3) > 0.72) col = [205, 196, 170];                   // highlights
    const f = 0.93 + Math.random() * 0.09;
    const k = (y * S + x) * 4;
    img.data[k] = col[0] * f; img.data[k + 1] = col[1] * f; img.data[k + 2] = col[2] * f; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: true, repeat: true });
}

/** Ripstop weave normal map: fine plain weave with a heavier reinforcing thread grid. */
export function ripstopNormal(S = 256) {
  const c = canvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const wx = Math.sin(x * Math.PI / 2) * (((y >> 1) & 1) ? 1 : -1), wy = Math.sin(y * Math.PI / 2) * (((x >> 1) & 1) ? 1 : -1);
    const grid = (x % 32 < 2 || y % 32 < 2) ? 1.6 : 0;
    h[y * S + x] = 0.35 * (wx + wy) + grid + (Math.random() - 0.5) * 0.3;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)];
    const dy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
    const n = [-dx * 0.35, -dy * 0.35, 1], l = Math.hypot(...n);
    const k = (y * S + x) * 4;
    img.data[k] = (n[0] / l * 0.5 + 0.5) * 255; img.data[k + 1] = (n[1] / l * 0.5 + 0.5) * 255; img.data[k + 2] = (n[2] / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat: true });
}

/** Overcast storm sky (equirectangular): layered grey cloud deck, brighter towards the horizon. */
export function overcastSkyTexture() {
  const W = 1024, H = 512;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI; // +pi/2 at the top
    const up = Math.max(0, Math.sin(lat));
    for (let x = 0; x < W; x++) {
      // clouds are sampled on a plane above the viewer so they shrink towards the horizon
      const k = 1 / Math.max(0.08, up);
      const az = (x / W) * Math.PI * 2;
      const u = Math.cos(az) * k * 0.9, v = Math.sin(az) * k * 0.9;
      const n = fbm(u + 20, v + 20, 71, 5) * 0.7 + fbm(u * 3 + 5, v * 3, 73, 3) * 0.3;
      let l = 118 + up * -38 + (n - 0.5) * 70 * Math.min(1, up * 4 + 0.2);
      if (lat < 0) l = 112; // below the horizon: flat grey (ground haze)
      const i = (y * W + x) * 4;
      img.data[i] = l * 0.97; img.data[i + 1] = l; img.data[i + 2] = l * 1.05; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = tex(c, { srgb: true });
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
