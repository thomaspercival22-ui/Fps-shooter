// Builds the "Compound" map: geometry (merged per material for few draw
// calls), collision boxes, navigation grid, cover points and spawn points.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld } from './physics.js';
import { NavGrid } from './nav.js';
import { pbrMaterial } from './assets.js';
import * as TX from './textures.js';
import { groundMaterial, addWallGrime, addWireMesh, GROUND_TILE } from './terrain.js';
import { CONTAINER, containerGeometry, containerGrimeTexture, applyContainerGrime } from './containers.js';

const BOUND = 70;        // inner face of the HESCO ring
const WALL = 42;         // compound wall half-size

// Penetration: fraction of damage a bullet keeps after passing through.
const PEN = { container: 0.5, crate: 0.55, sheet: 0.7, barrel: 0.45, tyre: 0.3, glass: 0.9 };

class GeoBatch {
  constructor() { this.geos = new Map(); }
  add(key, geo) {
    if (!this.geos.has(key)) this.geos.set(key, []);
    this.geos.get(key).push(geo);
  }
  /** Axis-aligned box with world-space UVs (tile = metres per texture repeat). */
  box(key, x0, y0, z0, x1, y1, z1, tile = 2, skipBottom = true) {
    const pos = [], nor = [], uv = [];
    const face = (ax, sign, verts) => {
      const n = [0, 0, 0]; n[ax] = sign;
      for (const v of verts) {
        pos.push(v[0], v[1], v[2]); nor.push(n[0], n[1], n[2]);
        if (ax === 0) uv.push(v[2] / tile * sign, v[1] / tile);
        else if (ax === 1) uv.push(v[0] / tile, v[2] / tile * -sign);
        else uv.push(v[0] / tile * -sign, v[1] / tile);
      }
    };
    const q = (a, b, c, d) => [a, b, c, a, c, d];
    // +X
    face(0, 1, q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]));
    face(0, -1, q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]));
    face(1, 1, q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]));
    if (!(skipBottom && y0 <= 0.001)) face(1, -1, q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]));
    face(2, 1, q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]));
    face(2, -1, q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.add(key, g);
  }
  /** Arbitrary geometry (already in world space); UVs get replaced by triplanar world UVs. */
  geometry(key, geo, tile = 2) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g = worldUV(g, tile);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    this.add(key, g);
  }
  build(scene, materials, shadows) {
    const meshes = [];
    for (const [key, list] of this.geos) {
      const merged = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(merged, materials[key]);
      mesh.castShadow = shadows && key !== 'floor';
      mesh.receiveShadow = true;
      // surface temperature for thermal imaging (scaled by time of day)
      mesh.userData.heat = key.startsWith('cont_') || key === 'sheet' || key === 'tank' ? 0.38 : key === 'glass' ? 0.2 : 0.31;
      mesh.userData.env = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
}

function worldUV(g, tile) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function grayscale(texture, contrast = 1.25) {
  const img = texture.image;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    let l = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
    l = Math.max(0, Math.min(255, (l - 110) * contrast + 150));
    d.data[i] = d.data[i + 1] = d.data[i + 2] = l;
  }
  ctx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = texture.anisotropy;
  return t;
}

/** Swap red/blue channels: turns the blue oil drum into a red fuel drum. */
function redden(texture) {
  const img = texture.image;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2];
    d.data[i] = Math.min(255, b * 1.25); d.data[i + 1] = g * 0.45; d.data[i + 2] = r * 0.6;
  }
  ctx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = texture.flipY;
  return t;
}

