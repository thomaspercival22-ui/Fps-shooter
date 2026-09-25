// Hard-surface signed-distance modelling for the weapons (build time only,
// run by tools/build-guns.mjs). Parts are unions and cuts of machined,
// extruded and turned shapes. Every edge carries a small radius, the way real
// machined and moulded parts do, so it catches light instead of looking like
// a game-model box. Meshes come from surface nets projected onto the exact
// surface, with a material region per triangle and baked edge wear / cavity.
//
// Gun space: x right, y up, z back (the muzzle points to -z). Profiles are
// written in forward units (f = -z): side view [f, y], plan view [f, x],
// front view [x, y], lathe [radius, along-axis].

const { sqrt, abs, min, max, sin, cos, PI } = Math;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- 2D polygon distance (any number of loops; holes by even-odd) ----------
function packLoops(loops) {
  const e = [];
  for (const L of loops) for (let i = 0, j = L.length - 1; i < L.length; j = i, i++) e.push(L[i][0], L[i][1], L[j][0], L[j][1]);
  return Float64Array.from(e);
}
function polyDist(px, py, E) {
  let d = 1e20, s = 1;
  for (let k = 0; k < E.length; k += 4) {
    const vix = E[k], viy = E[k + 1], vjx = E[k + 2], vjy = E[k + 3];
    const ex = vjx - vix, ey = vjy - viy, wx = px - vix, wy = py - viy;
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey || 1e-30), 0, 1);
    const bx = wx - ex * t, by = wy - ey * t, dd = bx * bx + by * by;
    if (dd < d) d = dd;
    const c1 = py >= viy, c2 = py < vjy, c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * sqrt(d);
}
function loopsBounds(loops) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const L of loops) for (const [x, y] of L) { a = min(a, x); b = min(b, y); c = max(c, x); d = max(d, y); }
  return [a, b, c, d];
}
/** Rounded combination of a 2D distance and a slab (extrusion with edge radius r). */
function extrudeD(d2, w, r) {
  const a = d2 + r, b = w + r;
  const ox = a > 0 ? a : 0, oy = b > 0 ? b : 0;
  return min(max(a, b), 0) + sqrt(ox * ox + oy * oy) - r;
}

// ---------- 2D helpers for building profiles ----------
/** Arc points around (cx, cy) from angle a0 to a1 (radians), n segments. */
export function arc(cx, cy, r, a0, a1, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + cos(a) * r, cy + sin(a) * r]); }
  return out;
}
/** Rounded rectangle loop centred at (cx, cy), size w x h, corner radius r. */
export function rrect(cx, cy, w, h, r, n = 6) {
  const x0 = cx - w / 2 + r, x1 = cx + w / 2 - r, y0 = cy - h / 2 + r, y1 = cy + h / 2 - r;
  return [...arc(x1, y0, r, -PI / 2, 0, n), ...arc(x1, y1, r, 0, PI / 2, n), ...arc(x0, y1, r, PI / 2, PI, n), ...arc(x0, y0, r, PI, PI * 1.5, n)];
}
/** Circle loop. */
export function circle(cx, cy, r, n = 32) { return arc(cx, cy, r, 0, PI * 2 * (1 - 1 / n), n - 1); }
/** Regular polygon with rounded corners (e.g. octagonal handguards, hex nuts). */
export function ngon(cx, cy, R, n, rc, rot = 0) {
  const out = [];
  const inner = R - rc / cos(PI / n);
  for (let i = 0; i < n; i++) {
    const a = rot + i * 2 * PI / n;
    out.push(...arc(cx + cos(a) * inner, cy + sin(a) * inner, rc, a - PI / n, a + PI / n, 3));
  }
  return out;
}
/** Reverses a loop (for holes written in the same winding). */
export const rev = (L) => L.slice().reverse();
/**
 * Rounds every corner of a closed loop with an arc fillet (convex and
 * concave alike). r: one radius or one per vertex; radii shrink to fit.
 */
