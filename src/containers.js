// ISO 20 ft shipping containers with real geometry: trapezoidal corrugated
// walls, corner posts, rails and castings, and cargo doors with locking bars.
// A weathering overlay (rust runs, faded paint, dirt) is painted per face.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

export const CONTAINER = { L: 6.06, W: 2.44, H: 2.59 };
const PITCH = 0.277, DEPTH = 0.036;

// corrugation profile (inward offset) over one pitch: outer flat, slope, inner flat, slope
function corr(t, depth = DEPTH) {
  t -= Math.floor(t);
  if (t < 0.26) return 0;
  if (t < 0.37) return depth * (t - 0.26) / 0.11;
  if (t < 0.63) return depth;
  if (t < 0.74) return depth * (1 - (t - 0.63) / 0.11);
  return 0;
}
const BREAKS = [0, 0.26, 0.37, 0.63, 0.74];

/**
 * Corrugated panel spanning a0..a1 along one axis and y0..y1, flat-shaded
 * facets. put(a, y, inward) returns the local position; the grime UV is
 * (a / len, y / H).
 */
function panel(a0, a1, y0, y1, put, len, pitch = PITCH, depth = DEPTH, rows = 5) {
  const xs = [];
  for (let k = Math.floor(a0 / pitch); k * pitch < a1; k++) for (const b of BREAKS) {
    const a = (k + b) * pitch;
    if (a > a0 && a < a1) xs.push(a);
  }
  xs.unshift(a0); xs.push(a1);
  const pos = [], uv = [];
  const dent = (a, y) => (TX.fbm(a * 0.9 + 3.1, y * 0.9, 17, 2) - 0.5) * 0.018;
  for (let i = 0; i < xs.length - 1; i++) for (let r = 0; r < rows; r++) {
    const ya = y0 + (y1 - y0) * r / rows, yb = y0 + (y1 - y0) * (r + 1) / rows;
    const q = [[xs[i], ya], [xs[i + 1], ya], [xs[i + 1], yb], [xs[i], yb]];
    const v = q.map(([a, y]) => put(a, y, corr(a / pitch, depth) + dent(a, y)));
    for (const k of [0, 2, 1, 0, 3, 2]) { pos.push(...v[k]); uv.push(q[k][0] / len, q[k][1] / CONTAINER.H); } // wound to face outwards
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('grimeUv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function block(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const p = g.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) uv.push(Math.max(p.getX(i), p.getZ(i) * 0.4) / CONTAINER.L, p.getY(i) / CONTAINER.H);
  g.setAttribute('grimeUv', new THREE.Float32BufferAttribute(uv, 2));
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  return g;
}
function bar(x, z, y0, y1, r) {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, 10, 1).toNonIndexed();
  g.translate(x, (y0 + y1) / 2, z);
  const p = g.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) uv.push(0.98, p.getY(i) / CONTAINER.H);
  g.setAttribute('grimeUv', new THREE.Float32BufferAttribute(uv, 2));
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  return g;
}

let geometryCache = null;
/** Local space: x along the length (doors at x = L), z across, y up. */
export function containerGeometry() {
  if (geometryCache) return geometryCache;
  const { L, W, H } = CONTAINER;
  const P = 0.16, parts = [];
  // long sides (corrugation runs along x); the panel sits behind the frame
  parts.push(panel(P, L - P, 0.16, H - 0.1, (a, y, d) => [a, y, d + 0.005], L));
  parts.push(panel(P, L - P, 0.16, H - 0.1, (a, y, d) => [L - a, y, W - d - 0.005], L));
  // blind end (x = 0): vertical corrugation across z
  parts.push(panel(P, W - P, 0.16, H - 0.1, (a, y, d) => [d + 0.005, y, W - a], W));
  // roof: shallow corrugation
  parts.push(panel(0.05, L - 0.05, 0.05, W - 0.05, (a, y, d) => [a, H - 0.012 - d * 0.5, y], L, 0.25, 0.02, 1));
  // doors (x = L): two leaves with shallow vertical corrugation
  parts.push(panel(P, W / 2 - 0.01, 0.16, H - 0.12, (a, y, d) => [L - 0.03 - d * 0.6, y, a], W, 0.23, 0.022));
  parts.push(panel(W / 2 + 0.01, W - P, 0.16, H - 0.12, (a, y, d) => [L - 0.03 - d * 0.6, y, a], W, 0.23, 0.022));
  // frame: corner posts, top/bottom rails, end rails
  for (const [x0, x1] of [[0, P], [L - P, L]]) for (const [z0, z1] of [[0, P], [W - P, W]]) parts.push(block(x0, 0, z0, x1, H, z1));
  for (const [z0, z1] of [[0, 0.1], [W - 0.1, W]]) { parts.push(block(P, 0, z0, L - P, 0.16, z1)); parts.push(block(P, H - 0.1, z0, L - P, H, z1)); }
  for (const x0 of [0, L - 0.12]) { parts.push(block(x0, 0, P, x0 + 0.12, 0.18, W - P)); parts.push(block(x0, H - 0.14, P, x0 + 0.12, H, W - P)); }
  // corner castings stand proud of the frame
  for (const x of [0, L - 0.178]) for (const z of [0, W - 0.162]) for (const y of [0, H - 0.118]) parts.push(block(x - 0.004, y, z - 0.004, x + 0.182, y + 0.118, z + 0.166));
  // door locking bars with cam keepers and handles
  for (const z of [0.36, 0.78, W - 0.78, W - 0.36]) {
    parts.push(bar(L + 0.012, z, 0.12, H - 0.08, 0.014));
    parts.push(block(L - 0.02, 0.1, z - 0.04, L + 0.03, 0.18, z + 0.04));
    parts.push(block(L - 0.02, H - 0.15, z - 0.04, L + 0.03, H - 0.07, z + 0.04));
    parts.push(block(L + 0.012, 1.02, z - 0.02, L + 0.05, 1.06, z + 0.28 * (z < W / 2 ? 1 : -1)));
  }
  // door hinges
  for (const z of [0.07, W - 0.07]) for (const y of [0.35, 1.1, 1.85, 2.35]) parts.push(block(L - 0.01, y, z - 0.05, L + 0.035, y + 0.1, z + 0.05));
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals(); // non-indexed: crisp faceted normals
  // metre-scale UVs for the paint texture
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const u = ay > 0.7 ? p.getX(i) : ax > 0.7 ? p.getZ(i) : p.getX(i);
    const v = ay > 0.7 ? p.getZ(i) : p.getY(i);
    uv[i * 2] = u / 1.94; uv[i * 2 + 1] = v / 1.94;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometryCache = g;
  return g;
}

