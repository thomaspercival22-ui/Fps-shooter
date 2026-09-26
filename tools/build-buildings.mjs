// Builds the compound's buildings from real models (Sketchfab, CC BY; credits
// in assets/buildings/CREDITS.md). Each is brought to real size, stood on the
// ground (y = 0) at its footprint centre, stripped of its ground plane,
// simplified to a triangle budget and re-encoded (WebP textures, meshopt):
//   assets/buildings/<name>.glb     phones (512 px colour, 256 px other maps)
//   assets/buildings/<name>_hq.glb  desktop (1024 px everywhere)
// Collision comes from the model itself: its triangles are voxelised, the
// voxels greedily merged into boxes and each box shrunk back onto the surfaces
// inside it, so walls, floors, stairs, doorways and windows collide where they
// are drawn. The boxes go to assets/buildings/buildings.json.
// usage: node tools/build-buildings.mjs [name ...]
//   DOORS=1     list door-sized pieces (candidates for cfg.doors)
//   PLAN=1,3.5  print the collision plan at those heights
//   WALKMAP=2   print where a player can walk below that height (o = ground, digits = floor height)
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, cloneDocument, flatten, join, weld, simplify, transformMesh } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache', 'models');
const OUT = path.join(ROOT, 'assets', 'buildings');
const OBJAVERSE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';

// Collision classes: game material, bullet penetration (damage kept), blocks bullets / sight.
const CLASSES = {
  wood: { mat: 'wood', pen: 0.6 },
  sheet: { mat: 'metal', pen: 0.7 },
  metal: { mat: 'metal', pen: 0.45 },
  concrete: { mat: 'concrete', pen: 0 },
  plaster: { mat: 'plaster', pen: 0 },
  glass: { mat: 'glass', pen: 0.9, bullets: false, sight: false },
};
const CLASS_NAMES = Object.keys(CLASSES), GLASS = CLASS_NAMES.indexOf('glass');

// uid: Sketchfab model. scale: metres per model unit. drop: nodes/materials left out (ground planes).
// mats: [material-name regex, collision class] (first match; else `cls`). tris: budget.
export const BUILDINGS = {
  // two storeys of weathered planks and rusted sheet: porch, balcony, ladder
  house: {
    uid: '7f496b3002d24341a618408cb8221e8c', title: 'Old | House | Wooden | Enterable | Rusty', author: 'yadrogames',
    scale: 1, tris: 16000, cls: 'wood', roofY: 6.3, doors: [[-1.87, -4.11], [1.48, -1.36]], mats: [[/zinc/i, 'sheet'], [/iron/i, 'metal'], [/glass/i, 'glass']],
  },
  // single-storey plank house with a lean-to, solar panel and water drums
  post: {
    uid: 'a0d3931586a14385b6617cf7160aaa47', title: 'Post-Apocalyptic | House | Dirty | Old | Wooden', author: 'yadrogames',
    scale: 1, tris: 8000, cls: 'wood', drop: /^Ground$/, noAO: true, doors: [[-2.12, 4.51, 0.2]], mats: [[/roof/i, 'sheet'], [/equip/i, 'metal'], [/glass/i, 'glass']],
  },
  // two-storey block: rendered ground floor, plank upper floor, outside stair to a landing
  shanty: {
    uid: '64f09376d1a44ffd8716d7cc5f28db9c', title: 'Shanty | House | Building | Enterable', author: 'yadrogames',
    scale: 0.5, tris: 2700, cls: 'wood', ground: 0,
  },
  // flat-roofed rendered block with a blue door and wall AC units (closed: collision only)
  block: {
    uid: 'da4172d66b144acbadd9b9e86c39469d', title: 'Arab house model 2', author: '123a9el',
    scale: 1, tris: 5300, cls: 'plaster', drop: /^door/, mats: [[/door|window/i, 'wood'], [/black|screuw|lamp/i, 'metal']],
  },
};

