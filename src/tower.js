// Builds "Meridian Tower", floor 47: a full office floor of a high-rise for
// close-quarters hostage rescue. Concrete core (stairs, lifts, restrooms,
// IT closet), glass curtain wall, private offices, boardroom, executive
// suite, open-plan desks, kitchen, server room and reception, with the city
// 183 m below. Same interface as buildLevel (collision boxes, nav grid,
// cover, minimap, AO) plus the mission scenario: hostiles at their posts,
// hostages and civilians.
import * as THREE from 'three';
import { CollisionWorld } from './physics.js';
import { NavGrid } from './nav.js';
import { pbrMaterial } from './assets.js';
import { GeoBatch, bakeAO, applyBakedAO, makeCovers } from './level.js';
import { PropSet } from './props.js';
import * as OT from './officetex.js';

export const TOWER = { x0: -24, x1: 24, z0: -18, z1: 18, ceil: 2.8, storey: 3.9, street: -183, floor: 47 };
const PEN = { dry: 0.6, glass: 0.9, wood: 0.55, metal: 0.5, rack: 0.35 };

export function buildTower(scene, assets, opts = {}) {
  const shadows = opts.shadows !== false;
  const { x0: X0, x1: X1, z0: Z0, z1: Z1, ceil: CEIL, storey: ST } = TOWER;
  const world = new CollisionWorld(-30, -24, 30, 24, 2);
  world.groundMat = 'carpet'; // the office floor (the core has concrete floor boxes of its own)
  world.groundRect = { x0: X0 - 0.05, x1: X1 + 0.05, z0: Z0 - 0.05, z1: Z1 + 0.05 };
  const G = new GeoBatch();
  const coverBoxes = [], minimap = [];

  // ---------------- materials ----------------
  const carpet = OT.carpetTextures(0x4b5058, 0x31363e);
  const carpetB = OT.carpetTextures(0x5a5048, 0x3b342e);
  const paintBump = OT.paintBump();
  const std = (o) => { const m = new THREE.MeshStandardMaterial(o); m.userData.noWet = true; return m; };
  const repeat = (t, r) => { t.repeat.set(r, r); return t; };
  const mats = {
    carpet: std({ map: carpet.map, bumpMap: carpet.bump, bumpScale: 1.2, roughness: 0.97 }),
    carpetB: std({ map: carpetB.map, bumpMap: carpetB.bump, bumpScale: 1.2, roughness: 0.97 }),
    stone: std({ map: OT.stoneTexture(), roughness: 0.22, metalness: 0.0 }),
    vinyl: std({ color: 0xb9b6ae, roughness: 0.45, bumpMap: paintBump, bumpScale: 0.3 }),
    ceiling: std({ map: OT.ceilingTexture(), roughness: 0.92 }),
    paint: std({ color: 0xe9e5dc, roughness: 0.82, bumpMap: paintBump, bumpScale: 0.6 }),
    paintAccent: std({ color: 0x5d6b73, roughness: 0.8, bumpMap: paintBump, bumpScale: 0.6 }),
    core: std({ color: 0xd6d0c4, roughness: 0.85, bumpMap: paintBump, bumpScale: 0.8 }),
    stairConcrete: pbrMaterial(assets, 'concrete_wall_008', { color: 0xd9d6cf }),
    coreFloor: pbrMaterial(assets, 'concrete_floor_worn_001', { color: 0xc8c4bb }),
    wood: std({ map: OT.woodTexture(false), roughness: 0.4 }),
    woodLight: std({ map: OT.woodTexture(true), roughness: 0.45 }),
    laminate: std({ color: 0xe8e6e1, roughness: 0.35 }),
    steel: std({ color: 0x3b3e42, roughness: 0.45, metalness: 0.7 }),
    brushed: std({ color: 0xb7b9bb, roughness: 0.32, metalness: 0.9 }),
    alu: std({ color: 0x2a2c2f, roughness: 0.38, metalness: 0.75 }),
    fabric: std({ color: 0x55636e, roughness: 0.95 }),
    fabricDark: std({ color: 0x26282b, roughness: 0.9 }),
    plastic: std({ color: 0x151618, roughness: 0.5 }),
    whiteMetal: std({ color: 0xdcdcd8, roughness: 0.5, metalness: 0.3 }),
    leaf: std({ color: 0x2f5a2c, roughness: 0.7, side: THREE.DoubleSide }),
    pot: std({ color: 0x3a3632, roughness: 0.6 }),
    rack: std({ color: 0x1a1b1d, roughness: 0.55, metalness: 0.5 }),
    skirting: std({ color: 0x2b2b2b, roughness: 0.6 }),
    rubber: std({ color: 0x202020, roughness: 0.9 }),
    lightPanel: std({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 1.6, roughness: 0.6 }),
    exitSign: std({ map: OT.signTexture('EXIT'), emissive: 0xffffff, emissiveMap: null, roughness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xb4c4c8, transparent: true, opacity: 0.09, roughness: 0.03, metalness: 0.05, envMapIntensity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
    facadeGlass: new THREE.MeshStandardMaterial({ color: 0x7d8f98, transparent: true, opacity: 0.22, roughness: 0.03, metalness: 0.45, depthWrite: false, side: THREE.DoubleSide }),
    frost: new THREE.MeshStandardMaterial({ color: 0xf4f6f6, transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false, side: THREE.DoubleSide }),
  };
  mats.exitSign.emissiveMap = mats.exitSign.map; mats.exitSign.emissiveIntensity = 1.4;
  for (const k of ['glass', 'facadeGlass', 'frost']) mats[k].userData.noWet = true;
  for (const k of ['stairConcrete', 'coreFloor']) mats[k].userData.noWet = true;
  repeat(mats.carpet.map, 1); repeat(mats.carpetB.map, 1);

  // ---------------- helpers ----------------
  const solid = (key, x0, y0, z0, x1, y1, z1, tile = 2, props = {}) => {
    if (key !== 'none') G.box(key, x0, y0, z0, x1, y1, z1, tile);
    const b = world.add(x0, y0, z0, x1, y1, z1, props);
    if (y1 - y0 > 0.7 && y0 < 0.3 && !props.noCover) coverBoxes.push(b);
    if (y1 > 1.0 && !props.noMap) minimap.push(b);
    return b;
  };
  const deco = (key, x0, y0, z0, x1, y1, z1, tile = 2) => G.box(key, Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1), tile);
  /** Axis box on a wall line: s along the wall, d across it. */
  const onWall = (axis, key, s0, s1, y0, y1, d0, d1, tile, props, isSolid = true) => {
    if (s1 - s0 < 0.005 || y1 - y0 < 0.005) return;
    const f = isSolid ? solid : (k, a, b, c, d, e, g, t) => deco(k, a, b, c, d, e, g, t);
    if (axis === 'x') f(key, s0, y0, d0, s1, y1, d1, tile, props);
    else f(key, d0, y0, s0, d1, y1, s1, tile, props);
  };
  const doorLeaves = [];
  /**
   * Interior wall along X (axis 'x', at z = c) or Z (at x = c) from a to b.
   * kind: 'dry' plasterboard, 'core' concrete, 'glass' glazed partition. Openings: {from, to, top, leaf: +1/-1 side the door swings to}.
   */
  const wall = (kind, axis, a, b, c, openings = [], opt = {}) => {
    const t = kind === 'core' ? 0.3 : kind === 'glass' ? 0.08 : 0.12;
    const d0 = c - t / 2, d1 = c + t / 2;
    const key = opt.key || (kind === 'core' ? 'core' : 'paint');
    const props = kind === 'core' ? { mat: 'concrete' } : kind === 'glass' ? { mat: 'glass', pen: PEN.glass, blocksSight: false, noCover: true } : { mat: 'plaster', pen: PEN.dry };
    const ops = [...openings].sort((p, q) => p.from - q.from);
    let cur = a;
    const span = (s0, s1) => {
      if (s1 - s0 < 0.005) return;
      if (kind === 'glass') {
        onWall(axis, 'glass', s0, s1, 0.1, CEIL - 0.05, c - 0.006, c + 0.006, 2, props);
        onWall(axis, 'alu', s0, s1, 0, 0.1, d0, d1, 2, {}, false);
        onWall(axis, 'alu', s0, s1, CEIL - 0.05, CEIL, d0, d1, 2, {}, false);
        for (let s = s0; s <= s1 + 0.01; s += Math.max(0.6, (s1 - s0) / Math.max(1, Math.round((s1 - s0) / 1.2)))) onWall(axis, 'alu', Math.min(s, s1) - 0.025, Math.min(s, s1) + 0.025, 0, CEIL, d0, d1, 2, {}, false);
        // frosted manifestation band at eye level
        onWall(axis, 'frost', s0, s1, 1.05, 1.45, c - 0.009, c + 0.009, 2, {}, false);
      } else {
        onWall(axis, key, s0, s1, 0, CEIL, d0, d1, 1.6, props);
        if (kind === 'dry') for (const dd of [[d0 - 0.012, d0], [d1, d1 + 0.012]]) onWall(axis, 'skirting', s0, s1, 0, 0.09, dd[0], dd[1], 2, {}, false);
      }
    };
    for (const o of ops) {
      span(cur, o.from);
      const top = o.top || 2.2;
      // head over the opening
      if (kind === 'glass') {
        onWall(axis, 'glass', o.from, o.to, top + 0.05, CEIL - 0.05, c - 0.006, c + 0.006, 2, props);
        onWall(axis, 'alu', o.from, o.to, top, top + 0.05, d0, d1, 2, {}, false);
      } else onWall(axis, key, o.from, o.to, top, CEIL, d0, d1, 1.6, props);
      // frame
      onWall(axis, kind === 'core' ? 'steel' : 'alu', o.from - 0.04, o.from, 0, top, d0 - 0.01, d1 + 0.01, 2, {}, false);
      onWall(axis, kind === 'core' ? 'steel' : 'alu', o.to, o.to + 0.04, 0, top, d0 - 0.01, d1 + 0.01, 2, {}, false);
      onWall(axis, kind === 'core' ? 'steel' : 'alu', o.from - 0.04, o.to + 0.04, top, top + 0.04, d0 - 0.01, d1 + 0.01, 2, {}, false);
      if (o.leaf) doorLeaves.push({ axis, at: o.leafAtEnd ? o.to : o.from, end: !!o.leafAtEnd, w: Math.min(1.0, o.to - o.from - 0.05), c, side: o.leaf, top, glass: kind === 'glass', steel: kind === 'core' });
      cur = o.to;
    }
    span(cur, b);
  };
  const door = (from, w = 1.2, leaf = 1, extra = {}) => ({ from, to: from + w, top: 2.2, leaf, ...extra });

  /** Local box on a piece of furniture, rotated by multiples of 90 degrees about (cx, cz). */
  const rb = (cx, cz, rot, key, lx0, y0, lz0, lx1, y1, lz1, isSolid = false, props = {}) => {
    const r = ((Math.round(rot / (Math.PI / 2)) % 4) + 4) % 4;
    const tr = (x, z) => (r === 0 ? [x, z] : r === 1 ? [z, -x] : r === 2 ? [-x, -z] : [-z, x]);
    const [ax, az] = tr(lx0, lz0), [bx, bz] = tr(lx1, lz1);
    const x0 = cx + Math.min(ax, bx), x1 = cx + Math.max(ax, bx), z0 = cz + Math.min(az, bz), z1 = cz + Math.max(az, bz);
    if (isSolid) return solid(key, x0, y0, z0, x1, y1, z1, 1.2, props);
    deco(key, x0, y0, z0, x1, y1, z1, 1.2);
    return null;
  };
  const screens = [0, 1, 2, 3].map((i) => std({ map: OT.screenTexture(i + 1), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0.9, roughness: 0.25 }));
  screens.forEach((m, i) => { m.emissiveMap = m.map; mats['screen' + i] = m; });
  let screenN = 0;
  // real furniture and fixtures (props.js) where loaded; the sculpted pieces otherwise
  const P = new PropSet();
  const loc = (cx, cz, rot, lx, lz) => { const c = Math.cos(rot), s = Math.sin(rot); return [cx + lx * c + lz * s, cz - lx * s + lz * c]; };
  const jitter = (x, z, a) => (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453 % 1) * a;
  /** A prop on the floor with a box collider around its footprint (skipped where something already stands). */
  const standing = (name, x, z, ry = 0, props = {}) => {
    if (!P.has(name)) return false;
    const f = P.footprint(name, x, z, ry);
    P.put(name, x, 0, z, ry);
    solid('none', f.x0, 0, f.z0, f.x1, f.h, f.z1, 1, { mat: 'metal', pen: PEN.metal, noMap: true, noCover: f.h < 0.9, ...props });
    return true;
  };
  const monitor = (cx, cz, rot, lx, lz, y = 0.75) => {
    // monitor, keyboard and mouse: the screen faces the user (local +z)
    const [x, z] = loc(cx, cz, rot, lx, lz + 0.1);
    if (P.put('computer', x, y, z, rot + Math.PI)) return true;
    rb(cx, cz, rot, 'plastic', lx - 0.1, 0.745, lz - 0.08, lx + 0.1, 0.76, lz + 0.08);
    rb(cx, cz, rot, 'plastic', lx - 0.02, 0.76, lz - 0.02, lx + 0.02, 0.98, lz + 0.02);
    rb(cx, cz, rot, 'plastic', lx - 0.29, 0.92, lz - 0.025, lx + 0.29, 1.27, lz + 0.01);
    rb(cx, cz, rot, 'screen' + (screenN++ % 4), lx - 0.275, 0.935, lz + 0.01, lx + 0.275, 1.255, lz + 0.016);
    return false;
  };
  const chair = (cx, cz, rot, lx, lz) => {
    const [x, z] = loc(cx, cz, rot, lx, lz);
    if (P.put('officeChair', x, 0, z, rot + jitter(x, z, 0.5) - 0.25)) return;
    rb(cx, cz, rot, 'plastic', lx - 0.03, 0.06, lz - 0.03, lx + 0.03, 0.42, lz + 0.03);
    for (const [dx, dz] of [[-0.3, 0], [0.3, 0], [0, -0.3], [0, 0.3]]) rb(cx, cz, rot, 'plastic', lx + Math.min(0, dx) - 0.02, 0.0, lz + Math.min(0, dz) - 0.02, lx + Math.max(0, dx) + 0.02, 0.06, lz + Math.max(0, dz) + 0.02);
    rb(cx, cz, rot, 'fabricDark', lx - 0.25, 0.42, lz - 0.24, lx + 0.25, 0.5, lz + 0.24);
    rb(cx, cz, rot, 'fabricDark', lx - 0.23, 0.55, lz + 0.22, lx + 0.23, 1.08, lz + 0.28);
    rb(cx, cz, rot, 'plastic', lx - 0.02, 0.45, lz + 0.22, lx + 0.02, 0.6, lz + 0.26);
  };
  /** Workstation (1.6 x 0.8): the user sits on local +z, facing -z. */
  const desk = (cx, cz, rot, withChair = true, key = 'laminate') => {
    rb(cx, cz, rot, key, -0.8, 0.72, -0.4, 0.8, 0.75, 0.4, true, { mat: 'wood', pen: PEN.wood, noMap: true });
    for (const sx of [-0.76, 0.72]) rb(cx, cz, rot, 'steel', sx, 0, -0.38, sx + 0.04, 0.72, 0.38);
    rb(cx, cz, rot, 'steel', -0.76, 0.3, -0.36, 0.76, 0.5, -0.34);            // modesty panel
    rb(cx, cz, rot, 'whiteMetal', 0.2, 0, -0.35, 0.62, 0.6, 0.2, true, { mat: 'metal', pen: PEN.metal, noMap: true, noCover: true }); // pedestal
    if (!monitor(cx, cz, rot, -0.1, -0.2)) rb(cx, cz, rot, 'plastic', -0.35, 0.75, 0.02, 0.1, 0.77, 0.17); // keyboard
    if (withChair) chair(cx, cz, rot, -0.15, 0.75);
  };
  /** Benching cluster: 2 x n desks back to back with a fabric screen between. */
  const cluster = (cx, cz, n, alongX = true, rotBase = 0) => {
    const rot = alongX ? 0 : Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 1.62;
      const [ax, az] = alongX ? [cx + off, cz] : [cx, cz + off];
      desk(alongX ? ax : ax - 0.41, alongX ? az - 0.41 : az, rot + rotBase + Math.PI);
      desk(alongX ? ax : ax + 0.41, alongX ? az + 0.41 : az, rot + rotBase);
    }
    const L = n * 1.62;
    if (alongX) solid('fabric', cx - L / 2, 0.75, cz - 0.03, cx + L / 2, 1.22, cz + 0.03, 1.2, { mat: 'wood', pen: PEN.dry, noMap: true, noCover: true });
    else solid('fabric', cx - 0.03, 0.75, cz - L / 2, cx + 0.03, 1.22, cz + L / 2, 1.2, { mat: 'wood', pen: PEN.dry, noMap: true, noCover: true });
  };
  const plant = (x, z, h = 1.3) => {
    const real = h >= 1.2 ? 'plantBush' : 'plantTall';
    solid(P.has(real) ? 'none' : 'pot', x - 0.22, 0, z - 0.22, x + 0.22, 0.5, z + 0.22, 1, { mat: 'plaster', noMap: true, noCover: true });
    if (P.put(real, x, 0, z, jitter(x, z, 6.28))) return;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4, r = 0.12 + Math.random() * 0.2, y = 0.5 + Math.random() * (h - 0.6);
      const g = new THREE.PlaneGeometry(0.34, 0.7);
      g.translate(0, 0.35, 0); g.rotateX(-0.5 - Math.random() * 0.5); g.rotateY(a); g.translate(x + Math.cos(a) * r * 0.4, y, z + Math.sin(a) * r * 0.4);
      G.geometry('leaf', g, 1);
    }
  };
  const sofa = (cx, cz, rot, w = 2.0) => {
    const real = P.has('sofa');
    rb(cx, cz, rot, real ? 'none' : 'fabric', -w / 2, 0.1, -0.45, w / 2, 0.45, 0.45, true, { mat: 'wood', pen: 0.8, noMap: true });
    if (real) { P.put('sofa', cx, 0, cz, rot, w / 1.81); return; }
    rb(cx, cz, rot, 'fabric', -w / 2, 0.45, 0.25, w / 2, 0.85, 0.45);
    for (const s of [-1, 1]) rb(cx, cz, rot, 'fabric', s > 0 ? w / 2 - 0.18 : -w / 2, 0.45, -0.45, s > 0 ? w / 2 : -w / 2 + 0.18, 0.65, 0.45);
    rb(cx, cz, rot, 'steel', -w / 2 + 0.05, 0, -0.4, w / 2 - 0.05, 0.1, 0.4);
  };
  const table = (x0, z0, x1, z1, h = 0.74, key = 'wood') => {
    solid(key, x0, h - 0.04, z0, x1, h, z1, 1.2, { mat: 'wood', pen: PEN.wood, noMap: true, noCover: true });
    const lx = 0.08;
    for (const [px, pz] of [[x0 + lx, z0 + lx], [x1 - lx, z0 + lx], [x0 + lx, z1 - lx], [x1 - lx, z1 - lx]]) deco('steel', px - 0.03, 0, pz - 0.03, px + 0.03, h - 0.04, pz + 0.03);
  };
  const cabinet = (x0, z0, x1, z1, h = 1.1, key = 'whiteMetal') => solid(key, x0, 0, z0, x1, h, z1, 1, { mat: 'metal', pen: PEN.metal, noMap: h < 1.2 });

  // ---------------- floor finishes ----------------
  const floorQuad = (key, x0, z0, x1, z1, tile, top = 0.006) => G.box(key, x0, -0.02, z0, x1, top, z1, tile, true);
  floorQuad('carpet', X0, Z0, X1, Z1, 2, 0.002);
  floorQuad('stone', -3.5, -2, 16.5, 2, 1.2);          // lift lobby into reception
  floorQuad('stone', 8, -4, 16.5, -2, 1.2); floorQuad('stone', 8, 2, 16.5, 4, 1.2);
  floorQuad('coreFloor', -8, -6, -3.5, 6, 2);          // stairs + IT closet
  floorQuad('vinyl', -3.5, -6, 1.5, -2, 1);            // restrooms
  floorQuad('vinyl', -3.5, 2, 1.5, 6, 1);
  floorQuad('vinyl', 4, 11.5, 14, 18, 1);              // kitchen
  floorQuad('coreFloor', 14, 11.5, 24, 18, 2);         // server room (raised access floor look)
  floorQuad('carpetB', -24, -18, -15, -11, 2);         // executive office

  // ---------------- ceiling, slab and structure ----------------
  // the slab + plenum above the suspended ceiling: one box (ceiling for the player, roof for AO and rain)
  world.add(X0 - 0.3, CEIL, Z0 - 0.3, X1 + 0.3, ST, Z1 + 0.3, { mat: 'concrete', noMap: true });
  G.box('ceiling', X0, CEIL, Z0, X1, CEIL + 0.02, Z1, 1.2);
  // light panels (600 x 1200) on a 3 m grid, return air grilles in between
  for (let x = X0 + 2.4; x < X1 - 1; x += 3.0) for (let z = Z0 + 2.1; z < Z1 - 1; z += 3.0) {
    if (x > -8.3 && x < 8.3 && z > -6.3 && z < 6.3) continue; // core has its own lights
    deco('lightPanel', x - 0.6, CEIL - 0.012, z - 0.3, x + 0.6, CEIL, z + 0.3);
    deco('alu', x + 1.2, CEIL - 0.008, z - 0.3, x + 1.8, CEIL, z + 0.3);
  }
  for (const [x, z] of [[-5.7, -4], [-5.7, 4], [-1, -4], [-1, 4], [2.5, 0], [5.5, 0], [-5.7, 0]]) deco('lightPanel', x - 0.3, CEIL - 0.012, z - 0.3, x + 0.3, CEIL, z + 0.3);
  // perimeter columns
  for (const x of [-18, -9, 0, 9, 18]) for (const z of [Z0 + 0.9, Z1 - 0.9]) solid('paint', x - 0.35, 0, z - 0.35, x + 0.35, CEIL, z + 0.35, 1.2, { mat: 'concrete' });
  for (const z of [-9, 0, 9]) for (const x of [X0 + 0.9, X1 - 0.9]) solid('paint', x - 0.35, 0, z - 0.35, x + 0.35, CEIL, z + 0.35, 1.2, { mat: 'concrete' });

  // ---------------- curtain wall ----------------
  {
    const gp = { mat: 'glass', pen: PEN.glass, blocksSight: false, noCover: true };
    const side = (axis, a, b, c, out) => {
      onWall(axis, 'facadeGlass', a, b, 0.12, CEIL, c - 0.01, c + 0.01, 3, gp);
      // spandrel over the plenum, sill, mullions every 1.5 m, a transom at the ceiling line
      onWall(axis, 'alu', a, b, CEIL, ST, c - 0.05 + out * 0.05, c + 0.05 + out * 0.05, 2, { mat: 'metal' });
      onWall(axis, 'alu', a, b, 0, 0.12, c - 0.08, c + 0.08, 2, {}, false);
      for (let s = a; s <= b + 0.01; s += 1.5) onWall(axis, 'alu', s - 0.03, s + 0.03, 0, CEIL, c - 0.09, c + 0.09, 2, {}, false);
      // heating trench along the glass
      onWall(axis, 'alu', a, b, 0, 0.02, c - out * 0.35 - 0.12, c - out * 0.35 + 0.12, 2, {}, false);
      // invisible barrier so nobody leaves through a shot-out window
      if (axis === 'x') world.add(a, 0, c + out * 0.02, b, ST, c + out * 0.6, { blocksBullets: false, blocksSight: false });
      else world.add(c + out * 0.02, 0, a, c + out * 0.6, ST, b, { blocksBullets: false, blocksSight: false });
    };
    side('x', X0, X1, Z0, -1); side('x', X0, X1, Z1, 1);
    side('z', Z0, Z1, X0, -1); side('z', Z0, Z1, X1, 1);
  }

  // ---------------- core ----------------
  wall('core', 'x', -8.15, 8.15, -6);
  wall('core', 'x', -8.15, 8.15, 6);
  wall('core', 'z', -5.85, 5.85, -8, [door(-4.8, 1.2, -1, { steel: true }), door(3.6, 1.2, -1, { steel: true })]);
  wall('core', 'z', -5.85, -1.9, 8); wall('core', 'z', 1.9, 5.85, 8);
  wall('dry', 'z', -5.85, 5.85, -3.5, [door(-0.6, 1.2, 1)], { key: 'core' });
  wall('dry', 'x', -8, 8, -2, [door(-2.6, 1.2, -1)], { key: 'core' });
  wall('dry', 'x', -8, 8, 2, [door(-2.6, 1.2, 1)], { key: 'core' });
  wall('dry', 'z', -5.85, -2.06, 1.5, [], { key: 'core' });
  wall('dry', 'z', 2.06, 5.85, 1.5, [], { key: 'core' });
  // lift doors (brushed steel), call buttons, floor number
  for (const x of [2.6, 4.75, 6.9]) for (const s of [-1, 1]) {
    const z = s * 2 + (s < 0 ? 0.07 : -0.07);
    deco('brushed', x - 0.55, 0, z - 0.01, x + 0.55, 2.2, z + 0.01);
    deco('steel', x - 0.62, 2.2, z - 0.015, x + 0.62, 2.35, z + 0.015);
    deco('alu', x - 0.004, 0, z - 0.014, x + 0.004, 2.2, z + 0.014);
  }
  // stair A (the entry): landing, flights up and down behind a rail
  const stairs = (zA, zB) => {
    const zc = (zA + zB) / 2, w = (zB - zA) / 2 - 0.1;
    // flight up (towards +x from the landing) behind a rail; the flight down is walled off
    for (let i = 0; i < 9; i++) {
      const x = -6.4 + i * 0.28;
      deco('stairConcrete', x, 0, zA + 0.15, x + 0.28, (i + 1) * 0.17, zA + 0.15 + w, 1);
    }
    solid('none', -6.45, 0, zA + 0.15, -3.8, 1.5, zB - 0.15, 1, { mat: 'concrete', noMap: true, noCover: true, blocksSight: false });
    deco('stairConcrete', -6.4, 0, zc + 0.05, -3.8, 1.0, zB - 0.15, 1);
    deco('steel', -6.45, 0.95, zc - 0.03, -3.8, 1.0, zc + 0.03);
    for (let x = -6.45; x < -3.8; x += 0.9) deco('steel', x, 0, zc - 0.02, x + 0.04, 1.0, zc + 0.02);
    deco('steel', -6.45, 0.95, zA + 0.13, -6.4, 1.0, zB - 0.13);
  };
  stairs(-5.85, -2.15); stairs(2.15, 5.85);
  // floor number and exit signs
  const sign47 = std({ map: OT.signTexture('47', { bg: '#e8e4dc', fg: '#1b1b1b', font: 'bold 96px sans-serif', w: 256, h: 256 }), roughness: 0.6 });
  mats.sign47 = sign47;
  const signPlane = (mat, x, y, z, w, h, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
  };
  signPlane(sign47, -7.83, 1.7, -3.1, 0.5, 0.5, Math.PI / 2);
  signPlane(sign47, -7.83, 1.7, 3.1, 0.5, 0.5, Math.PI / 2);
  signPlane(mats.exitSign, -8.17, 2.45, -4.2, 0.5, 0.125, -Math.PI / 2);
  signPlane(mats.exitSign, -8.17, 2.45, 4.2, 0.5, 0.125, -Math.PI / 2);
  // restrooms: cubicle partitions, basins
  for (const s of [-1, 1]) {
    const zw = s * 5.85, zin = s * 2.15;
    for (const x of [-3.3, -2.1, -0.9]) deco('whiteMetal', x - 0.02, 0.15, zw - s * 1.5, x + 0.02, 2.0, zw);
    deco('laminate', -3.3, 0.8, zw - s * 1.5 + (s > 0 ? 0 : 0), 0.3, 0.84, zw - s * 1.5 + s * 0.02);
    solid('laminate', 0.6, 0, Math.min(zin, zin + s * 1.8), 1.35, 0.85, Math.max(zin, zin + s * 1.8), 1, { mat: 'wood', noMap: true, noCover: true });
  }
  // IT closet: small racks
  for (const z of [-1.4, -0.2, 1.0]) solid('rack', -7.7, 0, z - 0.3, -7.0, 2.0, z + 0.3, 1, { mat: 'metal', pen: PEN.rack, noMap: true });

  // ---------------- north band ----------------
  // executive office (NW) and boardroom
  wall('dry', 'z', Z0 + 0.05, -11, -15, [], { key: 'wood' });
  wall('dry', 'x', X0 + 0.05, -15, -11, [door(-17.6, 1.2, 1)]);
  wall('glass', 'x', -15, -4, -11, [door(-10.2, 1.8, 1)]);
  wall('dry', 'z', Z0 + 0.05, -11, -4);
  // exec: desk, credenza, sofa set, bookcase, art
  solid('wood', -21.5, 0.72, -15.8, -18.9, 0.76, -14.8, 1.2, { mat: 'wood', pen: PEN.wood, noMap: true });
  solid('wood', -21.4, 0, -15.75, -21.3, 0.72, -14.85, 1, { mat: 'wood', noMap: true, noCover: true });
  solid('wood', -19.1, 0, -15.75, -19.0, 0.72, -14.85, 1, { mat: 'wood', noMap: true, noCover: true });
  solid('wood', -21.4, 0, -15.1, -19.0, 0.72, -15.0, 1, { mat: 'wood', pen: PEN.wood, noMap: true });
  monitor(-20.2, -15.3, Math.PI, 0, 0, 0.76);
  chair(-20.2, -16.4, Math.PI, 0, 0);
  cabinet(-23.4, -17.6, -19, -17.1, 0.75, 'wood');
  cabinet(-15.6, -17.3, -15.15, -12, 2.1, 'wood');
  sofa(-22.9, -12.8, -Math.PI / 2, 1.9);
  table(-21.9, -13.4, -20.9, -12.2, 0.42, 'wood');
  plant(-23.3, -11.7); plant(-15.8, -11.7);
  // boardroom: long table with chairs, credenza, screen
  table(-12.8, -15.2, -6.2, -13.6, 0.74, 'wood');
  for (let x = -12.2; x < -6.4; x += 1.05) { chair(x, -15.75, Math.PI, 0, 0); chair(x, -13.05, 0, 0, 0); }
  cabinet(-12.5, -17.8, -6.5, -17.35, 0.75, 'wood');
  deco('plastic', -11.2, 1.1, -17.95, -7.8, 3.0 - 0.9, -17.9);
  deco('screen0', -11.1, 1.15, -17.9, -7.9, 2.05, -17.895);
  plant(-14.4, -17.3);
  // private offices along the north glass: glass fronts, drywall between
  const offX = [-4, 1.6, 7.2, 12.8, 18.4, 24];
  for (let i = 0; i < 5; i++) {
    const a = offX[i], b = offX[i + 1];
    wall('glass', 'x', a + 0.06, b - 0.06, -13.5, [door(a + 0.5, 1.2, 1)]);
    if (i > 0) wall('dry', 'z', Z0 + 0.05, -13.5, a);
    desk((a + b) / 2 + 0.4, -16.3, Math.PI, true, i % 2 ? 'woodLight' : 'laminate');
    cabinet(b - 0.7, -17.6, b - 0.2, -16.4, 1.2);
    chair((a + b) / 2 - 0.5, -14.6, 0, 0, 0);
    if (i % 2 === 0) plant(a + 0.6, -17.3, 1.0);
  }
  // open-plan north: benching clusters
  cluster(2.2, -10.4, 3); cluster(9.8, -10.4, 3); cluster(17.4, -10.4, 3);
  cabinet(21.5, -8.4, 23.4, -7.9, 1.1);
  // assistant desk outside the executive office
  desk(-19.8, -9.2, 0);
  cabinet(-23.3, -10.3, -22.1, -8.2, 1.3);

  // ---------------- west band ----------------
  // training room
  wall('dry', 'x', X0 + 0.05, -14.9, -6);
  wall('dry', 'x', X0 + 0.05, -14.9, 2);
  wall('glass', 'z', -6, 2, -15, [door(-1.6, 1.2, 1)]);
  for (const z of [-4.3, -2.3]) { table(-22.5, z - 0.35, -16.9, z + 0.35); for (let x = -22; x < -17; x += 1.1) chair(x, z + 0.75, 0, 0, 0); }
  table(-22.5, -0.65, -16.9, 0.05);
  for (let x = -22; x < -17; x += 1.1) chair(x, 0.45, 0, 0, 0);
  deco('plastic', -23.93, 1.0, -4.6, -23.88, 2.1, -1.0);
  deco('screen2', -23.88, 1.05, -4.5, -23.875, 2.05, -1.1);
  // lounge
  sofa(-22.7, 5.0, -Math.PI / 2, 2.4);
  sofa(-19.8, 7.8, Math.PI, 2.0);
  table(-21.4, 4.2, -20.2, 5.8, 0.42, 'woodLight');
  plant(-23.2, 2.8); plant(-16.4, 8.4); plant(-12.5, 2.8);
  sofa(-13.5, 5.2, Math.PI / 2, 1.8);

  // ---------------- south band ----------------
  // kitchen / break room
  wall('dry', 'x', 4, 14, 11.5, [{ from: 6, to: 9, top: 2.4 }]);
  wall('dry', 'z', 11.5, Z1 - 0.05, 4);
  wall('dry', 'z', 11.5, Z1 - 0.05, 14);
  solid('laminate', 4.1, 0, 16.9, 13.9, 0.9, 17.9, 1.2, { mat: 'wood', pen: PEN.wood });        // counter run
  deco('stone', 4.1, 0.9, 16.85, 13.9, 0.94, 17.9, 1.2);
  deco('laminate', 4.1, 1.5, 17.55, 13.9, 2.2, 17.9);                                           // wall cabinets
  solid('brushed', 12.8, 0, 16.0, 13.9, 2.0, 16.85, 1, { mat: 'metal', pen: PEN.metal });        // fridge
  deco('plastic', 9.0, 0.94, 17.2, 9.4, 1.35, 17.6);                                            // coffee machine
  solid('laminate', 7.5, 0, 13.6, 10.5, 0.92, 14.5, 1.2, { mat: 'wood', pen: PEN.wood });        // island
  table(5.0, 12.3, 6.4, 13.3); table(11.2, 12.3, 12.6, 13.3);
  for (const [x, z, r] of [[5.4, 12.0, 0], [6.0, 13.6, Math.PI], [11.6, 12.0, 0], [12.2, 13.6, Math.PI]]) chair(x, z, r, 0, 0);
  // server room
  wall('dry', 'x', 14, X1 - 0.05, 11.5, [door(20, 1.2, 1)]);
  const leds = [];
  for (const z of [13.4, 15.6]) for (let x = 15.0; x < 23.2; x += 0.65) {
    solid('rack', x, 0, z - 0.5, x + 0.6, 2.05, z + 0.5, 1, { mat: 'metal', pen: PEN.rack, noMap: x > 15.05 });
    leds.push([x + 0.3, z]);
  }
  // open-plan south
  for (const z of [10.8, 14.6]) { cluster(-19.6, z, 3); cluster(-11.6, z, 3); cluster(-3.6, z, 3); }
  cabinet(0.4, 16.6, 2.8, 17.2, 1.1); cabinet(-23.4, 9.3, -22.8, 12.2, 1.2);
  // print / copy area
  solid('whiteMetal', 10.0, 0, 8.6, 11.2, 1.05, 9.3, 1, { mat: 'metal', pen: PEN.metal });
  solid('whiteMetal', 12.0, 0, 8.6, 12.9, 0.95, 9.3, 1, { mat: 'metal', pen: PEN.metal });
  plant(15.8, 8.4); plant(3.2, 8.4);

  // ---------------- east band: reception, waiting, meeting rooms ----------------
  // reception desk facing the lifts and the company wall behind it
  solid('woodLight', 12.3, 0, -2.2, 13.2, 1.08, 2.2, 1, { mat: 'wood', pen: PEN.wood });
  deco('stone', 12.2, 1.08, -2.3, 13.3, 1.12, 2.3, 1.2);
  solid('laminate', 13.2, 0.72, -2.2, 14.0, 0.75, 2.2, 1, { mat: 'wood', noMap: true, noCover: true });
  monitor(13.6, -1.0, -Math.PI / 2, 0, 0); monitor(13.6, 1.0, -Math.PI / 2, 0, 0);
  chair(14.5, -1.0, -Math.PI / 2, 0, 0); chair(14.5, 1.0, -Math.PI / 2, 0, 0);
  solid('wood', 16.0, 0, -3.2, 16.25, CEIL, 3.2, 1.2, { mat: 'wood', pen: PEN.wood });
  const logo = std({ map: OT.signTexture('MERIDIAN CAPITAL', { bg: null, fg: '#e9e2cf', font: '600 64px serif', w: 1024, h: 128 }), transparent: true, roughness: 0.3, metalness: 0.8 });
  mats.logo = logo;
  signPlane(logo, 15.99, 1.75, 0, 4.2, 0.53, -Math.PI / 2);
  // waiting area
  sofa(10.4, -5.0, 0, 2.0); sofa(10.4, 5.0, Math.PI, 2.0);
  table(9.8, -3.9, 11.0, -3.2, 0.42, 'woodLight'); table(9.8, 3.2, 11.0, 3.9, 0.42, 'woodLight');
  plant(8.9, -6.9); plant(8.9, 6.9);
  // meeting rooms A and B
  for (const [za, zb, dz] of [[-9, -2, -6.2], [2, 9, 3.4]]) {
    wall('glass', 'z', za, zb, 18, [door(dz, 1.2, 1)]);
    wall('dry', 'x', 18.06, X1 - 0.05, za);
    wall('dry', 'x', 18.06, X1 - 0.05, zb);
    table(19.8, (za + zb) / 2 - 1.3, 22.2, (za + zb) / 2 + 1.3);
    for (const s of [-1, 1]) for (const k of [-0.8, 0.8]) chair(21 + s * 1.55, (za + zb) / 2 + k, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0);
  }
  // copy of the waiting chairs by the lift lobby entrance
  plant(8.9, -2.6); plant(8.9, 2.6);

  // ---------------- artwork ----------------
  const arts = [0, 1, 2].map((i) => { const m = std({ map: OT.artTexture(i + 1), roughness: 0.7 }); mats['art' + i] = m; return m; });
  const hang = (i, x, y, z, ry, w = 1.2, h = 0.9) => {
    const g = new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.03); g.rotateY(ry); g.translate(x, y, z);
    G.geometry('alu', g, 1);
    signPlane(arts[i % 3], x + Math.sin(ry) * 0.017, y, z + Math.cos(ry) * 0.017, w, h, ry);
  };
  hang(0, -15.07, 1.6, -14.5, -Math.PI / 2); hang(1, -9.0, 1.6, -6.17, Math.PI); hang(2, 9.0, 1.6, 6.17, 0);
  hang(1, -14.93, 1.6, 5.5, Math.PI / 2, 1.5, 1.0); hang(2, 4.07, 1.6, 15.0, Math.PI / 2); hang(0, 17.94, 1.6, 0, -Math.PI / 2, 1.0, 0.7);

  // ---------------- open door leaves ----------------
  // ---------------- fixtures ----------------
  {
    const wallProp = (name, x, y, z, ry) => P.put(name, x, y, z, ry);
    const W = Math.PI / 2, E = -Math.PI / 2, S = Math.PI; // facing -x, +x, +z (default: -z)
    // fire points by the stair doors and the lifts
    for (const z of [-2.6, 2.6]) { standing('extinguisher', -8.34, z, W); wallProp('fireAlarm', -8.166, 1.35, z + 0.45, W); }
    standing('extinguisher', 8.34, -4.2, E); wallProp('fireAlarm', 8.166, 1.35, -3.7, E);
    standing('extinguisher', 3.9, 11.3, 0); wallProp('fireAlarm', 3.4, 1.35, 11.434, 0);
    // clocks
    wallProp('wallClock', 4.085, 2.0, 12.6, E);        // kitchen
    wallProp('wallClock', -19.5, 2.1, -5.915, S);      // training room
    wallProp('wallClock', -4.085, 2.1, -14.5, W);      // boardroom
    // pictures in the private offices
    [-4, 1.6, 7.2, 12.8, 18.4].forEach((a, i) => { if (i > 0) wallProp(i % 2 ? 'picture1' : 'picture2', a + 0.075, 1.55, -16.0, E); });
    wallProp('picture2', -15.075, 1.55, -8.8, E);
    // water coolers, kitchen coffee cart
    standing('waterCooler', -3.0, 6.32, S);
    standing('waterCooler', 13.78, 12.2, W);
    standing('coffeeCart', 4.42, 13.0, E);
    // lounge and executive armchairs
    standing('armchair', -19.9, -12.8, W);
    standing('armchair', -20.3, 3.6, S);
    // wet floor by the restrooms
    P.put('wetFloor', -2.0, 0, -1.4, 0.4);
    // storage: shelving and boxes in the server room, boxes by the printers
    standing('shelves', 16.0, 17.7, 0); standing('shelves', 17.1, 17.7, 0);
    for (const [x, z] of [[23.72, 12.1], [23.72, 12.65], [13.7, 9.1], [14.2, 8.8]]) standing('cardboard', x, z, 0);
    P.put('cardboard', 23.72, 0.34, 12.35, 0.15);
    // cameras watching the lobby and the corridors
    wallProp('secCam', 15.72, 2.45, 2.9, W);
    wallProp('secCam', -8.43, 2.45, 5.6, W);
    wallProp('secCam', 7.9, 2.45, 5.72, S + 0.001);
  }

  for (const d of doorLeaves) {
    const s0 = d.end ? d.at - 0.02 : d.at + 0.02, dir = d.end ? -1 : 1;
    const key = d.glass ? 'glass' : d.steel ? 'steel' : 'wood';
    // leaf swung 90 degrees into the side given, hinged at the frame
    const a = s0, bb = s0 + dir * 0.045;
    const d0 = d.c + d.side * 0.07, d1 = d.c + d.side * (0.07 + d.w);
    if (d.axis === 'x') deco(key, Math.min(a, bb), 0.01, Math.min(d0, d1), Math.max(a, bb), d.top - 0.02, Math.max(d0, d1), 1);
    else deco(key, Math.min(d0, d1), 0.01, Math.min(a, bb), Math.max(d0, d1), d.top - 0.02, Math.max(a, bb), 1);
  }

  // ---------------- the building around the floor + the city below ----------------
  const outside = cityAndShell(scene, assets);

  // ---------------- build ----------------
  world.build();
  const meshes = G.build(scene, mats, shadows);
  const propGroup = new THREE.Group();
  scene.add(propGroup);
  P.build(propGroup, { heat: 0.31, shadows });
  for (const m of meshes) {
    const k = m.material;
    if (k === mats.glass || k === mats.facadeGlass || k === mats.frost) { m.castShadow = false; m.receiveShadow = false; m.userData.heat = 0.2; }
    if (k === mats.lightPanel || screens.includes(k)) m.castShadow = false;
    if (k === mats.carpet || k === mats.carpetB || k === mats.stone || k === mats.vinyl || k === mats.coreFloor) m.castShadow = false;
    if (k === mats.rack) m.userData.heat = 0.42;
  }
  meshes.forEach((m) => { if (screens.includes(m.material)) m.userData.heat = 0.45; });
  meshes.forEach((m) => { if (m.material === mats.lightPanel) { m.userData.heat = 0.4; m.userData.panel = true; } });

  // ---------------- lighting ----------------
  // office lighting: a soft hemispheric fill standing in for the ceiling panels; at night the power is
  // cut and only the green exit signs, emergency lights, server LEDs and the city glow remain
  const interior = new THREE.HemisphereLight(0xfff5e8, 0x70685e, 1.15);
  interior.position.set(0, 3, 0);
  scene.add(interior);
  const lamps = new THREE.Group(); // night: emergency lights
  {
    const em = std({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 3, roughness: 0.4 });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x55ff88, toneMapped: false });
    const box = new THREE.BoxGeometry(0.3, 0.06, 0.12);
    for (const [x, z] of [[-9, -7], [9, -7], [-9, 7], [9, 7], [-20, -9], [20, 0], [0, 12], [-12, 16], [10, -15], [-10, -15]]) {
      const m = new THREE.Mesh(box, em); m.position.set(x, CEIL - 0.05, z); lamps.add(m);
    }
    const ledGeo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    const inst = new THREE.InstancedMesh(ledGeo, ledMat, leds.length * 6);
    let n = 0; const M = new THREE.Matrix4();
    for (const [x, z] of leds) for (let k = 0; k < 6; k++) { M.makeTranslation(x - 0.2 + Math.random() * 0.4, 0.3 + Math.random() * 1.6, z + (z < 14.5 ? 0.505 : -0.505)); inst.setMatrixAt(n++, M); }
    inst.userData.noThermal = false;
    lamps.add(inst);
    const eHemi = new THREE.HemisphereLight(0xb8c8ff, 0x302a26, 0.05);
    lamps.add(eHemi);
  }
  /** Night: the power is out. Only exit signs, emergency lights, server LEDs and the city are lit. */
  const setNight = (n, city) => {
    interior.intensity = n ? 0 : 1.15;
    mats.lightPanel.emissiveIntensity = n ? 0.0 : 1.6;
    for (const m of screens) m.emissiveIntensity = n ? 0.35 : 0.9;
    city.facadeMat.userData.cityUniforms.night.value = n ? 1 : 0;
  };

  // baked AO (walls, furniture, the ceiling above)
  const ao = bakeAO(world, 30);
  for (const [k, m] of Object.entries(mats)) {
    if (!m.isMeshStandardMaterial || m.transparent || screens.includes(m) || ['lightPanel', 'exitSign', 'sign47', 'logo'].includes(k) || k.startsWith('art')) continue;
    applyBakedAO(m, ao, k === 'stairConcrete' || k === 'coreFloor' ? 'ao-t-' + k : 'ao-tower');
  }

  // ---------------- navigation ----------------
  const nav = new NavGrid(world, X0, Z0, X1, Z1, 0.5, 0.34);
  nav.build();
  const covers = makeCovers(coverBoxes, nav, 40);

  const groundUniforms = { heightMap: { value: outside.groundTex }, macroMap: { value: outside.groundTex }, wet: { value: 0 }, rainTime: { value: 0 } };
  return {
    kind: 'tower', indoor: true, wallDamp: 0.45, world, nav, covers, spawnPoints: [], waypoints: [], explosiveBarrels: [], minimap, meshes, props: propGroup,
    grassUniforms: { uTime: { value: 0 } }, lamps, lights: interior, ao, groundUniforms,
    playerSpawn: { x: -6.9, z: -4.2, yaw: Math.PI / 2 },
    resupply: { x: -7.3, z: -5.4, r: 0.8 },
    bounds: 26,
    menuView: { cx: 0, cy: 1.5, cz: 0, r: 60, y: 8 },
    rainFloor: TOWER.street,
    scenario: towerScenario(),
    city: outside,
    setNight: (n) => setNight(n, outside),
  };
}

