// Organic models built with signed distance fields: every body segment of the
// soldier rig (hips, torso with plate carrier, head with helmet, arms, gloved
// hands, legs with knee pads and boots), the first-person gloves and sculpted
// polymer gun parts. Run by tools/build-meshes.mjs (not at runtime): meshes
// are simplified with meshoptimizer and stored in src/meshdata.js.
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { SDFModel, P, place, segment, oriented, noise3 } from './sdf.js';
import { R } from './fabric.js';

let ready = false;
const cache = {};

/** Simplifies an indexed SDF mesh towards a triangle budget and compacts its vertices. */
function simplify(g, tris) {
  const S = MeshoptSimplifier;
  const idx = new Uint32Array(g.index.array);
  if (idx.length / 3 <= tris) return g;
  const pos = g.attributes.position.array, nor = g.attributes.normal.array, reg = g.attributes.region.array;
  const attr = new Float32Array(reg.length * 4);
  for (let i = 0; i < reg.length; i++) { attr[i * 4] = nor[i * 3]; attr[i * 4 + 1] = nor[i * 3 + 1]; attr[i * 4 + 2] = nor[i * 3 + 2]; attr[i * 4 + 3] = reg[i]; }
  let [out] = S.simplifyWithAttributes(idx, new Float32Array(pos), 3, attr, 4, [0.3, 0.3, 0.3, 2], null, Math.floor(tris) * 3, 0.02, []);
  out = new Uint32Array(out);
  const [remap, unique] = S.compactMesh(out);
  const res = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const n = a.itemSize, dst = new Float32Array(unique * n);
    for (let v = 0; v < remap.length; v++) { const r = remap[v]; if (r !== 0xffffffff) for (let k = 0; k < n; k++) dst[r * n + k] = a.array[v * n + k]; }
    res.setAttribute(name, new THREE.BufferAttribute(dst, n));
  }
  res.setIndex(new THREE.BufferAttribute(out, 1));
  res.computeBoundingSphere();
  return res;
}

const fold = (amp, freq) => (x, y, z) => (noise3(x * freq, y * freq * 0.5, z * freq) - 0.5) * amp;

// ---------- first-person gloves ----------
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const A = (v) => [v.x, v.y, v.z];

/**
 * Closes a joint chain the way a hand closes on an object: joint k starts at
 * rest[k] and flexes (about `axis`) until its phalanx touches `hit` or
 * reaches max[k]. Returns the joint positions and each segment's direction.
 */
function closeChain(base, dir, axis, lens, radii, rest, max, hit) {
  const pts = [base.clone()], dirs = [];
  let d = dir.clone().normalize();
  for (let k = 0; k < lens.length; k++) {
    const touches = (ang) => {
      const dd = d.clone().applyAxisAngle(axis, ang);
      for (let s = 1; s <= 8; s++) {
        const t = s / 8, p = pts[k].clone().addScaledVector(dd, lens[k] * t);
        if (hit(p.x, p.y, p.z) < radii[k] + (radii[k + 1] - radii[k]) * t + 0.0004) return true;
      }
      return false;
    };
    let a = rest[k];
    while (a < max[k] && !touches(a + 0.01)) a += 0.01;
    d = d.clone().applyAxisAngle(axis, a);
    dirs.push(d);
    pts.push(pts[k].clone().addScaledVector(d, lens[k]));
  }
  return { pts, dirs };
}

// gloved finger dimensions: knuckle offset towards the thumb (t), distance from
// the wrist (f), height (d); phalanx lengths; radii at the joints; convergence
const FINGERS = [
  { t: 0.0285, f: 0.093, d: -0.0005, L: [0.043, 0.025, 0.021], r: [0.0097, 0.0091, 0.0086, 0.0081], tilt: -0.03 },
  { t: 0.009, f: 0.097, d: 0.0015, L: [0.046, 0.029, 0.022], r: [0.0099, 0.0093, 0.0087, 0.0082], tilt: 0.0 },
  { t: -0.0105, f: 0.092, d: 0.0, L: [0.043, 0.027, 0.021], r: [0.0094, 0.0089, 0.0083, 0.0078], tilt: 0.035 },
  { t: -0.0282, f: 0.081, d: -0.004, L: [0.034, 0.021, 0.019], r: [0.0083, 0.0078, 0.0073, 0.0069], tilt: 0.08 },
];

/**
 * Anatomical gloved hand (M-Pact style: coyote back, synthetic-leather palm and
 * finger pads, moulded TPR knuckle guard and finger armour, hook-and-loop cuff).
 * pose: side (1 right, -1 left), knuckle target for the middle finger, hand
 * forward axis F (wrist -> knuckles), back-of-hand normal D, obstacle SDF `hit`
 * the fingers close around, per-finger rest/max joint angles, thumb chain.
 */
