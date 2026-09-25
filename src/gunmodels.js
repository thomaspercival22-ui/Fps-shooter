// Procedurally modelled modern weapons (first-person viewmodels) and the
// player's arms. Units are metres. Gun space: -Z is the muzzle direction,
// +Y up, +X right, bore axis on y = 0. Profiles are written as [forward, up].
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

let M = null;
export function gunMaterials() {
  if (M) return M;
  const wear = TX.wearRoughness();
  const stipple = TX.stippleNormal();
  stipple.repeat.set(25, 25);
  const mlok = TX.mlokAlphaTexture();
  // Worn finishes, mapped with real-world UVs (one tile = 25 cm).
  const finish = (opts) => {
    const f = TX.weaponFinish(opts);
    for (const t of [f.map, f.roughness, f.normal]) t.repeat.set(4, 4);
    return f;
  };
  const fAnod = finish({ base: '#2b2c2f', wear: '#8f9195', rough: [0.62, 0.3], dust: 0.35, scratches: 80, seed: 1 });
  const fSteel = finish({ base: '#27282b', wear: '#a9acb0', rough: [0.42, 0.18], dust: 0.2, scratches: 60, seed: 2 });
  const fPoly = finish({ base: '#242427', wear: '#3d3d40', rough: [0.86, 0.62], dust: 0.45, scratches: 40, seed: 3 });
  const fFde = finish({ base: '#7e6b4d', wear: '#a08e70', rough: [0.84, 0.66], dust: 0.3, scratches: 45, seed: 4 });
  const fOd = finish({ base: '#4b4f3b', wear: '#6e725d', rough: [0.8, 0.6], dust: 0.35, scratches: 45, seed: 5 });
  const std = (f, metal, normal, ns, extra = null) => new (extra ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({
    map: f.map, roughnessMap: f.roughness, roughness: 1, metalness: metal,
    normalMap: normal || f.normal, normalScale: new THREE.Vector2(ns, ns), ...(extra || {}),
  });
  M = {
    // hard-anodised aluminium: a thin, slightly glossy oxide layer over matte metal
    anod: std(fAnod, 0.55, null, 0.35, { clearcoat: 0.3, clearcoatRoughness: 0.42 }),
    rail: new THREE.MeshStandardMaterial({ map: fAnod.map, roughnessMap: fAnod.roughness, roughness: 1, metalness: 0.55, alphaMap: mlok, alphaTest: 0.5, side: THREE.DoubleSide }),
    polymer: std(fPoly, 0.04, stipple, 0.35),
    fde: std(fFde, 0.03, stipple, 0.25),
    od: std(fOd, 0.08, stipple, 0.2),
    // turned / phosphated steel: highlights stretch along the machining direction
    steel: std(fSteel, 0.9, null, 0.3, { anisotropy: 0.45 }),
    marks: new THREE.MeshStandardMaterial({ map: TX.rollMarkTexture(), color: 0xb8bcc2, roughness: 0.5, metalness: 0.7, alphaTest: 0.35,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    bcg: new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.28, metalness: 1, roughnessMap: wear }),
    sling: new THREE.MeshStandardMaterial({ map: fFde.map, color: 0xb9a37e, roughness: 0.95, metalness: 0, normalMap: stipple, normalScale: new THREE.Vector2(0.5, 0.5) }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.6, metalness: 0.3 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb5904f, roughness: 0.28, metalness: 1 }),
    shell: new THREE.MeshStandardMaterial({ color: 0x8e1d18, roughness: 0.45, metalness: 0.05 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.95, metalness: 0 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x1b2a38, roughness: 0.05, metalness: 1, transparent: true, opacity: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x6f8a99, roughness: 0.02, metalness: 0.9, transparent: true, opacity: 0.16, depthWrite: false }),
    // gloves: coyote synthetic back, grey synthetic-leather palm, TPR knuckle guards
    glove: new THREE.MeshPhysicalMaterial({ color: 0x6a5a45, roughness: 0.82, metalness: 0, sheen: 0.7, sheenColor: 0x9c8b72, sheenRoughness: 0.6 }),
    palm: new THREE.MeshPhysicalMaterial({ color: 0x3a3733, roughness: 0.62, metalness: 0, sheen: 0.4, sheenColor: 0x6b6660, sheenRoughness: 0.5 }),
    knuckle: new THREE.MeshStandardMaterial({ color: 0x1d1c1a, roughness: 0.5, metalness: 0 }),
    sleeve: null,
    reticle: new THREE.MeshBasicMaterial({ map: TX.holoReticleTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    tritium: new THREE.MeshBasicMaterial({ map: TX.dotTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  };
  // representative colours (enemy guns are vertex-coloured copies of these models)
  const base = { anod: 0x2b2c2f, rail: 0x2b2c2f, polymer: 0x242427, fde: 0x7e6b4d, od: 0x4b4f3b, steel: 0x27282b, sling: 0x6b5a42 };
  for (const [k, c] of Object.entries(base)) M[k].userData.baseColor = new THREE.Color(c);
  M.rail.userData.keepUV = true; M.marks.userData.keepUV = true;
  M.marks.userData.baseColor = new THREE.Color(0x2b2c2f);
  // player sleeve camo (multicam-ish)
  const atlas = document.createElement('canvas');
  atlas.width = atlas.height = 256;
  const ctx = atlas.getContext('2d');
  void ctx;
  void atlas;
  const camo = TX.ocpCamoTexture(512);
  camo.repeat.set(0.55, 0.7);
  const weave = TX.ripstopNormal(256);
  weave.repeat.set(9, 12);
  M.sleeve = new THREE.MeshPhysicalMaterial({ map: camo, normalMap: weave, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.9, metalness: 0,
    sheen: 0.6, sheenColor: 0xbfb296, sheenRoughness: 0.75 });
  M.glove.normalMap = weave; M.glove.normalScale = new THREE.Vector2(0.4, 0.4);
  M.palm.normalMap = TX.stippleNormal(); M.palm.normalScale = new THREE.Vector2(0.25, 0.25);
  return M;
}

// ---------- geometry helpers ----------
/**
 * Box centred at (x, y, forward f). Real machined parts never have razor
 * edges, so anything big enough gets a small chamfer on every edge: the
 * edges catch the light the way they do on a real gun.
 */
function box(w, h, l, x, y, f) {
  const c = Math.min(0.0009, 0.16 * Math.min(w, h, l));
  if (c < 0.00025) {
    const g = new THREE.BoxGeometry(w, h, l);
    g.translate(x, y, -f);
    return g;
  }
  const L = l / 2 - c, H = h / 2 - c, k = c * 0.8;
  const shape = new THREE.Shape([
    [-L + k, -H], [L - k, -H], [L, -H + k], [L, H - k], [L - k, H], [-L + k, H], [-L, H - k], [-L, -H + k],
  ].map(([a, b2]) => new THREE.Vector2(a, b2)));
  const depth = Math.max(0.0002, w - 2 * c);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  g.translate(x, y, -f);
  return g;
}
/** A 2D outline in the gun's cross-section plane (x right, y up) extruded along the bore from forward f0 to f1. */
function sweep(pts, f0, f1, bevel = 0.0008, holes = []) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const depth = Math.max(0.0002, f1 - f0 - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -depth / 2 - (f0 + f1) / 2);
  return g;
}
/** Rounded rectangle outline (x, y centre, width, height, corner radius) as points. */
function roundRect(cx, cy, w, h, r, rTop = r, steps = 5) {
  const pts = [];
  const arc = (x, y, rad, a0) => { for (let i = 0; i <= steps; i++) { const a = a0 + (i / steps) * Math.PI / 2; pts.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad]); } };
  arc(cx + w / 2 - r, cy - h / 2 + r, r, -Math.PI / 2);
  arc(cx + w / 2 - rTop, cy + h / 2 - rTop, rTop, 0);
  arc(cx - w / 2 + rTop, cy + h / 2 - rTop, rTop, Math.PI / 2);
  arc(cx - w / 2 + r, cy - h / 2 + r, r, Math.PI);
  return pts;
}
/**
 * Rounded polygon tube along the bore (e.g. an M-LOK handguard). UV u runs
 * around the tube (one column per face), v along it, for slot alpha maps.
 */
function polyTube(apothem, sides, cornerR, f0, len, y = 0) {
  // faces centred at angles 0, 2pi/n, ... ; rounded corners between them
  const ring = [];
  const cd = (apothem - cornerR) / Math.cos(Math.PI / sides);
  for (let i = 0; i < sides; i++) {
    const ac = (i + 0.5) * (2 * Math.PI / sides);
    const cx = Math.cos(ac) * cd, cy = Math.sin(ac) * cd;
    for (let k = 0; k <= 3; k++) {
      const a = ac - Math.PI / sides + (k / 3) * (2 * Math.PI / sides);
      ring.push([cx + Math.cos(a) * cornerR, cy + Math.sin(a) * cornerR, Math.cos(a), Math.sin(a)]);
    }
  }
  const pos = [], nor = [], uv = [], idx = [];
  const segs = 24, R = ring.length;
  for (let j = 0; j <= segs; j++) {
    const z = -(f0 + (j / segs) * len);
    for (const [x, yy, nx, ny] of ring) {
      pos.push(x, yy + y, z); nor.push(nx, ny, 0);
      let u = (Math.atan2(yy, x) + Math.PI / sides) / (Math.PI * 2); u -= Math.floor(u);
      uv.push(u, j / segs);
    }
  }
  for (let j = 0; j < segs; j++) for (let i = 0; i < R; i++) {
    const i2 = (i + 1) % R;
    const a = j * R + i, b2 = j * R + i2, c2 = (j + 1) * R + i, d = (j + 1) * R + i2;
    if (Math.abs(uv[a * 2] - uv[b2 * 2]) > 0.5) continue; // UV seam sits under the top rail
    idx.push(a, b2, c2, b2, d, c2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Cylinder along the bore from f0 forward by len. rBack at the rear end, rFront at the front. */
function cyl(rBack, rFront, len, f0, x = 0, y = 0, seg = 18, open = false) {
  // after rotateX(-90deg) the cylinder's top (+Y) points forward (-Z)
  const g = new THREE.CylinderGeometry(rFront, rBack, len, seg, 1, open);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, -(f0 + len / 2));
  return g;
}
/** Cylinder across the gun (axis along X), e.g. knobs, battery caps. */
function xcyl(r, len, x, y, f, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, -f);
  return g;
}
/** Vertical cylinder (e.g. turrets, shells). */
function vcyl(r, h, x, y, f, seg = 14) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(x, y, -f);
  return g;
}
/** Side profile [forward, up] extruded symmetrically across X. */
function prof(pts, width, x = 0, bevel = 0.0012, holes = []) {
  const shape = new THREE.Shape(pts.map(([f, y]) => new THREE.Vector2(f, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([f, y]) => new THREE.Vector2(f, y))));
  const depth = Math.max(0.0005, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2); // shape X (forward) -> -Z, extrusion -> X
  g.translate(x, 0, 0);
  return g;
}
function rail(f0, len, y, w = 0.021) {
  // Picatinny rail: base + teeth
  const parts = [box(w * 0.75, 0.004, len, 0, y + 0.002, f0 + len / 2)];
  for (let f = f0 + 0.004; f < f0 + len - 0.004; f += 0.01) parts.push(box(w, 0.0045, 0.0052, 0, y + 0.0058, f));
  return mergeGeometries(parts.map(norm));
}
/** Box-projected UVs in metres: every part gets the same texel density. */
function metreUV(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) { uv[i * 2] = p.getX(i); uv[i * 2 + 1] = p.getZ(i); }
    else if (ax >= az) { uv[i * 2] = p.getZ(i); uv[i * 2 + 1] = p.getY(i); }
    else { uv[i * 2] = p.getX(i); uv[i * 2 + 1] = p.getY(i); }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function norm(g, keepUV = false) {
  let n = g.index ? g.toNonIndexed() : g;
  if (!keepUV) metreUV(n);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  return n;
}

class Builder {
  constructor() { this.parts = new Map(); }
  add(geo, mat, part = 'body') {
    if (!this.parts.has(part)) this.parts.set(part, new Map());
    const m = this.parts.get(part);
    if (!m.has(mat)) m.set(mat, []);
    m.get(mat).push(norm(geo, !!mat.userData.keepUV));
    return this;
  }
  build() {
    const root = new THREE.Group();
    const parts = {};
    for (const [name, mats] of this.parts) {
      const g = new THREE.Group();
      g.name = name;
      for (const [mat, geos] of mats) {
        const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
        mesh.frustumCulled = false;
        mesh.castShadow = mesh.receiveShadow = !mat.transparent;
        g.add(mesh);
      }
      root.add(g);
      parts[name] = g;
    }
    return { root, parts };
  }
}

function reticlePlane(size, y, f) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), gunMaterials().reticle);
  m.position.set(0, y, -f);
  m.renderOrder = 10;
  m.frustumCulled = false;
  return m;
}
function marker(x, y, f) { const o = new THREE.Object3D(); o.position.set(x, y, -f); return o; }

