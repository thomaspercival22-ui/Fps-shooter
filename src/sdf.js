// Signed-distance modelling: organic shapes (bodies, gloves, clothing, polymer
// gun parts) are built from primitives blended with smooth unions, then
// meshed with surface nets. Every vertex carries a "region" id (the nearest
// primitive's material), used by the fabric shader for colours and textures.
import * as THREE from 'three';

// ---------- primitives (all take a point in the primitive's local frame) ----------
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
export const P = {
  sphere: (r) => (x, y, z) => len3(x, y, z) - r,
  ellipsoid: (a, b, c) => (x, y, z) => {
    const k0 = len3(x / a, y / b, z / c), k1 = len3(x / (a * a), y / (b * b), z / (c * c));
    return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(a, b, c);
  },
  /** Rounded box with half extents hx, hy, hz and edge radius r. */
  box: (hx, hy, hz, r = 0) => (x, y, z) => {
    const qx = Math.abs(x) - hx + r, qy = Math.abs(y) - hy + r, qz = Math.abs(z) - hz + r;
    return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
  },
  /** Capsule along +y from 0 to h, radius r0 at the bottom, r1 at the top (cone-sphere). */
  capsule: (h, r0, r1 = r0) => (x, y, z) => {
    const t = Math.max(0, Math.min(1, y / h));
    const r = r0 + (r1 - r0) * t;
    return len3(x, y - t * h, z) - r;
  },
  /** Capped cylinder along y (centred), radius r, half height h, edge rounding e. */
  cylinder: (r, h, e = 0) => (x, y, z) => {
    const dx = Math.sqrt(x * x + z * z) - r + e, dy = Math.abs(y) - h + e;
    return Math.min(Math.max(dx, dy), 0) + Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2) - e;
  },
  /** Torus in the xz plane. */
  torus: (R, r) => (x, y, z) => Math.sqrt((Math.sqrt(x * x + z * z) - R) ** 2 + y * y) - r,
};

/** Segment capsule between two world points with radii ra, rb. */
export function segment(a, b, ra, rb = ra) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const L2 = bx * bx + by * by + bz * bz;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / L2));
    return len3(px - bx * t, py - by * t, pz - bz * t) - (ra + (rb - ra) * t);
  };
}

/** Moves a primitive: position, Euler rotation (radians) and optional non-uniform scale. */
export function place(fn, pos = [0, 0, 0], rot = [0, 0, 0], scale = null) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)).invert();
  const e = m.elements;
  const s = scale ? Math.min(...scale) : 1;
  return (x, y, z) => {
    let lx = e[0] * x + e[4] * y + e[8] * z + e[12];
    let ly = e[1] * x + e[5] * y + e[9] * z + e[13];
    let lz = e[2] * x + e[6] * y + e[10] * z + e[14];
    if (scale) { lx /= scale[0]; ly /= scale[1]; lz /= scale[2]; }
    return fn(lx, ly, lz) * s;
  };
}

/** Places a primitive in an orthonormal frame given by origin o and axes X, Y, Z (THREE.Vector3). */
export function oriented(fn, o, X, Y, Z) {
  return (x, y, z) => {
    const dx = x - o.x, dy = y - o.y, dz = z - o.z;
    return fn(dx * X.x + dy * X.y + dz * X.z, dx * Y.x + dy * Y.y + dz * Y.z, dx * Z.x + dy * Z.y + dz * Z.z);
  };
}

const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

// cheap 3D value noise for cloth wrinkles and surface irregularity
function hash3(x, y, z) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

/**
 * A model is an ordered list of operations. union/sub use a smoothing radius
 * k (metres). Regions come from union operations.
 */
export class SDFModel {
  constructor() { this.ops = []; this.displace = null; }
  add(fn, region = 0, k = 0) { this.ops.push({ fn, region, k, sub: false }); return this; }
  sub(fn, k = 0) { this.ops.push({ fn, k, sub: true }); return this; }
  /** Groove / seam: subtracts, but only as a shallow carve. */
  eval(x, y, z) {
    let d = 1e9;
    for (const o of this.ops) {
      const v = o.fn(x, y, z);
      d = o.sub ? smax(d, -v, o.k) : smin(d, v, o.k);
    }
    if (this.displace) d += this.displace(x, y, z);
    return d;
  }
  region(x, y, z) {
    let best = 1e9, r = 0;
    for (const o of this.ops) {
      if (o.sub) continue;
      const v = o.fn(x, y, z);
      if (v < best) { best = v; r = o.region; }
    }
    return r;
  }

