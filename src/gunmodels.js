// First-person weapons and the player's arms. The guns are sculpted parts
// (src/gunparts.js, prebuilt into src/gundata.js) assembled into animated
// groups, plus lenses, sight glass, reticles and the sling. Units are metres.
// Gun space: -Z is the muzzle direction, +Y up, +X right, bore on y = 0.
import * as THREE from 'three';
import * as TX from './textures.js';
import { meshes } from './meshes.js';
import { fabricMaterial, R } from './fabric.js';
import { gunGeo, gunPartNames } from './guns.js';
import { gunMaterial } from './gunmaterial.js';
import { RealArms } from './arms.js';

let M = null;
export function gunMaterials() {
  if (M) return M;
  // The sculpted guns use the weapon shader (gunmaterial.js). These are the
  // extras: lenses and glass, reticles, markings, sling, brass, grenades, arms.
  const stipple = TX.stippleNormal();
  stipple.repeat.set(25, 25);
  const fSteel = TX.weaponFinish({ base: '#27282b', wear: '#a9acb0', rough: [0.42, 0.18], dust: 0.2, scratches: 60, seed: 2 });
  for (const t of [fSteel.map, fSteel.roughness, fSteel.normal]) t.repeat.set(4, 4);
  const webbing = TX.weaponFinish({ base: '#7e6b4d', wear: '#a08e70', rough: [0.84, 0.66], dust: 0.3, scratches: 45, seed: 4 });
  M = {
    // turned / phosphated steel (grenade fuzes and spoons)
    steel: new THREE.MeshPhysicalMaterial({ map: fSteel.map, roughnessMap: fSteel.roughness, roughness: 1, metalness: 0.9, normalMap: fSteel.normal, normalScale: new THREE.Vector2(0.3, 0.3), anisotropy: 0.45 }),
    marks: new THREE.MeshStandardMaterial({ map: TX.rollMarkTexture(), color: 0xb8bcc2, roughness: 0.5, metalness: 0.7, alphaTest: 0.35,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    sling: new THREE.MeshStandardMaterial({ map: webbing.map, color: 0xb9a37e, roughness: 0.95, metalness: 0, normalMap: stipple, normalScale: new THREE.Vector2(0.5, 0.5) }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.6, metalness: 0.3 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb5904f, roughness: 0.28, metalness: 1 }),
    shell: new THREE.MeshStandardMaterial({ color: 0x8e1d18, roughness: 0.45, metalness: 0.05 }),
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
  // player sleeve camo (multicam-ish)
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

function reticlePlane(size, y, f) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), gunMaterials().reticle);
  m.position.set(0, y, -f);
  m.renderOrder = 10;
  m.frustumCulled = false;
  return m;
}
function marker(x, y, f) { const o = new THREE.Object3D(); o.position.set(x, y, -f); return o; }