// ---------- M4A1 carbine ----------
export function buildM4(opts = {}) {
  const m = gunMaterials();
  const b = new Builder();
  const nv = opts.optic === 'nv';
  // upper receiver
  b.add(prof([[-0.105, 0.0], [0.085, 0.0], [0.085, 0.029], [-0.1, 0.029], [-0.105, 0.024]], 0.027), m.anod);
  b.add(box(0.012, 0.012, 0.02, 0, 0.022, 0.08), m.anod); // barrel nut shoulder
  b.add(rail(-0.1, 0.18, 0.029), m.anod);
  // ejection port: dark recess, bolt carrier inside, spring-loaded dust cover
  b.add(box(0.0015, 0.013, 0.052, 0.0131, 0.012, 0.025), m.dark);
  b.add(box(0.004, 0.011, 0.05, 0.0112, 0.012, 0.025), m.bcg, 'bcg');
  b.add(box(0.0016, 0.002, 0.03, 0.0134, 0.014, 0.02), m.dark, 'bcg');
  b.add(box(0.0016, 0.015, 0.056, 0.0008, 0.0075, 0.025), m.anod, 'dust');
  b.add(box(0.0022, 0.003, 0.012, 0.0014, 0.012, 0.03), m.anod, 'dust');
  b.add(cyl(0.0065, 0.0065, 0.028, -0.075, 0.017, 0.016, 12), m.anod);
  // forward assist knob with serrations, brass deflector behind the port
  b.add(cyl(0.0056, 0.0056, 0.008, -0.083, 0.017, 0.016, 16), m.steel);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.add(box(0.0012, 0.0012, 0.007, 0.017 + Math.cos(a) * 0.0057, 0.016 + Math.sin(a) * 0.0057, -0.079), m.dark); }
  b.add(prof([[-0.004, 0.011], [-0.022, 0.011], [-0.022, 0.029], [-0.013, 0.029]], 0.007, 0.0165, 0.0008), m.anod);
  // roll marks on the left of the magwell
  { const d = new THREE.PlaneGeometry(0.066, 0.028); d.rotateY(-Math.PI / 2); d.translate(-0.01265, -0.041, -0.036); b.add(d, m.marks); }
  b.add(box(0.008, 0.012, 0.018, 0.0155, 0.02, -0.03), m.anod);
  // lower receiver with flared magwell
  b.add(prof([[-0.105, 0.0], [0.075, 0.0], [0.078, -0.02], [0.074, -0.06], [0.0, -0.062], [-0.004, -0.04], [-0.07, -0.038], [-0.098, -0.028], [-0.105, -0.018]], 0.025), m.anod);
  b.add(box(0.029, 0.006, 0.075, 0, -0.058, 0.037), m.anod); // magwell flare
  // trigger guard + trigger
  b.add(prof([[0.002, -0.038], [0.002, -0.052], [-0.007, -0.062], [-0.058, -0.063], [-0.063, -0.056], [-0.063, -0.038]], 0.012, 0, 0.0012,
    [[[-0.003, -0.041], [-0.003, -0.05], [-0.01, -0.058], [-0.056, -0.059], [-0.059, -0.055], [-0.059, -0.041]]]), m.anod);
  b.add(prof([[-0.012, -0.036], [-0.006, -0.036], [-0.01, -0.05], [-0.016, -0.054], [-0.017, -0.048]], 0.005), m.steel);
  // pistol grip (raked)
  b.add(prof([[-0.035, -0.03], [-0.062, -0.028], [-0.079, -0.05], [-0.09, -0.07], [-0.103, -0.125], [-0.098, -0.133], [-0.066, -0.129],
    [-0.061, -0.117], [-0.064, -0.107], [-0.056, -0.098], [-0.056, -0.088], [-0.049, -0.078], [-0.043, -0.058], [-0.03, -0.042]], 0.03, 0, 0.004), m.polymer);
  // buffer tube + CTR style stock
  b.add(cyl(0.0148, 0.0148, 0.19, -0.295, 0, 0.004, 18), m.anod);
  b.add(prof([[-0.19, 0.026], [-0.33, 0.03], [-0.346, 0.024], [-0.346, -0.086], [-0.332, -0.097], [-0.3, -0.094], [-0.245, -0.042], [-0.205, -0.03], [-0.19, -0.018]], 0.038, 0, 0.004,
    [[[-0.25, 0.012], [-0.318, 0.015], [-0.318, -0.055], [-0.296, -0.066], [-0.256, -0.028]]]), m.fde);
  b.add(box(0.04, 0.125, 0.012, 0, -0.03, -0.352), m.rubber);
  b.add(cyl(0.0178, 0.0178, 0.011, -0.118, 0, 0.004, 16), m.steel);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.add(box(0.004, 0.004, 0.012, Math.cos(a) * 0.017, 0.004 + Math.sin(a) * 0.017, -0.112), m.dark); }
  b.add(prof([[-0.1055, 0.012], [-0.1085, 0.012], [-0.1085, -0.03], [-0.1055, -0.03]], 0.03), m.steel);
  b.add(cyl(0.006, 0.006, 0.01, -0.113, -0.019, -0.012, 10), m.steel);
  b.add(box(0.01, 0.007, 0.05, 0, -0.037, -0.245), m.polymer);
  // selector, takedown pins, bolt catch, mag release
  b.add(box(0.004, 0.006, 0.018, -0.0145, -0.016, -0.045), m.steel);
  for (const f of [-0.095, 0.062]) {
    const pin = new THREE.CylinderGeometry(0.0035, 0.0035, 0.0275, 8);
    pin.rotateZ(Math.PI / 2); pin.translate(0, -0.006, -f);
    b.add(pin, m.steel);
  }
  b.add(box(0.003, 0.012, 0.016, -0.014, -0.02, 0.0), m.anod);
  b.add(box(0.004, 0.008, 0.008, 0.0145, -0.022, 0.0), m.steel);
  // charging handle
  b.add(box(0.012, 0.007, 0.03, 0, 0.024, -0.118), m.anod, 'charge');
  b.add(box(0.046, 0.008, 0.01, 0, 0.024, -0.132), m.anod, 'charge');
  // free-float M-LOK handguard (octagonal, with real slots)
  b.add(polyTube(0.0252, 8, 0.0045, 0.085, 0.32, 0.004), m.rail);
  b.add(cyl(0.0275, 0.0275, 0.012, 0.402, 0, 0.004, 8), m.anod); // end cap
  b.add(rail(0.09, 0.31, 0.029), m.anod);
  // barrel, gas tube, gas block, compensator
  b.add(cyl(0.0095, 0.0092, 0.4, 0.085, 0, 0, 16), m.steel);
  b.add(cyl(0.0022, 0.0022, 0.26, 0.09, 0, 0.014, 6), m.steel);
  b.add(box(0.02, 0.022, 0.02, 0, 0.004, 0.345), m.steel);
  b.add(cyl(0.0112, 0.0112, 0.055, 0.482, 0, 0, 12), m.dark);
  for (let i = 0; i < 3; i++) b.add(box(0.024, 0.004, 0.006, 0, 0.0, 0.5 + i * 0.012), m.dark);
  // magazine (curved PMAG) with base plate
  b.add(prof([[0.007, -0.03], [0.068, -0.03], [0.074, -0.08], [0.087, -0.14], [0.104, -0.2], [0.1, -0.214], [0.04, -0.214], [0.034, -0.2], [0.019, -0.14], [0.011, -0.08]], 0.024, 0, 0.0025), m.fde, 'mag');
  b.add(prof([[0.036, -0.212], [0.106, -0.212], [0.108, -0.222], [0.034, -0.222]], 0.028), m.polymer, 'mag');
  b.add(box(0.003, 0.08, 0.004, 0.0125, -0.1, 0.02), m.polymer, 'mag');
  for (let k = 0; k < 3; k++) b.add(box(0.0262, 0.0035, 0.046, 0, -0.105 - k * 0.028, 0.049 + k * 0.012), m.fde, 'mag');
  if (nv) {
    // digital day/night riflescope: sensor body, objective bell, eyecup, IR illuminator
    const ax = 0.078; // optical axis height above the bore
    b.add(prof([[-0.07, 0.036], [0.07, 0.036], [0.07, 0.046], [-0.07, 0.046]], 0.03, 0, 0.002), m.anod); // QD mount
    b.add(box(0.012, 0.012, 0.03, 0.021, 0.041, -0.03), m.anod);
    b.add(sweep(roundRect(0, ax, 0.05, 0.058, 0.012), -0.075, 0.065, 0.004), m.polymer);              // sensor/display body
    b.add(cyl(0.024, 0.031, 0.05, 0.065, 0, ax, 28), m.polymer);                                        // objective bell
    b.add(cyl(0.029, 0.029, 0.004, 0.113, 0, ax, 28), m.rubber);
    b.add(cyl(0.026, 0.026, 0.002, 0.116, 0, ax, 28), m.lens);                                          // front lens
    b.add(cyl(0.02, 0.023, 0.045, -0.12, 0, ax, 24, true), m.rubber);                                    // eyecup
    for (let i = 0; i < 3; i++) b.add(box(0.008, 0.004, 0.012, -0.012 + i * 0.012, ax + 0.031, -0.02 + i * 0.001), m.rubber); // buttons
    b.add(cyl(0.011, 0.011, 0.012, -0.03, 0, ax + 0.03, 20), m.anod);                                    // control knob
    b.add(cyl(0.011, 0.012, 0.085, 0.0, 0.037, ax - 0.006, 20), m.anod);                                 // IR illuminator
    b.add(cyl(0.0105, 0.0105, 0.002, 0.086, 0.037, ax - 0.006, 20), m.lens);
    b.add(box(0.012, 0.014, 0.03, 0.03, ax - 0.012, 0.03), m.anod);
  } else {
  // EXPS3-style holographic sight: rounded hood around the window, base with
  // the battery at the front, side buttons, QD lever and adjuster turrets
  b.add(prof([[-0.058, 0.036], [0.036, 0.036], [0.046, 0.041], [0.046, 0.049], [0.037, 0.056], [-0.05, 0.056], [-0.058, 0.049]], 0.04, 0, 0.0025), m.anod);
  b.add(sweep(roundRect(0, 0.0765, 0.048, 0.047, 0.004, 0.014), -0.034, 0.018, 0.0014, [roundRect(0, 0.0745, 0.034, 0.027, 0.004).reverse()]), m.anod);
  b.add(box(0.036, 0.029, 0.0015, 0, 0.0745, 0.012), m.glass);
  b.add(xcyl(0.0085, 0.006, -0.022, 0.046, 0.024), m.anod); // battery cap
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.add(box(0.005, 0.0012, 0.0012, -0.022, 0.046 + Math.sin(a) * 0.0086, 0.024 + Math.cos(a) * 0.0086), m.dark); }
  b.add(box(0.004, 0.009, 0.011, -0.021, 0.047, -0.03), m.rubber); // up / down buttons
  b.add(box(0.004, 0.009, 0.011, -0.021, 0.047, -0.044), m.rubber);
  b.add(xcyl(0.0035, 0.004, -0.0215, 0.051, -0.018), m.rubber); // NV button
  b.add(box(0.005, 0.007, 0.034, 0.0215, 0.041, -0.01), m.anod); // QD lever
  b.add(box(0.008, 0.005, 0.012, 0.024, 0.041, 0.004), m.anod);
  b.add(xcyl(0.005, 0.005, 0.0265, 0.078, -0.012), m.anod); // windage / elevation turrets
  b.add(vcyl(0.005, 0.005, 0.006, 0.1025, -0.024), m.anod);
  }
  // PEQ laser box + weapon light + angled foregrip
  b.add(box(0.03, 0.026, 0.075, 0, 0.049, 0.31), m.fde);
  b.add(cyl(0.005, 0.005, 0.01, 0.35, 0.008, 0.052, 8), m.lens);
  b.add(cyl(0.012, 0.013, 0.1, 0.29, 0.034, 0.004, 14), m.anod);
  b.add(cyl(0.0135, 0.0135, 0.012, 0.388, 0.034, 0.004, 14), m.anod);
  b.add(cyl(0.0105, 0.0105, 0.002, 0.4, 0.034, 0.004, 14), m.lens);
  b.add(prof([[0.17, -0.026], [0.235, -0.026], [0.215, -0.05], [0.18, -0.06], [0.165, -0.05]], 0.022, 0, 0.003), m.polymer);
  // folded backup irons
  b.add(box(0.02, 0.01, 0.03, 0, 0.037, -0.085), m.anod);
  b.add(box(0.02, 0.01, 0.03, 0, 0.037, 0.37), m.anod);
  // front QD sling mount + two-point sling hanging under the gun
  b.add(cyl(0.006, 0.006, 0.012, 0.365, -0.029, -0.008, 10), m.steel);
  const slingCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.03, -0.012, -0.365), new THREE.Vector3(-0.034, -0.1, -0.26), new THREE.Vector3(-0.036, -0.16, -0.1),
    new THREE.Vector3(-0.034, -0.14, 0.02), new THREE.Vector3(-0.03, -0.06, 0.1), new THREE.Vector3(-0.022, -0.019, 0.113),
  ]);
  const sling = new THREE.TubeGeometry(slingCurve, 40, 0.0125, 6, false);
  sling.scale(0.28, 1, 1);
  sling.translate(-0.022, 0, 0);
  b.add(sling, m.sling);

  const { root, parts } = b.build();
  parts.dust.position.set(0.0137, 0.0045, 0);
  const sightY = nv ? 0.078 : 0.074;
  if (!nv) root.add(reticlePlane(0.013, sightY, -0.005));
  const muzzle = marker(0, 0, 0.54); root.add(muzzle);
  const eject = marker(0.016, 0.012, 0.025); root.add(eject);
  return {
    root, parts, muzzle, eject, sightY, sightF: -0.07,
    handR: { f: -0.06, y: -0.07, rot: 0.35 }, handL: { f: 0.16, y: -0.035, rot: -0.2 },
    magWell: { f: 0.04, y: -0.03 }, chargeF: -0.13,
    hip: new THREE.Vector3(0.13, -0.158, -0.31), ads: new THREE.Vector3(0, 0, -0.26),
  };
}