export function buildLevel(scene, assets, opts = {}) {
  const shadows = opts.shadows !== false;
  const world = new CollisionWorld(-BOUND - 6, -BOUND - 6, BOUND + 6, BOUND + 6, 4);
  const G = new GeoBatch();
  const coverBoxes = [];
  const minimap = [];

  // ---------------- materials ----------------
  const mats = {
    plaster: pbrMaterial(assets, 'damaged_plaster', { color: 0xf2e6d2 }),
    plasterB: pbrMaterial(assets, 'damaged_plaster', { color: 0xd9c3a0 }),
    concrete: pbrMaterial(assets, 'concrete_wall_008', { color: 0xe8e2d6 }),
    floor: pbrMaterial(assets, 'concrete_floor_worn_001'),
    sheet: pbrMaterial(assets, 'rusty_corrugated_iron', { color: 0xc9b8a8 }),
    planks: pbrMaterial(assets, 'green_rough_planks', { color: 0xbfc79a }),
    metalDark: new THREE.MeshStandardMaterial({ color: 0x3f4234, roughness: 0.55, metalness: 0.45 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x4a5550, roughness: 0.5, metalness: 0.55 }),
    pvc: new THREE.MeshStandardMaterial({ color: 0xc9c5ba, roughness: 0.45, metalness: 0 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.55, metalness: 0 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6, metalness: 0 }),
    tank: new THREE.MeshStandardMaterial({ color: 0xb7b09f, roughness: 0.5, metalness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0d1114, roughness: 0.08, metalness: 0.9 }),
  };
  const containerGray = grayscale(assets.textures.container_side.diff);
  // weathered container paint (the corrugation is real geometry, so only a fine dent normal is kept)
  const containerColors = { red: 0x8c3b2d, blue: 0x3b5670, green: 0x56674a, tan: 0x9f8c66, orange: 0xa65e30, white: 0xbdbab1 };
  const grimes = [containerGrimeTexture(1), containerGrimeTexture(2)];
  const contMats = {};
  Object.entries(containerColors).forEach(([name, col], i) => {
    const m = new THREE.MeshStandardMaterial({ map: containerGray, color: col, roughness: 0.62, metalness: 0.25, roughnessMap: assets.textures.container_side.arm });
    applyContainerGrime(m, grimes[i % 2]);
    contMats[name] = m;
  });
  const contPl = {};
  for (const k of ['plaster', 'plasterB', 'concrete']) addWallGrime(mats[k], k);
  // HESCO: hessian geotextile liner, welded mesh drawn in the shader, sand fill on top
  mats.hesco = pbrMaterial(assets, 'hessian_230', { color: 0xcdb892, normalScale: 1.4, metalness: 0 });
  mats.hesco.metalnessMap = null;
  addWireMesh(mats.hesco);
  mats.hescoFill = pbrMaterial(assets, 'gravelly_sand', { color: 0xe8d6ba, metalness: 0 });

  // ---------------- helpers ----------------
  const place = (x, y, z, ry = 0, rx = 0, s = 1) => new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(s, s, s));
  const cratePl = [], barrierPl = [];   // instanced scan placements, filled while building
  const solid = (key, x0, y0, z0, x1, y1, z1, tile, props = {}) => {
    if (key !== 'none') G.box(key, x0, y0, z0, x1, y1, z1, tile);
    const b = world.add(x0, y0, z0, x1, y1, z1, props);
    if (y1 - y0 > 0.8 && y0 < 0.3 && !props.noCover) coverBoxes.push(b);
    if (y1 > 1.0 && !props.noMap) minimap.push(b);
    return b;
  };
  /**
   * Wall along X (axis 'x') or Z (axis 'z') between a..b, at fixed coordinate c (thickness t),
   * with openings [{ from, to, bottom, top }].
   */
  const wall = (key, axis, a, b, c0, c1, h, openings = [], tile = 1.6, props = {}) => {
    const box = (s0, s1, y0, y1) => {
      if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
      if (axis === 'x') solid(key, s0, y0, c0, s1, y1, c1, tile, props);
      else solid(key, c0, y0, s0, c1, y1, s1, tile, props);
      // rendered concrete plinth along the foot of masonry walls
      if (y0 === 0 && key.startsWith('plaster')) deco('concrete', s0, 0, s1, 0.32, c0 - 0.025, c1 + 0.025, 1.2);
    };
    const deco = (k, s0, y0, s1, y1, d0, d1, t = 1) => {
      if (axis === 'x') G.box(k, s0, y0, d0, s1, y1, d1, t); else G.box(k, d0, y0, s0, d1, y1, s1, t);
    };
    if (key.startsWith('plaster')) {
      for (const o of openings) {
        const fw = 0.055, d0 = c0 - 0.012, d1 = c1 + 0.012;
        deco('frame', o.from, o.bottom || 0, o.from + fw, o.top, d0, d1);
        deco('frame', o.to - fw, o.bottom || 0, o.to, o.top, d0, d1);
        deco('frame', o.from, o.top - fw, o.to, o.top, d0, d1);
        deco('concrete', o.from - 0.12, o.top, o.to + 0.12, o.top + 0.18, c0 - 0.018, c1 + 0.018, 1.2); // lintel
        if (o.bottom > 0) {
          deco('frame', o.from, o.bottom, o.to, o.bottom + fw, d0, d1);
          deco('concrete', o.from - 0.08, o.bottom - 0.05, o.to + 0.08, o.bottom + 0.012, c0 - 0.06, c1 + 0.06, 1.2); // sill
          // security grille: vertical bars and two rails, mid-depth
          const m0 = (c0 + c1) / 2 - 0.008, m1 = m0 + 0.016;
          for (let sx = o.from + 0.14; sx < o.to - 0.1; sx += 0.13) deco('frame', sx, o.bottom + fw, sx + 0.016, o.top - fw, m0, m1);
          for (const fy of [0.33, 0.66]) { const yy = o.bottom + (o.top - o.bottom) * fy; deco('frame', o.from + fw, yy, o.to - fw, yy + 0.016, m0, m1); }
        }
      }
    }
    const ops = [...openings].sort((p, q) => p.from - q.from);
    let cur = a;
    for (const o of ops) {
      box(cur, o.from, 0, h);
      box(o.from, o.to, 0, o.bottom || 0);
      box(o.from, o.to, o.top, h);
      cur = o.to;
    }
    box(cur, b, 0, h);
  };
  const door = (from, w = 1.8, top = 2.2) => ({ from, to: from + w, bottom: 0, top });
  const win = (from, w = 1.4, bottom = 1.0, top = 2.1) => ({ from, to: from + w, bottom, top });

  // ---------------- ground + distant dunes ----------------
  let groundMatRef = null;
  {
    const size = 1800, seg = 128;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const r = Math.hypot(x, z);
      const t = THREE.MathUtils.smoothstep(r, 95, 320);
      const dunes = TX.fbm(x / 90, z / 90, 4, 4) * 38 + TX.fbm(x / 30, z / 30, 9, 3) * 8;
      p.setY(i, t * dunes - (r > 90 ? 0.02 : 0));
    }
    g.computeVertexNormals();
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { uv.setXY(i, p.getX(i) / GROUND_TILE, -p.getZ(i) / GROUND_TILE); }
    const groundMat = groundMatRef = groundMaterial(assets);
    const ground = new THREE.Mesh(g, groundMat);
    ground.receiveShadow = true;
    ground.userData.heat = 0.29; ground.userData.env = true;
    ground.matrixAutoUpdate = false;
    scene.add(ground);
  }

  // ---------------- HESCO perimeter ----------------
  /** A run of filled HESCO cells: liner bulging between the mesh joints, sand fill just below the rim. */
  function hescoRow(x0, z0, x1, z1, h) {
    world.add(x0, 0, z0, x1, h, z1, { mat: 'sand' });
    minimap.push(world.boxes[world.boxes.length - 1]);
    const alongX = x1 - x0 > z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0, dep = alongX ? z1 - z0 : x1 - x0;
    const g = new THREE.BoxGeometry(len, h, dep, Math.round(len / 0.265), 8, 4);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i) + h / 2, z = p.getZ(i);
      if (Math.abs(n.getY(i)) > 0.5) { p.setY(i, y); continue; }
      const cell = ((x + len / 2) / 1.06) % 1, v = y / h;
      // sand pushes the liner out between the coil joints, most at mid height
      const bulge = Math.sin(cell * Math.PI) * Math.sin(Math.min(1, v * 1.05) * Math.PI) * 0.045 + (TX.fbm(x * 1.7, y * 1.7, 5, 2) - 0.5) * 0.02;
      const sx = Math.sign(n.getX(i)) * (Math.abs(n.getX(i)) > 0.5 ? 1 : 0), sz = Math.sign(n.getZ(i)) * (Math.abs(n.getZ(i)) > 0.5 ? 1 : 0);
      p.setXYZ(i, x + sx * bulge, y, z + sz * bulge);
    }
    g.computeVertexNormals();
    if (!alongX) g.rotateY(Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    G.geometry('hesco', g, 0.6);
    G.box('hescoFill', x0 + 0.05, h - 0.12, z0 + 0.05, x1 - 0.05, h - 0.06, z1 - 0.05, GROUND_TILE);
  }
  {
    const t = 1.15, h = 2.2;
    for (const s of [-1, 1]) {
      const c0 = s > 0 ? BOUND : -BOUND - t, c1 = c0 + t;
      hescoRow(-BOUND - t, c0, BOUND + t, c1, h);
      hescoRow(c0, -BOUND, c1, BOUND, h);
      // invisible barrier so nobody climbs out
      world.add(-BOUND - 3, 0, s > 0 ? BOUND : -BOUND - 3, BOUND + 3, 12, s > 0 ? BOUND + 3 : -BOUND, { blocksBullets: false, blocksSight: false });
      world.add(s > 0 ? BOUND : -BOUND - 3, 0, -BOUND - 3, s > 0 ? BOUND + 3 : -BOUND, 12, BOUND + 3, { blocksBullets: false, blocksSight: false });
    }
  }

  // ---------------- compound wall ----------------
  {
    const h = 3.0, t = 0.3, cap = (axis, a, b, c) => {
      if (axis === 'x') G.box('concrete', a, h, c - t - 0.06, b, h + 0.12, c + t + 0.06, 2);
      else G.box('concrete', c - t - 0.06, h, a, c + t + 0.06, h + 0.12, b, 2);
    };
    const sides = [
      { axis: 'x', c: -WALL, ops: [{ from: -3.5, to: 3.5, bottom: 0, top: h }, { from: 22, to: 25.5, bottom: 0.95, top: h }] },
      { axis: 'x', c: WALL, ops: [{ from: -3.5, to: 3.5, bottom: 0, top: h }, { from: -29, to: -26, bottom: 0, top: h }] },
      { axis: 'z', c: -WALL, ops: [{ from: 6, to: 12, bottom: 0, top: h }] },
      { axis: 'z', c: WALL, ops: [{ from: -6, to: 0, bottom: 0, top: h }] },
    ];
    for (const s of sides) {
      const a = s.axis === 'x' ? -WALL - t : -WALL + t, b = -a;
      wall('plasterB', s.axis, a, b, s.c - t, s.c + t, h, s.ops, 1.8, { mat: 'plaster' });
      const ca = s.axis === 'x' ? a - 0.06 : a + 0.06, cb = -ca;
      let cur = ca;
      for (const o of [...s.ops].sort((p, q) => p.from - q.from)) { if (o.bottom === 0) { cap(s.axis, cur, o.from, s.c); cur = o.to; } }
      cap(s.axis, cur, cb, s.c);
      // gate pillars
      for (const o of s.ops) {
        if (o.bottom > 0 || o.to - o.from < 5) continue;
        for (const e of [o.from - 0.45, o.to + 0.45]) {
          if (s.axis === 'x') solid('concrete', e - 0.45, 0, s.c - 0.45, e + 0.45, 3.6, s.c + 0.45, 2, { mat: 'concrete' });
          else solid('concrete', s.c - 0.45, 0, e - 0.45, s.c + 0.45, 3.6, e + 0.45, 2, { mat: 'concrete' });
        }
      }
    }
    // rubble in the breaches
    solid('concrete', 22, 0, -WALL - 0.9, 25.5, 0.35, -WALL + 0.9, 1.5, { mat: 'concrete', noCover: true });
    solid('concrete', -28.7, 0, WALL - 1.0, -26.3, 0.3, WALL + 1.2, 1.5, { mat: 'concrete', noCover: true });
  }

  // ---------------- HQ building ----------------
  const HQ = { x0: -10, x1: 8, z0: -28, z1: -16, h: 3.4 };
  {
    const t = 0.35, { x0, x1, z0, z1, h } = HQ;
    solid('floor', x0, 0, z0, x1, 0.08, z1, 3, { mat: 'concrete', noCover: true, noMap: true });
    wall('plaster', 'x', x0, x1, z1 - t, z1, h, [door(-4.4), win(-8), win(1), win(4.5)]);
    wall('plaster', 'x', x0, x1, z0, z0 + t, h, [win(2), win(4.5)]);
    wall('plaster', 'z', z0 + t, z1 - t, x0, x0 + t, h, [door(-22.9)]);
    wall('plaster', 'z', z0 + t, z1 - t, x1 - t, x1, h, [door(-21.9), win(-26)]);
    wall('plaster', 'z', z0 + t, z1 - t, -1.175, -0.825, h, [door(-20.4)]);
    // roof + parapet
    solid('concrete', x0 - 0.2, h, z0, x1 + 0.2, h + 0.25, z1 + 0.2, 2.5, { mat: 'concrete', noCover: true });
    const ph = h + 0.25, pt = 0.25, py = ph + 0.95;
    solid('concrete', x0 - 0.2, ph, z1 - 0.05, x1 + 0.2, py, z1 + 0.2, 2, { mat: 'concrete' });
    solid('concrete', x0 - 0.2, ph, z0, -1.7, py, z0 + pt, 2, { mat: 'concrete' });
    solid('concrete', 0.3, ph, z0, x1 + 0.2, py, z0 + pt, 2, { mat: 'concrete' });
    solid('concrete', x0 - 0.2, ph, z0 + pt, x0 + 0.05, py, z1 - 0.05, 2, { mat: 'concrete' });
    solid('concrete', x1 - 0.05, ph, z0 + pt, x1 + 0.2, py, z1 - 0.05, 2, { mat: 'concrete' });
    // exterior stairs to the roof (north side)
    const steps = 14, rise = (h + 0.25) / steps, run = 0.55, sx = -8.8, sz0 = -29.3, sz1 = -28.03;
    for (let i = 0; i < steps; i++) {
      const xa = sx + run * i, xb = i === steps - 1 ? 0.3 : xa + run;
      solid('concrete', xa, 0, sz0, xb, rise * (i + 1), sz1, 2, { mat: 'concrete', noCover: true });
    }
    // stair side wall
    solid('concrete', sx, 0, sz0 - 0.2, 0.3, 0.6, sz0, 2, { mat: 'concrete', noCover: true });
    // resupply crate + furniture
    solid('planks', -7.4, 0.08, -26.9, -5.6, 0.85, -26.0, 1.2, { mat: 'wood', pen: PEN.crate });
    solid('planks', 2.2, 0.08, -24.8, 4.2, 0.9, -23.9, 1.2, { mat: 'wood', pen: PEN.crate });
    solid('planks', -6.5, 0.08, -19.5, -5.3, 0.9, -18.3, 1.2, { mat: 'wood', pen: PEN.crate });
    solid('planks', 5.4, 0.08, -18.6, 6.6, 0.8, -17.4, 1.2, { mat: 'wood', pen: PEN.crate });
  }

  // ---------------- Warehouse ----------------
  {
    const x0 = 16, x1 = 36, z0 = -34, z1 = -18, h = 6, t = 0.15, p = { mat: 'metal', pen: PEN.sheet };
    solid('floor', x0, 0, z0, x1, 0.06, z1, 3, { mat: 'concrete', noCover: true, noMap: true });
    wall('sheet', 'z', z0, z1, x0, x0 + t, h, [{ from: -29, to: -23.5, bottom: 0, top: 4.6 }], 2, p);
    wall('sheet', 'z', z0, z1, x1 - t, x1, h, [], 2, p);
    wall('sheet', 'x', x0 + t, x1 - t, z1 - t, z1, h, [door(27, 1.8, 2.3)], 2, p);
    wall('sheet', 'x', x0 + t, x1 - t, z0, z0 + t, h, [door(20, 1.8, 2.3)], 2, p);
    // roof with two skylight gaps
    solid('sheet', x0 - 0.3, h, z0 - 0.3, x0 + 6, h + 0.12, z1 + 0.3, 2, { ...p, noCover: true });
    solid('sheet', x0 + 7.4, h, z0 - 0.3, x0 + 13, h + 0.12, z1 + 0.3, 2, { ...p, noCover: true });
    solid('sheet', x0 + 14.4, h, z0 - 0.3, x1 + 0.3, h + 0.12, z1 + 0.3, 2, { ...p, noCover: true });
    // steel roof trusses
    for (let x = x0 + 2; x < x1; x += 4) G.box('metalDark', x - 0.08, h - 0.4, z0, x + 0.08, h, z1, 2);
    // interior: container and crate stacks
    container('blue', 29.5, -33.4, true, 0, 0.06);
    crateStack(19, -21, 2, 1);
    crateStack(22.5, -31.5, 1, 2);
    crateStack(31, -22, 2, 2);
    crateStack(25.5, -26.5, 1, 1);
  }

  // ---------------- Container yard (SE) ----------------
  function container(color, x, z, alongX, level = 0, base = 0) {
    const { L, W, H } = CONTAINER;
    const y0 = level * H + base;
    // alternate which end the doors face
    const flip = ((x * 7 + z * 13) | 0) % 2 === 0;
    const m = new THREE.Matrix4();
    if (alongX) m.compose(new THREE.Vector3(flip ? x + L : x, y0, flip ? z + W : z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), flip ? Math.PI : 0), new THREE.Vector3(1, 1, 1));
    else m.compose(new THREE.Vector3(flip ? x : x + W, y0, flip ? z + L : z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), flip ? Math.PI / 2 : -Math.PI / 2), new THREE.Vector3(1, 1, 1));
    (contPl[color] = contPl[color] || []).push(m);
    if (alongX) solid('none', x, y0, z, x + L, y0 + H, z + W, 2.6, { mat: 'metal', pen: PEN.container });
    else solid('none', x, y0, z, x + W, y0 + H, z + L, 2.6, { mat: 'metal', pen: PEN.container });
  }
  container('blue', 14, 10, true); container('red', 14, 12.44, true); container('green', 14, 10, true, 1);
  container('orange', 24, 8, false);
  container('tan', 30, 12, true);
  container('blue', 30, 20, true); container('red', 30, 20, true, 1);
  container('green', 16, 22, false);
  container('red', 22, 30, true);
  container('white', 33, 28, false);
  container('tan', 8, 30, false);

  // ---------------- Houses (SW) ----------------
  const house = (x0, z0, x1, z1, doorSide, doorAt, wins) => {
    const t = 0.3, h = 3.0;
    solid('floor', x0, 0, z0, x1, 0.06, z1, 3, { mat: 'concrete', noCover: true, noMap: true });
    const ops = { n: [], s: [], w: [], e: [] };
    ops[doorSide].push(door(doorAt));
    for (const [side, at] of wins) ops[side].push(win(at, 1.2));
    wall('plasterB', 'x', x0, x1, z0, z0 + t, h, ops.n);
    wall('plasterB', 'x', x0, x1, z1 - t, z1, h, ops.s);
    wall('plasterB', 'z', z0 + t, z1 - t, x0, x0 + t, h, ops.w);
    wall('plasterB', 'z', z0 + t, z1 - t, x1 - t, x1, h, ops.e);
    solid('concrete', x0 - 0.15, h, z0 - 0.15, x1 + 0.15, h + 0.22, z1 + 0.15, 2.5, { mat: 'concrete', noCover: true });
  };
  // rooftop water tank (ribbed black plastic on a steel stand) and satellite dish
  const waterTank = (x, y, z) => {
    for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) G.box('frame', x + dx - 0.03, y, z + dz - 0.03, x + dx + 0.03, y + 0.5, z + dz + 0.03, 1);
    G.box('frame', x - 0.55, y + 0.48, z - 0.55, x + 0.55, y + 0.54, z + 0.55, 1);
    const t = new THREE.CylinderGeometry(0.52, 0.55, 1.15, 28, 6);
    const tp = t.attributes.position;
    for (let i = 0; i < tp.count; i++) { const k = 1 + 0.03 * Math.cos(tp.getY(i) * 22); tp.setX(i, tp.getX(i) * k); tp.setZ(i, tp.getZ(i) * k); }
    t.computeVertexNormals(); t.translate(x, y + 0.54 + 0.575, z);
    G.geometry('plastic', t, 1);
    const lid = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 18); lid.translate(x, y + 1.72, z); G.geometry('plastic', lid, 1);
    world.add(x - 0.55, y, z - 0.55, x + 0.55, y + 1.72, z + 0.55, { mat: 'rubber', pen: 0.8 });
  };
  const dish = (x, y, z, ry) => {
    const d = new THREE.SphereGeometry(0.42, 22, 8, 0, Math.PI * 2, 0, 0.55);
    d.rotateX(-Math.PI / 2 + 0.6); d.rotateY(ry); d.translate(x, y + 0.75, z);
    G.geometry('pvc', d, 1);
    G.box('frame', x - 0.025, y, z - 0.025, x + 0.025, y + 0.72, z + 0.025, 1);
  };
  const drainpipe = (x, z, top) => {
    const p = new THREE.CylinderGeometry(0.045, 0.045, top - 0.15, 12); p.translate(x, (top + 0.15) / 2, z); G.geometry('pvc', p, 1);
    const e = new THREE.CylinderGeometry(0.045, 0.045, 0.3, 12); e.rotateZ(Math.PI / 2.6); e.translate(x + 0.08, 0.12, z); G.geometry('pvc', e, 1);
  };
  /** Power cable sagging between two points (catenary-ish). */
  const cable = (a, b, sag = 0.9) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0))); }
    G.geometry('cable', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.009, 5, false), 1);
  };
  waterTank(4.8, 3.65, -26.6); waterTank(-8.4, 3.65, -18.2);
  dish(-3.4, 3.65, -27.2, 0.8);
  waterTank(-28.8, 3.22, 18.6); dish(-17.3, 3.22, 28.8, 2.4); waterTank(-31.2, 3.22, 32.2);
  drainpipe(8.12, -27.6, 3.4); drainpipe(-10.12, -16.4, 3.4); drainpipe(-26.88, 14.4, 3.0); drainpipe(-15.0 + 0.12, 29.6, 3.0);
  cable(new THREE.Vector3(8.1, 3.5, -16.4), new THREE.Vector3(16.1, 5.6, -18.4), 0.6);
  cable(new THREE.Vector3(21, 5.9, 17.9), new THREE.Vector3(8.1, 3.3, -15.9), 1.6);
  cable(new THREE.Vector3(21, 5.9, 17.9), new THREE.Vector3(-15.1, 2.9, 24.2), 2.2);
  cable(new THREE.Vector3(-10.1, 3.3, -16.1), new THREE.Vector3(-26.9, 2.9, 14.1), 2.4);
  house(-34, 14, -27, 20, 'e', 16.1, [['s', -32], ['n', -31]]);
  house(-22, 24, -15, 30, 'n', -19.9, [['e', 26], ['w', 26.5]]);
  house(-36, 28, -29, 34, 'n', -33.4, [['e', 30]]);
  wall('plasterB', 'x', -27, -22, 21.5, 21.8, 1.2, [], 1.8, { mat: 'plaster' });
  wall('plasterB', 'z', 20, 24, -24.3, -24, 1.2, [], 1.8, { mat: 'plaster' });

  // ---------------- Fuel depot (W) ----------------
  const explosiveBarrels = [];
  {
    // horizontal fuel tank on concrete saddles
    const tank = new THREE.CylinderGeometry(1.3, 1.3, 6.4, 24, 1);
    tank.rotateZ(Math.PI / 2);
    tank.translate(-33, 1.75, -10.7);
    G.geometry('tank', tank, 2);
    for (const x of [-35.4, -30.6]) solid('concrete', x - 0.3, 0, -12, x + 0.3, 0.9, -9.4, 2, { mat: 'concrete', noCover: true });
    world.add(-36.2, 0.45, -12, -29.8, 3.05, -9.4, { mat: 'metal' });
    coverBoxes.push(world.boxes[world.boxes.length - 1]);
    minimap.push(world.boxes[world.boxes.length - 1]);
    solid('concrete', -37, 0, -13, -29, 0.12, -8.4, 2, { mat: 'concrete', noCover: true, noMap: true });
  }

  // ---------------- parked vehicle under a tarp + supply crates ----------------
  {
    world.add(-13.9, 0, -3.8, -9.5, 1.41, -1.9, { mat: 'metal', pen: 0.6 });
    coverBoxes.push(world.boxes[world.boxes.length - 1]);
    minimap.push(world.boxes[world.boxes.length - 1]);
    crateStack(-9.1, -3.95, 1, 1, 1);
  }

  // ---------------- courtyard cover ----------------
  // concrete barrier blocks (photo-scanned), two per position
  const jersey = (x, z, alongX) => {
    for (const o of [-0.79, 0.79]) {
      const j = (Math.random() - 0.5) * 0.06;
      barrierPl.push(alongX ? place(x + o, 0, z + j, (Math.random() - 0.5) * 0.04) : place(x + j, 0, z + o, Math.PI / 2 + (Math.random() - 0.5) * 0.04));
    }
    if (alongX) world.add(x - 1.58, 0, z - 0.25, x + 1.58, 1.1, z + 0.25, { mat: 'concrete' });
    else world.add(x - 0.25, 0, z - 1.58, x + 0.25, 1.1, z + 1.58, { mat: 'concrete' });
    coverBoxes.push(world.boxes[world.boxes.length - 1]);
    minimap.push(world.boxes[world.boxes.length - 1]);
  };
  jersey(-3.5, 30, true); jersey(3.2, 22, true); jersey(-4.5, 10, true); jersey(4, 2.5, true);
  jersey(-12, 14, false); jersey(12, -6, false); jersey(-20, -14, true); jersey(20, 2, true);
  jersey(0, -56, true); jersey(-3.2, -56, true); jersey(58, 10, false); jersey(58, 14, false);
  jersey(25, -56, true); jersey(-56, 40, false); jersey(46, -30, false);

  // crates: stacks of photo-scanned wooden ammunition crates (1.24 x 0.52 x 0.46 m)
  function crateStack(x, z, nx, nz, layers = 2) {
    const w = 1.26, d = 1.08;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const L = Math.max(1, layers - ((i + j) % 2));
      const n = L >= 2 ? 3 : 2;
      const x0 = x + i * (w + 0.03), z0 = z + j * (d + 0.03);
      for (let k = 0; k < n; k++) for (const dz of [0.27, 0.81]) {
        const jit = () => (Math.random() - 0.5) * 0.035;
        cratePl.push(place(x0 + w / 2 + jit(), k * 0.462, z0 + dz + jit(), (Math.random() < 0.5 ? 0 : Math.PI) + jit() * 1.5));
      }
      solid('none', x0, 0, z0, x0 + w, n * 0.462, z0 + d, 1, { mat: 'wood', pen: PEN.crate });
    }
  }
  crateStack(8, 4, 2, 1); crateStack(-9, -7, 1, 2); crateStack(-15, 5, 2, 1, 1); crateStack(11.5, -10, 1, 1);
  crateStack(-6, 19, 2, 1); crateStack(6, 27, 1, 2); crateStack(-24, -2, 2, 2); crateStack(26, 0, 2, 1);
  crateStack(-52, -10, 2, 1); crateStack(50, 45, 2, 2); crateStack(-8, 36, 1, 1, 1); crateStack(20, 18, 1, 1);
  crateStack(-45, -48, 1, 2); crateStack(40, -52, 2, 1);

  // containers outside the wall
  container('red', -58, -56, true); container('blue', 52, -54, false); container('tan', -3, 57, true);
  container('green', -44, 52, true); container('orange', 55, 30, false); container('white', -60, 14, false);
  container('blue', 20, 60, true); container('red', -30, -62, true);

  // ---------------- sandbag positions ----------------
  const bagSlots = [];
  const bagWall = (x0, z0, x1, z1, layers = 5) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 0.68));
    for (let l = 0; l < layers; l++) {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5 + (l % 2) * 0.25) / (n + (l % 2) * 0.5);
        bagSlots.push({ x: x0 + (x1 - x0) * t, y: l * 0.175, z: z0 + (z1 - z0) * t, ry: ang + (Math.random() - 0.5) * 0.12 });
      }
    }
    const pad = 0.26;
    const b = world.add(Math.min(x0, x1) - pad, 0, Math.min(z0, z1) - pad, Math.max(x0, x1) + pad, layers * 0.175 + 0.02, Math.max(z0, z1) + pad, { mat: 'sand' });
    coverBoxes.push(b);
    minimap.push(b);
  };
  // north gate nest
  bagWall(-2.6, -37.6, 2.6, -37.6); bagWall(-2.8, -37.2, -2.8, -34.8); bagWall(2.8, -37.2, 2.8, -34.8);
  // south gate nest
  bagWall(-2.6, 37.4, 2.6, 37.4); bagWall(-2.8, 37, -2.8, 34.6); bagWall(2.8, 37, 2.8, 34.6);
  // west gate + east gate
  bagWall(-37.5, 5.5, -37.5, 12.5); bagWall(37.2, -7, 37.2, 1);
  // field positions
  bagWall(-24, -31, -20, -31); bagWall(-24.3, -30.6, -24.3, -28);
  bagWall(-58, 22, -58, 27); bagWall(28, 54, 33, 54); bagWall(-14, -54, -9, -54); bagWall(46, 8, 46, 13);
  bagWall(-50, -30, -46, -30); bagWall(10, 46, 15, 46); bagWall(52, -12, 52, -7); bagWall(-30, 48, -26, 48);
  bagWall(-16, 42 + 5, -12, 42 + 5);
  // courtyard
  bagWall(-18, 6, -18, 10, 4); bagWall(16, -12, 20, -12, 4);

  // ---------------- props (instanced GLTF models) ----------------
  const props = new THREE.Group();
  scene.add(props);
  const instanced = (model, placements, { castShadow = true, map = null, color = null, keepMaps = true, heat = 0.31 } = {}) => {
    model.updateMatrixWorld(true);
    const out = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      let mat = o.material;
      if (map || color) {
        mat = mat.clone();
        if (map) mat.map = map;
        if (color) mat.color = new THREE.Color(color);
        if (!keepMaps) { mat.aoMap = null; }
      }
      const im = new THREE.InstancedMesh(o.geometry, mat, placements.length);
      const m = new THREE.Matrix4();
      placements.forEach((p, i) => { m.multiplyMatrices(p, o.matrixWorld); im.setMatrixAt(i, m); });
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.userData.heat = heat; im.userData.env = true;
      im.computeBoundingSphere();
      props.add(im);
      out.push(im);
    });
    return out;
  };

  // sandbags: filled hessian bags with a folded, tucked end
  {
    const bagMat = pbrMaterial(assets, 'hessian_380', { color: 0xd4c09a, normalScale: 1.6, metalness: 0 });
    bagMat.metalnessMap = null;
    const bag = new THREE.Mesh(sandbagGeometry(), bagMat);
    // split into spatial chunks so off-screen groups are culled
    const chunks = new Map();
    for (const b of bagSlots) {
      const k = `${Math.floor(b.x / 48)},${Math.floor(b.z / 48)}`;
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(place(b.x, b.y, b.z, b.ry + (Math.random() < 0.5 ? 0 : Math.PI), (Math.random() - 0.5) * 0.05, 0.94 + Math.random() * 0.1));
    }
    for (const list of chunks.values()) instanced(new THREE.Group().add(bag.clone()), list);
  }

  // barrels
  const barrelSpots = [[-28, -12.5], [-28.7, -11.7], [-27.9, -10.9], [-38, -8], [-37.2, -7.3], [9.5, 7], [-5, -12], [-4.3, -12.6],
    [30, -22.3], [33.5, -20.5], [34.2, -21.2], [-20, 18], [22, 6], [-40, 38], [38, 38], [-12, -38], [14, -38.5], [62, -40], [-62, -38], [40, 60]];
  const explosiveSpots = [[-29.5, -8], [-36.5, -13.8], [-26.8, -12], [18.5, 6.2], [-6, 31], [33, -24.5], [-44, 20], [44, -20]];
  const barrelPl = [], drumPl = [];
  barrelSpots.forEach(([x, z], i) => {
    const plastic = i % 3 === 1;
    (plastic ? drumPl : barrelPl).push(place(x, 0, z, Math.random() * 6));
    const r = plastic ? 0.25 : 0.3;
    const b = world.add(x - r, 0, z - r, x + r, plastic ? 0.88 : 0.93, z + r, { mat: plastic ? 'rubber' : 'metal', pen: plastic ? 0.75 : PEN.barrel });
    coverBoxes.push(b);
  });
  instanced(assets.models.barrel_03, barrelPl);
  instanced(assets.models.Barrel_02, drumPl, { heat: 0.3 });
  const redMap = redden(findMap(assets.models.barrel_03));
  const redPl = explosiveSpots.map(([x, z]) => place(x, 0, z, Math.random() * 6));
  const redMeshes = instanced(assets.models.barrel_03, redPl, { map: redMap });
  explosiveSpots.forEach(([x, z], i) => {
    const box = world.add(x - 0.3, 0, z - 0.3, x + 0.3, 0.93, z + 0.3, { mat: 'metal', tag: 'explosive' });
    explosiveBarrels.push({ x, z, hp: 30, alive: true, box, index: i, meshes: redMeshes });
    box.barrel = explosiveBarrels[explosiveBarrels.length - 1];
  });

  // tyre stacks + truck wheels
  const tyrePl = [];
  const tyreStack = (x, z, n) => {
    for (let i = 0; i < n; i++) tyrePl.push(place(x + (Math.random() - 0.5) * 0.06, 0.083 + i * 0.165, z + (Math.random() - 0.5) * 0.06, Math.random() * 3, Math.PI / 2));
    world.add(x - 0.3, 0, z - 0.3, x + 0.3, n * 0.165, z + 0.3, { mat: 'rubber', pen: PEN.tyre });
  };
  tyreStack(-30, 6, 4); tyreStack(-29.3, 6.7, 3); tyreStack(25, -8, 4); tyreStack(-10, 24, 3); tyreStack(10, -30, 4); tyreStack(-47, -20, 3);
  instanced(assets.models.old_tyre, tyrePl);

  // ammo boxes on the resupply crate
  instanced(assets.models.ammo_box, [place(-7.0, 0.85, -26.45, Math.PI / 2), place(-6.6, 0.85, -26.45, Math.PI / 2 + 0.1), place(-6.1, 0.85, -26.4, Math.PI / 2 - 0.1)]);
  instanced(assets.models.medical_box, [place(3.2, 0.9, -24.35, 0.3)]);

  // ---------------- photo-scanned clutter ----------------
  const M = assets.models;
  {
    const geo = containerGeometry();
    for (const [color, list] of Object.entries(contPl)) {
      instanced(new THREE.Group().add(new THREE.Mesh(geo, contMats[color])), list, { heat: 0.38 });
    }
  }
  instanced(M.concrete_road_barrier_02, barrierPl, { heat: 0.34 });
  instanced(M.wooden_military_crate, cratePl, { heat: 0.31 });
  instanced(M.covered_car, [place(-11.7, 0, -2.85, Math.PI / 2 + 0.02)], { heat: 0.33 });
  // cement bags stacked by the houses
  {
    const pl = [];
    const stack = (x, z, ry, layers) => {
      for (let l = 0; l < layers; l++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const rot = (l % 2) ? Math.PI / 2 : 0;
        const dx = (i - 0.5) * (l % 2 ? 0.72 : 0.47), dz = (j - 0.5) * (l % 2 ? 0.47 : 0.72);
        const c = Math.cos(ry), sn = Math.sin(ry);
        pl.push(place(x + dx * c + dz * sn, l * 0.17, z - dx * sn + dz * c, ry + rot + (Math.random() - 0.5) * 0.12));
      }
      world.add(x - 0.72, 0, z - 0.72, x + 0.72, layers * 0.17, z + 0.72, { mat: 'sand' });
      coverBoxes.push(world.boxes[world.boxes.length - 1]);
    };
    stack(-25.6, 23.4, 0.2, 5); stack(-13.6, 26.5, 1.4, 3); stack(-31, 26.4, 0.5, 4);
    instanced(M.cement_bag, pl, { heat: 0.3 });
  }
  // roller shutters on the warehouse's blank east wall
  {
    const shutter = new THREE.Group();
    M.rollershutter_door.children.forEach((c) => { if (!/graffiti/.test(c.name)) shutter.add(c.clone()); });
    instanced(shutter, [place(36.0, 0.06, -30.5, Math.PI / 2), place(36.0, 0.06, -26.2, Math.PI / 2), place(36.0, 0.06, -21.9, Math.PI / 2)], { heat: 0.33 });
  }
  // wall-mounted AC condensers (the model is a pair of units, back at -z)
  instanced(M.exterior_aircon_unit, [
    place(8 + 0.22, 1.62, -24.5, Math.PI / 2), place(-34 - 0.22, 1.7, 17.2, -Math.PI / 2), place(-18.5, 1.7, 30 + 0.22, 0),
  ], { heat: 0.36 });
  world.add(8, 1.3, -25.4, 8.6, 2.25, -23.6, { mat: 'metal', pen: 0.6 });
  world.add(-34.6, 1.38, 16.3, -34, 2.33, 18.1, { mat: 'metal', pen: 0.6 });
  world.add(-19.4, 1.38, 30, -17.6, 2.33, 30.6, { mat: 'metal', pen: 0.6 });
  // electrical cabinets on the perimeter wall and the warehouse
  instanced(M.utility_box_02, [place(-15, 0, -WALL + 0.51, 0), place(WALL - 0.51, 0, 20, -Math.PI / 2), place(22, 0, -18 + 0.22, 0)], { heat: 0.33 });
  for (const [x0, z0, x1, z1] of [[-15.46, -41.7, -14.54, -41.27], [41.27, 19.54, 41.7, 20.46], [21.54, -18, 22.46, -17.57]]) {
    const b = world.add(x0, 0, z0, x1, 1.12, z1, { mat: 'metal', pen: 0.5 }); coverBoxes.push(b);
  }
  // generator + fuel cans by the HQ, cans by the truck
  instanced(M.portable_generator, [place(10.2, 0, -22.6, 0.4)], { heat: 0.38 });
  world.add(9.75, 0, -23.05, 10.65, 0.58, -22.15, { mat: 'metal', pen: 0.4 });
  instanced(M.metal_jerrycan, [place(10.9, 0, -21.7, 1.2), place(11.2, 0, -21.9, 1.5), place(-7.1, 0, -1.3, 0.2), place(-6.72, 0, -1.25, 0.05), place(-24.4, 0, -12.7, 2.8)], { heat: 0.32 });
  // covered cars (usable as cover)
  instanced(M.covered_car, [place(-21, 0, -9, 0), place(30, 0, 38, Math.PI / 2)], { heat: 0.33 });
  for (const [x0, z0, x1, z1] of [[-21.85, -11.17, -20.06, -6.79], [27.79, 37.08, 32.21, 38.94]]) {
    const b = world.add(x0, 0, z0, x1, 1.38, z1, { mat: 'metal', pen: 0.55 }); coverBoxes.push(b); minimap.push(b);
  }
  // gas bottles and rubbish around the houses and yards
  instanced(M.propane_tank, [place(-26.6, 0, 15.2, 0.3), place(-26.2, 0, 15.62, 1.1), place(-15.4, 0, 31.2, 2.2), place(-28.6, 0, 27.4, 0.7)], { heat: 0.33 });
  for (const [x, z] of [[-26.6, 15.2], [-26.2, 15.62], [-15.4, 31.2], [-28.6, 27.4]]) world.add(x - 0.17, 0, z - 0.17, x + 0.17, 0.55, z + 0.17, { mat: 'metal', tag: null });
  instanced(M.trashbag, [
    place(13.5, 0, 9.4, 0.4), place(13.9, 0, 8.9, 2.1), place(13.2, 0, 8.7, 3.9), place(-28.3, 0, 20.7, 1.0), place(-27.8, 0, 21.0, 2.6),
    place(-14.4, 0, 23.4, 0.2), place(35.4, 0, 26.2, 5.2), place(-9.6, 0, -15.3, 0.9), place(24.4, 0, -17.4, 1.7), place(-36.5, 0, 26.8, 4.4),
  ], { castShadow: true, heat: 0.3 });

  world.build();
  // Scatters the separate parts of a scan (stones, bushes, branches) as individual instances.
  const scatter = (model, count, pick, { scale = [1, 1], sink = 0, heat = 0.31, castShadow = true, noThermal = false } = {}) => {
    model.updateMatrixWorld(true);
    const parts = model.children.filter((c) => { let m = false; c.traverse((o) => { m = m || o.isMesh; }); return m; });
    const perPart = parts.map(() => []), spots = [];
    for (let i = 0, tries = 0; i < count && tries < count * 20; tries++) {
      const pt = pick();
      if (!pt) continue;
      const sc = scale[0] + Math.random() * (scale[1] - scale[0]);
      perPart[i % parts.length].push(place(pt[0], -sink * sc, pt[1], Math.random() * Math.PI * 2, 0, sc));
      spots.push([pt[0], pt[1], sc]);
      i++;
    }
    parts.forEach((part, k) => {
      if (!perPart[k].length) return;
      const box = new THREE.Box3().setFromObject(part);
      const c = box.getCenter(new THREE.Vector3());
      const g = new THREE.Group();
      const holder = new THREE.Group();
      holder.position.set(-c.x, -box.min.y, -c.z);
      holder.add(part.clone());
      g.add(holder);
      const ims = instanced(g, perPart[k], { heat, castShadow });
      if (noThermal) ims.forEach((m) => { m.userData.noThermal = true; });
    });
    return spots;
  };
  const freeSpot = (r, inside = true) => () => {
    const lim = inside ? BOUND - 2 : BOUND + 60;
    const x = (Math.random() * 2 - 1) * lim, z = (Math.random() * 2 - 1) * lim;
    if (!inside && Math.max(Math.abs(x), Math.abs(z)) < BOUND + 4) return null;
    if (inside && world.overlaps(x, z, r, 0, 3)) return null;
    if (inside && (Math.abs(x) < 3.5 || Math.abs(z - 9) < 2.5) && Math.random() < 0.9) return null; // trampled tracks
    return [x, z];
  };
  // pebbles and small stones everywhere
  scatter(M.namaqualand_stones_01, 300, freeSpot(0.3), { scale: [0.8, 2.6], sink: 0.01, heat: 0.34, castShadow: false });
  // boulders out in the field
  for (const [x, z, sc] of scatter(new THREE.Group().add(M.rock_09.clone()), 34, freeSpot(1.2), { scale: [4, 9], sink: 0.006, heat: 0.35 })) {
    const r = 0.055 * sc;
    world.addDynamic(x - r, 0, z - r, x + r, 0.025 * sc, z + r, { mat: 'concrete' });
  }
  scatter(new THREE.Group().add(M.rock_09.clone()), 60, freeSpot(0, false), { scale: [8, 22], sink: 0.006, heat: 0.35 });
  // desert shrubs and dead branches
  scatter(M.wild_rooibos_bush, 80, freeSpot(0.8), { scale: [1.2, 2.3], heat: 0.26, noThermal: false });
  scatter(M.wild_rooibos_bush, 60, freeSpot(0, false), { scale: [1.4, 2.8], heat: 0.26 });
  scatter(M.dry_branches_medium_01, 45, freeSpot(0.8), { scale: [0.9, 1.5], heat: 0.28 });
  // quiver trees beyond the perimeter
  scatter(new THREE.Group().add(M.quiver_tree_02.clone()), 14, freeSpot(0, false), { scale: [2.4, 3.8], heat: 0.27 });

  // dry grass tufts swaying in the wind
  const grassUniforms = { uTime: { value: 0 } };
  {
    const a = new THREE.PlaneGeometry(0.75, 0.46); a.translate(0, 0.23, 0);
    const b = a.clone(); b.rotateY(Math.PI / 2);
    const geo = mergeGeometries([a, b]);
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const mat = new THREE.MeshStandardMaterial({ map: TX.grassTexture(), alphaTest: 0.45, side: THREE.DoubleSide, color: 0xd8c9a0, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = grassUniforms.uTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.45;
          float sway = (sin(uTime * 1.6 + ph) + 0.4 * sin(uTime * 3.7 + ph * 2.0)) * 0.07 * position.y * 2.2;
          transformed.x += sway; transformed.z += sway * 0.6;
        #endif`);
    };
    const pl = [];
    for (let i = 0; i < 1400 && pl.length < 240; i++) {
      const x = (Math.random() * 2 - 1) * (BOUND - 1.5), z = (Math.random() * 2 - 1) * (BOUND - 1.5);
      if (world.overlaps(x, z, 0.6, 0, 3)) continue;
      // fewer tufts on the trampled roads through the gates
      if ((Math.abs(x) < 4 || Math.abs(z - 9) < 3) && Math.random() < 0.85) continue;
      const s = 0.6 + Math.random() * 0.9;
      pl.push(place(x, 0, z, Math.random() * 6, 0, s));
    }
    const grass = instanced(new THREE.Group().add(new THREE.Mesh(geo, mat)), pl, { castShadow: false });
    for (const m of grass) { m.userData.noThermal = true; }
  }

  // security lamps: the fixtures are always there; bulbs and lights switch on at night
  const lamps = new THREE.Group();      // lights + glowing bulbs (added to the scene at night)
  const lampLights = [];
  {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.6, metalness: 0.6 });
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb65c, emissiveIntensity: 9, roughness: 0.4 });
    const fixtures = [];
    const add = (x, y, z, ry, pole) => {
      if (pole) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, y + 0.4, 8), poleMat);
        const bx = x + Math.sin(ry) * 0.386, bz = z + Math.cos(ry) * 0.386;
        p.position.set(bx, (y + 0.4) / 2, bz); p.castShadow = true; p.userData.heat = 0.3; p.userData.env = true;
        props.add(p);
        world.addDynamic(bx - 0.1, 0, bz - 0.1, bx + 0.1, y, bz + 0.1, { mat: 'metal', blocksSight: false });
      }
      fixtures.push(place(x, y, z, ry));
      const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), bulbMat);
      bulb.rotation.x = Math.PI / 2; bulb.position.set(x, y - 0.35, z); bulb.userData.heat = 0.8;
      lamps.add(bulb);
      const l = new THREE.PointLight(0xffb866, 30, 26, 2);
      l.position.set(x, y - 0.5, z);
      lamps.add(l);
      lampLights.push(l);
    };
    add(-3.5, 2.8, -15.614, Math.PI, false);
    add(15.614, 4.9, -26.2, Math.PI / 2, false);
    add(-3.95, 3.3, 41.164, 0, false);
    add(21, 6.0, 17.814, 0, true);
    instanced(M.security_light, fixtures, { heat: 0.3 });
  }

  const meshes = G.build(scene, mats, shadows);

  // baked ambient occlusion on the level, ground and props
  const ao = bakeAO(world, BOUND);
  for (const [k, m] of Object.entries(mats)) applyBakedAO(m, ao, 'ao-' + k);
  applyBakedAO(groundMatRef, ao, 'ao-ground');
  const aoDone = new Set();
  props.traverse((o) => {
    if (!o.isMesh || aoDone.has(o.material) || o.material.alphaTest > 0) return;
    aoDone.add(o.material);
    applyBakedAO(o.material, ao, 'ao-prop-' + o.material.uuid);
  });

  // ---------------- navigation ----------------
  const nav = new NavGrid(world, -BOUND, -BOUND, BOUND, BOUND, 0.5, 0.38);
  nav.build();

  // ---------------- cover points ----------------
  const covers = [];
  for (const b of coverBoxes) {
    const h = b.y1;
    const faces = [
      { nx: 1, nz: 0, a: b.z0, b: b.z1, fixed: b.x1, along: 'z' },
      { nx: -1, nz: 0, a: b.z0, b: b.z1, fixed: b.x0, along: 'z' },
      { nx: 0, nz: 1, a: b.x0, b: b.x1, fixed: b.z1, along: 'x' },
      { nx: 0, nz: -1, a: b.x0, b: b.x1, fixed: b.z0, along: 'x' },
    ];
    for (const f of faces) {
      const len = f.b - f.a;
      if (len < 0.55) continue;
      const n = Math.max(1, Math.floor(len / 1.4));
      for (let i = 0; i < n; i++) {
        const t = f.a + (len * (i + 0.5)) / n;
        const x = f.along === 'z' ? f.fixed + f.nx * 0.6 : t;
        const z = f.along === 'z' ? t : f.fixed + f.nz * 0.6;
        if (!nav.walkable(x, z)) continue;
        if (Math.abs(x) > BOUND - 1 || Math.abs(z) > BOUND - 1) continue;
        const edgeDist = Math.min(t - f.a, f.b - t);
        covers.push({
          x, z, dx: -f.nx, dz: -f.nz, h, low: h < 1.5,
          tx: f.along === 'z' ? 0 : 1, tz: f.along === 'z' ? 1 : 0,
          edge: edgeDist < 1.2, occupant: null, box: b,
        });
      }
    }
  }

  const spawnPoints = [
    [-62, -62], [0, -64], [62, -62], [64, 0], [62, 62], [0, 64], [-62, 62], [-64, 0],
    [-64, -30], [64, 30], [30, -64], [-30, 64], [64, -32], [-64, 32], [34, 64], [-34, -64],
  ].map(([x, z]) => ({ x, z })).filter((p) => nav.walkable(p.x, p.z));

  // patrol / reinforcement waypoints inside the compound
  const waypoints = [];
  for (let i = 0; i < 400 && waypoints.length < 60; i++) {
    const x = (Math.random() * 2 - 1) * (WALL - 3), z = (Math.random() * 2 - 1) * (WALL - 3);
    if (nav.walkable(x, z)) waypoints.push({ x, z });
  }

  return {
    world, nav, covers, spawnPoints, waypoints, explosiveBarrels, minimap, meshes, props, grassUniforms, lamps,
    ao, groundUniforms: groundMatRef.userData.groundUniforms,
    playerSpawn: { x: 3, z: -20.5, yaw: Math.PI },
    resupply: { x: -6.5, z: -26.45, r: 2.0 },
    bounds: BOUND,
  };
}