function gloveModel(pose) {
  const m = new SDFModel();
  const F = pose.F.clone().normalize();
  const D = pose.D.clone().sub(F.clone().multiplyScalar(pose.D.dot(F))).normalize();
  const T = pose.side > 0 ? D.clone().cross(F) : F.clone().cross(D); // towards the thumb
  const W = pose.knuckle.clone().addScaledVector(F, -0.097).addScaledVector(T, -0.009).addScaledVector(D, -0.0015);
  const at = (f, t, d) => W.clone().addScaledVector(F, f).addScaledVector(T, t).addScaledVector(D, d);
  const hb = (f, t, d) => V().addScaledVector(F, f).addScaledVector(T, t).addScaledVector(D, d).normalize();
  const box = (c, X, Y, Z, hx, hy, hz, r) => oriented(P.box(hx, hy, hz, r), c, X, Y, Z);
  const ell = (c, X, Y, Z, a, b, cc) => oriented(P.ellipsoid(a, b, cc), c, X, Y, Z);
  const pts = [];

  // palm: dorsal (fabric) and palmar (leather) slabs, metacarpals, thenar and hypothenar pads
  m.add(box(at(0.05, 0.0, 0.0035), T, F, D, 0.034, 0.043, 0.0085, 0.0075), R.GLOVE);
  m.add(box(at(0.052, 0.0, -0.0045), T, F, D, 0.035, 0.041, 0.008, 0.007), R.PALM, 0.004);
  FINGERS.forEach((fg) => m.add(segment(A(at(0.02, fg.t * 0.6, 0.002)), A(at(fg.f, fg.t, fg.d + 0.001)), 0.0098, fg.r[0] + 0.0012), R.GLOVE, 0.01));
  m.add(ell(at(0.034, 0.023, -0.009), T, hb(1, 0.45, 0), D, 0.014, 0.027, 0.0115), R.PALM, 0.008);
  m.add(ell(at(0.045, -0.026, -0.007), T, F, D, 0.0115, 0.034, 0.0105), R.PALM, 0.008);
  // wrist and cuff (oval), hook-and-loop strap with a pull tab
  const oval = (L, rw, k) => (x, y, z) => (Math.hypot(x, y - Math.max(0, Math.min(L, y)), z / k) - rw) * k;
  // the cuff follows the forearm (pose.arm: wrist -> elbow), so the wrist bends like a real one
  const Yc = (pose.arm || F.clone().negate()).clone().normalize().negate();
  const Zc = D.clone().sub(Yc.clone().multiplyScalar(D.dot(Yc))).normalize(), Xc = Yc.clone().cross(Zc);
  const cw = (f, x = 0, z = 0) => W.clone().addScaledVector(Yc, f).addScaledVector(Xc, x).addScaledVector(Zc, z);
  m.add(oriented(oval(0.034, 0.0272, 0.72), cw(-0.03), Xc, Yc, Zc), R.GLOVE, 0.014);
  m.add(oriented(oval(0.012, 0.0288, 0.72), cw(-0.024, 0, 0.0005), Xc, Yc, Zc), R.BLACK, 0.002);
  m.add(box(cw(-0.016, 0, 0.0162), Xc, Yc, Zc, 0.015, 0.0075, 0.0024, 0.002), R.TPR, 0.0015);
  const tabX = pose.side > 0 ? -0.0285 : 0.0285;
  m.add(box(cw(-0.017, tabX, 0.008), Zc.clone().multiplyScalar(-1), Yc, Xc.clone().multiplyScalar(Math.sign(tabX)), 0.004, 0.0075, 0.0022, 0.0018), R.TPR, 0.0015);

  // fingers: each phalanx as a fabric capsule (back) and a leather capsule (palm side)
  const fingerChains = [];
  FINGERS.forEach((fg, i) => {
    const base = at(fg.f, fg.t, fg.d);
    const cfg = pose.fingers[i];
    let dir = F.clone().applyAxisAngle(D, (pose.side > 0 ? 1 : -1) * (cfg.spread || 0));
    let axis = dir.clone().cross(D.clone().negate()).normalize().applyAxisAngle(D, (pose.side > 0 ? -1 : 1) * fg.tilt);
    let ch;
    if (cfg.points) {
      // explicitly placed joints (trigger finger)
      const p = [base, ...cfg.points.map((q) => V(...q))];
      ch = { pts: p, dirs: [0, 1, 2].map((k) => p[k + 1].clone().sub(p[k]).normalize()) };
      const n = p[1].clone().sub(p[0]).cross(p[3].clone().sub(p[1]));
      if (n.lengthSq() > 1e-12) axis = n.normalize();
    } else ch = closeChain(base, dir, axis, fg.L, fg.r, cfg.rest, cfg.max, cfg.hit || pose.hit);
    fingerChains.push(ch);
    for (let k = 0; k < 3; k++) {
      const a = ch.pts[k], b = ch.pts[k + 1], up = ch.dirs[k].clone().cross(axis).normalize();
      const ra = fg.r[k], rb = fg.r[k + 1] * (k === 2 ? 0.97 : 1);
      m.add(segment(A(a.clone().addScaledVector(up, 0.0011)), A(b.clone().addScaledVector(up, 0.0011)), ra - 0.0004, rb - 0.0004), R.GLOVE, 0.0022);
      m.add(segment(A(a.clone().addScaledVector(up, -0.0012)), A(b.clone().addScaledVector(up, -0.0012)), ra - 0.0006, rb - 0.0006), R.PALM, 0.0022);
      // fabric bunching over the knuckles
      if (k > 0) m.add(ell(a.clone().addScaledVector(up, ra * 0.55), axis, ch.dirs[k], up, ra * 0.72, ra * 0.55, ra * 0.42), R.GLOVE, 0.003);
      if (k === 0) {
        // moulded TPR armour on the first phalanx
        const mid = a.clone().lerp(b, 0.55).addScaledVector(up, ra * 0.93);
        m.add(box(mid, axis, ch.dirs[0], up, ra * 0.62, fg.L[0] * 0.3, 0.0021, 0.0019), R.TPR, 0.0012);
      }
      pts.push(a, b);
    }
    // knuckle guard pad over the knuckle head
    m.add(box(base.clone().addScaledVector(D, fg.r[0] + 0.0038).addScaledVector(F, -0.004), T, F, D, 0.0082, 0.0085, 0.0028, 0.0026), R.TPR, 0.0018);
  });
  // knuckle guard bridge and back-of-hand panel with moulded ribs
  m.add(segment(A(at(0.089, 0.03, 0.0125)), A(at(0.081, -0.029, 0.0105)), 0.0034), R.TPR, 0.004);
  m.add(box(at(0.047, 0.001, 0.0115), T, F, D, 0.024, 0.021, 0.0022, 0.0021), R.TPR, 0.004);
  for (const t of [-0.011, 0, 0.011]) m.add(segment(A(at(0.03, t, 0.0138)), A(at(0.064, t * 1.15, 0.0138)), 0.0017), R.TPR, 0.0012);

  // thumb: metacarpal from the base of the palm, then joints through the given points
  const th = pose.thumb;
  const tp = [at(0.02, 0.024, -0.011), ...th.points.map((p) => V(...p))];
  const tr = [0.0135, 0.0114, 0.0104, 0.0092];
  const curlDir = th.curl.clone().normalize();
  for (let k = 0; k < 3; k++) {
    const a = tp[k], b = tp[k + 1], dir = b.clone().sub(a).normalize();
    const up = curlDir.clone().negate().sub(dir.clone().multiplyScalar(-curlDir.dot(dir))).normalize();
    const side = dir.clone().cross(up);
    m.add(segment(A(a.clone().addScaledVector(up, 0.0008)), A(b.clone().addScaledVector(up, 0.0008)), tr[k] - 0.0004, tr[k + 1] - 0.0004), R.GLOVE, k === 0 ? 0.012 : 0.0025);
    m.add(segment(A(a.clone().addScaledVector(up, -0.0016)), A(b.clone().addScaledVector(up, -0.0016)), tr[k] - 0.0012, tr[k + 1] - 0.0012), R.PALM, 0.0025);
    if (k === 1) m.add(box(a.clone().lerp(b, 0.5).addScaledVector(up, tr[1] * 0.92), side, dir, up, 0.0062, 0.0105, 0.002, 0.0018), R.TPR, 0.0012);
    if (k === 2) m.add(ell(a.clone().addScaledVector(up, tr[2] * 0.5), side, dir, up, tr[2] * 0.75, tr[2] * 0.55, tr[2] * 0.42), R.GLOVE, 0.003);
    pts.push(a, b);
  }
  if (process.env.DEBUG_GLOVE) console.log(pose.side, 'W', A(W).map((v) => v.toFixed(3)), 'CMC', A(tp[0]).map((v) => v.toFixed(3)), 'T', A(T).map((v) => v.toFixed(2)),
    'index', fingerChains[0].pts.map((p) => A(p).map((v) => v.toFixed(3)).join(',')).join(' | '));
  m.displace = (x, y, z) => (noise3(x * 230, y * 230, z * 230) - 0.5) * 0.0007 + (noise3(x * 70, y * 70, z * 70) - 0.5) * 0.0009;
  // mesh bounds from the joints plus the cuff
  const bb = new THREE.Box3().setFromPoints([...pts, cw(-0.07), cw(-0.03, 0.03, 0.03), cw(-0.03, -0.03, -0.03), at(0.1, 0.045, 0.02), at(0.02, -0.04, -0.02), at(-0.05, 0.03, 0.03)]);
  bb.expandByScalar(0.016);
  return { m, min: A(bb.min), max: A(bb.max), wrist: A(cw(-0.012)), fingerChains };
}