export function fillet(loop, r = 0.0005, n = 4) {
  const out = [], N = loop.length;
  for (let i = 0; i < N; i++) {
    const P = loop[i], A = loop[(i + N - 1) % N], B = loop[(i + 1) % N];
    let rad = Array.isArray(r) ? r[i] : r;
    const ux = A[0] - P[0], uy = A[1] - P[1], wx = B[0] - P[0], wy = B[1] - P[1];
    const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
    if (!rad || lu < 1e-9 || lw < 1e-9) { out.push(P); continue; }
    const cu = [ux / lu, uy / lu], cw = [wx / lw, wy / lw];
    const th = Math.acos(clamp(cu[0] * cw[0] + cu[1] * cw[1], -1, 1));
    if (th < 1e-3 || th > PI - 1e-3) { out.push(P); continue; }
    let t = rad / Math.tan(th / 2);
    const tmax = min(lu, lw) * 0.5;
    if (t > tmax) { t = tmax; rad = t * Math.tan(th / 2); }
    const T1 = [P[0] + cu[0] * t, P[1] + cu[1] * t], T2 = [P[0] + cw[0] * t, P[1] + cw[1] * t];
    const bx = cu[0] + cw[0], by = cu[1] + cw[1], bl = Math.hypot(bx, by);
    const dC = rad / sin(th / 2), C = [P[0] + bx / bl * dC, P[1] + by / bl * dC];
    let a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]), a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    let da = a2 - a1;
    while (da > PI) da -= 2 * PI;
    while (da < -PI) da += 2 * PI;
    for (let k = 0; k <= n; k++) { const a = a1 + da * k / n; out.push([C[0] + cos(a) * rad, C[1] + sin(a) * rad]); }
  }
  return out;
}

// ---------- 3D primitives: each returns { fn(x, y, z), bb: [x0, y0, z0, x1, y1, z1] } ----------
/** Side-view profile [f, y] extruded across x from x0 to x1, edge radius r. */
export function extrudeX(loops, x0, x1, r = 0.0004) {
  if (typeof loops[0][0] === 'number') loops = [loops];
  const E = packLoops(loops), [f0, y0, f1, y1] = loopsBounds(loops);
  const xc = (x0 + x1) / 2, hw = (x1 - x0) / 2;
  return { fn: (x, y, z) => extrudeD(polyDist(-z, y, E), abs(x - xc) - hw, r), bb: [x0, y0, -f1, x1, y1, -f0] };
}
/** Plan-view profile [f, x] extruded vertically from y0 to y1. */
export function extrudeY(loops, y0, y1, r = 0.0004) {
  if (typeof loops[0][0] === 'number') loops = [loops];
  const E = packLoops(loops), [f0, x0, f1, x1] = loopsBounds(loops);
  const yc = (y0 + y1) / 2, hh = (y1 - y0) / 2;
  return { fn: (x, y, z) => extrudeD(polyDist(-z, x, E), abs(y - yc) - hh, r), bb: [x0, y0, -f1, x1, y1, -f0] };
}
/** Front-view profile [x, y] extruded along the bore from f0 to f1. */
export function extrudeZ(loops, f0, f1, r = 0.0004) {
  if (typeof loops[0][0] === 'number') loops = [loops];
  const E = packLoops(loops), [x0, y0, x1, y1] = loopsBounds(loops);
  const fc = (f0 + f1) / 2, hl = (f1 - f0) / 2;
  return { fn: (x, y, z) => extrudeD(polyDist(x, y, E), abs(-z - fc) - hl, r), bb: [x0, y0, -f1, x1, y1, -f0] };
}
/**
 * Turned part: profile [radius, along] revolved about an axis. axis 'z' runs
 * along the bore through (x, y) = c (profile 'along' is forward f); 'y' is
 * vertical through (x, f) = c; 'x' is lateral through (y, f) = c.
 */