// ---------- sculpted guns (see src/gunparts.js) ----------
let gunMat = null, canMat = null;
/** The weapon shader shared by every sculpted viewmodel part (the suppressor gets its own, for the heat glow). */
export function viewmodelGunMaterial() {
  if (!gunMat) { gunMat = gunMaterial({ clearcoat: true }); canMat = gunMaterial({ clearcoat: true }); }
  return gunMat;
}
/** Assembles a sculpted gun: one group per animated part, rotating about its stored pivot. */
function sculptedGun(gun, optic = null) {
  viewmodelGunMaterial();
  const root = new THREE.Group(), parts = {};
  for (const name of gunPartNames(gun)) {
    const g = gunGeo(gun, name), ud = g.userData;
    if (ud.anim.startsWith('opt:') && ud.anim !== 'opt:' + optic) continue;
    let group = parts[ud.anim];
    if (!group) {
      group = parts[ud.anim] = new THREE.Group();
      group.name = ud.anim;
      if (ud.pivot) group.position.set(ud.pivot[0], ud.pivot[1], -ud.pivot[2]);
      root.add(group);
    }
    const mesh = new THREE.Mesh(g, ud.material === 'can' ? canMat : gunMat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return { root, parts };
}
/** A lens / glass disc facing the muzzle (or the shooter). */
function lensDisc(r, x, y, f, mat, back = false) {
  const g = new THREE.CircleGeometry(r, 32);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, -f);
  if (!back) m.rotation.y = Math.PI; // faces out of the front of the device
  m.frustumCulled = false;
  return m;
}

// ---------- real guns (tools/build-realguns.mjs) ----------
// Artist-made models of real weapons, split into the same animated parts as
// the sculpted ones. Loaded at boot (setRealGun); without them the sculpted
// guns are used.
const REAL = {};
export function setRealGun(key, gltf, meta) { REAL[key] = { gltf, meta }; }
export function hasRealGun(key) { return !!REAL[key]; }
function realGun(key) {
  const r = REAL[key];
  if (!r) return null;
  const src = r.gltf.scene.clone(true); // geometry and materials are shared between copies
  const root = new THREE.Group(), parts = {};
  for (const node of [...src.children]) {
    const group = new THREE.Group();
    group.name = node.name;
    const pv = r.meta.pivots?.[node.name];
    if (pv) { group.position.set(pv[0], pv[1], pv[2]); node.position.set(-pv[0], -pv[1], -pv[2]); }
    group.add(node);
    root.add(group);
    parts[node.name] = group;
  }
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    o.frustumCulled = false;
    // sight and lens glass: the game's thin coated glass (the models' solid glass blocks read as grey slabs)
    if (/glass/i.test(o.material.name) || o.material.transparent) { o.material = gunMaterials().glass; o.castShadow = false; o.renderOrder = 5; }
  });
  return { root, parts, meta: r.meta };
}
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
/** The anchors every gun model provides, from the real model's measured points. */
function realAnchors({ meta }, extra) {
  const muzzle = new THREE.Object3D(); muzzle.position.copy(V3(meta.muzzle));
  const eject = new THREE.Object3D(); eject.position.copy(V3(meta.eject));
  return { muzzle, eject, ...extra };
}

// ---------- M4A1 carbine ----------
export function buildM4(opts = {}) {
  const real = realGun('m4');
  if (real) return buildRealM4(real, opts);
  const m = gunMaterials();
  const nv = opts.optic === 'nv';
  const { root, parts } = sculptedGun('m4', nv ? 'nv' : 'holo');
  const body = parts.body;
  if (nv) {
    const ax = 0.078;
    body.add(lensDisc(0.0262, 0, ax, 0.1115, m.lens));
    body.add(lensDisc(0.0106, 0.037, ax - 0.006, 0.0433, m.lens));
  } else {
    // holographic window and its reticle
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.03), m.glass);
    glass.position.set(0, 0.0748, -0.012);
    glass.frustumCulled = false;
    body.add(glass);
  }
  body.add(lensDisc(0.0048, 0.0065, 0.052, 0.3472, m.lens), lensDisc(0.0031, 0.0065, 0.0425, 0.3472, m.lens)); // PEQ windows
  body.add(lensDisc(0.0114, 0.034, 0.004, 0.3947, m.lens));                                                   // light lens
  // roll marks on the left of the magwell
  const d = new THREE.PlaneGeometry(0.062, 0.026); d.rotateY(-Math.PI / 2); d.translate(-0.01435, -0.036, -0.038);
  const marks = new THREE.Mesh(d, m.marks); marks.frustumCulled = false; body.add(marks);
  // two-point sling from the front QD swivel to the end-plate socket
  const slingCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.031, -0.024, -0.382), new THREE.Vector3(-0.036, -0.1, -0.28), new THREE.Vector3(-0.038, -0.16, -0.12),
    new THREE.Vector3(-0.036, -0.14, 0.0), new THREE.Vector3(-0.032, -0.06, 0.08), new THREE.Vector3(-0.028, -0.008, 0.106),
  ]);
  const sling = new THREE.Mesh(new THREE.TubeGeometry(slingCurve, 48, 0.0125, 8, false).scale(0.28, 1, 1).translate(-0.024, 0, 0), m.sling);
  sling.castShadow = true; sling.frustumCulled = false;
  body.add(sling);
  const sightY = nv ? 0.078 : 0.074;
  if (!nv) root.add(reticlePlane(0.013, sightY, -0.005));
  const muzzle = marker(0, 0, 0.664); root.add(muzzle);
  const eject = marker(0.016, 0.012, 0.025); root.add(eject);
  return {
    root, parts, muzzle, eject, sightY, sightF: -0.07,
    handR: { f: -0.06, y: -0.07, rot: -0.42 }, handL: { f: 0.17, y: 0.0, rot: 0 },
    magWell: { f: 0.04, y: -0.03 }, chargeF: -0.13,
    hip: new THREE.Vector3(0.13, -0.158, -0.31), ads: new THREE.Vector3(0, 0, -0.26),
  };
}