function sketchfab(uid) {
  const file = path.join(CACHE, uid + '.glb');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(CACHE, { recursive: true });
  const idx = path.join(CACHE, 'object-paths.json');
  if (!fs.existsSync(idx)) { execFileSync('curl', ['-sSL', '--retry', '4', '-o', idx + '.gz', OBJAVERSE + 'object-paths.json.gz']); execFileSync('gunzip', ['-f', idx + '.gz']); }
  const rel = JSON.parse(fs.readFileSync(idx, 'utf8'))[uid];
  execFileSync('curl', ['-sSL', '--http1.1', '--retry', '4', '--retry-all-errors', '-o', file + '.part', OBJAVERSE + rel]);
  fs.renameSync(file + '.part', file);
  return file;
}

// ---------------------------------------------------------------- voxels -> boxes

/** Triangle / axis-aligned box overlap (separating axis test, Akenine-Möller). */
function triBox(c, h, a, b, d) {
  const v0 = [a[0] - c[0], a[1] - c[1], a[2] - c[2]], v1 = [b[0] - c[0], b[1] - c[1], b[2] - c[2]], v2 = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
  const e = [[v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]], [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]], [v0[0] - v2[0], v0[1] - v2[1], v0[2] - v2[2]]];
  for (const f of e) for (let ax = 0; ax < 3; ax++) {
    // axis = unit(ax) x f
    const u = [0, 0, 0]; u[(ax + 1) % 3] = -f[(ax + 2) % 3]; u[(ax + 2) % 3] = f[(ax + 1) % 3];
    const p0 = u[0] * v0[0] + u[1] * v0[1] + u[2] * v0[2], p1 = u[0] * v1[0] + u[1] * v1[1] + u[2] * v1[2], p2 = u[0] * v2[0] + u[1] * v2[1] + u[2] * v2[2];
    const r = h[0] * Math.abs(u[0]) + h[1] * Math.abs(u[1]) + h[2] * Math.abs(u[2]);
    if (Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r) return false;
  }
  for (let ax = 0; ax < 3; ax++) if (Math.min(v0[ax], v1[ax], v2[ax]) > h[ax] || Math.max(v0[ax], v1[ax], v2[ax]) < -h[ax]) return false;
  const n = [e[0][1] * e[1][2] - e[0][2] * e[1][1], e[0][2] * e[1][0] - e[0][0] * e[1][2], e[0][0] * e[1][1] - e[0][1] * e[1][0]];
  const dd = n[0] * v0[0] + n[1] * v0[1] + n[2] * v0[2];
  const r = h[0] * Math.abs(n[0]) + h[1] * Math.abs(n[1]) + h[2] * Math.abs(n[2]);
  return Math.abs(dd) <= r;
}

/** Clips a triangle to a box; grows `acc` [minx,miny,minz,maxx,maxy,maxz] by what is left. */
function clipInto(tri, bx, acc) {
  let poly = tri;
  for (let ax = 0; ax < 3 && poly.length; ax++) for (const [lim, sgn] of [[bx[ax], 1], [bx[ax + 3], -1]]) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const dp = (p[ax] - lim) * sgn, dq = (q[ax] - lim) * sgn;
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
    }
    poly = out;
    if (!poly.length) break;
  }
  for (const p of poly) for (let k = 0; k < 3; k++) { if (p[k] < acc[k]) acc[k] = p[k]; if (p[k] > acc[k + 3]) acc[k + 3] = p[k]; }
}

/**
 * tris: [[a, b, c, cls]] in metres. Returns boxes [x0, y0, z0, x1, y1, z1, cls].
 * Voxels 0.2 m across and 0.15 m tall; clutter smaller than `minPart` is left out.
 */
