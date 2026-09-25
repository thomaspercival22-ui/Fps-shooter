// Enemy soldier visuals: a procedurally built, jointed character with
// IK arms holding a rifle, procedural locomotion, and reactions (reload,
// grenade throw, flashbang blindness, hit flinches, falling deaths).
// Faces +Z in its local space; its right side is -X.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { soldierAtlas, atlasUV, soldierNormalMap } from './textures.js';
import { buildM4, buildM1014, buildSniper } from './gunmodels.js';

const materials = {};
let normalTex = null;
// Soldiers can show flipped-down night vision goggles (set by the game at night).
export const soldierOptions = { night: false };
function material(kit) {
  if (!normalTex) normalTex = soldierNormalMap();
  // woven fabric with a soft sheen at grazing angles
  if (!materials[kit]) materials[kit] = new THREE.MeshPhysicalMaterial({ map: soldierAtlas(kit), normalMap: normalTex, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.86, metalness: 0.02,
    sheen: 0.55, sheenRoughness: 0.7, sheenColor: 0x8a806c });
  return materials[kit];
}

function part(geo, region, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  const [u0, v0, u1, v1] = atlasUV(region);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i) - Math.floor(uv.getX(i) * 0.9999), v = uv.getY(i) - Math.floor(uv.getY(i) * 0.9999);
    uv.setXY(i, u0 + (u1 - u0) * Math.min(1, Math.max(0, u)), v0 + (v1 - v0) * Math.min(1, Math.max(0, v)));
  }
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
  g.applyMatrix4(m);
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const C = (r, len, seg = 16) => new THREE.CapsuleGeometry(r, len, 5, seg);
const CY = (r0, r1, h, seg = 16) => new THREE.CylinderGeometry(r1, r0, h, seg);
const S = (r, ws = 20, hs = 14, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) => new THREE.SphereGeometry(r, ws, hs, ps, pl, ts, tl);
/** Rounded box (padded pouches, plates, boots): rounded-rectangle outline extruded with a soft bevel. */
function RB(w, h, d, r = 0.012) {
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001);
  const x = w / 2 - r, y = h / 2 - r, sh = new THREE.Shape();
  sh.moveTo(-x, -h / 2); sh.lineTo(x, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -y); sh.lineTo(w / 2, y);
  sh.quadraticCurveTo(w / 2, h / 2, x, h / 2); sh.lineTo(-x, h / 2); sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, y);
  sh.lineTo(-w / 2, -y); sh.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const bv = Math.min(r, d / 2 - 0.001);
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.001, d - 2 * bv), bevelEnabled: true, bevelThickness: bv, bevelSize: bv * 0.6, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * bv) / 2);
  // UVs in metres so the atlas region tiles at cloth scale
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + p.getZ(i)) * 3, p.getY(i) * 3);
  return g;
}
/** Fabric limb: capsule with compression folds around the joints. */
function limb(r, len, seed, folds = 0.05) {
  const g = C(r, len, 18);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (y + len / 2) / len, th = Math.atan2(z, x);
    const endK = Math.pow(Math.abs(t - 0.5) * 2, 2);
    const k = 1 + folds * (0.5 + 0.5 * Math.sin(t * 40 + Math.sin(th * 2 + seed) * 2 + seed)) * endK;
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// Geometry is shared by all soldiers of a kit/weapon.
const geoCache = {};
function geometries(kit) {
  if (geoCache[kit]) return geoCache[kit];
  const heavy = kit === 'heavy';
  const G = {};
  // ---- hips: trousers, padded battle belt with pouches, holster ----
  G.pelvis = mergeGeometries([
    part(S(0.165), 'pants', { pos: [0, -0.035, 0], scale: [1.08, 0.72, 0.82] }),
    part(CY(0.19, 0.19, 0.065, 28), 'pouch', { pos: [0, 0.045, 0], scale: [1, 1, 0.74] }),                  // battle belt
    part(CY(0.192, 0.192, 0.02, 28), 'black', { pos: [0, 0.045, 0], scale: [1, 1, 0.745] }),                // inner belt
    part(RB(0.065, 0.1, 0.05), 'pouch', { pos: [0.13, 0.0, 0.11], rot: [0, 0.4, 0] }),                      // mag pouch
    part(RB(0.11, 0.13, 0.07, 0.02), 'pouch', { pos: [0, 0.0, -0.15] }),                                     // IFAK
    part(RB(0.05, 0.13, 0.065, 0.01), 'black', { pos: [-0.19, -0.06, 0.02], rot: [0, 0.2, 0.08] }),         // holster
    part(RB(0.03, 0.06, 0.035, 0.006), 'black', { pos: [-0.19, 0.03, 0.03], rot: [0, 0.2, 0.08] }),         // pistol grip
  ]);
  // ---- torso: combat shirt, plate carrier, cummerbund, pouches ----
  const vestW = heavy ? 0.36 : 0.32, vestD = heavy ? 0.3 : 0.27;
  const chest = [
    part(C(0.15, 0.22, 20), 'camo', { pos: [0, 0.25, 0], scale: [1.2, 1, 0.8] }),
    part(RB(vestW, 0.33, 0.055, 0.03), 'vest', { pos: [0, 0.3, vestD / 2 - 0.01] }),                          // front plate bag
    part(RB(vestW, 0.35, 0.05, 0.03), 'vest', { pos: [0, 0.3, -vestD / 2 + 0.01] }),                          // back plate bag
    part(CY(0.215, 0.205, 0.16, 28), 'vest', { pos: [0, 0.2, 0], scale: [1, 1, 0.72] }),                    // cummerbund
    part(RB(0.13, 0.055, 0.05, 0.015), 'vest', { pos: [0, 0.465, vestD / 2 - 0.035] }),                      // collar strap
  ];
  // triple magazine pouch with flaps and the rifle mags inside
  for (let i = 0; i < 3; i++) {
    const x = -0.085 + i * 0.085;
    chest.push(part(RB(0.078, 0.12, 0.05, 0.012), 'pouch', { pos: [x, 0.2, vestD / 2 + 0.035] }));
    chest.push(part(RB(0.08, 0.035, 0.055, 0.01), 'pouch', { pos: [x, 0.265, vestD / 2 + 0.036], rot: [0.15, 0, 0] })); // flap
    chest.push(part(RB(0.026, 0.03, 0.058, 0.004), 'black', { pos: [x, 0.29, vestD / 2 + 0.03], rot: [0.1, 0, 0] })); // mag base
  }
  chest.push(part(RB(0.12, 0.085, 0.045, 0.015), 'pouch', { pos: [0.02, 0.38, vestD / 2 + 0.035] }));          // admin pouch
  chest.push(part(CY(0.017, 0.017, 0.11, 10), 'black', { pos: [-0.12, 0.39, vestD / 2 + 0.02] }));             // tourniquet
  chest.push(part(RB(0.065, 0.14, 0.045, 0.012), 'black', { pos: [0.16, 0.23, 0.1], rot: [0, 1.1, 0] }));      // radio on the cummerbund
  // shoulders under the padded straps
  chest.push(part(S(0.078), 'camo', { pos: [-0.2, 0.46, 0], scale: [1, 0.9, 1.05] }));
  chest.push(part(S(0.078), 'camo', { pos: [0.2, 0.46, 0], scale: [1, 0.9, 1.05] }));
  chest.push(part(RB(0.055, 0.03, 0.26, 0.012), 'vest', { pos: [-0.13, 0.49, 0], rot: [0, 0, -0.2] }));
  chest.push(part(RB(0.055, 0.03, 0.26, 0.012), 'vest', { pos: [0.13, 0.49, 0], rot: [0, 0, 0.2] }));
  // hydration carrier / assault pack, antenna
  chest.push(part(RB(0.26, 0.34, 0.1, 0.04), heavy ? 'black' : 'pouch', { pos: [0, 0.3, -vestD / 2 - 0.06] }));
  chest.push(part(CY(0.004, 0.003, 0.4, 6), 'black', { pos: [0.1, 0.62, -vestD / 2 - 0.05], rot: [-0.12, 0, 0] }));
  chest.push(part(C(0.07, 0.05, 14), 'face', { pos: [0, 0.5, 0.01], scale: [1, 0.7, 1] }));                        // neck (balaclava)
  if (heavy) chest.push(part(RB(0.19, 0.12, 0.07, 0.03), 'vest', { pos: [-0.2, 0.45, 0], rot: [0, 0, 0.35] }), part(RB(0.19, 0.12, 0.07, 0.03), 'vest', { pos: [0.2, 0.45, 0], rot: [0, 0, -0.35] }));
  G.chest = mergeGeometries(chest);
  // ---- head: balaclava, ballistic glasses, FAST high-cut helmet, comms headset ----
  const head = [
    part(S(0.1, 26, 20), 'face', { pos: [0, 0.1, 0.005], scale: [0.9, 1.12, 1.02] }),
    part(S(0.103, 26, 10, -0.9, 1.8, 1.25, 0.45), 'black', { pos: [0, 0.105, 0.012], scale: [0.95, 1.1, 1.06], rot: [0, Math.PI / 2 + 0.0, 0] }), // eye protection
    part(S(0.129, 30, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), 'helmet', { pos: [0, 0.128, -0.006], scale: [1, 0.96, 1.1] }), // shell
    part(CY(0.131, 0.131, 0.025, 30, 1), 'helmet', { pos: [0, 0.14, -0.006], scale: [1, 1, 1.1] }),           // rim
    part(RB(0.014, 0.035, 0.12, 0.005), 'black', { pos: [0.124, 0.145, -0.01] }),                              // ARC rails
    part(RB(0.014, 0.035, 0.12, 0.005), 'black', { pos: [-0.124, 0.145, -0.01] }),
    part(RB(0.045, 0.035, 0.018, 0.006), 'black', { pos: [0, 0.205, 0.125], rot: [-0.3, 0, 0] }),            // NVG shroud
    part(RB(0.06, 0.035, 0.1, 0.012), 'pouch', { pos: [0, 0.2, -0.125], rot: [-0.45, 0, 0] }),               // counterweight
    part(RB(0.08, 0.05, 0.004, 0.006), 'pouch', { pos: [0, 0.255, -0.02], rot: [-Math.PI / 2 + 0.1, 0, 0] }), // loop panel
    part(CY(0.042, 0.04, 0.035, 18), 'black', { pos: [0.108, 0.085, 0.0], rot: [0, 0, Math.PI / 2] }),       // ear cups
    part(CY(0.042, 0.04, 0.035, 18), 'black', { pos: [-0.108, 0.085, 0.0], rot: [0, 0, -Math.PI / 2] }),
    part(CY(0.004, 0.004, 0.07, 6), 'black', { pos: [0.085, 0.06, 0.07], rot: [1.25, 0, 0.4] }),            // boom mic
    part(RB(0.006, 0.07, 0.014, 0.002), 'black', { pos: [0.088, 0.04, 0.045], rot: [0.3, 0, 0.1] }),         // chinstrap
    part(RB(0.006, 0.07, 0.014, 0.002), 'black', { pos: [-0.088, 0.04, 0.045], rot: [0.3, 0, -0.1] }),
  ];
  if (heavy) head.push(part(S(0.105, 22, 10, 0, Math.PI, 0.9, 1.2), 'black', { pos: [0, 0.08, 0.02], scale: [0.95, 1, 1.1], rot: [0, -Math.PI / 2, 0] })); // ballistic mask
  G.head = mergeGeometries(head);
  G.nvg = mergeGeometries([
    part(CY(0.019, 0.017, 0.075, 16), 'black', { pos: [0.034, 0.1, 0.135], rot: [Math.PI / 2, 0, 0] }),
    part(CY(0.019, 0.017, 0.075, 16), 'black', { pos: [-0.034, 0.1, 0.135], rot: [Math.PI / 2, 0, 0] }),
    part(RB(0.09, 0.03, 0.03, 0.008), 'black', { pos: [0, 0.135, 0.125] }),
    part(RB(0.03, 0.05, 0.03, 0.008), 'black', { pos: [0, 0.18, 0.12] }),
  ]);
  // ---- arms: sleeves with folds, elbow pads, gloves ----
  G.upperArm = mergeGeometries([part(limb(0.058, 0.2, 1), 'camo', { pos: [0, -0.14, 0] }), part(RB(0.085, 0.07, 0.03, 0.012), 'pouch', { pos: [0, -0.07, 0.055], rot: [0, 0, 0] })]);
  G.foreArm = mergeGeometries([part(limb(0.048, 0.18, 2), 'camo', { pos: [0, -0.12, 0] }), part(S(0.05, 14, 10, 0, Math.PI), 'black', { pos: [0, -0.005, -0.02], scale: [1, 0.8, 0.9], rot: [0, Math.PI, 0] })]);
  G.hand = mergeGeometries([
    part(RB(0.055, 0.085, 0.075, 0.022), 'black', { pos: [0, -0.04, 0.01] }),
    part(C(0.011, 0.04, 8), 'black', { pos: [0.02, -0.03, 0.05], rot: [1.2, 0, 0] }),                         // thumb
    part(RB(0.05, 0.03, 0.05, 0.012), 'black', { pos: [0, -0.09, 0.03], rot: [0.6, 0, 0] }),                  // curled fingers
  ]);
  // ---- legs: trousers with cargo pockets, knee pads, boots ----
  G.thigh = mergeGeometries([part(limb(0.084, 0.3, 3, 0.04), 'pants', { pos: [0, -0.22, 0] }), part(RB(0.11, 0.13, 0.04, 0.02), 'pants', { pos: [0.075, -0.22, 0.015], rot: [0, 1.4, 0] })]);
  G.shin = mergeGeometries([
    part(limb(0.064, 0.28, 4, 0.06), 'pants', { pos: [0, -0.2, 0] }),
    part(S(0.062, 18, 12, 0, Math.PI), 'black', { pos: [0, -0.02, 0.035], scale: [0.95, 1.2, 0.7], rot: [0, -Math.PI / 2, 0] }), // knee pad
    part(RB(0.1, 0.16, 0.12, 0.035), 'pouch', { pos: [0, -0.37, 0.02] }),                                  // boot upper
    part(RB(0.11, 0.05, 0.28, 0.025), 'pouch', { pos: [0, -0.43, 0.06] }),                                 // boot foot
    part(RB(0.115, 0.022, 0.295, 0.01), 'black', { pos: [0, -0.46, 0.06] }),                               // sole
  ]);
  geoCache[kit] = G;
  return G;
}

// ---------- enemy weapons (forward = +Z, grip at origin) ----------
// Built from the same detailed models the player uses, merged into one mesh
// with vertex colours so each enemy gun is a single draw call.
const gunCache = {};
let gunMat = null;
const GUN_SPECS = {
  rifle: { build: buildM4, grip: [-0.07, -0.06], fore: [-0.035, 0.16], muzzle: [0, 0.54], butt: -0.35 },
  lmg: { build: buildM4, grip: [-0.07, -0.06], fore: [-0.035, 0.16], muzzle: [0, 0.54], butt: -0.35, boxMag: true },
  shotgun: { build: buildM1014, grip: [-0.07, -0.12], fore: [-0.04, 0.23], muzzle: [0.008, 0.6], butt: -0.41 },
  dmr: { build: buildSniper, grip: [-0.09, -0.1], fore: [-0.06, 0.2], muzzle: [0, 0.81], butt: -0.53 },
};
function gunGeometry(type) {
  if (gunCache[type]) return gunCache[type];
  const spec = GUN_SPECS[type] || GUN_SPECS.rifle;
  const g = spec.build();
  g.root.updateMatrixWorld(true);
  const parts = [];
  const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  g.root.traverse((o) => {
    if (!o.isMesh || !visible(o) || o.material.transparent || o.material.blending === THREE.AdditiveBlending) return;
    let geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    const n = geo.attributes.position.count, c = o.material.userData.baseColor || o.material.color, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(geo);
  });
  if (spec.boxMag) {
    let box = new THREE.BoxGeometry(0.08, 0.1, 0.11).toNonIndexed();
    box.translate(0.02, -0.08, -0.05);
    box.deleteAttribute('uv');
    const col = new Float32Array(box.attributes.position.count * 3).fill(0.03);
    box.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(box);
  }
  const geo = mergeGeometries(parts);
  geo.rotateY(Math.PI); // player models point down -Z; soldiers aim down +Z
  if (!gunMat) gunMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.55 });
  gunCache[type] = {
    geo, mat: gunMat, muzzleY: spec.muzzle[0], muzzleZ: spec.muzzle[1],
    grip: new THREE.Vector3(0, spec.grip[0], spec.grip[1]), fore: new THREE.Vector3(0, spec.fore[0], spec.fore[1]), butt: spec.butt,
  };
  return gunCache[type];
}