export function lathe(profile, axis = 'z', c = [0, 0]) {
  const E = packLoops([profile]);
  let R = 0, a0 = Infinity, a1 = -Infinity;
  for (const [rr, a] of profile) { R = max(R, rr); a0 = min(a0, a); a1 = max(a1, a); }
  if (axis === 'z') {
    const [cx, cy] = c;
    return { fn: (x, y, z) => polyDist(sqrt((x - cx) ** 2 + (y - cy) ** 2), -z, E), bb: [cx - R, cy - R, -a1, cx + R, cy + R, -a0] };
  }
  if (axis === 'y') {
    const [cx, cf] = c;
    return { fn: (x, y, z) => polyDist(sqrt((x - cx) ** 2 + (-z - cf) ** 2), y, E), bb: [cx - R, a0, -cf - R, cx + R, a1, -cf + R] };
  }
  const [cy, cf] = c;
  return { fn: (x, y, z) => polyDist(sqrt((y - cy) ** 2 + (-z - cf) ** 2), x, E), bb: [a0, cy - R, -cf - R, a1, cy + R, -cf + R] };
}

// rotation helpers: rot = [rx, ry, rz] Euler XYZ (radians), applied as inverse to the query point
function rotMat(rx, ry, rz) {
  const a = cos(rx), b = sin(rx), c = cos(ry), d = sin(ry), e = cos(rz), f = sin(rz);
  // R = Rx * Ry * Rz (three.js 'XYZ'); rows of R
  return [c * e, -c * f, d, a * f + b * e * d, a * e - b * f * d, -b * c, b * f - a * e * d, b * e + a * f * d, a * c];
}
function rotatedBB(bb, R, cx, cy, cz) {
  let o = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const x = (i & 1 ? bb[3] : bb[0]) - cx, y = (i & 2 ? bb[4] : bb[1]) - cy, z = (i & 4 ? bb[5] : bb[2]) - cz;
    const X = R[0] * x + R[1] * y + R[2] * z + cx, Y = R[3] * x + R[4] * y + R[5] * z + cy, Z = R[6] * x + R[7] * y + R[8] * z + cz;
    o = [min(o[0], X), min(o[1], Y), min(o[2], Z), max(o[3], X), max(o[4], Y), max(o[5], Z)];
  }
  return o;
}
/** Rotates a primitive about the point (x, y, f) = pivot. */
export function rotate(p, rot, pivot) {
  const R = rotMat(...rot), cx = pivot[0], cy = pivot[1], cz = -pivot[2];
  return {
    fn: (x, y, z) => {
      const dx = x - cx, dy = y - cy, dz = z - cz; // inverse rotation = transpose
      return p.fn(R[0] * dx + R[3] * dy + R[6] * dz + cx, R[1] * dx + R[4] * dy + R[7] * dz + cy, R[2] * dx + R[5] * dy + R[8] * dz + cz);
    },
    bb: rotatedBB(p.bb, R, cx, cy, cz),
  };
}
/** Moves a primitive by (dx, dy, df). */
export function move(p, [dx, dy, df]) {
  const dz = -df;
  return { fn: (x, y, z) => p.fn(x - dx, y - dy, z - dz), bb: [p.bb[0] + dx, p.bb[1] + dy, p.bb[2] + dz, p.bb[3] + dx, p.bb[4] + dy, p.bb[5] + dz] };
}
/** Mirrors a primitive across x = 0. */
export function mirrorX(p) { return { fn: (x, y, z) => p.fn(-x, y, z), bb: [-p.bb[3], p.bb[1], p.bb[2], -p.bb[0], p.bb[4], p.bb[5]] }; }