/**
 * Who is where on floor 47. Hostiles stand guard or patrol; three of them hold
 * hostages and will execute them if the assault is slow or loud.
 */
function towerScenario() {
  const E = Math.PI / 2, W = -Math.PI / 2, S = 0, N = Math.PI;
  return {
    exit: { x: -7.1, z: 4.6 },
    // what the groups talk about while nobody knows the assault is coming (overheard within earshot)
    talk: {
      west: [
        ['How long do we sit up here?', 'Until the transfer clears. Relax.'],
        ['You checked the stairwells?', 'Both doors. Nobody is climbing forty-seven floors.'],
        ['The CEO keeps asking for water.', 'Then give him water. We need him talking.'],
        ['I heard a helicopter.', 'News crews. They circle, they film, they leave.'],
      ],
      lifts: [
        ['Lifts are locked off?', 'Cut the power myself. Stairs only.'],
        ['Any word from the lobby team?', 'Radio went quiet ten minutes ago.'],
        ['That is not good.', 'Probably the building. Concrete eats the signal.'],
        ['When this is done I am going somewhere warm.', 'Sure. Somewhere without windows.'],
      ],
      south: [
        ['These desks still have coffee on them.', 'They left in a hurry. Everyone does.'],
        ['What is on the servers anyway?', 'Not our problem. We hold the floor.'],
        ['You think they will send a team?', 'If they do, we will hear them coming.'],
        ['My feet are killing me.', 'Stop pacing then.'],
      ],
    },
    hostages: [
      { x: -11.0, z: -16.3, yaw: N, hood: true, look: 4 },
      { x: -8.2, z: -16.4, yaw: N, hood: true, look: 1 },
      { x: -21.5, z: -17.0, yaw: S, hood: false, look: 6, name: 'CEO' },
      { x: 20.6, z: 17.1, yaw: N, hood: true, look: 2 },
    ],
    civilians: [
      { x: -0.9, z: -4.6, yaw: S, pose: 'cower', look: 0 },
      { x: 4.8, z: -15.2, yaw: S, pose: 'stand', look: 3 },
      { x: 14.2, z: -9.5, yaw: S, pose: 'cower', look: 5 },
      { x: -17.2, z: 12.6, yaw: N, pose: 'cower', look: 2 },
      { x: -5.2, z: 12.7, yaw: E, pose: 'cower', look: 4 },
      { x: 11.5, z: 16.2, yaw: N, pose: 'cower', look: 1 },
      { x: 5.3, z: 14.8, yaw: E, pose: 'stand', look: 6 },
      { x: -22.4, z: 7.9, yaw: E, pose: 'cower', look: 0 },
      { x: 21.8, z: 5.6, yaw: W, pose: 'stand', look: 2 },
    ],
    // group: hostiles standing together talking (they face each other, weapons lowered, and are slow to
    // notice anything); yaw 'hostages': a hostage taker watching the people he is holding
    hostiles: [
      { type: 'rifleman', x: 10.6, z: -0.9, group: 'lifts' },
      { type: 'assaulter', x: 10.6, z: 1.5, group: 'lifts' },
      { type: 'rifleman', x: 12.0, z: -6.5, yaw: S, patrol: [[12.0, -6.5], [11.5, 7.0], [4.0, 7.2]] },
      { type: 'rifleman', x: 20.8, z: -4.8, yaw: W },
      { type: 'rifleman', x: -9.6, z: -15.2, yaw: 'hostages', exec: [0, 1] },
      { type: 'assaulter', x: -5.6, z: -12.0, yaw: N },
      { type: 'rifleman', x: -19.4, z: -14.2, yaw: 'hostages', exec: [2] },
      { type: 'rifleman', x: -20.0, z: -3.4, group: 'west' },
      { type: 'rifleman', x: 6.0, z: -12.3, yaw: E, patrol: [[6.0, -12.3], [21.5, -12.3], [21.5, -8.6], [6.0, -8.6]] },
      { type: 'rifleman', x: 15.4, z: -15.8, yaw: N },
      { type: 'heavy', x: -20.0, z: -0.9, group: 'west' },
      { type: 'rifleman', x: -17.6, z: 5.0, yaw: E, patrol: [[-17.6, 5.0], [-10.5, 8.3], [3.0, 8.3], [-10.5, 8.3]] },
      { type: 'rifleman', x: -4.6, z: 13.4, group: 'south' },
      { type: 'assaulter', x: 8.6, z: 15.4, yaw: N },
      { type: 'rifleman', x: 18.6, z: 16.6, yaw: 'hostages', exec: [3] },
      { type: 'rifleman', x: -2.4, z: 13.4, group: 'south' },
    ],
  };
}