/** Weathering overlay: rust runs from the top rail, faded paint, dirt and rust along the bottom. */
export function containerGrimeTexture(seed = 1) {
  const Wd = 1024, Ht = 512;
  const c = document.createElement('canvas');
  c.width = Wd; c.height = Ht;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(Wd, Ht);
  let s = seed * 7919;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const R = new Float32Array(Wd * Ht).fill(1), G = new Float32Array(Wd * Ht).fill(1), B = new Float32Array(Wd * Ht).fill(1);
  for (let y = 0; y < Ht; y++) {
    const v = 1 - y / Ht; // 1 at the top
    for (let x = 0; x < Wd; x++) {
      const i = y * Wd + x;
      const n = TX.fbm(x / 60, y / 60, seed * 3 + 1, 4, 0);
      // sun-faded paint towards the top, blotchy
      const fade = Math.max(0, v - 0.55) * 0.35 * n;
      // dirt and rust creeping up from the bottom
      const dirt = Math.max(0, 0.22 + n * 0.18 - v) / 0.35;
      R[i] += fade * 0.5 - dirt * 0.28; G[i] += fade * 0.5 - dirt * 0.36; B[i] += fade * 0.55 - dirt * 0.45;
      // speckled paint wear
      if (rnd() < 0.012) { R[i] -= 0.15; G[i] -= 0.22; B[i] -= 0.28; }
    }
  }
  // rust runs hanging from the top rail and from the roof seams
  for (let k = 0; k < 90; k++) {
    const sx = rnd() * Wd, len = (0.2 + rnd() * 0.75) * Ht, w = 1 + rnd() * 5, amp = 0.25 + rnd() * 0.45;
    for (let y = 0; y < len; y++) for (let x = Math.floor(sx - w * 1.5); x <= sx + w * 1.5; x++) {
      if (x < 0 || x >= Wd) continue;
      const dx = Math.abs(x - sx) / w;
      const a = (1 - Math.min(1, dx)) * (1 - y / len) * amp * (0.7 + 0.6 * TX.fbm(x / 6, y / 40, k, 2, 0));
      const i = y * Wd + x;
      R[i] -= a * 0.28; G[i] -= a * 0.45; B[i] -= a * 0.6;
    }
  }
  for (let i = 0; i < Wd * Ht; i++) {
    img.data[i * 4] = Math.max(0, Math.min(255, R[i] * 235));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, G[i] * 235));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, B[i] * 235));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Adds the weathering overlay (sampled with the grimeUv attribute) to a container paint material. */
export function applyContainerGrime(mat, grime) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    shader.uniforms.grimeMap = { value: grime };
    shader.vertexShader = 'attribute vec2 grimeUv; varying vec2 vGrimeUv;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vGrimeUv = grimeUv;');
    shader.fragmentShader = 'uniform sampler2D grimeMap; varying vec2 vGrimeUv;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec3 grime = texture2D(grimeMap, vGrimeUv).rgb * 1.085;
      diffuseColor.rgb *= grime;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + (1.0 - dot(grime, vec3(0.333))) * 0.6, 0.0, 1.0);`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => key() + '|cgrime';
}