// ---------- Glock 17 ----------
export function buildGlock() {
  const m = gunMaterials();
  const b = new Builder();
  // slide with chamfered top
  b.add(prof([[-0.078, -0.012], [0.108, -0.012], [0.108, 0.013], [0.105, 0.018], [-0.075, 0.018], [-0.078, 0.013]], 0.0255, 0, 0.0015), m.anod, 'slide');
  for (let i = 0; i < 7; i++) {
    b.add(box(0.0262, 0.022, 0.0018, 0, 0.003, -0.07 + i * 0.0045), m.dark, 'slide'); // rear serrations
  }
  b.add(box(0.0012, 0.008, 0.03, 0.0128, 0.006, 0.02), m.dark, 'slide'); // ejection port
  b.add(box(0.012, 0.004, 0.028, 0, 0.0185, 0.02), m.steel, 'slide');    // barrel hood
  b.add(box(0.0035, 0.006, 0.004, 0, 0.021, 0.1), m.dark, 'slide');      // front sight
  b.add(box(0.018, 0.006, 0.006, 0, 0.021, -0.065), m.dark, 'slide');    // rear sight
  b.add(box(0.004, 0.006, 0.0062, 0, 0.021, -0.065), m.dark, 'slide');
  const fs = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.004), m.tritium); fs.position.set(0, 0.0225, -0.1 + 0.0021);
  // frame
  b.add(prof([[-0.075, -0.012], [0.104, -0.012], [0.104, -0.027], [0.036, -0.029], [0.03, -0.05], [0.018, -0.058], [-0.02, -0.058], [-0.03, -0.045], [-0.035, -0.03], [-0.06, -0.03], [-0.07, -0.022]], 0.0215, 0, 0.0012,
    [[[0.024, -0.03], [0.019, -0.049], [0.012, -0.053], [-0.018, -0.053], [-0.024, -0.032]]]), m.polymer);
  b.add(box(0.012, 0.004, 0.035, 0, -0.024, 0.07), m.polymer); // rail
  b.add(prof([[-0.028, -0.03], [-0.062, -0.028], [-0.074, -0.05], [-0.09, -0.118], [-0.08, -0.126], [-0.045, -0.124], [-0.036, -0.1], [-0.024, -0.052]], 0.03, 0, 0.003), m.polymer);
  b.add(prof([[0.004, -0.032], [0.009, -0.032], [0.004, -0.046], [-0.002, -0.046]], 0.006), m.polymer); // trigger
  b.add(prof([[-0.042, -0.122], [-0.083, -0.124], [-0.093, -0.132], [-0.044, -0.13]], 0.028), m.polymer, 'mag');
  b.add(prof([[-0.035, -0.03], [-0.065, -0.03], [-0.085, -0.12], [-0.047, -0.12]], 0.024), m.steel, 'mag');
  const { root, parts } = b.build();
  parts.slide.add(fs);
  const muzzle = marker(0, 0, 0.11); parts.slide.add(muzzle);
  const eject = marker(0.014, 0.01, 0.02); root.add(eject);
  return {
    root, parts, muzzle, eject, sightY: 0.0225, sightF: -0.065,
    handR: { f: -0.055, y: -0.07, rot: 0.4 }, handL: { f: -0.045, y: -0.085, rot: 0.2, support: true },
    magWell: { f: -0.06, y: -0.1 },
    hip: new THREE.Vector3(0.09, -0.088, -0.3), ads: new THREE.Vector3(0, 0, -0.3),
  };
}