/** MK18 with an EXPS3 (or the night-vision scope in its place) and a SOCOM suppressor. */
function buildRealM4(real, opts) {
  const m = gunMaterials();
  const { root, parts, meta } = real;
  const nv = opts.optic === 'nv';
  let sightY = meta.window[1];
  if (nv) {
    // the sculpted clip-on NV scope on the real rail (its base sits 5.6 mm lower than on the sculpted upper)
    parts.optic.visible = false;
    const dy = meta.bounds.optic.min[1] - 0.028;
    const scope = new THREE.Group();
    scope.position.y = dy;
    for (const name of gunPartNames('m4')) {
      const g = gunGeo('m4', name);
      if (g.userData.anim !== 'opt:nv') continue;
      const mesh = new THREE.Mesh(g, viewmodelGunMaterial());
      mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
      scope.add(mesh);
    }
    const ax = 0.078;
    scope.add(lensDisc(0.0262, 0, ax, 0.1115, m.lens), lensDisc(0.0106, 0.037, ax - 0.006, 0.0433, m.lens));
    parts.body.add(scope);
    sightY = ax + dy;
  } else {
    root.add(reticlePlane(0.013, sightY, -meta.window[2]));
  }
  // the can glows when hot (weapons.js drives emissiveIntensity)
  const hot = new Map();
  parts.supp?.traverse((o) => {
    if (!o.isMesh) return;
    if (!hot.has(o.material)) { const c = o.material.clone(); c.emissive = new THREE.Color(0xff3a0a); c.emissiveIntensity = 0; hot.set(o.material, c); }
    o.material = hot.get(o.material);
  });
  const g = meta.grip, hg = meta.handguard, mw = meta.magwell;
  return {
    root, parts, sightY, sightF: -0.07, real: true, ...realAnchors(real),
    handR: { f: -g[2], y: g[1], rot: -0.42 }, handL: { f: -hg[2], y: hg[1], rot: 0 },
    magWell: { f: -mw[2], y: mw[1] }, chargeF: -meta.chargeHandle[2],
    hip: new THREE.Vector3(0.12, -0.15, -0.3), ads: new THREE.Vector3(0, 0, -0.25),
  };
}

// ---------- Glock 17 ----------
export function buildGlock() {
  const real = realGun('glock');
  if (real) return buildRealGlock(real);
  const m = gunMaterials();
  const { root, parts } = sculptedGun('glock');
  // tritium insert glowing in the front sight's white dot
  const fs = new THREE.Mesh(new THREE.PlaneGeometry(0.0034, 0.0034), m.tritium);
  fs.position.set(0, 0.0215, -0.0976);
  parts.slide.add(fs);
  const muzzle = marker(0, 0, 0.11); parts.slide.add(muzzle);
  const eject = marker(0.014, 0.01, 0.02); root.add(eject);
  return {
    root, parts, muzzle, eject, sightY: 0.0225, sightF: -0.065,
    handR: { f: -0.055, y: -0.07, rot: -0.21 }, handL: { f: -0.055, y: -0.07, rot: -0.21, support: true },
    magWell: { f: -0.06, y: -0.1 },
    hip: new THREE.Vector3(0.09, -0.088, -0.3), ads: new THREE.Vector3(0, 0, -0.3),
  };
}