// grip-shaped obstacles the fingers close around
const ellipseY = (a, b) => (x, y, z) => (Math.hypot(x / a, z / b) - 1) * Math.min(a, b);
const cylY = (r) => (x, y, z) => Math.hypot(x, z) - r;

/**
 * Right glove on a pistol grip: local y = grip axis (up), -z = front, palm on
 * +x, origin at the grip centre; index finger on the trigger, thumb wrapped
 * round the back strap to the left side.
 */
function rightGlove() {
  const grip = ellipseY(0.0138, 0.0205);
  const hit = (x, y, z) => Math.min(grip(x, y, z), 1);
  return gloveModel({
    side: 1, F: V(-0.08, 0.2, -1), D: V(1, 0, 0.05), arm: V(0.15, -0.77, 0.62), knuckle: V(0.0265, 0.0065, -0.0135), hit,
    fingers: [
      { points: [[0.0205, 0.035, -0.044], [0.0005, 0.039, -0.0575], [-0.0165, 0.04, -0.0495]] },
      { rest: [0.5, 0.5, 0.3], max: [1.6, 1.8, 1.2] },
      { rest: [0.5, 0.5, 0.3], max: [1.6, 1.8, 1.2] },
      { rest: [0.5, 0.5, 0.3], max: [1.6, 1.8, 1.2] },
    ],
    thumb: { points: [[-0.004, 0.031, 0.029], [-0.0225, 0.034, 0.006], [-0.0245, 0.037, -0.019]], curl: V(0.6, -0.2, -0.3) },
  });
}