// ---------- M1014 semi-auto shotgun ----------
export function buildM1014() {
  const m = gunMaterials();
  const b = new Builder();
  b.add(prof([[-0.14, -0.034], [0.12, -0.034], [0.12, 0.022], [0.1, 0.03], [-0.13, 0.03], [-0.14, 0.02]], 0.036, 0, 0.003), m.anod);
  b.add(rail(-0.12, 0.2, 0.03), m.anod);
  b.add(box(0.002, 0.018, 0.06, 0.0185, 0.004, 0.03), m.dark);           // ejection port
  b.add(box(0.01, 0.01, 0.02, 0.022, 0.004, 0.02), m.steel, 'charge');    // charging handle
  b.add(box(0.022, 0.004, 0.09, 0, -0.035, 0.0), m.dark);                 // loading port
  // barrel & magazine tube
  b.add(cyl(0.0118, 0.0112, 0.48, 0.12, 0, 0.008, 16), m.steel);
  b.add(cyl(0.0138, 0.0138, 0.4, 0.12, 0, -0.024, 16), m.anod);
  b.add(box(0.03, 0.05, 0.02, 0, -0.008, 0.46), m.anod);                  // barrel clamp
  b.add(cyl(0.012, 0.012, 0.02, 0.52, 0, -0.024, 14), m.anod);            // tube cap
  b.add(box(0.004, 0.04, 0.012, 0, 0.03, 0.585), m.anod);                 // front blade
  // polymer forend
  b.add(prof([[0.12, 0.004], [0.33, 0.004], [0.335, -0.012], [0.33, -0.05], [0.13, -0.05], [0.12, -0.04]], 0.046, 0, 0.004), m.polymer);
  // ghost ring rear sight
  b.add(box(0.03, 0.02, 0.03, 0, 0.042, -0.1), m.anod);
  b.add(box(0.004, 0.02, 0.01, -0.012, 0.058, -0.1), m.anod);
  b.add(box(0.004, 0.02, 0.01, 0.012, 0.058, -0.1), m.anod);
  const ring = new THREE.TorusGeometry(0.006, 0.0018, 8, 18); ring.translate(0, 0.058, 0.1);
  b.add(ring, m.anod);
  // pistol grip + collapsible stock
  b.add(prof([[-0.1, -0.03], [-0.128, -0.03], [-0.152, -0.075], [-0.165, -0.13], [-0.155, -0.137], [-0.128, -0.133], [-0.116, -0.088], [-0.095, -0.045]], 0.03, 0, 0.004), m.polymer);
  b.add(cyl(0.0148, 0.0148, 0.19, -0.33, 0, 0.0, 16), m.anod);
  b.add(prof([[-0.235, 0.026], [-0.385, 0.03], [-0.4, 0.024], [-0.4, -0.088], [-0.386, -0.099], [-0.352, -0.096], [-0.29, -0.044], [-0.25, -0.032], [-0.235, -0.02]], 0.038, 0, 0.004,
    [[[-0.295, 0.012], [-0.372, 0.015], [-0.372, -0.058], [-0.35, -0.068], [-0.302, -0.03]]]), m.polymer);
  b.add(box(0.04, 0.128, 0.014, 0, -0.032, -0.405), m.rubber);
  // trigger guard + trigger
  b.add(box(0.006, 0.004, 0.06, 0, -0.058, -0.06), m.anod);
  b.add(prof([[-0.05, -0.036], [-0.044, -0.036], [-0.048, -0.05], [-0.054, -0.054]], 0.005), m.steel);
  // side saddle with shells (left side)
  b.add(box(0.004, 0.034, 0.09, -0.021, 0.004, -0.02), m.anod);
  for (let i = 0; i < 5; i++) {
    const f = -0.058 + i * 0.019;
    b.add(vcyl(0.0102, 0.056, -0.034, 0.012, f, 12), m.shell);
    b.add(vcyl(0.0106, 0.012, -0.034, -0.02, f, 12), m.brass);
  }
  const { root, parts } = b.build();
  const muzzle = marker(0, 0.008, 0.6); root.add(muzzle);
  const eject = marker(0.02, 0.006, 0.03); root.add(eject);
  // a loose shell used by the reload animation (held by the left hand)
  const loose = new THREE.Group();
  const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.0102, 0.0102, 0.056, 12), m.shell); s1.position.y = 0.01;
  const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.0106, 0.0106, 0.014, 12), m.brass); s2.position.y = -0.024;
  loose.add(s1, s2); loose.rotation.x = Math.PI / 2; loose.visible = false;
  root.add(loose);
  parts.loose = loose;
  return {
    root, parts, muzzle, eject, sightY: 0.058, sightF: -0.1,
    handR: { f: -0.12, y: -0.07, rot: 0.35 }, handL: { f: 0.23, y: -0.04, rot: -0.2 },
    magWell: { f: 0.0, y: -0.045 },
    hip: new THREE.Vector3(0.125, -0.153, -0.31), ads: new THREE.Vector3(0, 0, -0.3),
  };
}