// ---------- M1014 semi-auto shotgun ----------
export function buildM1014() {
  const real = realGun('m1014');
  if (real) return buildRealM1014(real);
  const { root, parts } = sculptedGun('m1014');
  const muzzle = marker(0, 0.008, 0.6); root.add(muzzle);
  const eject = marker(0.02, 0.006, 0.03); root.add(eject);
  // the loose shell carried by the left hand during shell-by-shell reloads
  parts.loose.rotation.x = Math.PI / 2;
  parts.loose.visible = false;
  return {
    root, parts, muzzle, eject, sightY: 0.058, sightF: -0.1,
    handR: { f: -0.12, y: -0.07, rot: -0.31 }, handL: { f: 0.23, y: -0.023, rot: 0 },
    magWell: { f: 0.0, y: -0.045 },
    hip: new THREE.Vector3(0.125, -0.153, -0.31), ads: new THREE.Vector3(0, 0, -0.3),
  };
}

// ---------- Bolt-action precision rifle in a chassis ----------
export function buildSniper() {
  const real = realGun('sniper');
  if (real) return buildRealSniper(real);
  const m = gunMaterials();
  const { root, parts } = sculptedGun('sniper');
  const sy = 0.058;
  parts.body.add(lensDisc(0.0272, 0, sy, 0.2745, m.lens), lensDisc(0.0178, 0, sy, -0.2125, m.lens, true));
  const muzzle = marker(0, 0, 0.81); root.add(muzzle);
  const eject = marker(0.02, 0.01, -0.06); root.add(eject);
  return {
    root, parts, muzzle, eject, sightY: sy, sightF: -0.24,
    handR: { f: -0.1, y: -0.09, rot: -0.13 }, handL: { f: 0.2, y: -0.038, rot: 0 },
    magWell: { f: 0.025, y: -0.07 }, boltHandle: { f: -0.143, x: 0.055, y: -0.004 },
    hip: new THREE.Vector3(0.13, -0.172, -0.33), ads: new THREE.Vector3(0, 0, -0.27),
  };
}

/** Glock 17: slide, frame, magazine. The model only has the magazine's baseplate: the sculpted body sits above it, in the grip. */
function buildRealGlock(real) {
  const m = gunMaterials();
  const { root, parts, meta } = real;
  const mb = meta.bounds.mag, g = gunGeo('glock', 'mag');
  g.computeBoundingBox();
  const sb = g.boundingBox;
  const body = new THREE.Mesh(g, viewmodelGunMaterial());
  body.position.set((mb.min[0] + mb.max[0]) / 2 - (sb.min.x + sb.max.x) / 2, mb.max[1] - sb.min.y - 0.002, (mb.min[2] + mb.max[2]) / 2 - (sb.min.z + sb.max.z) / 2);
  body.frustumCulled = false;
  parts.mag.children[0].add(body);
  // tritium insert in the front sight's white dot, and the muzzle, ride on the slide
  const fs = new THREE.Mesh(new THREE.PlaneGeometry(0.0022, 0.0022), m.tritium);
  fs.position.set(0, meta.window[1], meta.muzzle[2] + 0.012);
  parts.slide.add(fs);
  const a = realAnchors(real);
  parts.slide.add(a.muzzle);
  const gr = meta.grip, mw = meta.magwell;
  return {
    root, parts, sightY: meta.window[1], sightF: -0.065, real: true, ...a,
    handR: { f: -gr[2], y: gr[1], rot: -0.21 }, handL: { f: -gr[2], y: gr[1], rot: -0.21, support: true },
    magWell: { f: -mw[2], y: mw[1] },
    // held out at arm's length (isosceles stance), not under the nose
    hip: new THREE.Vector3(0.1, -0.12, -0.44), ads: new THREE.Vector3(0, 0, -0.52),
  };
}

/** Benelli M4: the rearmost saddle shell doubles as the loose shell carried to the loading port. */
function buildRealM1014(real) {
  const { root, parts, meta } = real;
  // the saddle keeps its shell while a copy of it travels with the hand
  const stay = parts.loose.clone(true);
  parts.body.add(stay);
  parts.loose.rotation.x = Math.PI / 2;
  parts.loose.visible = false;
  const gr = meta.grip, hg = meta.handguard, mw = meta.magwell;
  return {
    root, parts, sightY: meta.window[1], sightF: -0.1, real: true, ...realAnchors(real),
    handR: { f: -gr[2], y: gr[1], rot: -0.31 }, handL: { f: -hg[2], y: hg[1], rot: 0 },
    magWell: { f: -mw[2], y: mw[1] },
    hip: new THREE.Vector3(0.105, -0.125, -0.34), ads: new THREE.Vector3(0, 0, -0.32),
  };
}