/**
 * Left glove on a handguard (C-clamp): local y = bore axis (forward), z = up,
 * origin on the bore; palm on the left side, fingers wrap underneath, thumb
 * over the top pointing at the target.
 */
function leftGlove() {
  const hit = cylY(0.0262);
  return gloveModel({
    side: -1, F: V(0.12, 0.8, -0.58), D: V(-1, 0, 0.2), arm: V(-0.45, -0.8, -0.4), knuckle: V(-0.03, -0.006, -0.022), hit,
    fingers: [0, 1, 2, 3].map(() => ({ rest: [0.35, 0.5, 0.3], max: [1.6, 1.8, 1.2] })),
    thumb: { points: [[-0.029, -0.018, 0.031], [-0.014, 0.012, 0.035], [-0.002, 0.037, 0.0355]], curl: V(0.4, 0, -1) },
  });
}

// ---------- soldier body segments (same joint layout as the rig in soldier.js) ----------
function pelvisModel() {
  const m = new SDFModel();
  m.add(place(P.ellipsoid(0.168, 0.12, 0.125), [0, -0.035, 0]), R.PANTS);
  for (const s of [-1, 1]) {
    m.add(place(P.sphere(0.084), [s * 0.062, -0.072, -0.045]), R.PANTS, 0.05);
    m.add(segment([s * 0.095, -0.04, 0.0], [s * 0.1, -0.17, 0.005], 0.085, 0.08), R.PANTS, 0.05);
  }
  m.add(place(P.torus(0.165, 0.032), [0, 0.045, 0], [0, 0, 0], [1, 0.8, 0.8]), R.VEST, 0.006); // padded battle belt
  m.add(place(P.torus(0.168, 0.018), [0, 0.045, 0], [0, 0, 0], [1, 0.8, 0.8]), R.BLACK, 0.002);
  m.add(place(P.box(0.022, 0.018, 0.012, 0.004), [0, 0.045, 0.14]), R.BLACK, 0.002);                 // buckle
  m.add(place(P.box(0.034, 0.052, 0.024, 0.009), [0.125, 0.0, 0.1], [0, 0.45, 0]), R.POUCH, 0.004);   // mag pouch
  m.add(place(P.box(0.056, 0.064, 0.034, 0.014), [0, -0.005, -0.15]), R.POUCH, 0.004);               // IFAK
  m.add(place(P.box(0.024, 0.072, 0.034, 0.008), [-0.19, -0.075, 0.025], [0, 0.2, 0.08]), R.BLACK, 0.003); // holster
  m.add(place(P.box(0.014, 0.03, 0.018, 0.005), [-0.19, 0.01, 0.03], [0, 0.2, 0.08]), R.BLACK, 0.002);
  m.displace = fold(0.004, 30);
  return m;
}