// ---------- Bolt-action sniper in a modern chassis ----------
export function buildSniper() {
  const m = gunMaterials();
  const b = new Builder();
  // round action + fluted heavy barrel + muzzle brake
  b.add(cyl(0.018, 0.018, 0.24, -0.12, 0, 0, 20), m.anod);
  b.add(cyl(0.014, 0.0115, 0.6, 0.12, 0, 0, 16), m.steel);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(box(0.003, 0.003, 0.34, Math.cos(a) * 0.0128, Math.sin(a) * 0.0128, 0.36), m.dark);
  }
  b.add(box(0.03, 0.026, 0.085, 0, 0, 0.765), m.anod);
  for (let i = 0; i < 3; i++) b.add(box(0.031, 0.016, 0.008, 0, 0, 0.74 + i * 0.018), m.dark);
  b.add(rail(-0.12, 0.28, 0.018, 0.022), m.anod);
  // chassis: forend + skeletonised stock (with holes), OD green
  b.add(prof([[-0.02, -0.018], [0.44, -0.018], [0.45, -0.03], [0.44, -0.058], [0.07, -0.058], [0.06, -0.075], [-0.03, -0.075], [-0.04, -0.03]], 0.052, 0, 0.004), m.od);
  b.add(prof([[-0.04, -0.018], [-0.14, -0.018], [-0.2, 0.0], [-0.26, 0.004], [-0.5, 0.004], [-0.52, -0.01], [-0.52, -0.12], [-0.46, -0.125], [-0.36, -0.06], [-0.2, -0.05], [-0.13, -0.055], [-0.08, -0.05]], 0.034, 0, 0.004,
    [[[-0.3, -0.012], [-0.44, -0.012], [-0.44, -0.07], [-0.36, -0.035]]]), m.od);
  b.add(prof([[-0.28, 0.004], [-0.46, 0.004], [-0.46, 0.028], [-0.3, 0.028]], 0.03), m.polymer); // cheek riser
  b.add(box(0.036, 0.14, 0.018, 0, -0.057, -0.528), m.rubber);
  // vertical grip + trigger guard
  b.add(prof([[-0.08, -0.05], [-0.115, -0.05], [-0.125, -0.09], [-0.13, -0.15], [-0.118, -0.157], [-0.09, -0.152], [-0.088, -0.1], [-0.075, -0.06]], 0.03, 0, 0.004), m.polymer);
  b.add(box(0.006, 0.004, 0.07, 0, -0.078, -0.055), m.anod);
  b.add(prof([[-0.05, -0.058], [-0.044, -0.058], [-0.048, -0.072], [-0.054, -0.075]], 0.005), m.steel);
  // detachable box magazine
  b.add(box(0.03, 0.07, 0.085, 0, -0.1, 0.025), m.steel, 'mag');
  b.add(box(0.034, 0.008, 0.09, 0, -0.137, 0.025), m.polymer, 'mag');
  // folded bipod
  b.add(cyl(0.004, 0.004, 0.2, 0.2, -0.012, -0.066, 8), m.anod);
  b.add(cyl(0.004, 0.004, 0.2, 0.2, 0.012, -0.066, 8), m.anod);
  // bolt (rotates about the bore + slides back)
  b.add(cyl(0.0095, 0.0095, 0.1, -0.2, 0, 0, 14), m.steel, 'bolt');
  b.add(box(0.05, 0.006, 0.008, 0.028, 0, -0.14), m.steel, 'bolt');
  const knob = new THREE.SphereGeometry(0.009, 12, 10); knob.translate(0.054, -0.004, 0.14);
  b.add(knob, m.dark, 'bolt');
  // scope: rings, tube, bells, turrets, lenses
  const sy = 0.058;
  for (const f of [-0.07, 0.07]) b.add(box(0.028, 0.04, 0.018, 0, 0.042, f), m.anod);
  b.add(cyl(0.017, 0.017, 0.3, -0.13, 0, sy, 24), m.anod);
  b.add(cyl(0.021, 0.021, 0.07, -0.21, 0, sy, 24), m.anod);
  b.add(cyl(0.017, 0.021, 0.02, -0.14, 0, sy, 24), m.anod);
  b.add(cyl(0.017, 0.029, 0.05, 0.17, 0, sy, 24), m.anod);
  b.add(cyl(0.029, 0.029, 0.06, 0.22, 0, sy, 24), m.anod);
  b.add(vcyl(0.013, 0.028, 0, sy + 0.028, 0.0, 16), m.anod);
  const wt = new THREE.CylinderGeometry(0.012, 0.012, 0.026, 16); wt.rotateZ(Math.PI / 2); wt.translate(0.028, sy, 0);
  b.add(wt, m.anod);
  b.add(cyl(0.027, 0.027, 0.002, 0.279, 0, sy, 24), m.lens);
  b.add(cyl(0.019, 0.019, 0.002, -0.211, 0, sy, 24), m.lens);
  const { root, parts } = b.build();
  const muzzle = marker(0, 0, 0.81); root.add(muzzle);
  const eject = marker(0.02, 0.01, -0.06); root.add(eject);
  return {
    root, parts, muzzle, eject, sightY: sy, sightF: -0.24,
    handR: { f: -0.1, y: -0.09, rot: 0.1 }, handL: { f: 0.2, y: -0.06, rot: -0.2 },
    magWell: { f: 0.025, y: -0.07 }, boltHandle: { f: -0.14, x: 0.054, y: -0.004 },
    hip: new THREE.Vector3(0.13, -0.172, -0.33), ads: new THREE.Vector3(0, 0, -0.27),
  };
}