/**
 * Bakes ambient occlusion for the whole map into a small texture, analytically
 * from the collision boxes: R = contact occlusion near walls and objects,
 * G = sky occlusion under roofs, B = roof height / 8.
 */
function bakeAO(world, bound) {
  const res = 0.5, min = -(bound + 4), size = (bound + 4) * 2, n = Math.ceil(size / res);
  const contact = new Float32Array(n * n), over = new Float32Array(n * n), roof = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = min + (i + 0.5) * res, z = min + (j + 0.5) * res;
    let occ = 0, ov = 0, rh = 0;
    for (const b of world.query(x - 2.6, z - 2.6, x + 2.6, z + 2.6)) {
      if (!b.blocksSight || b.y1 < 0.12) continue;
      const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
      const d = Math.hypot(x - cx, z - cz);
      if (b.y0 > 0.3) {
        // something overhead (roofs): interiors get much less sky light
        if (d < 0.01) { ov = Math.max(ov, 0.55); rh = Math.max(rh, b.y0); }
        else if (d < 1.5) ov = Math.max(ov, 0.55 * (1 - d / 1.5) * 0.6);
        continue;
      }
      if (d < 0.01) { occ += 1; continue; }
      if (d > 2.6) continue;
      const dx = (cx - x) / d, dz = (cz - z) / d;
      const halfW = 0.5 * (Math.abs(dz) * (b.x1 - b.x0) + Math.abs(dx) * (b.z1 - b.z0));
      const w = 2 * Math.atan(halfW / d);
      const e = Math.atan(b.y1 / d);
      occ += (w / (2 * Math.PI)) * Math.sin(e) ** 2 * 1.9 * (1 - d / 2.6);
    }
    contact[j * n + i] = Math.max(0.3, 1 - occ);
    over[j * n + i] = 1 - ov;
    roof[j * n + i] = rh;
  }
  // soften
  const blur = (a) => {
    const o = new Float32Array(a.length);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let sum = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        sum += a[jj * n + ii]; c++;
      }
      o[j * n + i] = sum / c;
    }
    return o;
  };
  const cA = blur(blur(contact)), oA = blur(over);
  const data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    data[k * 4] = cA[k] * 255; data[k * 4 + 1] = oA[k] * 255; data[k * 4 + 2] = Math.min(255, roof[k] / 8 * 255); data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, min, size };
}

