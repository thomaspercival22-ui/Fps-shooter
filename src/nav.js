// Grid-based navigation for the AI: A* over a 0.5 m walkability grid built
// from the collision world, with line-of-walk path smoothing.

export class NavGrid {
  constructor(world, minX, minZ, maxX, maxZ, cell = 0.5, agentRadius = 0.38) {
    this.world = world;
    this.minX = minX; this.minZ = minZ;
    this.cell = cell;
    this.w = Math.ceil((maxX - minX) / cell);
    this.h = Math.ceil((maxZ - minZ) / cell);
    this.n = this.w * this.h;
    this.blocked = new Uint8Array(this.n);
    this.cost = new Float32Array(this.n);         // static extra cost (e.g. open ground)
    this.agentRadius = agentRadius;
    // A* scratch
    this.g = new Float32Array(this.n);
    this.f = new Float32Array(this.n);
    this.parent = new Int32Array(this.n);
    this.visit = new Uint32Array(this.n);
    this.closed = new Uint32Array(this.n);
    this.gen = 0;
    this.heap = new Int32Array(this.n);
    this.heapSize = 0;
  }

  build() {
    const r = this.agentRadius;
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const x = this.minX + (i + 0.5) * this.cell, z = this.minZ + (j + 0.5) * this.cell;
        // blocked if something between knee and head height is within the agent radius
        this.blocked[j * this.w + i] = this.world.overlaps(x, z, r, 0.45, 1.7) ? 1 : 0;
      }
    }
    // Small extra cost near walls so paths don't hug geometry.
    for (let j = 1; j < this.h - 1; j++) for (let i = 1; i < this.w - 1; i++) {
      const k = j * this.w + i;
      if (this.blocked[k]) continue;
      let near = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) near += this.blocked[k + dj * this.w + di];
      this.cost[k] = near * 0.15;
    }
  }

  idx(x, z) {
    const i = Math.floor((x - this.minX) / this.cell), j = Math.floor((z - this.minZ) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }
  cx(k) { return this.minX + ((k % this.w) + 0.5) * this.cell; }
  cz(k) { return this.minZ + (Math.floor(k / this.w) + 0.5) * this.cell; }

  walkable(x, z) { const k = this.idx(x, z); return k >= 0 && !this.blocked[k]; }

  nearestWalkable(x, z, maxR = 6) {
    const k0 = this.idx(x, z);
    if (k0 >= 0 && !this.blocked[k0]) return k0;
    const i0 = Math.floor((x - this.minX) / this.cell), j0 = Math.floor((z - this.minZ) / this.cell);
    const maxRing = Math.ceil(maxR / this.cell);
    for (let ring = 1; ring <= maxRing; ring++) {
      let best = -1, bestD = Infinity;
      for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) {
        if (Math.abs(di) !== ring && Math.abs(dj) !== ring) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const k = j * this.w + i;
        if (this.blocked[k]) continue;
        const d = di * di + dj * dj;
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** True if an agent can walk in a straight line between the points. */
  lineWalkable(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const d = Math.hypot(dx, dz);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      const k = this.idx(x0 + dx * t, z0 + dz * t);
      if (k < 0 || this.blocked[k]) return false;
    }
    return true;
  }

  _push(k) {
    const heap = this.heap, f = this.f;
    let i = this.heapSize++;
    heap[i] = k;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[heap[p]] <= f[k]) break;
      heap[i] = heap[p]; i = p;
    }
    heap[i] = k;
  }
  _pop() {
    const heap = this.heap, f = this.f;
    const top = heap[0];
    const last = heap[--this.heapSize];
    let i = 0;
    const n = this.heapSize;
    while (true) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && f[heap[c + 1]] < f[heap[c]]) c++;
      if (f[heap[c]] >= f[last]) break;
      heap[i] = heap[c]; i = c;
    }
    heap[i] = last;
    return top;
  }

  /**
   * A* path. costFn(x, z) may return extra cost per metre for a cell (danger,
   * exposure to the player...). Returns smoothed [{x, z}] or null.
   */
  findPath(sx, sz, tx, tz, costFn = null, maxIter = 24000) {
    const start = this.nearestWalkable(sx, sz, 3);
    const goal = this.nearestWalkable(tx, tz, 4);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: tx, z: tz }];
    const gen = ++this.gen;
    const w = this.w;
    const gx = goal % w, gz = Math.floor(goal / w);
    this.heapSize = 0;
    this.g[start] = 0;
    this.f[start] = this._h(start % w, Math.floor(start / w), gx, gz);
    this.parent[start] = -1;
    this.visit[start] = gen;
    this._push(start);
    let found = false, iter = 0;
    let bestK = start, bestH = Infinity;
    const SQ2 = Math.SQRT2;
    while (this.heapSize > 0 && iter++ < maxIter) {
      const k = this._pop();
      if (this.closed[k] === gen) continue;
      this.closed[k] = gen;
      if (k === goal) { found = true; break; }
      const ki = k % w, kj = Math.floor(k / w);
      const hk = this.f[k] - this.g[k];
      if (hk < bestH) { bestH = hk; bestK = k; }
      for (let d = 0; d < 8; d++) {
        const di = DI[d], dj = DJ[d];
        const ni = ki + di, nj = kj + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
        const nk = nj * w + ni;
        if (this.blocked[nk] || this.closed[nk] === gen) continue;
        if (di !== 0 && dj !== 0 && (this.blocked[kj * w + ni] || this.blocked[nj * w + ki])) continue; // no corner cutting
        let step = (di !== 0 && dj !== 0 ? SQ2 : 1) * this.cell;
        let extra = this.cost[nk];
        if (costFn) extra += costFn(this.cx(nk), this.cz(nk));
        step *= 1 + extra;
        const ng = this.g[k] + step;
        if (this.visit[nk] === gen && ng >= this.g[nk]) continue;
        this.visit[nk] = gen;
        this.g[nk] = ng;
        this.f[nk] = ng + this._h(ni, nj, gx, gz);
        this.parent[nk] = k;
        this._push(nk);
      }
    }
    const end = found ? goal : bestK;
    if (end === start) return null;
    const raw = [];
    for (let k = end; k !== -1; k = this.parent[k]) raw.push(k);
    raw.reverse();
    // smooth: greedy string pulling
    const pts = [];
    let anchor = 0;
    let ax = sx, az = sz;
    while (anchor < raw.length - 1) {
      let far = anchor + 1;
      for (let j = raw.length - 1; j > anchor + 1; j--) {
        if (j - anchor > 40) continue;
        if (this.lineWalkable(ax, az, this.cx(raw[j]), this.cz(raw[j]))) { far = j; break; }
      }
      ax = this.cx(raw[far]); az = this.cz(raw[far]);
      pts.push({ x: ax, z: az });
      anchor = far;
    }
    if (found) {
      const last = pts[pts.length - 1];
      if (this.walkable(tx, tz) && this.lineWalkable(last.x, last.z, tx, tz)) { last.x = tx; last.z = tz; }
    }
    return pts;
  }

  _h(i, j, gi, gj) {
    const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
    return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * this.cell;
  }
}

const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