function chestModel(heavy) {
  const m = new SDFModel();
  const vw = heavy ? 0.18 : 0.162, vd = heavy ? 0.15 : 0.135;
  // body under the kit: rib cage, abdomen, shoulders, trapezius
  m.add(place(P.ellipsoid(0.158, 0.2, 0.118), [0, 0.3, 0]), R.SHIRT);
  m.add(place(P.ellipsoid(0.138, 0.14, 0.108), [0, 0.12, 0.005]), R.SHIRT, 0.06);
  for (const s of [-1, 1]) m.add(place(P.sphere(0.074), [s * 0.19, 0.448, 0]), R.SHIRT, 0.05);
  m.add(segment([-0.12, 0.5, -0.02], [0.12, 0.5, -0.02], 0.05), R.SHIRT, 0.05);
  m.add(segment([0, 0.47, 0.0], [0, 0.6, 0.012], 0.054, 0.05), R.FACE, 0.02);                       // neck (balaclava)
  // plate carrier: plates with curved edges, cummerbund, padded shoulder straps
  m.add(place(P.box(vw, 0.165, 0.027, 0.022), [0, 0.305, vd - 0.008], [-0.06, 0, 0]), R.VEST, 0.01);
  m.add(place(P.box(vw, 0.175, 0.024, 0.022), [0, 0.305, -vd + 0.01], [0.05, 0, 0]), R.VEST, 0.01);
  m.add(place(P.cylinder(0.2, 0.075, 0.025), [0, 0.195, 0], [0, 0, 0], [1, 1, 0.74]), R.VEST, 0.012);
  for (const s of [-1, 1]) {
    m.add(segment([s * 0.095, 0.45, vd - 0.02], [s * 0.115, 0.535, 0.0], 0.02), R.VEST, 0.01);
    m.add(segment([s * 0.115, 0.535, 0.0], [s * 0.1, 0.46, -vd + 0.02], 0.02), R.VEST, 0.01);
  }
  // triple magazine pouch with flaps and mag baseplates, admin pouch, radio, tourniquet
  for (let i = 0; i < 3; i++) {
    const x = -0.085 + i * 0.085;
    m.add(place(P.box(0.037, 0.058, 0.024, 0.008), [x, 0.2, vd + 0.036]), R.POUCH, 0.004);
    m.add(place(P.box(0.039, 0.018, 0.026, 0.007), [x, 0.262, vd + 0.038], [0.12, 0, 0]), R.POUCH, 0.003);
    m.add(place(P.box(0.012, 0.012, 0.028, 0.003), [x, 0.288, vd + 0.032], [0.1, 0, 0]), R.BLACK, 0.002);
  }
  m.add(place(P.box(0.058, 0.04, 0.02, 0.008), [0.02, 0.385, vd + 0.03]), R.POUCH, 0.004);
  m.add(place(P.box(0.03, 0.07, 0.022, 0.007), [0.172, 0.225, 0.08], [0, 1.1, 0]), R.BLACK, 0.004);
  m.add(segment([-0.15, 0.36, vd + 0.012], [-0.09, 0.42, vd + 0.012], 0.016), R.BLACK, 0.003);
  // assault pack
  m.add(place(P.box(0.13, 0.17, 0.05, 0.035), [0, 0.3, -vd - 0.065]), heavy ? R.BLACK : R.POUCH, 0.01);
  if (heavy) for (const s of [-1, 1]) m.add(place(P.box(0.08, 0.06, 0.04, 0.02), [s * 0.2, 0.45, 0], [0, 0, s * -0.35]), R.VEST, 0.01);
  m.displace = fold(0.003, 26);
  return m;
}

function headModel() {
  const m = new SDFModel();
  // head in a balaclava: skull, jaw, nose, brow
  m.add(place(P.ellipsoid(0.089, 0.11, 0.1), [0, 0.1, 0.004]), R.FACE);
  m.add(place(P.ellipsoid(0.064, 0.052, 0.07), [0, 0.035, 0.03]), R.FACE, 0.03);
  m.add(segment([0, 0.095, 0.094], [0, 0.07, 0.106], 0.011, 0.014), R.FACE, 0.012);
  m.add(place(P.ellipsoid(0.07, 0.016, 0.02), [0, 0.12, 0.088]), R.FACE, 0.02);
  // wrap-around ballistic glasses
  const glasses = place(P.torus(0.1, 0.0155), [0, 0.106, 0.004], [0, 0, 0], [0.93, 0.55, 1.05]);
  m.add((x, y, z) => Math.max(glasses(x, y, z), 0.035 - z), R.LENS, 0.003);
  // FAST high-cut helmet: shell clipped high over the ears and above the brow
  const shell = place(P.ellipsoid(0.128, 0.118, 0.14), [0, 0.128, -0.008]);
  m.add((x, y, z) => {
    const ear = Math.exp(-(((z - 0.01) / 0.055) ** 2)) * Math.min(1, Math.max(0, (Math.abs(x) - 0.06) / 0.05));
    const brow = Math.min(1, Math.max(0, (z - 0.07) / 0.05));
    const bottom = 0.072 + 0.05 * ear + 0.075 * brow;
    return Math.max(shell(x, y, z), bottom - y);
  }, R.HELMET, 0.004);
  for (const s of [-1, 1]) {
    m.add(place(P.box(0.006, 0.017, 0.055, 0.003), [s * 0.123, 0.14, -0.012], [0, 0, s * -0.15]), R.BLACK, 0.002); // ARC rails
    m.add(place(P.cylinder(0.041, 0.016, 0.006), [s * 0.103, 0.083, 0.0], [0, 0, Math.PI / 2]), R.BLACK, 0.004);   // ear cups
  }
  m.add(place(P.box(0.022, 0.016, 0.009, 0.004), [0, 0.2, 0.128], [-0.35, 0, 0]), R.BLACK, 0.003);               // NVG shroud
  m.add(place(P.box(0.03, 0.019, 0.045, 0.01), [0, 0.2, -0.128], [-0.5, 0, 0]), R.POUCH, 0.004);                 // counterweight
  m.add(segment([-0.1, 0.12, 0.0], [0, 0.245, -0.01], 0.008), R.BLACK, 0.003);                                   // headset band
  m.add(segment([0, 0.245, -0.01], [0.1, 0.12, 0.0], 0.008), R.BLACK, 0.003);
  return m;
}