/** M40A5: bolt (handle and shroud) and magazine move; the scope's image is drawn by the HUD when zoomed in. */
function buildRealSniper(real) {
  const { root, parts, meta } = real;
  const gr = meta.grip, hg = meta.handguard, mw = meta.magwell, bh = meta.boltHandle;
  return {
    root, parts, sightY: meta.window[1], sightF: -0.24, real: true, ...realAnchors(real),
    handR: { f: -gr[2], y: gr[1], rot: -0.13 }, handL: { f: -hg[2], y: hg[1], rot: 0 },
    magWell: { f: -mw[2], y: mw[1] }, boltHandle: { f: -bh[2], x: bh[0], y: bh[1] },
    hip: new THREE.Vector3(0.115, -0.14, -0.3), ads: new THREE.Vector3(0, 0, -0.27),
  };
}

/** Magazine geometry of a sculpted gun, centred (dropped empties). */
const magCache = {};
export function magazineGeometry(key) {
  const gun = key === 'glock' ? 'glock' : key === 'sniper' ? 'sniper' : 'm4';
  if (magCache[gun]) return magCache[gun];
  const g = gunGeo(gun, gun === 'm4' ? 'pmag' : 'mag').clone();
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z);
  g.computeBoundingSphere();
  return (magCache[gun] = g);
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
let gloveMat = null;
/**
 * A gloved hand wrapped around a grip (local y = grip axis, origin = grip
 * centre): the sculpted SDF glove (fingers curled in three joints, leather
 * palm, TPR knuckle guard, strap) with the fabric shader.
 */
function buildHand(side) {
  if (!gloveMat) {
    gloveMat = fabricMaterial({
      colors: { [R.GLOVE]: 0x6d5c46, [R.PALM]: 0x3b3834, [R.TPR]: 0x1c1b19, [R.BLACK]: 0x24231f },
      rough: { [R.GLOVE]: 0.82, [R.PALM]: 0.58, [R.TPR]: 0.5, [R.BLACK]: 0.7 }, camo: null, bump: 0.6,
    });
    gloveMat.side = THREE.DoubleSide;
  }
  const g = new THREE.Group();
  // right: pistol grip with the index on the trigger; left: C-clamp on a
  // handguard, or ('pistol') wrapped over the firing hand
  for (const name of side > 0 ? ['glove'] : ['gloveL', 'gloveLP']) {
    const mesh = new THREE.Mesh(meshes()[name], gloveMat);
    mesh.userData.hand = true;
    mesh.userData.wrist = new THREE.Vector3(...meshes()[name].userData.wrist);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.visible = name !== 'gloveLP';
    g.add(mesh);
  }
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

let ARMS_GLTF = null;
/** The rigged first-person arms (src/arms.js), once loaded. */
export function setRealArms(gltf) { ARMS_GLTF = gltf; }
/** The real rigged arms when loaded, else the sculpted ones. */
export function createArms() { return ARMS_GLTF ? new RealArms(ARMS_GLTF) : new Arms(); }

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
  solve(side, wrist, handQuat, visible = true, pistol = false) {
    const hand = this.hands[side];
    hand.visible = this.fore[side].visible = this.upper[side].visible = this.cuff[side].visible = visible;
    if (!visible) return;
    hand.position.copy(wrist);
    hand.quaternion.copy(handQuat);
    let glove = hand.children[0];
    if (side === 'L') { hand.children[0].visible = !pistol; hand.children[1].visible = pistol; glove = hand.children[pistol ? 1 : 0]; }
    // the forearm starts at the glove's wrist
    const w = this._w.copy(glove.userData.wrist).applyQuaternion(handQuat).add(wrist);
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
