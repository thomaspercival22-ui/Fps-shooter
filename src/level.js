// Builds the "Compound" map: geometry (merged per material for few draw
// calls), collision boxes, navigation grid, cover points and spawn points.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld } from './physics.js';
import { NavGrid } from './nav.js';
import { pbrMaterial } from './assets.js';
import * as TX from './textures.js';

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
    tank: new THREE.MeshStandardMaterial({ color: 0xb7b09f, roughness: 0.5, metalness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0d1114, roughness: 0.08, metalness: 0.9 }),
  };
  const containerGray = grayscale(assets.textures.container_side.diff);
  const containerColors = { red: 0x9a3a2a, blue: 0x2f5474, green: 0x4f6b43, tan: 0xa88d5f, orange: 0xb0612a, white: 0xc9c6bd };
  for (const [name, col] of Object.entries(containerColors)) {
    const m = pbrMaterial(assets, 'container_side', { color: col });
    m.map = containerGray;
    mats['cont_' + name] = m;
  }
  const hesco = TX.hescoTextures();
  mats.hesco = new THREE.MeshStandardMaterial({ map: hesco.map, normalMap: hesco.normalMap, roughness: 0.95, metalness: 0 });
  const burlap = TX.burlapTexture();
  mats.canvas = new THREE.MeshStandardMaterial({ map: burlap, color: 0x7f8062, roughness: 0.95 });

  // ---------------- helpers ----------------
  const solid = (key, x0, y0, z0, x1, y1, z1, tile, props = {}) => {
    G.box(key, x0, y0, z0, x1, y1, z1, tile);
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
    };
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
    for (let i = 0; i < uv.count; i++) { uv.setXY(i, p.getX(i) / 3, -p.getZ(i) / 3); }
    const groundMat = pbrMaterial(assets, 'gravelly_sand', { color: 0xf0e0c8, normalScale: 1.2 });
    const macro = TX.macroNoiseTexture();
    groundMat.onBeforeCompile = (shader) => {
      shader.uniforms.macroMap = { value: macro };
      shader.fragmentShader = 'uniform sampler2D macroMap;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          vec4 s2 = texture2D( map, vMapUv * 0.29 + vec2( 0.37, 0.11 ) );
          vec2 mac = texture2D( macroMap, vMapUv * 0.021 ).rg;
          sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, s2.rgb, smoothstep( 0.35, 0.7, mac.g ) * 0.65 );
          sampledDiffuseColor.rgb *= mix( 0.78, 1.16, mac.r );
          diffuseColor *= sampledDiffuseColor;
        #endif`);
    };
    const ground = new THREE.Mesh(g, groundMat);
    ground.receiveShadow = true;
    ground.matrixAutoUpdate = false;
    scene.add(ground);
  }

  // ---------------- HESCO perimeter ----------------
  {
    const t = 1.15, h = 2.2;
    for (const s of [-1, 1]) {
      const c0 = s > 0 ? BOUND : -BOUND - t, c1 = c0 + t;
      solid('hesco', -BOUND - t, 0, c0, BOUND + t, h, c1, 1.15, { mat: 'sand', noCover: true });
      solid('hesco', c0, 0, -BOUND, c1, h, BOUND, 1.15, { mat: 'sand', noCover: true });
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
    solid('cont_blue', 29.5, 0.06, -33.4, 35.56, 2.65, -30.96, 2.6, { mat: 'metal', pen: PEN.container });
    crateStack(19, -21, 2, 1);
    crateStack(22.5, -31.5, 1, 2);
    crateStack(31, -22, 2, 2);
    crateStack(25.5, -26.5, 1, 1);
  }

  // ---------------- Container yard (SE) ----------------
  const container = (color, x, z, alongX, level = 0) => {
    const L = 6.06, W = 2.44, H = 2.59;
    const y0 = level * H;
    if (alongX) solid('cont_' + color, x, y0, z, x + L, y0 + H, z + W, 2.6, { mat: 'metal', pen: PEN.container });
    else solid('cont_' + color, x, y0, z, x + W, y0 + H, z + L, 2.6, { mat: 'metal', pen: PEN.container });
  };
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

  // ---------------- Military truck ----------------
  let truckTyres = [];
  {
    const x = -14, z = -4; // rear-left corner; truck points +x
    solid('metalDark', x, 0.55, z, x + 6.4, 1.25, z + 2.4, 2, { mat: 'metal' });           // chassis + bed floor
    solid('metalDark', x + 4.6, 1.25, z + 0.1, x + 6.4, 2.7, z + 2.3, 2, { mat: 'metal', noCover: true }); // cab
    G.box('glass', x + 6.41, 1.85, z + 0.25, x + 6.44, 2.5, z + 2.15, 1);
    G.box('glass', x + 5.1, 1.85, z + 0.08, x + 6.0, 2.45, z + 0.1, 1);
    G.box('glass', x + 5.1, 1.85, z + 2.3, x + 6.0, 2.45, z + 2.32, 1);
    // canvas-covered cargo bed
    G.box('canvas', x, 1.25, z + 0.05, x + 4.5, 2.9, z + 2.35, 1.5);
    world.add(x, 1.25, z + 0.05, x + 4.5, 2.9, z + 2.35, { mat: 'wood', pen: 0.8 });
    minimap.push(world.boxes[world.boxes.length - 1]);
    truckTyres = [[x + 1.1, z - 0.02], [x + 2.3, z - 0.02], [x + 5.4, z - 0.02], [x + 1.1, z + 2.42], [x + 2.3, z + 2.42], [x + 5.4, z + 2.42]];
  }

  // ---------------- courtyard cover ----------------
  const jersey = (x, z, alongX) => {
    const shape = new THREE.Shape([
      new THREE.Vector2(-0.3, 0), new THREE.Vector2(0.3, 0), new THREE.Vector2(0.3, 0.08), new THREE.Vector2(0.13, 0.33),
      new THREE.Vector2(0.08, 0.86), new THREE.Vector2(-0.08, 0.86), new THREE.Vector2(-0.13, 0.33), new THREE.Vector2(-0.3, 0.08),
    ]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false });
    g.translate(0, 0, -1.5);
    if (alongX) g.rotateY(Math.PI / 2);
    g.translate(x, 0, z);
    G.geometry('concrete', g, 1.6);
    if (alongX) world.add(x - 1.5, 0, z - 0.3, x + 1.5, 0.86, z + 0.3, { mat: 'concrete' });
    else world.add(x - 0.3, 0, z - 1.5, x + 0.3, 0.86, z + 1.5, { mat: 'concrete' });
    coverBoxes.push(world.boxes[world.boxes.length - 1]);
  };
  jersey(-3.5, 30, true); jersey(3.2, 22, true); jersey(-4.5, 10, true); jersey(4, 2.5, true);
  jersey(-12, 14, false); jersey(12, -6, false); jersey(-20, -14, true); jersey(20, 2, true);
  jersey(0, -56, true); jersey(-3.2, -56, true); jersey(58, 10, false); jersey(58, 14, false);
  jersey(25, -56, true); jersey(-56, 40, false); jersey(46, -30, false);

  // crates
  function crateStack(x, z, nx, nz, layers = 2) {
    const w = 1.25, d = 0.85, h = 0.8;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const L = Math.max(1, layers - ((i + j) % 2));
      const x0 = x + i * (w + 0.02), z0 = z + j * (d + 0.02);
      solid('planks', x0, 0, z0, x0 + w, h * L, z0 + d, 1.2, { mat: 'wood', pen: PEN.crate });
      // steel straps
      for (let l = 0; l < L; l++) {
        G.box('metalDark', x0 - 0.01, l * h + 0.12, z0 - 0.01, x0 + w + 0.01, l * h + 0.17, z0 + d + 0.01, 2);
        G.box('metalDark', x0 - 0.01, l * h + h - 0.17, z0 - 0.01, x0 + w + 0.01, l * h + h - 0.12, z0 + d + 0.01, 2);
      }
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
  const instanced = (model, placements, { castShadow = true, map = null, color = null, keepMaps = true } = {}) => {
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
      im.computeBoundingSphere();
      props.add(im);
      out.push(im);
    });
    return out;
  };
  const place = (x, y, z, ry = 0, rx = 0, s = 1) => new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(s, s, s));

  // sandbags: low-poly procedural pillows (hundreds of them, so keep them cheap)
  {
    const bagMat = new THREE.MeshStandardMaterial({ map: burlap, color: 0xd6c39b, roughness: 0.95, metalness: 0 });
    const bag = new THREE.Mesh(sandbagGeometry(), bagMat);
    // split into spatial chunks so off-screen groups are culled
    const chunks = new Map();
    for (const b of bagSlots) {
      const k = `${Math.floor(b.x / 48)},${Math.floor(b.z / 48)}`;
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(place(b.x, b.y, b.z, b.ry, 0, 1));
    }
    for (const list of chunks.values()) instanced(new THREE.Group().add(bag.clone()), list);
  }

  // barrels
  const barrelSpots = [[-28, -12.5], [-28.7, -11.7], [-27.9, -10.9], [-38, -8], [-37.2, -7.3], [9.5, 7], [-5, -12], [-4.3, -12.6],
    [30, -22.3], [33.5, -20.5], [34.2, -21.2], [-20, 18], [22, 6], [-40, 38], [38, 38], [-12, -38], [14, -38.5], [62, -40], [-62, -38], [40, 60]];
  const explosiveSpots = [[-29.5, -8], [-36.5, -13.8], [-26.8, -12], [18.5, 6.2], [-6, 31], [33, -24.5], [-44, 20], [44, -20]];
  const barrelPl = [];
  for (const [x, z] of barrelSpots) {
    barrelPl.push(place(x, 0, z, Math.random() * 6));
    const b = world.add(x - 0.3, 0, z - 0.3, x + 0.3, 0.93, z + 0.3, { mat: 'metal', pen: PEN.barrel });
    coverBoxes.push(b);
  }
  instanced(assets.models.barrel_03, barrelPl);
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
  for (const [x, z] of truckTyres) tyrePl.push(place(x, 0.5, z, 0, 0, 1.65));
  instanced(assets.models.old_tyre, tyrePl, { castShadow: false });

  // ammo boxes on the resupply crate
  instanced(assets.models.ammo_box, [place(-7.0, 0.85, -26.45, Math.PI / 2), place(-6.6, 0.85, -26.45, Math.PI / 2 + 0.1), place(-6.1, 0.85, -26.4, Math.PI / 2 - 0.1)]);
  instanced(assets.models.medical_box, [place(3.2, 0.9, -24.35, 0.3)]);

  world.build();
  // scattered rocks
  {
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const p = rockGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = 0.75 + TX.fbm(p.getX(i) * 2 + 5, p.getY(i) * 2 + p.getZ(i), 3, 2) * 0.5;
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.6, p.getZ(i) * s);
    }
    rockGeo.computeVertexNormals();
    const rockMat = pbrMaterial(assets, 'concrete_wall_008', { color: 0xc9b393 });
    const pl = [];
    for (let i = 0; i < 260; i++) {
      const x = (Math.random() * 2 - 1) * (BOUND - 2), z = (Math.random() * 2 - 1) * (BOUND - 2);
      if (world.overlaps(x, z, 0.8, 0, 3)) continue;
      const s = 0.08 + Math.random() ** 3 * 0.35;
      pl.push(place(x, -s * 0.2, z, Math.random() * 6, 0, s));
    }
    instanced(new THREE.Group().add(new THREE.Mesh(rockGeo, rockMat)), pl, { castShadow: false });
  }

  const meshes = G.build(scene, mats, shadows);

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
    world, nav, covers, spawnPoints, waypoints, explosiveBarrels, minimap, meshes, props,
    playerSpawn: { x: 3, z: -20.5, yaw: Math.PI },
    resupply: { x: -6.5, z: -26.45, r: 2.0 },
    bounds: BOUND,
  };
}

/** A filled sandbag: a rounded, slightly lumpy pillow (~170 triangles). */
function sandbagGeometry() {
  const W = 0.46, H = 0.17, L = 0.68;
  let g = new THREE.BoxGeometry(W, H, L, 3, 2, 4);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = x / (W / 2), ny = y / (H / 2), nz = z / (L / 2);
    y *= 1 - 0.45 * nx ** 4 - 0.35 * nz ** 4;
    x *= 1 - 0.12 * ny * ny;
    z *= 1 - 0.1 * ny * ny - 0.06 * nx * nx;
    const n = TX.fbm(x * 9 + 3, z * 9 + y * 5, 7, 2) - 0.5;
    p.setXYZ(i, x * (1 + n * 0.05), y + H / 2 + n * 0.012, z);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getY(i)) * 2.2; uv[i * 2 + 1] = p.getZ(i) * 2.2; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function findMap(root) {
  let map = null;
  root.traverse((o) => { if (!map && o.isMesh && o.material.map) map = o.material.map; });
  return map;
}