function collider(tris, { vs = 0.2, vy = 0.15, minPart = 0.4, minBox = 0.22, thick = 0.1, roofY = Infinity } = {}) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], t[i][k]); hi[k] = Math.max(hi[k], t[i][k]); }
  const size = [vs, vy, vs];
  for (let k = 0; k < 3; k++) { lo[k] -= size[k]; hi[k] += size[k]; }
  const n = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / size[k]));
  const [nx, ny, nz] = n, at = (i, j, k) => (j * nz + k) * nx + i;
  const grid = new Uint8Array(nx * ny * nz);
  const half = size.map((s) => s / 2 + 1e-5);
  // every voxel a triangle touches (dominant class: the lowest index, so solid beats glass)
  const each = (t, fn) => {
    const r0 = [0, 1, 2].map((k) => Math.max(0, Math.floor((Math.min(t[0][k], t[1][k], t[2][k]) - lo[k]) / size[k])));
    const r1 = [0, 1, 2].map((k) => Math.min(n[k] - 1, Math.floor((Math.max(t[0][k], t[1][k], t[2][k]) - lo[k]) / size[k])));
    const c = [0, 0, 0];
    for (let j = r0[1]; j <= r1[1]; j++) for (let k = r0[2]; k <= r1[2]; k++) for (let i = r0[0]; i <= r1[0]; i++) {
      c[0] = lo[0] + (i + 0.5) * vs; c[1] = lo[1] + (j + 0.5) * vy; c[2] = lo[2] + (k + 0.5) * vs;
      if (triBox(c, half, t[0], t[1], t[2])) fn(at(i, j, k));
    }
  };
  for (const t of tris) each(t, (v) => { if (!grid[v] || grid[v] > t[3] + 1) grid[v] = t[3] + 1; });
  // drop small loose parts (6-connected pieces whose bounds are under minPart)
  const seen = new Uint8Array(grid.length), stack = [], part = [];
  for (let v = 0; v < grid.length; v++) {
    if (!grid[v] || seen[v]) continue;
    part.length = 0; stack.push(v); seen[v] = 1;
    const pl = [Infinity, Infinity, Infinity], ph = [-Infinity, -Infinity, -Infinity];
    while (stack.length) {
      const u = stack.pop(); part.push(u);
      const i = u % nx, k = Math.floor(u / nx) % nz, j = Math.floor(u / (nx * nz));
      const p = [i * vs, j * vy, k * vs];
      for (let q = 0; q < 3; q++) { pl[q] = Math.min(pl[q], p[q]); ph[q] = Math.max(ph[q], p[q] + size[q]); }
      for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const a = i + di, b = j + dj, c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
        const w = at(a, b, c);
        if (grid[w] && !seen[w]) { seen[w] = 1; stack.push(w); }
      }
    }
    if (Math.max(ph[0] - pl[0], ph[1] - pl[1], ph[2] - pl[2]) < minPart) for (const u of part) grid[u] = 0;
  }
  // greedy merge: runs along x, grown along z, then up
  const owner = new Int32Array(grid.length).fill(-1), boxes = [];
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const v = at(i, j, k), c = grid[v];
    if (!c || owner[v] >= 0) continue;
    const kind = (x) => (x === GLASS + 1 ? 2 : x ? 1 : 0), kv = kind(c);
    const free = (a, b, d) => kind(grid[at(a, b, d)]) === kv && owner[at(a, b, d)] < 0;
    let i1 = i; while (i1 + 1 < nx && free(i1 + 1, j, k)) i1++;
    let k1 = k; grow: while (k1 + 1 < nz) { for (let a = i; a <= i1; a++) if (!free(a, j, k1 + 1)) break grow; k1++; }
    let j1 = j; up: while (j1 + 1 < ny) { for (let d = k; d <= k1; d++) for (let a = i; a <= i1; a++) if (!free(a, j1 + 1, d)) break up; j1++; }
    const id = boxes.length, votes = new Map();
    for (let b = j; b <= j1; b++) for (let d = k; d <= k1; d++) for (let a = i; a <= i1; a++) { const w = at(a, b, d); owner[w] = id; votes.set(grid[w], (votes.get(grid[w]) || 0) + 1); }
    const cls = [...votes].sort((p, q) => q[1] - p[1])[0][0] - 1;
    boxes.push({ vox: [lo[0] + i * vs, lo[1] + j * vy, lo[2] + k * vs, lo[0] + (i1 + 1) * vs, lo[1] + (j1 + 1) * vy, lo[2] + (k1 + 1) * vs], c: cls, acc: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] });
  }
  // shrink each box onto the surfaces inside it
  const mark = new Int32Array(boxes.length).fill(-1);
  tris.forEach((t, ti) => each(t, (v) => {
    const id = owner[v];
    if (id < 0 || mark[id] === ti) return;
    mark[id] = ti;
    clipInto([t[0], t[1], t[2]], boxes[id].vox, boxes[id].acc);
  }));
  const out = [];
  for (const b of boxes) {
    const a = b.acc;
    if (!(a[0] <= a[3])) continue;
    for (let k = 0; k < 3; k++) if (a[k + 3] - a[k] < thick) { const m = (a[k] + a[k + 3]) / 2; a[k] = m - thick / 2; a[k + 3] = m + thick / 2; }
    if (Math.max(a[3] - a[0], a[4] - a[1], a[5] - a[2]) < minBox || a[4] < 0.05) continue;
    out.push([...a.map((x) => Math.round(x * 100) / 100), b.c]);
  }
  return mergeBoxes(out, { roofY });
}

