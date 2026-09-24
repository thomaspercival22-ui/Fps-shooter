// Static collision world made of axis-aligned boxes, with a uniform XZ grid
// for fast ray casts and region queries. Everything in the level that blocks
// movement, bullets or sight is a box here.

export const RAY_ALL = 0;      // movement / grenades: everything
export const RAY_BULLET = 1;   // bullets: skips boxes with blocksBullets=false
export const RAY_SIGHT = 2;    // line of sight: skips boxes with blocksSight=false

const BIG = 1e30;

export class CollisionWorld {
  constructor(minX = -80, minZ = -80, maxX = 80, maxZ = 80, cellSize = 4) {
    this.boxes = [];
    this.minX = minX; this.minZ = minZ; this.maxX = maxX; this.maxZ = maxZ;
    this.cell = cellSize;
    this.nx = Math.ceil((maxX - minX) / cellSize);
    this.nz = Math.ceil((maxZ - minZ) / cellSize);
    this.grid = null;
    this.stampId = 1;
    this.hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, box: null, exitT: 0 };
    this._q = [];
  }

  /** Adds a box. props: { mat, pen (bullet penetration resistance per metre, 0 = none), blocksBullets, blocksSight, tag } */
  add(x0, y0, z0, x1, y1, z1, props = {}) {
    const b = {
      x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1),
      x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1),
      mat: props.mat || 'concrete',
      pen: props.pen ?? 0,
      blocksBullets: props.blocksBullets ?? true,
      blocksSight: props.blocksSight ?? true,
      tag: props.tag || null,
      id: this.boxes.length, stamp: 0,
    };
    this.boxes.push(b);
    return b;
  }

  build() {
    this.grid = new Array(this.nx * this.nz);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = [];
    for (const b of this.boxes) this._insert(b);
  }

  _insert(b) {
    const c0x = this._cx(b.x0), c1x = this._cx(b.x1);
    const c0z = this._cz(b.z0), c1z = this._cz(b.z1);
    for (let z = c0z; z <= c1z; z++) for (let x = c0x; x <= c1x; x++) this.grid[z * this.nx + x].push(b);
  }

  /** Add a box after build() (e.g. dynamic props). */
  addDynamic(...args) { const b = this.add(...args); if (this.grid) this._insert(b); return b; }

  _cx(x) { return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cell))); }
  _cz(z) { return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.minZ) / this.cell))); }

  /** Returns boxes overlapping the XZ rectangle (array is reused between calls). */
  query(x0, z0, x1, z1) {
    const out = this._q; out.length = 0;
    const s = ++this.stampId;
    const c0x = this._cx(x0), c1x = this._cx(x1), c0z = this._cz(z0), c1z = this._cz(z1);
    for (let z = c0z; z <= c1z; z++) for (let x = c0x; x <= c1x; x++) {
      const cell = this.grid[z * this.nx + x];
      for (let i = 0; i < cell.length; i++) {
        const b = cell[i];
        if (b.stamp === s) continue;
        b.stamp = s;
        if (b.x1 < x0 || b.x0 > x1 || b.z1 < z0 || b.z0 > z1) continue;
        out.push(b);
      }
    }
    return out;
  }

  /**
   * Ray cast from (ox,oy,oz) along unit direction (dx,dy,dz). Returns this.hit (reused) or null.
   * Includes the ground plane y=0. mode: RAY_ALL | RAY_BULLET | RAY_SIGHT.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, mode = RAY_ALL, ignore = null) {
    const idx = dx !== 0 ? 1 / dx : BIG, idy = dy !== 0 ? 1 / dy : BIG, idz = dz !== 0 ? 1 / dz : BIG;
    let best = maxDist, bestBox = null, bestAxis = -1, bestExit = 0;

    // ground plane
    if (dy < 0 && oy >= 0) {
      const t = -oy * idy;
      if (t < best) { best = t; bestBox = null; bestAxis = 3; }
    }

    // Walk the XZ grid cells along the ray (2D DDA).
    const s = ++this.stampId;
    let tStart = 0;
    let px = ox, pz = oz;
    if (px < this.minX || px >= this.maxX || pz < this.minZ || pz >= this.maxZ) {
      // enter the grid bounds
      let t0 = 0, t1 = best;
      const ax = (this.minX - ox) * idx, bx = (this.maxX - ox) * idx;
      t0 = Math.max(t0, Math.min(ax, bx)); t1 = Math.min(t1, Math.max(ax, bx));
      const az = (this.minZ - oz) * idz, bz = (this.maxZ - oz) * idz;
      t0 = Math.max(t0, Math.min(az, bz)); t1 = Math.min(t1, Math.max(az, bz));
      if (t0 > t1) return this._finish(best, bestBox, bestAxis, bestExit, ox, oy, oz, dx, dy, dz, maxDist);
      tStart = t0 + 1e-4;
      px = ox + dx * tStart; pz = oz + dz * tStart;
    }
    let cx = this._cx(px), cz = this._cz(pz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const nextBX = this.minX + (cx + (dx > 0 ? 1 : 0)) * this.cell;
    const nextBZ = this.minZ + (cz + (dz > 0 ? 1 : 0)) * this.cell;
    let tMaxX = dx !== 0 ? (nextBX - ox) * idx : BIG;
    let tMaxZ = dz !== 0 ? (nextBZ - oz) * idz : BIG;
    const tDX = dx !== 0 ? Math.abs(this.cell * idx) : BIG;
    const tDZ = dz !== 0 ? Math.abs(this.cell * idz) : BIG;

    for (let iter = 0; iter < 256; iter++) {
      const cell = this.grid[cz * this.nx + cx];
      for (let i = 0; i < cell.length; i++) {
        const b = cell[i];
        if (b.stamp === s) continue;
        b.stamp = s;
        if (b === ignore) continue;
        if (mode === RAY_BULLET && !b.blocksBullets) continue;
        if (mode === RAY_SIGHT && !b.blocksSight) continue;
        // slab test
        let t1 = (b.x0 - ox) * idx, t2 = (b.x1 - ox) * idx;
        let tmin = t1 < t2 ? t1 : t2, tmax = t1 < t2 ? t2 : t1, axis = 0;
        t1 = (b.y0 - oy) * idy; t2 = (b.y1 - oy) * idy;
        let a = t1 < t2 ? t1 : t2, c = t1 < t2 ? t2 : t1;
        if (a > tmin) { tmin = a; axis = 1; }
        if (c < tmax) tmax = c;
        t1 = (b.z0 - oz) * idz; t2 = (b.z1 - oz) * idz;
        a = t1 < t2 ? t1 : t2; c = t1 < t2 ? t2 : t1;
        if (a > tmin) { tmin = a; axis = 2; }
        if (c < tmax) tmax = c;
        if (tmax < 0 || tmin > tmax) continue;
        if (tmin < 0) { // origin inside box
          if (tmin < -1e-3) continue;
          tmin = 0;
        }
        if (tmin < best) { best = tmin; bestBox = b; bestAxis = axis; bestExit = tmax; }
      }
      const tExit = Math.min(tMaxX, tMaxZ);
      if (best <= tExit || tExit > maxDist) break;
      if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDX; if (cx < 0 || cx >= this.nx) break; }
      else { cz += stepZ; tMaxZ += tDZ; if (cz < 0 || cz >= this.nz) break; }
    }
    return this._finish(best, bestBox, bestAxis, bestExit, ox, oy, oz, dx, dy, dz, maxDist);
  }

  _finish(best, box, axis, exitT, ox, oy, oz, dx, dy, dz, maxDist) {
    if (axis < 0 || best >= maxDist) return null;
    const h = this.hit;
    h.t = best; h.box = box; h.exitT = exitT;
    h.x = ox + dx * best; h.y = oy + dy * best; h.z = oz + dz * best;
    h.nx = 0; h.ny = 0; h.nz = 0;
    if (axis === 0) h.nx = dx > 0 ? -1 : 1;
    else if (axis === 1) h.ny = dy > 0 ? -1 : 1;
    else if (axis === 2) h.nz = dz > 0 ? -1 : 1;
    else h.ny = 1; // ground
    h.mat = box ? box.mat : 'sand';
    return h;
  }

  /** True if nothing blocks sight between the two points. */
  los(ax, ay, az, bx, by, bz, mode = RAY_SIGHT) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, mode) === null;
  }

  /** Highest walkable surface under a circle footprint, at or below maxY. */
  groundAt(x, z, r, maxY) {
    let g = 0;
    const boxes = this.query(x - r, z - r, x + r, z + r);
    for (const b of boxes) {
      if (b.y1 > maxY || b.y1 <= g) continue;
      const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) g = b.y1;
    }
    return g;
  }

  /**
   * Moves a vertical cylinder (feet at pos) by (mx, mz) and resolves collisions.
   * Boxes whose top is within stepHeight of the feet are treated as steps.
   */
  slide(pos, mx, mz, r, height, stepHeight) {
    // sub-step large moves so we don't tunnel through thin walls
    const dist = Math.hypot(mx, mz);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.8)));
    for (let s = 0; s < steps; s++) {
      pos.x += mx / steps; pos.z += mz / steps;
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        const boxes = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r);
        for (const b of boxes) {
          if (b.y1 <= pos.y + stepHeight || b.y0 >= pos.y + height) continue;
          const cx = Math.max(b.x0, Math.min(pos.x, b.x1)), cz = Math.max(b.z0, Math.min(pos.z, b.z1));
          let dx = pos.x - cx, dz = pos.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2), push = r - d;
            pos.x += dx / d * push; pos.z += dz / d * push;
          } else {
            // centre inside the box: push out along the shallowest axis
            const l = pos.x - b.x0, rr = b.x1 - pos.x, f = pos.z - b.z0, k = b.z1 - pos.z;
            const m = Math.min(l, rr, f, k);
            if (m === l) pos.x = b.x0 - r; else if (m === rr) pos.x = b.x1 + r;
            else if (m === f) pos.z = b.z0 - r; else pos.z = b.z1 + r;
          }
          moved = true;
        }
        if (!moved) break;
      }
    }
  }

  /** Lowest ceiling above feet+minY that overlaps the footprint (Infinity if none). */
  ceilingAt(x, z, r, fromY) {
    let c = Infinity;
    const boxes = this.query(x - r, z - r, x + r, z + r);
    for (const b of boxes) {
      if (b.y0 < fromY || b.y0 >= c) continue;
      const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) c = b.y0;
    }
    return c;
  }

  /** True if the cylinder overlaps any solid box between y0 and y1. */
  overlaps(x, z, r, y0, y1) {
    const boxes = this.query(x - r, z - r, x + r, z + r);
    for (const b of boxes) {
      if (b.y1 <= y0 || b.y0 >= y1) continue;
      const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return false;
  }

  /**
   * Bouncing sphere (grenades, shell casings, dropped mags). Moves pos by vel*dt,
   * reflects off boxes and ground. Returns impact speed (0 if no impact).
   */
  bounceSphere(pos, vel, r, dt, restitution = 0.35, friction = 0.6) {
    const steps = Math.max(1, Math.ceil(Math.hypot(vel.x, vel.y, vel.z) * dt / (r * 1.5 + 0.02)));
    const h = dt / steps;
    let impact = 0;
    for (let s = 0; s < steps; s++) {
      pos.x += vel.x * h; pos.y += vel.y * h; pos.z += vel.z * h;
      if (pos.y < r) {
        const vi = -vel.y;
        if (vi > impact) impact = vi;
        pos.y = r;
        if (vel.y < 0) vel.y = -vel.y * restitution;
        vel.x *= friction; vel.z *= friction;
      }
      const boxes = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r);
      for (const b of boxes) {
        if (pos.x + r <= b.x0 || pos.x - r >= b.x1 || pos.y + r <= b.y0 || pos.y - r >= b.y1 || pos.z + r <= b.z0 || pos.z - r >= b.z1) continue;
        // penetration along each axis, pick smallest
        const px0 = pos.x + r - b.x0, px1 = b.x1 - (pos.x - r);
        const py0 = pos.y + r - b.y0, py1 = b.y1 - (pos.y - r);
        const pz0 = pos.z + r - b.z0, pz1 = b.z1 - (pos.z - r);
        const m = Math.min(px0, px1, py0, py1, pz0, pz1);
        let vi = 0;
        if (m === py1) { pos.y = b.y1 + r; vi = -vel.y; if (vel.y < 0) vel.y = -vel.y * restitution; vel.x *= friction; vel.z *= friction; }
        else if (m === py0) { pos.y = b.y0 - r; vi = vel.y; if (vel.y > 0) vel.y = -vel.y * restitution; }
        else if (m === px0) { pos.x = b.x0 - r; vi = vel.x; if (vel.x > 0) vel.x = -vel.x * restitution; vel.z *= 0.8; }
        else if (m === px1) { pos.x = b.x1 + r; vi = -vel.x; if (vel.x < 0) vel.x = -vel.x * restitution; vel.z *= 0.8; }
        else if (m === pz0) { pos.z = b.z0 - r; vi = vel.z; if (vel.z > 0) vel.z = -vel.z * restitution; vel.x *= 0.8; }
        else { pos.z = b.z1 + r; vi = -vel.z; if (vel.z < 0) vel.z = -vel.z * restitution; vel.x *= 0.8; }
        if (vi > impact) impact = vi;
      }
    }
    return impact;
  }
}