function nvgModel() {
  const m = new SDFModel();
  for (const s of [-1, 1]) m.add(place(P.cylinder(0.018, 0.037, 0.004), [s * 0.034, 0.1, 0.135], [Math.PI / 2, 0, 0]), R.BLACK, 0.003);
  m.add(place(P.box(0.045, 0.014, 0.014, 0.005), [0, 0.132, 0.125]), R.BLACK, 0.004);
  m.add(place(P.box(0.014, 0.025, 0.014, 0.005), [0, 0.175, 0.122]), R.BLACK, 0.004);
  for (const s of [-1, 1]) m.add(place(P.cylinder(0.013, 0.002, 0.001), [s * 0.034, 0.1, 0.173], [Math.PI / 2, 0, 0]), R.LENS, 0.001);
  return m;
}

function upperArmModel() {
  const m = new SDFModel();
  m.add(segment([0, -0.01, 0], [0, -0.3, 0.0], 0.06, 0.047), R.SHIRT);
  m.add(place(P.ellipsoid(0.05, 0.08, 0.05), [0, -0.14, 0.014]), R.SHIRT, 0.03);
  m.add(place(P.box(0.034, 0.04, 0.012, 0.006), [0, -0.08, 0.052]), R.SHIRT, 0.006); // sleeve pocket
  m.displace = fold(0.006, 40);
  return m;
}
function foreArmModel() {
  const m = new SDFModel();
  m.add(segment([0, 0, 0], [0, -0.25, 0], 0.048, 0.037), R.SHIRT);
  m.add(place(P.ellipsoid(0.049, 0.075, 0.044), [0, -0.07, 0]), R.SHIRT, 0.03);
  m.add(segment([0, -0.23, 0], [0, -0.285, 0.004], 0.039, 0.037), R.GLOVE, 0.008); // glove gauntlet
  m.displace = fold(0.005, 45);
  return m;
}
function thighModel() {
  const m = new SDFModel();
  m.add(segment([0, 0, 0], [0, -0.42, 0.005], 0.086, 0.06), R.PANTS);
  m.add(place(P.ellipsoid(0.075, 0.14, 0.07), [0, -0.15, 0.022]), R.PANTS, 0.04);
  for (const s of [-1, 1]) m.add(place(P.box(0.016, 0.07, 0.058, 0.012), [s * 0.08, -0.22, 0.01]), R.PANTS, 0.008); // cargo pockets
  m.displace = fold(0.006, 34);
  return m;
}
function shinModel() {
  const m = new SDFModel();
  m.add(segment([0, 0, 0], [0, -0.35, 0], 0.062, 0.046), R.PANTS);
  m.add(place(P.ellipsoid(0.055, 0.1, 0.058), [0, -0.1, -0.02]), R.PANTS, 0.04);
  m.add(place(P.ellipsoid(0.05, 0.062, 0.03), [0, -0.01, 0.056]), R.TPR, 0.008);           // knee pad
  m.add(place(P.torus(0.064, 0.006), [0, -0.03, 0.0], [0.2, 0, 0], [1, 1, 1.05]), R.BLACK, 0.002);
  m.add(segment([0, -0.31, 0], [0, -0.42, 0.005], 0.051, 0.055), R.BOOT, 0.01);             // boot shaft
  m.add(place(P.box(0.048, 0.034, 0.12, 0.03), [0, -0.432, 0.06]), R.BOOT, 0.02);           // foot
  m.add(place(P.box(0.052, 0.011, 0.13, 0.009), [0, -0.461, 0.061]), R.BLACK, 0.004);        // sole
  m.displace = (x, y, z) => (y > -0.3 ? fold(0.005, 34)(x, y, z) : 0);
  return m;
}