/**
 * Merges neighbouring boxes of the same kind: ones that touch along one axis and line up (within
 * `tol`) on the other two, which never bridges a doorway or window; and, in a thin horizontal band,
 * ones side by side on the ground plan (a sloped roof becomes a few flat strips instead of a
 * staircase). Above `roofY` nobody walks, so roof strips may be misaligned by up to `roofTol`.
 */
function mergeBoxes(list, { band = 0.35, tol = 0.08, roofY = Infinity, roofBand = 0.9, roofTol = 0.6 } = {}) {
  const vol = (b) => (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
  const touch = (a, b, k) => b[k] <= a[k + 3] + 0.05 && a[k] <= b[k + 3] + 0.05;
  const aligned = (a, b, k, t) => Math.abs(a[k] - b[k]) <= t && Math.abs(a[k + 3] - b[k + 3]) <= t;
  const glass = (b) => b[6] === GLASS;
  let boxes = list.map((b) => [...b]), merged = true;
  while (merged) {
    merged = false;
    const alive = boxes.map(() => true);
    for (let i = 0; i < boxes.length; i++) {
      if (!alive[i]) continue;
      let best = -1, bestCost = Infinity, bestU = null;
      const a = boxes[i];
      for (let j = i + 1; j < boxes.length; j++) {
        if (!alive[j]) continue;
        const b = boxes[j];
        if (glass(a) !== glass(b) || !touch(a, b, 0) || !touch(a, b, 1) || !touch(a, b, 2)) continue;
        const u = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];
        let ok = [0, 1, 2].some((m) => [0, 1, 2].every((k) => k === m || aligned(a, b, k, tol)));
        if (!ok) {
          const roof = Math.min(a[1], b[1]) >= roofY;
          ok = u[4] - u[1] <= (roof ? roofBand : band) && (aligned(a, b, 0, roof ? roofTol : tol) || aligned(a, b, 2, roof ? roofTol : tol));
        }
        const cost = vol(u) - vol(a) - vol(b);
        if (ok && cost < bestCost) { bestCost = cost; best = j; bestU = u; }
      }
      if (best < 0) continue;
      const b = boxes[best];
      boxes[i] = [...bestU, vol(a) >= vol(b) ? a[6] : b[6]];
      alive[best] = false;
      merged = true;
    }
    boxes = boxes.filter((_, i) => alive[i]);
  }
  return boxes;
}

/**
 * Where a player can walk (same rules as the game: 0.42 m steps, 0.32 m radius, crouched height),
 * starting outside on the ground. Returns reachable spots under a roof, one per `spacing` metres,
 * and the walkable area per floor height.
 */