// ---- small geometry helpers used by hit detection ----

/** Ray (unit dir) vs sphere. Returns distance or -1. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  const thc = Math.sqrt(r * r - d2);
  const t = tca - thc;
  if (t >= 0) return t;
  return tca + thc >= 0 ? 0 : -1;
}

/** Ray (unit dir) vs capsule segment a-b radius r. Returns distance or -1. */
export function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  // Closest approach between ray and segment, then sphere test at that point.
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const wx = ox - ax, wy = oy - ay, wz = oz - az;
  const a = 1, b = dx * ux + dy * uy + dz * uz, c = ux * ux + uy * uy + uz * uz;
  const d = dx * wx + dy * wy + dz * wz, e = ux * wx + uy * wy + uz * wz;
  const den = a * c - b * b;
  // parameter of the closest point on the segment
  let tc;
  if (den < 1e-8) tc = c > 0 ? e / c : 0;
  else tc = (a * e - b * d) / den;
  tc = Math.max(0, Math.min(1, tc));
  const px = ax + ux * tc, py = ay + uy * tc, pz = az + uz * tc;
  return raySphere(ox, oy, oz, dx, dy, dz, px, py, pz, r);
}

/** Closest distance between point p and the segment a->b. */
export function pointSegDist(px, py, pz, ax, ay, az, bx, by, bz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const l2 = ux * ux + uy * uy + uz * uz;
  let t = l2 > 0 ? ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + ux * t), py - (ay + uy * t), pz - (az + uz * t));
}