// ---------- grenades (held + thrown) ----------
export function buildFragMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), new THREE.MeshStandardMaterial({ color: 0x3f4632, roughness: 0.7, metalness: 0.2 }));
  body.scale.y = 1.12;
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.022, 10), gunMaterials().steel);
  fuse.position.y = 0.042;
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.004), gunMaterials().steel);
  spoon.position.set(0, 0.02, 0.03); spoon.rotation.x = -0.25;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.0015, 6, 14), gunMaterials().steel);
  ring.position.set(0.016, 0.05, 0);
  g.add(body, fuse, spoon, ring);
  return g;
}
export function buildFlashMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b2d2c, roughness: 0.55, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.11, 16), mat);
  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0228, 0.0228, 0.004, 16), gunMaterials().dark);
    band.position.y = -0.03 + i * 0.03;
    g.add(band);
  }
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.022, 10), gunMaterials().steel);
  fuse.position.y = 0.065;
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.004), gunMaterials().steel);
  spoon.position.set(0, 0.035, 0.024); spoon.rotation.x = -0.12;
  g.add(body, fuse, spoon);
  return g;
}

// ---------- arms ----------
/** Capsule mesh from point a to point b. */
function bone(a, b, r, mat, seg = 10) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, seg), mat);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return mesh;
}