let flashTex = null;
function flashTexture() {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,245,210,1)'); g.addColorStop(0.3, 'rgba(255,180,80,0.8)'); g.addColorStop(1, 'rgba(255,100,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export class Soldier {
  constructor(scene, kit, weaponType) {
    const mat = material(kit);
    const G = geometries(kit);
    this.meshes = [];
    const mk = (geo, heat = 0.85, m2 = mat) => {
      const m = new THREE.Mesh(geo, m2);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.heat = heat; m.userData.baseHeat = heat;
      this.meshes.push(m);
      return m;
    };
    this.root = new THREE.Group();
    this.faller = new THREE.Group();
    this.root.add(this.faller);
    this.hips = new THREE.Group(); this.hips.position.y = 0.97; this.faller.add(this.hips);
    this.hips.add(mk(G.pelvis));
    this.spine = new THREE.Group(); this.spine.position.y = 0.08; this.hips.add(this.spine);
    this.spine.add(mk(G.chest, 0.78));
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.52, 0.0); this.spine.add(this.neck);
    this.head = new THREE.Group(); this.head.position.y = 0.04; this.neck.add(this.head);
    this.head.add(mk(G.head, 1.0));
    this.nvg = mk(G.nvg, 0.4);
    this.nvg.visible = soldierOptions.night;
    this.head.add(this.nvg);
    this.arm = {};
    for (const [side, x, z] of [['R', -0.2, 0.02], ['L', 0.2, 0.06]]) {
      const up = new THREE.Group(); up.position.set(x, 0.46, z); this.spine.add(up); up.add(mk(G.upperArm, 0.84));
      const fo = new THREE.Group(); fo.position.y = -0.31; up.add(fo); fo.add(mk(G.foreArm, 0.88));
      const ha = new THREE.Group(); ha.position.y = -0.28; fo.add(ha); ha.add(mk(G.hand, 0.95));
      this.arm[side] = { up, fo, ha, shoulder: new THREE.Vector3(x, 0.46, z) };
    }
    this.leg = {};
    for (const [side, x] of [['R', -0.1], ['L', 0.1]]) {
      const th = new THREE.Group(); th.position.set(x, -0.04, 0); this.hips.add(th); th.add(mk(G.thigh));
      const sh = new THREE.Group(); sh.position.y = -0.44; th.add(sh); sh.add(mk(G.shin, 0.8));
      this.leg[side] = { th, sh };
    }
    // weapon
    const gg = gunGeometry(weaponType);
    this.gunInfo = gg;
    this.gunPivot = new THREE.Group();
    this.gunPivot.position.set(-0.12, 0.42, 0.16);
    this.spine.add(this.gunPivot);
    this.gun = mk(gg.geo, 0.3, gg.mat);
    this.gun.position.z = -gg.butt - 0.03;
    this.gunPivot.add(this.gun);
    this.gunHeat = 0;
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, gg.muzzleY, gg.muzzleZ); this.gun.add(this.muzzle);
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    this.flashSprite.scale.setScalar(0.45);
    this.flashSprite.visible = false;
    this.muzzle.add(this.flashSprite);
    this.glint = null;

    scene.add(this.root);
    this.scene = scene;
    // animation state
    this.phase = 0;
    this.pose = { aim: 0, pitch: 0, yawOff: 0, crouch: 0, reload: -1, throw: -1, flashed: 0, cover: 0 };
    this.move = { speed: 0, fx: 0, fz: 0 };
    this.hit = { x: { x: 0, v: 0 }, z: { x: 0, v: 0 } };
    this.flashT = 0;
    this.dead = false;
    this.deathT = 0;
    this._aimSmooth = 0;
  }

  setPosition(x, y, z) { this.root.position.set(x, y, z); }
  set yaw(v) { this.root.rotation.y = v; }
  get yaw() { return this.root.rotation.y; }

  muzzleFlash() {
    this.flashSprite.visible = true;
    this.flashSprite.material.rotation = Math.random() * 6;
    this.flashSprite.scale.setScalar(0.35 + Math.random() * 0.25);
    this.flashT = 0.05;
    this.gunHeat = Math.min(0.6, this.gunHeat + 0.02);
  }
  muzzleWorld(out) { this.muzzle.updateWorldMatrix(true, false); return out.setFromMatrixPosition(this.muzzle.matrixWorld); }
  headWorld(out) { this.head.updateWorldMatrix(true, false); return out.set(0, 0.11, 0.01).applyMatrix4(this.head.matrixWorld); }
  chestWorld(out) { this.spine.updateWorldMatrix(true, false); return out.set(0, 0.28, 0).applyMatrix4(this.spine.matrixWorld); }
  hipsWorld(out) { this.hips.updateWorldMatrix(true, false); return out.setFromMatrixPosition(this.hips.matrixWorld); }
  footWorld(side, out) { const s = this.leg[side].sh; s.updateWorldMatrix(true, false); return out.set(0, -0.4, 0.04).applyMatrix4(s.matrixWorld); }
  kneeWorld(side, out) { const s = this.leg[side].sh; s.updateWorldMatrix(true, false); return out.setFromMatrixPosition(s.matrixWorld); }

  flinch(dirX, dirZ, strength = 1) {
    // dir in world; convert to local
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    const lx = dirX * c - dirZ * s, lz = dirX * s + dirZ * c;
    this.hit.x.v += lz * 6 * strength;
    this.hit.z.v += -lx * 6 * strength;
  }

  die(dirX, dirZ, headshot) {
    this.dead = true;
    this.deathT = 0;
    // fall along the impact direction, in root space
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    let lx = dirX * c - dirZ * s, lz = dirX * s + dirZ * c;
    const l = Math.hypot(lx, lz) || 1; lx /= l; lz /= l;
    if (headshot) { lx *= 0.4; lz *= 0.4; }
    this.fallDir = new THREE.Vector3(lx, 0, lz).normalize();
    if (this.fallDir.lengthSq() < 0.1) this.fallDir.set(0, 0, -1);
    this.fallAxis = new THREE.Vector3(0, 1, 0).cross(this.fallDir).normalize();
    this.fallAngle = 0; this.fallVel = 0;
    this.limp = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    // drop the weapon
    const g = this.gun;
    g.updateWorldMatrix(true, false);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    g.matrixWorld.decompose(wp, wq, ws);
    this.scene.add(g);
    g.position.copy(wp); g.quaternion.copy(wq);
    this.droppedGun = { vel: new THREE.Vector3(dirX * 1.5 + (Math.random() - 0.5), 1.5, dirZ * 1.5 + (Math.random() - 0.5)), spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3), rest: false };
    this.flashSprite.visible = false;
    if (this.glint) this.glint.visible = false;
  }

  dispose() {
    this.scene.remove(this.root);
    if (this.gun.parent === this.scene) this.scene.remove(this.gun);
  }

  update(dt, world, camPos) {
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flashSprite.visible = false; }
    this.gunHeat = Math.max(0, this.gunHeat - dt * 0.012);
    this.gun.userData.heat = 0.3 + this.gunHeat;
    this.nvg.visible = soldierOptions.night;
    if (this.dead) { this._updateDead(dt, world); return; }
    const P = this.pose, mv = this.move;
    // hit reaction springs
    for (const s of [this.hit.x, this.hit.z]) { s.v += (-s.x * 90 - s.v * 11) * dt; s.x += s.v * dt; }

    // ---- legs ----
    const running = mv.speed > 2.4;
    const stride = running ? 1.75 : 1.2;
    this.phase += (mv.speed * dt / stride) * Math.PI;
    const moveAmt = Math.min(1, mv.speed / 1.2);
    const fwd = mv.fz, side = mv.fx;
    const A = (running ? 0.62 : 0.4) * moveAmt;
    const sP = Math.sin(this.phase), cP = Math.cos(this.phase);
    const crouch = P.crouch;
    const L = this.leg.L, R = this.leg.R;
    // walking pose
    let tlx = -sP * A * fwd, trx = sP * A * fwd;
    let slx = Math.max(0, -cP) * A * 1.4 + 0.08, srx = Math.max(0, cP) * A * 1.4 + 0.08;
    let tlz = sP * A * side * 0.5, trz = -sP * A * side * 0.5;
    let hipY = 0.97 - Math.abs(sP) * 0.03 * moveAmt;
    if (crouch > 0) {
      const moving = moveAmt > 0.2;
      // crouch walk when moving, kneel when still
      const ktl = moving ? -0.9 + tlx * 0.6 : -1.5, ksl = moving ? 1.3 + slx * 0.5 : 1.55;
      const ktr = moving ? -0.9 + trx * 0.6 : 0.3, ksr = moving ? 1.3 + srx * 0.5 : 1.3;
      tlx = lerp(tlx, ktl, crouch); slx = lerp(slx, ksl, crouch);
      trx = lerp(trx, ktr, crouch); srx = lerp(srx, ksr, crouch);
      hipY = lerp(hipY, moving ? 0.72 : 0.56, crouch);
    }
    L.th.rotation.set(tlx, 0, tlz); L.sh.rotation.set(slx, 0, 0);
    R.th.rotation.set(trx, 0, trz); R.sh.rotation.set(srx, 0, 0);
    this.hips.position.y = hipY;

    // ---- torso ----
    const lean = (running ? 0.18 : 0.04) * moveAmt * fwd + crouch * 0.18;
    this.spine.rotation.set(lean + this.hit.x.x * 0.1, THREE.MathUtils.clamp(P.yawOff, -0.7, 0.7) * 0.8, this.hit.z.x * 0.1);
    this.hips.rotation.y = THREE.MathUtils.clamp(P.yawOff, -0.7, 0.7) * 0.2 - side * 0.3 * moveAmt;
    this.head.rotation.set(-P.pitch * 0.5 + P.flashed * 0.5, THREE.MathUtils.clamp(P.yawOff, -0.7, 0.7) * 0.3, 0);

    // ---- weapon ----
    this._aimSmooth += (P.aim - this._aimSmooth) * Math.min(1, dt * 8);
    const aim = this._aimSmooth * (1 - P.flashed) * (P.throw >= 0 ? 0.2 : 1);
    const gp = this.gunPivot;
    const lowX = 0.65, lowY = 0.45;
    gp.position.set(-0.12 + (1 - aim) * 0.08, 0.42 - (1 - aim) * 0.1, 0.16 + (1 - aim) * 0.02);
    gp.rotation.set(lerp(lowX, -P.pitch - lean, aim) + P.flashed * 0.5, lerp(lowY, 0, aim), lerp(0.2, 0, aim));
    if (P.reload >= 0) {
      const t = P.reload, tilt = Math.sin(Math.min(1, t) * Math.PI);
      gp.rotation.x += tilt * 0.5; gp.rotation.z += tilt * 0.5;
    }

    // ---- arms (IK to the weapon) ----
    gp.updateMatrix();
    const gi = this.gunInfo;
    const toSpine = (v) => v.applyMatrix4(this.gun.matrix).applyMatrix4(gp.matrix);
    const gripR = toSpine(_v.copy(gi.grip));
    let handL = toSpine(_v2.copy(gi.fore));
    if (P.reload >= 0) {
      const t = P.reload;
      const magPos = toSpine(_v3.set(0, -0.1, 0.1));
      const pouch = new THREE.Vector3(-0.02, 0.22, 0.2);
      const k1 = smooth(t / 0.3), k2 = smooth((t - 0.3) / 0.2), k3 = smooth((t - 0.55) / 0.2), k4 = smooth((t - 0.8) / 0.2);
      handL = handL.clone().lerp(magPos, k1).lerp(pouch, k2 * (1 - k3)).lerp(magPos, k3 * (1 - k4)).lerp(handL, k4);
    }
    if (P.flashed > 0.3) {
      // hands up to the face, stumbling
      this._solveArm('R', _v3.set(-0.06, 0.62, 0.16));
      this._solveArm('L', _v.set(0.06, 0.62, 0.16));
    } else if (P.throw >= 0) {
      const t = P.throw;
      const back = new THREE.Vector3(-0.3, 0.8, -0.2), front = new THREE.Vector3(-0.15, 0.7, 0.5);
      const hp = t < 0.5 ? gripR.clone().lerp(back, smooth(t / 0.5)) : back.clone().lerp(front, smooth((t - 0.5) / 0.25)).lerp(gripR, smooth((t - 0.75) / 0.25));
      this._solveArm('R', hp);
      this._solveArm('L', handL);
    } else {
      this._solveArm('R', gripR);
      this._solveArm('L', handL);
    }

    // marksman scope glint faces the player
    if (this.glint && camPos) this.glint.visible = P.aim > 0.8;
  }

  _solveArm(side, target) {
    const arm = this.arm[side];
    const S = arm.shoulder;
    const a = 0.31, b = 0.32;
    const dir = new THREE.Vector3().subVectors(target, S);
    const d = Math.min(a + b - 0.002, Math.max(0.1, dir.length()));
    dir.normalize();
    const pole = new THREE.Vector3(side === 'R' ? -0.6 : 0.6, -1, -0.3).normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E = S.clone().addScaledVector(dir, cosA * a).addScaledVector(perp, sinA * a);
    const W = S.clone().addScaledVector(dir, d);
    const dUp = E.clone().sub(S).normalize();
    arm.up.quaternion.setFromUnitVectors(DOWN, dUp);
    const dFo = W.clone().sub(E).normalize().applyQuaternion(arm.up.quaternion.clone().invert());
    arm.fo.quaternion.setFromUnitVectors(DOWN, dFo);
  }

  _updateDead(dt, world) {
    this.deathT += dt;
    // bodies slowly cool down (visible through thermal)
    if ((this.deathT % 1) < dt) {
      const k = Math.max(0.38, 1 - this.deathT / 120);
      for (const m of this.meshes) if (m !== this.gun) m.userData.heat = m.userData.baseHeat * k;
    }
    const t = this.deathT;
    // knees buckle, then the body topples with gravity and a small bounce
    const buckle = smooth(t / 0.35);
    for (const s of ['L', 'R']) {
      this.leg[s].th.rotation.x = lerp(this.leg[s].th.rotation.x, -0.5, buckle * 0.2);
      this.leg[s].sh.rotation.x = lerp(this.leg[s].sh.rotation.x, 0.9, buckle * 0.2);
    }
    this.hips.position.y = lerp(this.hips.position.y, 0.75, buckle * 0.15);
    if (this.fallAngle < Math.PI / 2 || this.fallVel > 0.01) {
      this.fallVel += (t > 0.12 ? 9 : 2) * dt * (0.3 + Math.sin(this.fallAngle) * 1.6);
      this.fallAngle += this.fallVel * dt;
      if (this.fallAngle > Math.PI / 2 - 0.05) { this.fallAngle = Math.PI / 2 - 0.05; this.fallVel = -this.fallVel * 0.2; if (Math.abs(this.fallVel) < 0.2) this.fallVel = 0; }
    }
    this.faller.quaternion.setFromAxisAngle(this.fallAxis, this.fallAngle);
    this.faller.position.y = -Math.sin(this.fallAngle) * 0.12;
    // limp limbs
    const k = Math.min(1, t * 2);
    this.arm.R.up.rotation.x = lerp(this.arm.R.up.rotation.x, 2.2 + this.limp[0], k * 0.1);
    this.arm.L.up.rotation.x = lerp(this.arm.L.up.rotation.x, 2.0 + this.limp[1], k * 0.1);
    this.arm.R.fo.rotation.x = lerp(this.arm.R.fo.rotation.x, 0.3, k * 0.1);
    this.arm.L.fo.rotation.x = lerp(this.arm.L.fo.rotation.x, 0.5, k * 0.1);
    this.spine.rotation.x = lerp(this.spine.rotation.x, this.limp[2] * 0.4, k * 0.1);
    this.head.rotation.x = lerp(this.head.rotation.x, this.limp[3] * 0.8, k * 0.1);
    // dropped weapon physics
    const dg = this.droppedGun;
    if (dg && !dg.rest) {
      dg.vel.y -= 9.81 * dt;
      const imp = world.bounceSphere(this.gun.position, dg.vel, 0.05, dt, 0.25, 0.5);
      this.gun.rotation.x += dg.spin.x * dt; this.gun.rotation.y += dg.spin.y * dt; this.gun.rotation.z += dg.spin.z * dt;
      if (imp > 0) dg.spin.multiplyScalar(0.5);
      if (this.gun.position.y < 0.06 && dg.vel.lengthSq() < 0.05) {
        dg.rest = true;
        // lie flat on its side
        this.gun.rotation.set(0, this.gun.rotation.y, Math.PI / 2);
        this.gun.position.y = 0.03;
      }
    }
  }
}

const lerp = (a, b, t) => a + (b - a) * t;
function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