function walkable(boxes, lo, hi, { cell = 0.1, r = 0.32, h = 1.15, stand = 1.78, step = 0.42, spacing = 1.2 } = {}) {
  const B = boxes.map((b) => ({ x0: b[0], y0: b[1], z0: b[2], x1: b[3], y1: b[4], z1: b[5] }));
  const near = (x, z, rr) => B.filter((b) => { const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1)); return (x - cx) ** 2 + (z - cz) ** 2 < rr * rr; });
  const groundAt = (x, z, maxY) => near(x, z, r * 0.75).reduce((g, b) => (b.y1 <= maxY && b.y1 > g ? b.y1 : g), 0);
  const blocked = (x, z, y) => near(x, z, r).some((b) => b.y1 > y + step && b.y0 < y + h);
  const roofed = (x, z, y) => B.some((b) => b.y0 >= y + stand && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);
  const x0 = lo[0] - 1, z0 = lo[2] - 1, nx = Math.ceil((hi[0] - lo[0] + 2) / cell), nz = Math.ceil((hi[2] - lo[2] + 2) / cell);
  const seen = new Map(), queue = [];
  const key = (i, k, y) => `${i},${k},${Math.round(y * 20)}`;
  const push = (i, k, y) => { const q = key(i, k, y); if (!seen.has(q)) { seen.set(q, [i, k, y]); queue.push([i, k, y]); } };
  for (let i = 0; i < nx; i++) { push(i, 0, 0); push(i, nz - 1, 0); }
  for (let k = 0; k < nz; k++) { push(0, k, 0); push(nx - 1, k, 0); }
  while (queue.length) {
    const [i, k, y] = queue.shift();
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, c = k + dk;
      if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
      const x = x0 + (a + 0.5) * cell, z = z0 + (c + 0.5) * cell, g = groundAt(x, z, y + step);
      if (!blocked(x, z, g)) push(a, c, g);
    }
  }
  const floors = {}, spots = [], taken = new Set();
  for (const [i, k, y] of seen.values()) {
    const x = x0 + (i + 0.5) * cell, z = z0 + (k + 0.5) * cell;
    if (x < lo[0] || x > hi[0] || z < lo[2] || z > hi[2] || !roofed(x, z, y)) continue;
    const f = y.toFixed(1); floors[f] = (floors[f] || 0) + cell * cell;
    const t = `${Math.floor(x / spacing)},${Math.floor(z / spacing)},${f}`;
    if (!taken.has(t) && !near(x, z, r + 0.25).some((b) => b.y1 > y + step && b.y0 < y + stand)) { taken.add(t); spots.push([+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]); }
  }
  if (process.env.WALKMAP) {
    const top = new Map(); for (const [i, k, y] of seen.values()) if (y < +process.env.WALKMAP) top.set(i + ',' + k, Math.max(top.get(i + ',' + k) ?? -1, y));
    const rows = [];
    for (let k = 0; k < nz; k++) {
      let row = '';
      for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * cell, z = z0 + (k + 0.5) * cell, y = top.get(i + ',' + k);
        row += y !== undefined ? (y < 0.05 ? 'o' : String(Math.min(9, Math.round(y * 10)))) : near(x, z, 0.01).some((b) => b.y1 > 0.5 && b.y0 < 1.7) ? '#' : '.';
      }
      rows.push(row);
    }
    console.log(rows.join('\n'));
  }
  return { floors: Object.fromEntries(Object.entries(floors).map(([f, a]) => [f, +a.toFixed(1)])), spots };
}

/** Plan view at height y (ASCII), for checking doorways and walls. */
function plan(boxes, y, lo, hi, cell = 0.3) {
  const rows = [];
  for (let z = lo[2]; z < hi[2]; z += cell) {
    let row = '';
    for (let x = lo[0]; x < hi[0]; x += cell) {
      const b = boxes.find((q) => x + cell / 2 >= q[0] && x + cell / 2 <= q[3] && z + cell / 2 >= q[2] && z + cell / 2 <= q[5] && y >= q[1] && y <= q[4]);
      row += b ? 'WsMCPg'[b[6]] || '#' : '.';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

// ---------------------------------------------------------------- model

/** Connected pieces of a primitive (triangles sharing vertex positions): [{tris: [i...], lo, hi}]. */
function pieces(prim) {
  const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), n = idx ? idx.getCount() : pos.getCount();
  const vid = new Map(), id = (i) => { const v = pos.getElement(i, []); const k = v.map((x) => Math.round(x * 1000)).join(','); if (!vid.has(k)) vid.set(k, vid.size); return vid.get(k); };
  const tv = []; for (let i = 0; i < n; i += 3) tv.push([0, 1, 2].map((q) => id(idx ? idx.getScalar(i + q) : i + q)));
  const par = Array.from({ length: vid.size }, (_, i) => i), find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  for (const [a, b, c] of tv) { par[find(b)] = find(a); par[find(c)] = find(a); }
  const groups = new Map();
  tv.forEach((t, ti) => {
    const g = find(t[0]);
    if (!groups.has(g)) groups.set(g, { tris: [], lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] });
    const G = groups.get(g); G.tris.push(ti);
    for (let q = 0; q < 3; q++) { const v = pos.getElement(idx ? idx.getScalar(ti * 3 + q) : ti * 3 + q, []); for (let k = 0; k < 3; k++) { G.lo[k] = Math.min(G.lo[k], v[k]); G.hi[k] = Math.max(G.hi[k], v[k]); } }
  });
  return [...groups.values()];
}

/** Removes the given triangles from a primitive. */
function dropTris(prim, drop) {
  const idx = prim.getIndices(), n = idx.getCount(), keep = [];
  for (let i = 0; i < n; i += 3) if (!drop.has(i / 3)) keep.push(idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2));
  if (!keep.length) { prim.dispose(); return; }
  idx.setArray(new Uint32Array(keep));
}