// ---------- sculpted polymer gun parts (gun space: x right, y up, -z forward) ----------
/** Pistol grip (MOE style): raked, finger groove, flared base, beaver tail. */
function gripModel() {
  const m = new SDFModel();
  const top = [0, -0.036, 0.047], bot = [0, -0.124, 0.086];
  const body = segment(top, bot, 0.0165, 0.0175);
  m.add((x, y, z) => body(x * 1.28, y, z) / 1.28 * 1.0, 0);
  m.add(place(P.ellipsoid(0.0118, 0.012, 0.009), [0, -0.075, 0.049]), 0, 0.01);              // finger groove bulge
  m.sub(place(P.cylinder(0.02, 0.02), [0, -0.092, 0.042], [0, 0, Math.PI / 2]), 0.004);
  m.add(place(P.box(0.0135, 0.004, 0.02, 0.003), [0, -0.129, 0.087], [-0.42, 0, 0]), 0, 0.004);  // base flare
  m.add(place(P.box(0.012, 0.006, 0.016, 0.004), [0, -0.029, 0.063], [0.5, 0, 0]), 0, 0.006);   // beaver tail
  m.displace = (x, y, z) => (noise3(x * 900, y * 900, z * 900) - 0.5) * 0.00018;                 // stippling
  return m;
}
/** Laser aiming module (PEQ style) on the handguard top rail, gun frame (z = -forward). */
function peqModel() {
  const m = new SDFModel();
  const cz = -0.31, cy = 0.049;
  m.add(place(P.box(0.0148, 0.0118, 0.0372, 0.0045), [0, cy, cz]), 0);
  m.add(place(P.box(0.0152, 0.0028, 0.034, 0.0014), [0, cy - 0.0102, cz]), 0, 0.002);                      // lower lip
  m.add(place(P.cylinder(0.0088, 0.017, 0.0025), [-0.0118, cy - 0.003, cz - 0.019], [Math.PI / 2, 0, 0]), 0, 0.003); // battery tube
  m.add(place(P.cylinder(0.0094, 0.0028, 0.0012), [-0.0118, cy - 0.003, cz - 0.0375], [Math.PI / 2, 0, 0]), 0, 0.0008); // battery cap
  for (let i = 0; i < 10; i++) {                                                                                   // cap knurl
    const a = i / 10 * Math.PI * 2;
    m.sub(place(P.box(0.0009, 0.0035, 0.0012, 0.0004), [-0.0118 + Math.cos(a) * 0.0095, cy - 0.003 + Math.sin(a) * 0.0095, cz - 0.0375], [0, 0, a]), 0.0003);
  }
  // front emitter windows (the lenses sit in these recesses)
  m.sub(place(P.cylinder(0.0052, 0.004, 0.0008), [0.0065, cy + 0.003, cz - 0.0375], [Math.PI / 2, 0, 0]), 0.0008);
  m.sub(place(P.cylinder(0.0034, 0.004, 0.0006), [0.0065, cy - 0.0065, cz - 0.0375], [Math.PI / 2, 0, 0]), 0.0006);
  // top: zeroing adjusters, mode selector, activation buttons; panel seam
  for (const [x, z] of [[-0.006, 0.012], [0.006, 0.012]]) m.add(place(P.cylinder(0.0038, 0.0022, 0.0008), [x, cy + 0.0126, cz + z]), 0, 0.001);
  m.add(place(P.cylinder(0.0062, 0.003, 0.001), [0, cy + 0.0125, cz + 0.026]), 0, 0.0015);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; m.sub(place(P.box(0.0007, 0.003, 0.001), [Math.cos(a) * 0.0063, cy + 0.0145, cz + 0.026 + Math.sin(a) * 0.0063], [0, a, 0]), 0.0002); }
  for (const x of [-0.0062, 0.0062]) m.add(place(P.box(0.0034, 0.0014, 0.0045, 0.0012), [x, cy + 0.0122, cz - 0.012]), 0, 0.0012);
  m.sub(place(P.box(0.02, 0.0004, 0.0003), [0, cy + 0.004, cz - 0.022]), 0.0003);
  // rail clamp with a thumb nut on the left
  m.add(place(P.box(0.0118, 0.004, 0.022, 0.0012), [0, cy - 0.0158, cz + 0.006]), 0, 0.002);
  m.add(place(P.cylinder(0.0058, 0.003, 0.0012), [-0.0148, cy - 0.0158, cz + 0.006], [0, 0, Math.PI / 2]), 0, 0.0015);
  m.displace = (x, y, z) => (noise3(x * 900, y * 900, z * 900) - 0.5) * 0.00008;
  return m;
}

/** Curved 30-round polymer magazine with ribs and a flared base plate. */
function pmagModel() {
  const m = new SDFModel();
  // the body follows the 5.56 curve: stacked rounded slabs, each tilted a little more
  const N = 7;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), y = -0.035 - t * 0.17, f = 0.038 + t * t * 0.04 + t * 0.012;
    m.add(place(P.box(0.0118, 0.016, 0.031, 0.004), [0, y, -f], [0.08 + t * 0.32, 0, 0]), 0, 0.012);
  }
  for (let k = 0; k < 3; k++) {
    const t = 0.35 + k * 0.17, y = -0.035 - t * 0.17, f = 0.038 + t * t * 0.04 + t * 0.012;
    m.add(place(P.box(0.0128, 0.0022, 0.029, 0.0012), [0, y, -f], [0.08 + t * 0.32, 0, 0]), 0, 0.0015); // ribs
  }
  m.add(place(P.box(0.0142, 0.0055, 0.037, 0.003), [0, -0.214, -0.098], [0.42, 0, 0]), 1, 0.003);           // base plate
  m.displace = (x, y, z) => (noise3(x * 700, y * 700, z * 700) - 0.5) * 0.00012;
  return m;
}