/** The tower's other floors (seen from outside, e.g. behind the menu) and a city of towers 183 m down. */
function cityAndShell(scene, assets) {
  const { x0: X0, x1: X1, z0: Z0, z1: Z1, storey: ST, street } = TOWER;
  const group = new THREE.Group();
  const facadeMat = cityMaterial();
  // shell above and below this floor (the same curtain wall, with lit or dark windows)
  const shellGeo = new THREE.BoxGeometry(1, 1, 1);
  const inst = new THREE.InstancedMesh(shellGeo, facadeMat, 64);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  let n = 0;
  const addBox = (cx, y0, cz, w, h, d, id) => {
    P.set(cx, y0 + h / 2, cz); S.set(w, h, d); M.compose(P, Q, S);
    inst.setMatrixAt(n, M); inst.setColorAt(n, new THREE.Color(id, 0, 0)); n++;
  };
  addBox(0, street, 0, X1 - X0 + 0.3, -street - 0.35, Z1 - Z0 + 0.3, 0.5);           // floors below
  addBox(0, ST, 0, X1 - X0 + 0.3, 60, Z1 - Z0 + 0.3, 0.5);                              // floors above
  addBox(0, ST + 60, 0, 30, 6, 22, 0.52);                                               // plant room on the roof
  // surrounding towers on a street grid (blocks of 70 m, streets 22 m)
  const R = mulberry(12);
  for (let bx = -6; bx <= 6; bx++) for (let bz = -6; bz <= 6; bz++) {
    if (Math.abs(bx) <= 0 && Math.abs(bz) <= 0) continue;
    const cx = bx * 92, cz = bz * 92, d = Math.hypot(cx, cz);
    if (d > 560 || n >= 62) continue;
    const w = 26 + R() * 34, dd = 24 + R() * 34;
    const tall = R() < 0.35 ? 150 + R() * 140 : 40 + R() * 120;
    addBox(cx + (R() - 0.5) * 14, street, cz + (R() - 0.5) * 14, w, tall, dd, R());
  }
  inst.count = n;
  inst.instanceMatrix.needsUpdate = true;
  inst.userData.heat = 0.3; inst.userData.noWet = true;
  inst.castShadow = false; inst.receiveShadow = false;
  inst.frustumCulled = false;
  group.add(inst);
  // streets: asphalt grid with pavements, parks and low roofs between the towers
  const groundTex = streetTexture();
  const gm = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.9 });
  gm.userData.noWet = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), gm);
  ground.rotation.x = -Math.PI / 2; ground.position.y = street;
  groundTex.repeat.set(2400 / 92, 2400 / 92); groundTex.offset.set(0.5 - (1200 / 92) % 1, 0.5 - (1200 / 92) % 1); // blocks centred between the streets
  ground.userData.heat = 0.3;
  group.add(ground);
  scene.add(group);
  facadeMat.userData.city = true;
  return { group, facadeMat, groundTex };
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** Curtain-wall facade computed in the shader: glass bays, spandrels, mullions; random lit offices at night. */
function cityMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 });
  const u = { night: { value: 0 } };
  m.userData.cityUniforms = u;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.night = u.night;
    shader.vertexShader = 'varying vec3 vCW; varying vec3 vCN; varying float vId;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 cw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      vCW = cw.xyz; vCN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #ifdef USE_INSTANCING_COLOR
        vId = instanceColor.r;
      #else
        vId = 0.5;
      #endif`);
    shader.fragmentShader = 'uniform float night; varying vec3 vCW; varying vec3 vCN; varying float vId;\nfloat h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }\n' + shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <map_fragment>', `
        vec3 an = abs(vCN);
        float roof = step(0.5, an.y);
        float u = an.x > an.z ? vCW.z : vCW.x;
        float fl = floor(vCW.y / 3.9), fv = fract(vCW.y / 3.9);
        float bayW = 1.5 + floor(vId * 3.0) * 0.3;
        float bay = floor(u / bayW), fu = fract(u / bayW);
        float glassA = step(0.08, fu) * step(fu, 0.94) * step(0.0, fv) * step(fv, 0.72) * (1.0 - roof);
        vec3 spandrel = mix(vec3(0.36, 0.37, 0.38), vec3(0.62, 0.58, 0.52), fract(vId * 7.13));
        vec3 glassC = mix(vec3(0.06, 0.08, 0.1), vec3(0.1, 0.13, 0.12), fract(vId * 3.7));
        diffuseColor.rgb = roof > 0.5 ? vec3(0.42, 0.42, 0.41) : mix(spandrel, glassC, glassA);
        float lit = step(0.62, h31(vec3(bay, fl, floor(vId * 97.0)))) * glassA * night;
        float office = h31(vec3(bay * 0.37, fl * 1.3, vId));`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.75, 0.06, glassA);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(0.05, 0.9, glassA);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += lit * mix(vec3(1.0, 0.82, 0.55), vec3(0.8, 0.9, 1.0), step(0.6, office)) * (0.6 + office * 1.2);`);
  };
  m.customProgramCacheKey = () => 'cityfacade';
  return m;
}