/** Adds the baked AO to a standard material (works for instanced meshes too). */
function applyBakedAO(mat, ao, key) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uAOMap = { value: ao.tex };
    shader.uniforms.uAOMin = { value: ao.min };
    shader.uniforms.uAOSize = { value: ao.size };
    shader.vertexShader = 'varying vec3 vAOWorld;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      #ifdef USE_INSTANCING
        vAOWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vAOWorld += normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal) * 0.3;
      #else
        vAOWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vAOWorld += normalize(mat3(modelMatrix) * objectNormal) * 0.3; // sample just off the surface
      #endif`);
    shader.fragmentShader = 'uniform sampler2D uAOMap; uniform float uAOMin; uniform float uAOSize; varying vec3 vAOWorld;\n' +
      shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      {
        vec4 bao = texture2D(uAOMap, (vAOWorld.xz - uAOMin) / uAOSize);
        float contact = mix(bao.r, 1.0, smoothstep(0.3, 2.1, vAOWorld.y));
        float over = vAOWorld.y < bao.b * 8.0 - 0.1 ? bao.g : 1.0;
        float k = contact * over;
        reflectedLight.indirectDiffuse *= k;
        reflectedLight.indirectSpecular *= k;
        reflectedLight.directDiffuse *= mix(1.0, contact, 0.3);
      }`);
  };
  mat.customProgramCacheKey = () => key;
}

/** A filled sandbag: a rounded, slightly lumpy pillow (~170 triangles). */
function sandbagGeometry() {
  const W = 0.46, H = 0.17, L = 0.68;
  let g = new THREE.BoxGeometry(W, H, L, 6, 3, 8);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = x / (W / 2), ny = y / (H / 2), nz = z / (L / 2);
    y *= 1 - 0.45 * nx ** 4 - 0.35 * nz ** 4;
    x *= 1 - 0.12 * ny * ny;
    z *= 1 - 0.1 * ny * ny - 0.06 * nx * nx;
    // the tied end is folded under: flatter and a little wider
    const fold = Math.max(0, nz - 0.55) / 0.45;
    y *= 1 - 0.38 * fold * fold;
    x *= 1 + 0.07 * fold;
    const n = TX.fbm(x * 9 + 3, z * 9 + y * 5, 7, 2) - 0.5;
    p.setXYZ(i, x * (1 + n * 0.05), y + H / 2 + n * 0.012, z);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getY(i)) * 2.6; uv[i * 2 + 1] = p.getZ(i) * 2.6; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function findMap(root) {
  let map = null;
  root.traverse((o) => { if (!map && o.isMesh && o.material.map) map = o.material.map; });
  return map;
}