/** Rounded box centred at (x, y, f) with half sizes (hx, hy, hf), edge radius r, optional rotation. */
export function box(c, h, r = 0.0004, rot = null) {
  const [cx, cy, cf] = c, cz = -cf, [hx, hy, hz] = h;
  const p = {
    fn: (x, y, z) => {
      const qx = abs(x - cx) - hx + r, qy = abs(y - cy) - hy + r, qz = abs(z - cz) - hz + r;
      const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
      return sqrt(ox * ox + oy * oy + oz * oz) + min(max(qx, qy, qz), 0) - r;
    },
    bb: [cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz],
  };
  return rot ? rotate(p, rot, c) : p;
}
/** Cylinder along axis 'x' | 'y' | 'z' centred at (x, y, f), radius, half length, edge radius e. */
export function cyl(axis, c, radius, half, e = 0.0003) {
  const [cx, cy, cf] = c, cz = -cf;
  const f = (a, b, l) => {
    const dx = sqrt(a * a + b * b) - radius + e, dy = abs(l) - half + e;
    const ox = dx > 0 ? dx : 0, oy = dy > 0 ? dy : 0;
    return min(max(dx, dy), 0) + sqrt(ox * ox + oy * oy) - e;
  };
  if (axis === 'z') return { fn: (x, y, z) => f(x - cx, y - cy, z - cz), bb: [cx - radius, cy - radius, cz - half, cx + radius, cy + radius, cz + half] };
  if (axis === 'y') return { fn: (x, y, z) => f(x - cx, z - cz, y - cy), bb: [cx - radius, cy - half, cz - radius, cx + radius, cy + half, cz + radius] };
  return { fn: (x, y, z) => f(y - cy, z - cz, x - cx), bb: [cx - half, cy - radius, cz - radius, cx + half, cy + radius, cz + radius] };
}
export function sphere(c, r) {
  const [cx, cy, cf] = c, cz = -cf;
  return { fn: (x, y, z) => sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - r, bb: [cx - r, cy - r, cz - r, cx + r, cy + r, cz + r] };
}
/** Capsule between points a and b (each [x, y, f]) with radii ra, rb. */
export function capsule(a, b, ra, rb = ra) {
  const ax = a[0], ay = a[1], az = -a[2], bx = b[0] - ax, by = b[1] - ay, bz = -b[2] - az, L2 = bx * bx + by * by + bz * bz;
  const R = max(ra, rb);
  return {
    fn: (x, y, z) => {
      const px = x - ax, py = y - ay, pz = z - az;
      const t = clamp((px * bx + py * by + pz * bz) / L2, 0, 1);
      return sqrt((px - bx * t) ** 2 + (py - by * t) ** 2 + (pz - bz * t) ** 2) - (ra + (rb - ra) * t);
    },
    bb: [min(ax, ax + bx) - R, min(ay, ay + by) - R, min(az, az + bz) - R, max(ax, ax + bx) + R, max(ay, ay + by) + R, max(az, az + bz) + R],
  };
}
/**
 * Stadium-shaped cut (slot) on a surface: centre (x, y, f), long axis u and
 * surface normal n (unit vectors in gun space, [x, y, f]), length, width,
 * depth below the surface point (and 'above' clearance outward).
 */
export function slot(c, u, n, length, width, depth, above = 0.02) {
  const cx = c[0], cy = c[1], cz = -c[2];
  const U = [u[0], u[1], -u[2]], N = [n[0], n[1], -n[2]];
  const V = [U[1] * N[2] - U[2] * N[1], U[2] * N[0] - U[0] * N[2], U[0] * N[1] - U[1] * N[0]];
  const hl = max(0, length / 2 - width / 2), rr = width / 2, mid = (above - depth) / 2, hd = (above + depth) / 2;
  const ext = length / 2 + above + depth;
  return {
    fn: (x, y, z) => {
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const pu = dx * U[0] + dy * U[1] + dz * U[2], pv = dx * V[0] + dy * V[1] + dz * V[2], pn = dx * N[0] + dy * N[1] + dz * N[2];
      const d2 = sqrt(max(abs(pu) - hl, 0) ** 2 + pv * pv) - rr;
      const w = abs(pn - mid) - hd;
      const ox = d2 > 0 ? d2 : 0, oy = w > 0 ? w : 0;
      return min(max(d2, w), 0) + sqrt(ox * ox + oy * oy);
    },
    bb: [cx - ext, cy - ext, cz - ext, cx + ext, cy + ext, cz + ext],
  };
}
/** Intersection helper: keeps only the part of p inside q (edge blended over k). */
export function intersect(p, q, k = 0) {
  return { fn: k > 0 ? (x, y, z) => -sminK(-p.fn(x, y, z), -q.fn(x, y, z), k) : (x, y, z) => max(p.fn(x, y, z), q.fn(x, y, z)), bb: [max(p.bb[0], q.bb[0]), max(p.bb[1], q.bb[1]), max(p.bb[2], q.bb[2]), min(p.bb[3], q.bb[3]), min(p.bb[4], q.bb[4]), min(p.bb[5], q.bb[5])] };
}