/**
 * A gloved hand wrapped around a grip (local y = grip axis, origin = grip
 * centre). Fingers curl around it in three joints; the back of the hand has
 * TPR knuckle guards, the palm is synthetic leather, a strap closes the cuff.
 */
function buildHand(side) {
  const m = gunMaterials();
  const g = new THREE.Group();
  const V = (x, y, z) => new THREE.Vector3(side * x, y, z);
  // palm and back of the hand: a padded, slightly flattened volume on the outside of the grip
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), m.palm);
  palm.scale.set(0.017, 0.047, 0.036); palm.position.copy(V(0.024, -0.006, 0.008));
  const back = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), m.glove);
  back.scale.set(0.014, 0.046, 0.034); back.position.copy(V(0.031, -0.006, 0.009));
  g.add(palm, back);
  // TPR guard over the back of the hand
  const guard = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI), m.knuckle);
  guard.scale.set(0.012, 0.03, 0.022); guard.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; guard.position.copy(V(0.041, 0.004, 0.0));
  g.add(guard);
  // fingers wrap around the grip: points on an arc, three phalanges each
  const lens = [1, 0.62, 0.46];
  for (let i = 0; i < 4; i++) {
    const y = 0.027 - i * 0.0185, R = 0.027 - i * 0.0008, rad = 0.0098 - i * 0.0006;
    const sweepA = [0.2, 1.25, 2.05, 2.7];
    const pts = sweepA.map((a) => V(Math.cos(a) * R, y - a * 0.002, -Math.sin(a) * R));
    for (let k = 0; k < 3; k++) {
      g.add(bone(pts[k], pts[k + 1], rad * (1 - k * 0.08) * (0.9 + lens[k] * 0.1), m.glove));
      if (k === 0) {
        // ribbed knuckle pad on the first joint
        const n = new THREE.Vector3().addVectors(pts[0], pts[1]).multiplyScalar(0.5);
        const out = n.clone().setY(0).normalize();
        const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), m.knuckle);
        pad.scale.set(0.0075, 0.0068, 0.0075); pad.position.copy(n).addScaledVector(out, rad * 0.85);
        g.add(pad);
      }
    }
  }
  // thumb: over the top of the grip on the far side
  const t0 = V(0.018, 0.03, 0.022), t1 = V(-0.006, 0.042, 0.012), t2 = V(-0.022, 0.04, -0.006);
  g.add(bone(t0, t1, 0.0112, m.glove), bone(t1, t2, 0.0098, m.glove));
  // cuff and hook-and-loop wrist strap
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.03, 0.035, 22, 1), m.glove);
  cuff.position.copy(V(0.022, -0.045, 0.045)); cuff.rotation.x = 0.7;
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.0345, 0.0345, 0.016, 22, 1), m.knuckle);
  strap.position.copy(cuff.position); strap.rotation.copy(cuff.rotation);
  g.add(cuff, strap);
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