function glove(g) {
  const geo = simplify(g.m.mesh(g.min, g.max, 0.0009), 16000);
  geo.userData.wrist = g.wrist;
  return geo;
}

/**
 * Left glove supporting a pistol grip (same frame as the right glove): palm on
 * the left side over the firing hand's fingers, fingers wrapped round the
 * front below the trigger guard, thumb forward along the frame.
 */
function leftPistolGlove() {
  const hit = (x, y, z) => ellipseY(0.03, 0.041)(x, y, z + 0.006);
  return gloveModel({
    side: -1, F: V(0.15, -0.3, -0.94), D: V(-1, 0, 0.1), arm: V(-0.4, -0.65, 0.63), knuckle: V(-0.041, -0.024, -0.03), hit,
    fingers: [0, 1, 2, 3].map(() => ({ rest: [0.3, 0.45, 0.3], max: [1.6, 1.8, 1.2] })),
    thumb: { points: [[-0.036, 0.02, -0.012], [-0.03, 0.03, -0.042], [-0.024, 0.035, -0.066]], curl: V(1, -0.2, 0) },
  });
}

/**
 * Soldier hands (hand bone frame: wrist at the origin, forearm continuing
 * along -y, palm facing +z): a gloved fist closed round a cylinder along x.
 */
function soldierGlove(side) {
  const cy = -0.085, cz = 0.034;
  const hit = (x, y, z) => Math.hypot(y - cy, z - cz) - 0.017;
  const sx = side > 0 ? -1 : 1; // thumb side
  return gloveModel({
    side, F: V(0, -1, 0), D: V(0, 0, -1), arm: V(0, 1, 0), knuckle: V(sx * 0.009, -0.107, -0.0015), hit,
    fingers: [0, 1, 2, 3].map(() => ({ rest: [0.4, 0.6, 0.3], max: [1.7, 1.9, 1.3] })),
    thumb: { points: [[sx * 0.03, -0.062, 0.03], [sx * 0.021, -0.083, 0.058], [sx * 0.003, -0.094, 0.064]], curl: V(-sx, 0, 0) },
  });
}

/** Builds every organic mesh (tool side). */
export async function buildAll(onProgress, only = null) {
  if (ready) return cache;
  await MeshoptSimplifier.ready;
  const jobs = [
    ['glove', () => glove(rightGlove())],
    ['gloveL', () => glove(leftGlove())],
    ['gloveLP', () => glove(leftPistolGlove())],
    ['pelvis', () => simplify(pelvisModel().mesh([-0.24, -0.26, -0.22], [0.24, 0.1, 0.2], 0.0055), 3200)],
    ['chest', () => simplify(chestModel(false).mesh([-0.28, 0.0, -0.26], [0.28, 0.64, 0.24], 0.0055), 7000)],
    ['chestHeavy', () => simplify(chestModel(true).mesh([-0.3, 0.0, -0.28], [0.3, 0.64, 0.25], 0.0055), 7500)],
    ['head', () => simplify(headModel().mesh([-0.15, -0.03, -0.18], [0.15, 0.26, 0.15], 0.0032), 5500)],
    ['nvg', () => simplify(nvgModel().mesh([-0.07, 0.07, 0.09], [0.07, 0.21, 0.19], 0.002), 1500)],
    ['upperArm', () => simplify(upperArmModel().mesh([-0.08, -0.37, -0.08], [0.08, 0.07, 0.08], 0.0045), 1600)],
    ['foreArm', () => simplify(foreArmModel().mesh([-0.07, -0.34, -0.07], [0.07, 0.06, 0.07], 0.004), 1500)],
    ['handR', () => { const g = soldierGlove(1); return simplify(g.m.mesh(g.min, g.max, 0.0016), 2200); }],
    ['handL', () => { const g = soldierGlove(-1); return simplify(g.m.mesh(g.min, g.max, 0.0016), 2200); }],
    ['thigh', () => simplify(thighModel().mesh([-0.12, -0.5, -0.11], [0.12, 0.1, 0.12], 0.0055), 2200)],
    ['shin', () => simplify(shinModel().mesh([-0.08, -0.49, -0.09], [0.08, 0.08, 0.2], 0.0045), 2600)],
    ['grip', () => simplify(gripModel().mesh([-0.022, -0.14, 0.02], [0.022, -0.015, 0.11], 0.0008), 3000)],
    ['peq', () => simplify(peqModel().mesh([-0.034, 0.025, -0.355], [0.024, 0.07, -0.265], 0.0006), 4000)],
    ['pmag', () => simplify(pmagModel().mesh([-0.018, -0.23, -0.14], [0.018, -0.02, -0.005], 0.0009), 3500)],
  ];
  for (let i = 0; i < jobs.length; i++) {
    if (only && !only.includes(jobs[i][0])) continue;
    cache[jobs[i][0]] = jobs[i][1]();
    onProgress?.((i + 1) / jobs.length);
    await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  ready = true;
  return cache;
}