// ---------- parts ----------
function sminK(a, b, k) { const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; }
const smin = (a, b, k) => { if (k <= 0) return a < b ? a : b; const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function bbDist(bb, x, y, z) {
  const dx = max(bb[0] - x, 0, x - bb[3]), dy = max(bb[1] - y, 0, y - bb[4]), dz = max(bb[2] - z, 0, z - bb[5]);
  return sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * One rigid part (a mesh). anim: the animated group it belongs to at runtime
 * ('body', 'charge', 'bcg', 'dust', 'slide', 'mag', 'bolt', 'supp', ...).
 * pivot: [x, y, f] the group rotates about (geometry is stored relative to it).
 */
export class Part {
  constructor(name, opts = {}) {
    this.name = name; this.ops = [];
    this.anim = opts.anim || 'body'; this.pivot = opts.pivot || null;
    this.cell = opts.cell || 0.0003; this.tris = opts.tris || 20000;
    this.error = opts.error ?? 0.00008; // simplification error, metres
    this.material = opts.material || 'gun';
    this.lod = opts.lod ?? true;        // included in the enemies' low-detail copy
  }
  add(p, region, k = 0) { this.ops.push({ fn: p.fn, bb: p.bb, region, k, sub: false }); return this; }
  sub(p, k = 0) { this.ops.push({ fn: p.fn, bb: p.bb, k, sub: true }); return this; }
  /** Cuts with a region change instead of removing material (e.g. a painted band). */
  paint(p, region) { this.ops.push({ fn: p.fn, bb: p.bb, region, paint: true }); return this; }

  eval(x, y, z) {
    let d = 1e9;
    const ops = this.ops;
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      if (o.paint) continue;
      const bd = bbDist(o.bb, x, y, z);
      if (o.sub) {
        if (bd >= o.k - d) continue;
        d = smax(d, -o.fn(x, y, z), o.k);
      } else {
        if (bd >= d + o.k) continue;
        d = smin(d, o.fn(x, y, z), o.k);
      }
    }
    return d;
  }
  region(x, y, z) {
    let best = 1e9, r = 0;
    for (const o of this.ops) {
      if (o.sub || o.paint) continue;
      if (bbDist(o.bb, x, y, z) > best) continue;
      const v = o.fn(x, y, z);
      if (v < best) { best = v; r = o.region; }
    }
    for (const o of this.ops) if (o.paint && bbDist(o.bb, x, y, z) < 0.0015 && o.fn(x, y, z) < 0) r = o.region;
    return r;
  }
  bounds() {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const o of this.ops) if (!o.sub && !o.paint) for (let i = 0; i < 3; i++) { b[i] = min(b[i], o.bb[i]); b[i + 3] = max(b[i + 3], o.bb[i + 3]); }
    const m = this.cell * 3;
    return [b[0] - m, b[1] - m, b[2] - m, b[3] + m, b[4] + m, b[5] + m];
  }
  normal(x, y, z, h = this.cell * 0.35) {
    const gx = this.eval(x + h, y, z) - this.eval(x - h, y, z);
    const gy = this.eval(x, y + h, z) - this.eval(x, y - h, z);
    const gz = this.eval(x, y, z + h) - this.eval(x, y, z - h);
    const l = sqrt(gx * gx + gy * gy + gz * gz) || 1;
    return [gx / l, gy / l, gz / l];
  }

  /**
   * Surface nets over the part's bounds. Returns raw arrays: positions
   * projected onto the surface, SDF normals, and a region per vertex with
   * vertices split wherever neighbouring triangles have different regions.
   */
  mesh() {
    const cell = this.cell, [X0, Y0, Z0, X1, Y1, Z1] = this.bounds();
    const nx = Math.ceil((X1 - X0) / cell) + 1, ny = Math.ceil((Y1 - Y0) / cell) + 1, nz = Math.ceil((Z1 - Z0) / cell) + 1;
    const F = new Float32Array(nx * ny * nz);
    // coarse blocks: evaluate exactly only where the surface can pass
    const B = 4, reach = cell * B * 1.75;
    const cnx = Math.ceil(nx / B) + 1, cny = Math.ceil(ny / B) + 1, cnz = Math.ceil(nz / B) + 1;
    const C = new Float32Array(cnx * cny * cnz);
    for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
      C[(k * cny + j) * cnx + i] = this.eval(X0 + i * B * cell, Y0 + j * B * cell, Z0 + k * B * cell);
    }
    for (let ck = 0; ck < cnz - 1; ck++) for (let cj = 0; cj < cny - 1; cj++) for (let ci = 0; ci < cnx - 1; ci++) {
      let near = false, allIn = true, v0 = 0;
      for (let q = 0; q < 8; q++) {
        const v = C[((ck + (q >> 2 & 1)) * cny + cj + (q >> 1 & 1)) * cnx + ci + (q & 1)];
        if (q === 0) v0 = v;
        if (abs(v) < reach) near = true;
        if (v >= 0) allIn = false;
      }
      const kk = min(nz, (ck + 1) * B + 1), jj = min(ny, (cj + 1) * B + 1), ii = min(nx, (ci + 1) * B + 1);
      for (let k = ck * B; k < kk; k++) for (let j = cj * B; j < jj; j++) for (let i = ci * B; i < ii; i++) {
        const idx = (k * ny + j) * nx + i;
        F[idx] = near ? this.eval(X0 + i * cell, Y0 + j * cell, Z0 + k * cell) : (allIn ? -reach : v0);
      }
    }
    // one vertex per sign-changing cell
    const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const pos = [];
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const cv = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      let mask = 0;
      for (let q = 0; q < 8; q++) { const v = F[((k + (q >> 2 & 1)) * ny + j + (q >> 1 & 1)) * nx + i + (q & 1)]; cv[q] = v; if (v < 0) mask |= 1 << q; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of E) {
        const va = cv[a], vb = cv[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += (a >> 1 & 1) + ((b >> 1 & 1) - (a >> 1 & 1)) * t; sz += (a >> 2 & 1) + ((b >> 2 & 1) - (a >> 2 & 1)) * t;
        n++;
      }
      vid[(k * (ny - 1) + j) * (nx - 1) + i] = pos.length / 3;
      pos.push(X0 + (i + sx / n) * cell, Y0 + (j + sy / n) * cell, Z0 + (k + sz / n) * cell);
    }
    const idx = [];
    const V = (i, j, k) => vid[(k * (ny - 1) + j) * (nx - 1) + i];
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const f0 = F[(k * ny + j) * nx + i] < 0;
      const quad = (a, b, c, d, flip) => {
        if (a < 0 || b < 0 || c < 0 || d < 0) return;
        if (flip) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
      };
      if (f0 !== (F[(k * ny + j) * nx + i + 1] < 0)) quad(V(i, j - 1, k - 1), V(i, j, k - 1), V(i, j, k), V(i, j - 1, k), f0);
      if (f0 !== (F[(k * ny + j + 1) * nx + i] < 0)) quad(V(i - 1, j, k - 1), V(i - 1, j, k), V(i, j, k), V(i, j, k - 1), f0);
      if (f0 !== (F[((k + 1) * ny + j) * nx + i] < 0)) quad(V(i - 1, j - 1, k), V(i, j - 1, k), V(i, j, k), V(i - 1, j, k), f0);
    }
    // project vertices onto the exact surface (two Newton steps)
    const P = Float64Array.from(pos), count = P.length / 3;
    for (let v = 0; v < count; v++) {
      for (let it = 0; it < 2; it++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        const d = this.eval(x, y, z);
        if (abs(d) < 1e-7) break;
        const n = this.normal(x, y, z);
        const s = clamp(d, -cell, cell);
        P[v * 3] -= n[0] * s; P[v * 3 + 1] -= n[1] * s; P[v * 3 + 2] -= n[2] * s;
      }
    }
    // region per triangle (at the centroid), vertices split between regions
    const triReg = new Uint8Array(idx.length / 3);
    for (let t = 0; t < triReg.length; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      triReg[t] = this.region((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3);
    }
    const split = new Map(), outPos = [], outReg = [], outIdx = new Uint32Array(idx.length);
    for (let t = 0; t < triReg.length; t++) for (let e = 0; e < 3; e++) {
      const v = idx[t * 3 + e], key = v * 256 + triReg[t];
      let nv = split.get(key);
      if (nv === undefined) { nv = outReg.length; split.set(key, nv); outPos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); outReg.push(triReg[t]); }
      outIdx[t * 3 + e] = nv;
    }
    const pos32 = Float32Array.from(outPos), nor = new Float32Array(pos32.length);
    for (let v = 0; v < outReg.length; v++) {
      const n = this.normal(pos32[v * 3], pos32[v * 3 + 1], pos32[v * 3 + 2]);
      nor[v * 3] = n[0]; nor[v * 3 + 1] = n[1]; nor[v * 3 + 2] = n[2];
    }
    return { pos: pos32, nor, reg: Uint8Array.from(outReg), idx: outIdx };
  }

  /**
   * Edge wear and cavity per vertex from the distance field: the mean
   * distance over a small sphere is positive on convex edges (worn bright by
   * handling) and negative in corners and grooves (where dust and oil collect).
   */
  wear(pos, nor) {
    const n = pos.length / 3, out = new Uint8Array(n * 2);
    const dirs = [];
    for (let i = 0; i < 14; i++) {
      const y = 1 - (i + 0.5) / 7, r = sqrt(max(0, 1 - y * y)), a = i * 2.39996;
      dirs.push([cos(a) * r, y, sin(a) * r]);
    }
    for (let v = 0; v < n; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      let e1 = 0, e2 = 0;
      for (const [dx, dy, dz] of dirs) {
        e1 += this.eval(x + dx * 0.0007, y + dy * 0.0007, z + dz * 0.0007);
        e2 += this.eval(x + dx * 0.0022, y + dy * 0.0022, z + dz * 0.0022);
      }
      e1 /= dirs.length * 0.0007; e2 /= dirs.length * 0.0022;
      const edge = clamp(e1 * 1.6 + e2 * 0.6, 0, 1);
      // cavity: how closed in the surface is along its normal, plus concave curvature
      let occ = 0;
      const nx_ = nor[v * 3], ny_ = nor[v * 3 + 1], nz_ = nor[v * 3 + 2];
      for (let k = 1; k <= 4; k++) {
        const h = k * 0.0016;
        occ += max(0, h - this.eval(x + nx_ * h, y + ny_ * h, z + nz_ * h)) / h / k;
      }
      out[v * 2] = Math.round(edge * 255);
      out[v * 2 + 1] = Math.round(clamp(occ * 0.9 + max(-e2, 0) * 0.8, 0, 1) * 255);
    }
    return out;
  }
}