/**
 * Sleeve segment (unit length along +y, scaled to the bone at runtime): an
 * oval, slightly tapered tube with compression folds bunching at the ends.
 */
function sleeveGeometry(r0, r1, seed) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 36, 30, true);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const th = Math.atan2(z, x), t = y;
    let r = r0 + (r1 - r0) * t;
    const endK = Math.pow(Math.abs(t - 0.5) * 2, 2.2);
    const fold = 0.5 + 0.5 * Math.sin(t * 44 + Math.sin(th * 2 + seed) * 1.8 + seed * 3);
    const lump = TX.fbm(Math.cos(th) * 1.5 + seed, t * 5 + Math.sin(th) * 1.5, seed, 3, 0) - 0.5;
    r *= 1 + fold * 0.045 * (0.25 + endK) + lump * 0.07;
    p.setXYZ(i, Math.cos(th) * r * 1.08, y, Math.sin(th) * r * 0.92);
  }
  g.computeVertexNormals();
  return g;
}

function segment(r0, r1, mat, seed = 1) {
  const geo = mat === gunMaterials().sleeve ? sleeveGeometry(r0, r1, seed) : (() => { const c = new THREE.CylinderGeometry(r1, r0, 1, 24, 1); c.translate(0, 0.5, 0); return c; })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export class Arms {
  constructor() {
    const m = gunMaterials();
    this.group = new THREE.Group();
    this.hands = { R: buildHand(1), L: buildHand(-1) };
    this.fore = { R: segment(0.041, 0.036, m.sleeve, 1), L: segment(0.041, 0.036, m.sleeve, 2) };
    this.upper = { R: segment(0.047, 0.043, m.sleeve, 3), L: segment(0.047, 0.043, m.sleeve, 4) };
    this.cuff = { R: segment(0.036, 0.038, m.sleeve, 5), L: segment(0.036, 0.038, m.sleeve, 6) };
    for (const s of ['R', 'L']) this.group.add(this.hands[s], this.fore[s], this.upper[s], this.cuff[s]);
    this.shoulder = { R: new THREE.Vector3(0.2, -0.3, 0.1), L: new THREE.Vector3(-0.18, -0.34, 0.02) };
    this._v = new THREE.Vector3(); this._e = new THREE.Vector3(); this._w = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
  }
  /** Places one arm so the hand sits at `wrist` (camera space) using 2-bone IK. */
  solve(side, wrist, handQuat, visible = true) {
    const hand = this.hands[side];
    hand.visible = this.fore[side].visible = this.upper[side].visible = this.cuff[side].visible = visible;
    if (!visible) return;
    hand.position.copy(wrist);
    hand.quaternion.copy(handQuat);
    // wrist joint is a bit behind the grip centre along the hand's local +z
    const w = this._w.set(side === 'R' ? 0.02 : -0.02, -0.02, 0.06).applyQuaternion(handQuat).add(wrist);
    const S = this.shoulder[side];
    const a = 0.31, b = 0.32;
    const d = Math.min(a + b - 0.001, S.distanceTo(w));
    const dir = this._v.subVectors(w, S).normalize();
    // elbow pole: down and outward
    const pole = new THREE.Vector3(side === 'R' ? 0.8 : -0.8, -1, 0.2).normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E = this._e.copy(S).addScaledVector(dir, cosA * a).addScaledVector(perp, sinA * a);
    this._place(this.upper[side], S, E);
    this._place(this.fore[side], E, w);
    const cuffEnd = w.clone().lerp(E, 0.2);
    this._place(this.cuff[side], w, cuffEnd);
  }
  _place(mesh, from, to) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(this._up, dir.multiplyScalar(1 / len));
    mesh.scale.set(1, len, 1);
  }
}