  /**
   * Surface-nets mesh inside the box [min, max] with the given cell size.
   * A coarse pre-pass skips blocks far from the surface.
   */
  mesh(min, max, cell) {
    const nx = Math.ceil((max[0] - min[0]) / cell) + 1, ny = Math.ceil((max[1] - min[1]) / cell) + 1, nz = Math.ceil((max[2] - min[2]) / cell) + 1;
    const F = new Float32Array(nx * ny * nz);
    const B = 4, bd = cell * B * 1.8;
    const cnx = Math.ceil(nx / B) + 1, cny = Math.ceil(ny / B) + 1, cnz = Math.ceil(nz / B) + 1;
    const C = new Float32Array(cnx * cny * cnz);
    for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
      C[(k * cny + j) * cnx + i] = this.eval(min[0] + i * B * cell, min[1] + j * B * cell, min[2] + k * B * cell);
    }
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      // coarse block corners: if the surface cannot pass near, skip the exact evaluation
      const ci = Math.floor(i / B), cj = Math.floor(j / B), ck = Math.floor(k / B);
      const c0 = C[(ck * cny + cj) * cnx + ci];
      let far = Math.abs(c0) > bd;
      if (far) {
        for (let q = 1; q < 8 && far; q++) {
          const v = C[((ck + (q >> 2 & 1)) * cny + cj + (q >> 1 & 1)) * cnx + ci + (q & 1)];
          if (v === undefined || Math.sign(v) !== Math.sign(c0) || Math.abs(v) < bd) far = false;
        }
      }
      F[(k * ny + j) * nx + i] = far ? c0 : this.eval(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
    }
    // one vertex per cell that the surface crosses (average of edge crossings)
    const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const pos = [];
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const cv = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      let mask = 0;
      for (let q = 0; q < 8; q++) {
        const v = F[((k + (q >> 2 & 1)) * ny + j + (q >> 1 & 1)) * nx + i + (q & 1)];
        cv[q] = v; if (v < 0) mask |= 1 << q;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of E) {
        const va = cv[a], vb = cv[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += (a & 1) + ((b & 1) - (a & 1)) * t;
        sy += (a >> 1 & 1) + ((b >> 1 & 1) - (a >> 1 & 1)) * t;
        sz += (a >> 2 & 1) + ((b >> 2 & 1) - (a >> 2 & 1)) * t;
        n++;
      }
      vid[(k * (ny - 1) + j) * (nx - 1) + i] = pos.length / 3;
      pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
    }
    // quads across every grid edge with a sign change
    const idx = [];
    const V = (i, j, k) => vid[(k * (ny - 1) + j) * (nx - 1) + i];
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const f0 = F[(k * ny + j) * nx + i] < 0;
      const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); };
      if (f0 !== (F[(k * ny + j) * nx + i + 1] < 0)) quad(V(i, j - 1, k - 1), V(i, j, k - 1), V(i, j, k), V(i, j - 1, k), f0);
      if (f0 !== (F[(k * ny + j + 1) * nx + i] < 0)) quad(V(i - 1, j, k - 1), V(i - 1, j, k), V(i, j, k), V(i, j, k - 1), f0);
      if (f0 !== (F[((k + 1) * ny + j) * nx + i] < 0)) quad(V(i - 1, j - 1, k), V(i, j - 1, k), V(i, j, k), V(i - 1, j, k), f0);
    }
    // gradient normals and regions
    const count = pos.length / 3, nor = new Float32Array(count * 3), reg = new Float32Array(count), h = cell * 0.5;
    for (let v = 0; v < count; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      let gx = this.eval(x + h, y, z) - this.eval(x - h, y, z), gy = this.eval(x, y + h, z) - this.eval(x, y - h, z), gz = this.eval(x, y, z + h) - this.eval(x, y, z - h);
      const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      nor[v * 3] = gx / l; nor[v * 3 + 1] = gy / l; nor[v * 3 + 2] = gz / l;
      reg[v] = this.region(x, y, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('region', new THREE.BufferAttribute(reg, 1));
    g.setIndex(idx);
    return g;
  }
}

/** Mirrors a geometry across X (for left hands) keeping the winding outward. */
export function mirrorX(g) {
  const m = g.clone();
  const p = m.attributes.position, n = m.attributes.normal;
  for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); n.setX(i, -n.getX(i)); }
  const ix = m.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  return m;
}
