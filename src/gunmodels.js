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
  stipple.repeat.set(40, 40);
  const mlok = TX.mlokAlphaTexture();
  M = {
    anod: new THREE.MeshStandardMaterial({ color: 0x2b2c2f, roughness: 0.46, metalness: 0.62, roughnessMap: wear }),
    rail: new THREE.MeshStandardMaterial({ color: 0x2b2c2f, roughness: 0.46, metalness: 0.62, roughnessMap: wear, alphaMap: mlok, alphaTest: 0.5, side: THREE.DoubleSide }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x222225, roughness: 0.82, metalness: 0.05, normalMap: stipple, normalScale: new THREE.Vector2(0.35, 0.35) }),
    fde: new THREE.MeshStandardMaterial({ color: 0x7d6a4c, roughness: 0.78, metalness: 0.03, normalMap: stipple, normalScale: new THREE.Vector2(0.25, 0.25) }),
    od: new THREE.MeshStandardMaterial({ color: 0x4a4e3a, roughness: 0.7, metalness: 0.1, normalMap: stipple, normalScale: new THREE.Vector2(0.2, 0.2) }),
    steel: new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.32, metalness: 0.95, roughnessMap: wear }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.6, metalness: 0.3 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb5904f, roughness: 0.28, metalness: 1 }),
    shell: new THREE.MeshStandardMaterial({ color: 0x8e1d18, roughness: 0.45, metalness: 0.05 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.95, metalness: 0 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x1b2a38, roughness: 0.05, metalness: 1, transparent: true, opacity: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x6f8a99, roughness: 0.02, metalness: 0.9, transparent: true, opacity: 0.16, depthWrite: false }),
    glove: new THREE.MeshStandardMaterial({ color: 0x3a342b, roughness: 0.85, metalness: 0 }),
    knuckle: new THREE.MeshStandardMaterial({ color: 0x1e1d1a, roughness: 0.7, metalness: 0 }),
    sleeve: null,
    reticle: new THREE.MeshBasicMaterial({ map: TX.holoReticleTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    tritium: new THREE.MeshBasicMaterial({ map: TX.dotTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  };
  // player sleeve camo (multicam-ish)
  const atlas = document.createElement('canvas');
  atlas.width = atlas.height = 256;
  const ctx = atlas.getContext('2d');
  const img = ctx.createImageData(256, 256);
  const cols = [[140, 124, 92], [106, 104, 72], [164, 146, 108], [84, 70, 52], [120, 118, 80]];
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    let c = cols[0];
    if (TX.fbm(x / 30, y / 22, 3, 4, 256 / 30) > 0.55) c = cols[1];
    if (TX.fbm(x / 18, y / 26, 7, 4, 256 / 18) > 0.6) c = cols[2];
    if (TX.fbm(x / 12, y / 12, 11, 3, 256 / 12) > 0.66) c = cols[3];
    if (TX.fbm(x / 8, y / 20, 15, 3, 256 / 8) > 0.7) c = cols[4];
    const f = 0.92 + Math.random() * 0.1;
    const k = (y * 256 + x) * 4;
    img.data[k] = c[0] * f; img.data[k + 1] = c[1] * f; img.data[k + 2] = c[2] * f; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(atlas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  M.sleeve = new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, metalness: 0 });
  return M;
}

// ---------- geometry helpers ----------
function box(w, h, l, x, y, f) {
  const g = new THREE.BoxGeometry(w, h, l);
  g.translate(x, y, -f);
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
function norm(g) {
  let n = g.index ? g.toNonIndexed() : g;
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
    m.get(mat).push(norm(geo));
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
export function buildM4() {
  const m = gunMaterials();
  const b = new Builder();
  // upper receiver
  b.add(prof([[-0.105, 0.0], [0.085, 0.0], [0.085, 0.029], [-0.1, 0.029], [-0.105, 0.024]], 0.027), m.anod);
  b.add(box(0.012, 0.012, 0.02, 0, 0.022, 0.08), m.anod); // barrel nut shoulder
  b.add(rail(-0.1, 0.18, 0.029), m.anod);
  // ejection port cover + forward assist + brass deflector
  b.add(box(0.002, 0.014, 0.055, 0.0142, 0.012, 0.025), m.dark);
  b.add(cyl(0.0065, 0.0065, 0.028, -0.075, 0.017, 0.016, 12), m.anod);
  b.add(box(0.008, 0.012, 0.018, 0.0155, 0.02, -0.03), m.anod);
  // lower receiver with flared magwell
  b.add(prof([[-0.105, 0.0], [0.075, 0.0], [0.078, -0.02], [0.074, -0.06], [0.0, -0.062], [-0.004, -0.04], [-0.07, -0.038], [-0.098, -0.028], [-0.105, -0.018]], 0.025), m.anod);
  b.add(box(0.029, 0.006, 0.075, 0, -0.058, 0.037), m.anod); // magwell flare
  // trigger guard + trigger
  b.add(box(0.006, 0.004, 0.058, 0, -0.06, -0.028), m.anod);
  b.add(prof([[-0.012, -0.036], [-0.006, -0.036], [-0.01, -0.05], [-0.016, -0.054], [-0.017, -0.048]], 0.005), m.steel);
  // pistol grip (raked)
  b.add(prof([[-0.035, -0.03], [-0.062, -0.028], [-0.09, -0.07], [-0.103, -0.125], [-0.095, -0.132], [-0.065, -0.128], [-0.052, -0.085], [-0.03, -0.042]], 0.03, 0, 0.004), m.polymer);
  // buffer tube + CTR style stock
  b.add(cyl(0.0148, 0.0148, 0.19, -0.295, 0, 0.004, 18), m.anod);
  b.add(prof([[-0.19, 0.026], [-0.33, 0.03], [-0.346, 0.024], [-0.346, -0.086], [-0.332, -0.097], [-0.3, -0.094], [-0.245, -0.042], [-0.205, -0.03], [-0.19, -0.018]], 0.038, 0, 0.004,
    [[[-0.25, 0.012], [-0.318, 0.015], [-0.318, -0.055], [-0.296, -0.066], [-0.256, -0.028]]]), m.fde);
  b.add(box(0.04, 0.125, 0.012, 0, -0.03, -0.352), m.rubber);
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
  const hg = new THREE.CylinderGeometry(0.0255, 0.0255, 0.32, 8, 1, true);
  hg.rotateY(Math.PI / 8); hg.rotateX(-Math.PI / 2); hg.translate(0, 0.004, -(0.085 + 0.16));
  b.add(hg, m.rail);
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
  // EOTech-style holographic sight
  b.add(box(0.034, 0.016, 0.1, 0, 0.044, -0.01), m.anod);
  b.add(box(0.0032, 0.044, 0.05, -0.0205, 0.074, -0.01), m.anod);
  b.add(box(0.0032, 0.044, 0.05, 0.0205, 0.074, -0.01), m.anod);
  b.add(box(0.044, 0.0035, 0.054, 0, 0.0975, -0.01), m.anod);
  b.add(box(0.01, 0.01, 0.03, 0.021, 0.048, -0.045), m.anod); // buttons
  b.add(box(0.038, 0.044, 0.0015, 0, 0.075, 0.014), m.glass);
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

  const { root, parts } = b.build();
  const sightY = 0.074;
  root.add(reticlePlane(0.013, sightY, -0.005));
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
/** A gloved hand: palm block + curled fingers + thumb. Local origin = grip centre. */
function buildHand(side) {
  const m = gunMaterials();
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.085, 0.07), m.glove);
  palm.position.set(side * 0.022, -0.005, 0.01);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const fg = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.036, 3, 8), m.glove);
    fg.rotation.z = Math.PI / 2;
    fg.position.set(-side * 0.008, 0.026 - i * 0.02, -0.022);
    g.add(fg);
    const kn = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.02), m.knuckle);
    kn.position.set(side * 0.03, 0.026 - i * 0.02, -0.018);
    g.add(kn);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.04, 3, 8), m.glove);
  thumb.rotation.set(0.9, 0, side * 0.4);
  thumb.position.set(-side * 0.012, 0.035, 0.018);
  g.add(thumb);
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

function segment(r0, r1, mat) {
  const geo = new THREE.CylinderGeometry(r1, r0, 1, 12, 1);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export class Arms {
  constructor() {
    const m = gunMaterials();
    this.group = new THREE.Group();
    this.hands = { R: buildHand(1), L: buildHand(-1) };
    this.fore = { R: segment(0.038, 0.032, m.sleeve), L: segment(0.038, 0.032, m.sleeve) };
    this.upper = { R: segment(0.044, 0.04, m.sleeve), L: segment(0.044, 0.04, m.sleeve) };
    this.cuff = { R: segment(0.035, 0.037, m.glove), L: segment(0.035, 0.037, m.glove) };
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