/** Bakes every node's world transform into its mesh (a mesh used twice is copied first). */
function bakeWorld(scene) {
  const nodes = []; scene.traverse((nd) => nodes.push(nd));
  const world = new Map(nodes.map((nd) => [nd, nd.getWorldMatrix()]));
  const used = new Set();
  for (const nd of nodes) {
    let m = nd.getMesh();
    if (!m) continue;
    if (used.has(m)) { const c = m.clone(); c.listPrimitives().forEach((p) => c.removePrimitive(p)); for (const p of m.listPrimitives()) c.addPrimitive(p.clone()); nd.setMesh(c); m = c; }
    used.add(m);
    transformMesh(m, world.get(nd));
  }
  for (const nd of nodes) nd.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

async function buildOne(name, cfg) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(sketchfab(cfg.uid));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) a.dispose();
  for (const s of root.listSkins()) s.dispose();
  if (cfg.drop) {
    for (const nd of root.listNodes()) if (nd.getMesh() && cfg.drop.test(nd.getName())) nd.setMesh(null);
    for (const m of root.listMeshes()) for (const p of m.listPrimitives()) if (cfg.drop.test(p.getMaterial()?.getName() || '')) p.dispose();
  }
  const scene = root.getDefaultScene() || root.listScenes()[0];
  bakeWorld(scene);
  await doc.transform(flatten(), join({ keepNamed: false }), weld({}));
  // scale, then stand on the ground at the footprint centre
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const eachPos = (fn) => { for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'), v = [0, 0, 0]; for (let i = 0; i < a.getCount(); i++) fn(a.getElement(i, v)); } };
  eachPos((v) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); } });
  const k = cfg.scale, ground = cfg.ground ?? lo[1];
  const T = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, -k * (lo[0] + hi[0]) / 2, -k * ground, -k * (lo[2] + hi[2]) / 2, 1];
  for (const m of root.listMeshes()) transformMesh(m, T);
  lo = [Infinity, Infinity, Infinity]; hi = [-Infinity, -Infinity, -Infinity];
  eachPos((v) => { for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], v[q]); hi[q] = Math.max(hi[q], v[q]); } });
  // door leaves: thin door-sized pieces standing on a floor (listed with DOORS=1; removed when named in
  // cfg.doors, with whatever hangs inside them: handles, grilles, vision panels)
  const leaves = [];
  const allPieces = [];
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    if (!p.getIndices()) continue;
    const list = pieces(p);
    allPieces.push([p, list]);
    for (const g of list) {
      const d = [0, 1, 2].map((q) => g.hi[q] - g.lo[q]), thin = Math.min(d[0], d[2]), wide = Math.max(d[0], d[2]);
      if (!(d[1] > 1.6 && d[1] < 2.6 && thin < 0.25 && wide > 0.55 && wide < 1.6)) continue;
      const at = [(g.lo[0] + g.hi[0]) / 2, g.lo[1], (g.lo[2] + g.hi[2]) / 2].map((v) => +v.toFixed(2));
      const hit = (cfg.doors || []).some(([x, z, t = 0.1]) => thin < t && Math.hypot(at[0] - x, at[2] - z) < 0.3);
      if (process.env.DOORS) console.log(`  door? ${p.getMaterial()?.getName()}@${at.join(',')} ${d.map((v) => v.toFixed(2)).join(' x ')} ${g.tris.length} tris${hit ? ' REMOVED' : ''}`);
      if (hit) leaves.push(g);
    }
  }
  for (const [p, list] of allPieces) {
    const drop = new Set();
    for (const g of list) {
      const inside = leaves.some((L) => [0, 1, 2].every((q) => { const pad = L.hi[q] - L.lo[q] < 0.1 ? 0.2 : 0.05; return g.lo[q] >= L.lo[q] - pad && g.hi[q] <= L.hi[q] + pad; }));
      if (inside) for (const t of g.tris) drop.add(t);
    }
    if (drop.size) dropTris(p, drop);
  }
  // collision from the full-detail surfaces
  const clsOf = (mat) => { const nm = mat?.getName() || ''; for (const [re, c] of cfg.mats || []) if (re.test(nm)) return c; return cfg.cls; };
  const tris = [];
  let count = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const c = CLASS_NAMES.indexOf(clsOf(p.getMaterial()));
    const pos = p.getAttribute('POSITION'), idx = p.getIndices();
    const nIdx = idx ? idx.getCount() : pos.getCount();
    for (let i = 0; i < nIdx; i += 3) {
      const v = [0, 1, 2].map((q) => pos.getElement(idx ? idx.getScalar(i + q) : i + q, []));
      tris.push([v[0], v[1], v[2], c]);
    }
    count += nIdx / 3;
  }
  const t0 = Date.now();
  const boxes = collider(tris, { roofY: cfg.roofY ?? Infinity });
  console.log(`${name.padEnd(8)} ${hi.map((v, q) => (v - lo[q]).toFixed(2)).join(' x ')} m, ${boxes.length} boxes (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const walk = walkable(boxes, lo, hi);
  console.log(`         indoor floors reachable on foot (m above ground: m2): ${JSON.stringify(walk.floors)}, ${walk.spots.length} spots`);
  if (process.env.PLAN) for (const y of process.env.PLAN.split(',').map(Number)) console.log(`-- ${name} plan at ${y} m\n` + plan(boxes, y, lo, hi));
  // render model
  await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
  if (count > cfg.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: cfg.tris / count, error: 0.004, lockBorder: true }));
  // a baked occlusion map that blacks out the interior (the level bakes its own AO)
  if (cfg.noAO) for (const m of root.listMaterials()) m.setOcclusionTexture(null);
  for (const m of root.listMaterials()) if (m.getAlphaMode() === 'BLEND' && m.getBaseColorFactor()[3] > 0.99 && !/glass/i.test(m.getName())) m.setAlphaMode('MASK').setAlphaCutoff(0.5);
  await doc.transform(prune(), dedup());
  let after = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) after += (p.getIndices()?.getCount() || 0) / 3;
  fs.mkdirSync(OUT, { recursive: true });
  for (const [suffix, color, other] of [['_hq', 1024, 1024], ['', 512, 256]]) {
    const d = cloneDocument(doc);
    await d.transform(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [color, color], quality: 85, slots: /^baseColor/ }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [other, other], quality: 85, slots: /^(?!baseColor)/ }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const file = path.join(OUT, `${name}${suffix}.glb`);
    await new NodeIO().registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder }).write(file, d);
    if (!suffix) console.log(`         ${count} -> ${after} triangles, ${root.listTextures().length} textures, ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
  }
  const r = (v) => Math.round(v * 100) / 100;
  return { min: lo.map(r), max: hi.map(r), boxes: boxes.flat(), spots: walk.spots.flat() };
}

const only = process.argv.slice(2);
const metaFile = path.join(OUT, 'buildings.json');
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
meta.classes = CLASS_NAMES.map((c) => ({ name: c, ...CLASSES[c] }));
for (const [name, cfg] of Object.entries(BUILDINGS)) {
  if (only.length && !only.includes(name)) continue;
  meta[name] = await buildOne(name, cfg);
}
fs.writeFileSync(metaFile, JSON.stringify(meta));
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), '# Buildings\n\nSketchfab models (CC BY 4.0), resized, simplified and re-encoded for the game; collision generated from their geometry.\n\n' +
  Object.values(BUILDINGS).map((c) => `- **${c.title}**${c.author ? ` by ${c.author}` : ''}: https://sketchfab.com/3d-models/${c.uid} (CC BY 4.0)`).join('\n') + '\n');