/** Street grid seen from 180 m up: one 92 m block per tile. */
function streetTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const k = S / 92;
  ctx.fillStyle = '#3a3b3d'; ctx.fillRect(0, 0, S, S);                      // asphalt
  ctx.fillStyle = '#8d8a84'; ctx.fillRect(11 * k, 11 * k, 70 * k, 70 * k);   // pavement
  ctx.fillStyle = '#6f6c66'; ctx.fillRect(15 * k, 15 * k, 62 * k, 62 * k);   // plaza / low roofs
  ctx.fillStyle = '#4f6b3e'; ctx.fillRect(20 * k, 50 * k, 22 * k, 22 * k);   // trees
  ctx.strokeStyle = '#d9d6c9'; ctx.lineWidth = 1.5; ctx.setLineDash([3 * k, 3 * k]);
  ctx.beginPath(); ctx.moveTo(0, 5.5 * k); ctx.lineTo(S, 5.5 * k); ctx.moveTo(5.5 * k, 0); ctx.lineTo(5.5 * k, S); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#e6e3da';
  for (let i = 0; i < 8; i++) { ctx.fillRect(12 * k + i * 1.2 * k, 0, 0.6 * k, 11 * k); ctx.fillRect(0, 12 * k + i * 1.2 * k, 11 * k, 0.6 * k); } // crossings
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
