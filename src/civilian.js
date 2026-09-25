// Non-combatants: office workers and bound hostages. Same jointed rig as the
// soldiers (sculpted office clothes, bare hands, hair or a hessian hood) with
// posed states: standing, hands up, cowering, kneeling bound, fleeing and
// walking out once rescued. Bullets, blasts and flashbangs affect them too.
import * as THREE from 'three';
import { meshes } from './meshes.js';
import { fabricMaterial, R } from './fabric.js';
import { raySphere, rayCapsule } from './physics.js';
import { soldierOptions, lodOf, LOD_NEAR, LOD_FAR } from './soldier.js';

// clothing and skin palettes
const LOOKS = [
  { chest: 'civChest', head: 'civHead', jacket: false, shirt: 0xdfe5ec, pants: 0x2d333d, hair: 0x2b2018, skin: 0xc49a7c, shoes: 0x2b1d15, tie: 0x6b1f24 },
  { chest: 'civChestSuit', head: 'civHead', jacket: true, shirt: 0xeef0f2, pants: 0x23262d, vest: 0x262a33, hair: 0x14110e, skin: 0x8d6248, shoes: 0x151312, tie: 0x2a3f6e },
  { chest: 'civChestF', head: 'civHeadF', jacket: false, shirt: 0x9fb4c9, pants: 0x1f2126, hair: 0x5a3a22, skin: 0xd8b097, shoes: 0x1a1414, tie: 0x333333 },
  { chest: 'civChestSuit', head: 'civHeadF', jacket: true, shirt: 0xf3efe9, pants: 0x3a3a3e, vest: 0x3d3f45, hair: 0x1c1512, skin: 0xb48468, shoes: 0x201a18, tie: 0x7a2530 },
  { chest: 'civChest', head: 'civHead', jacket: false, shirt: 0x7f93a6, pants: 0x4a4436, hair: 0x6e5a42, skin: 0xe0b9a0, shoes: 0x3a2a1c, tie: 0x2b2b2b },
  { chest: 'civChestF', head: 'civHeadF', jacket: false, shirt: 0xc9a9b2, pants: 0x2a2f3a, hair: 0x2a1c14, skin: 0x6f4a36, shoes: 0x18130f, tie: 0x333333 },
  { chest: 'civChestSuit', head: 'civHead', jacket: true, shirt: 0xd9e1ea, pants: 0x4b4f57, vest: 0x50545d, hair: 0x9b958c, skin: 0xd1a88e, shoes: 0x2b211a, tie: 0x5b4b1f },
];
export const LOOK_COUNT = LOOKS.length;

const mats = {};
function lookMaterial(i) {
  if (mats[i]) return mats[i];
  const L = LOOKS[i];
  const m = fabricMaterial({
    plain: true, bump: 0.6,
    colors: {
      [R.SHIRT]: L.shirt, [R.PANTS]: L.pants, [R.VEST]: L.vest ?? L.shirt, [R.FACE]: L.skin, [R.HELMET]: L.hair, [R.BOOT]: L.shoes,
      [R.BLACK]: 0x151412, [R.TPR]: L.tie, [R.POUCH]: 0x5f5140, [R.LENS]: 0x0b0908,
    },
    rough: { [R.SHIRT]: 0.82, [R.PANTS]: 0.8, [R.VEST]: 0.78, [R.FACE]: 0.55, [R.HELMET]: 0.62, [R.BOOT]: 0.35, [R.BLACK]: 0.5, [R.TPR]: 0.45, [R.POUCH]: 0.95, [R.LENS]: 0.08 },
  });
  m.side = THREE.DoubleSide;
  mats[i] = m;
  return m;
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);
const _v = new THREE.Vector3(), _a = new THREE.Vector3();

// Key poses: hip height, spine and head pitch, leg joints [thigh x, shin x, thigh z] per side,
// hand targets in spine space and the elbow pole direction per side.
const POSES = {
  stand: { hip: 0.95, spine: 0.03, head: 0.05, L: [0.02, 0.05, 0.03], R: [0.02, 0.05, -0.03],
    hL: V(0.19, -0.03, 0.05), hR: V(-0.19, -0.03, 0.05), pL: V(0.15, -1, -1), pR: V(-0.15, -1, -1) },
  handsUp: { hip: 0.95, spine: -0.04, head: -0.05, L: [0.02, 0.05, 0.05], R: [0.02, 0.05, -0.05],
    hL: V(0.25, 0.93, 0.16), hR: V(-0.25, 0.93, 0.16), pL: V(1, -0.7, 0), pR: V(-1, -0.7, 0) },
  kneelBound: { hip: 0.52, spine: 0.14, head: 0.32, L: [-0.06, 1.56, 0.05], R: [-0.06, 1.56, -0.05],
    hL: V(0.05, 0.03, -0.17), hR: V(-0.05, 0.03, -0.17), pL: V(0.9, 0.1, -0.5), pR: V(-0.9, 0.1, -0.5) },
  kneelHands: { hip: 0.52, spine: 0.06, head: 0.2, L: [-0.06, 1.56, 0.06], R: [-0.06, 1.56, -0.06],
    hL: V(0.07, 0.72, -0.06), hR: V(-0.07, 0.72, -0.06), pL: V(1, 0.4, 0.4), pR: V(-1, 0.4, 0.4) },
  cower: { hip: 0.5, spine: 0.55, head: 0.45, L: [-1.55, 1.75, 0.12], R: [-0.25, 1.45, -0.08],
    hL: V(0.08, 0.66, 0.16), hR: V(-0.08, 0.66, 0.16), pL: V(1, 0.1, 0.6), pR: V(-1, 0.1, 0.6) },
  dead: null,
};

export class Civilian {
  constructor(mgr, o) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.hostage = !!o.hostage;
    this.name = o.name || (this.hostage ? 'Hostage' : 'Civilian');
    this.hp = 100;
    this.alive = true;
    this.pos = new THREE.Vector3(o.x, 0, o.z);
    this.vel = new THREE.Vector3();
    this.home = { x: o.x, z: o.z };
    this.yaw = o.yaw ?? 0;
    this.state = this.hostage ? 'bound' : (o.pose || 'stand');
    this.hooded = this.hostage && o.hood !== false;
    this.stateT = 0;
    this.panic = 0;
    this.path = null; this.pathIdx = 0;
    this.phase = Math.random() * 6;
    this.rescued = false;
    this.gone = false;
    this.flashed = 0;
    this.hb = { head: V(), neck: V(), hips: V(), kL: V(), fL: V(), kR: V(), fR: V() };
    this.hit = { x: { x: 0, v: 0 }, z: { x: 0, v: 0 } };
    this._build(o.look ?? Math.floor(Math.random() * LOOKS.length));
    this.cur = this._poseCopy(POSES[this._poseName()]);
    this._apply(0, 0);
  }

  _build(lookIndex) {
    const M = meshes(), L = LOOKS[lookIndex % LOOKS.length], mat = lookMaterial(lookIndex % LOOKS.length);
    this.meshes = [];
    const mk = (geo, heat = 0.9) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.heat = heat; m.userData.baseHeat = heat;
      m.userData.geoHi = geo; m.userData.geoLo = lodOf(geo);
      this.meshes.push(m);
      return m;
    };
    this.far = false;
    this.root = new THREE.Group();
    this.faller = new THREE.Group(); this.root.add(this.faller);
    this.hips = new THREE.Group(); this.hips.position.y = 0.95; this.faller.add(this.hips);
    this.hips.add(mk(M.civPelvis, 0.8));
    this.spine = new THREE.Group(); this.spine.position.y = 0.08; this.hips.add(this.spine);
    this.spine.add(mk(M[L.chest], 0.85));
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.52, 0); this.spine.add(this.neck);
    this.head = new THREE.Group(); this.head.position.y = 0.04; this.neck.add(this.head);
    this.lookHead = M[L.head];
    this.head.add(mk(this.hooded ? M.civHood : M[L.head], this.hooded ? 0.72 : 1.0));
    this.arm = {};
    for (const [side, x] of [['R', -0.19], ['L', 0.19]]) {
      const up = new THREE.Group(); up.position.set(x, 0.45, 0.0); this.spine.add(up); up.add(mk(L.jacket ? M.civUpperArmJ : M.civUpperArm, 0.85));
      const fo = new THREE.Group(); fo.position.y = -0.3; up.add(fo); fo.add(mk(L.jacket ? M.civForeArmJ : M.civForeArm, 0.9));
      const ha = new THREE.Group(); ha.position.y = -0.275; ha.rotation.y = side === 'R' ? -Math.PI / 2 : Math.PI / 2; fo.add(ha);
      ha.add(mk(side === 'R' ? M.civHandR : M.civHandL, 0.97));
      this.arm[side] = { up, fo, ha, shoulder: V(x, 0.45, 0) };
    }
    this.leg = {};
    for (const [side, x] of [['R', -0.095], ['L', 0.095]]) {
      const th = new THREE.Group(); th.position.set(x, -0.04, 0); this.hips.add(th); th.add(mk(M.civThigh, 0.82));
      const sh = new THREE.Group(); sh.position.y = -0.44; th.add(sh); sh.add(mk(M.civShin, 0.78));
      this.leg[side] = { th, sh };
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.game.scene.add(this.root);
  }

  _poseName() {
    switch (this.state) {
      case 'bound': return this.hooded ? 'kneelBound' : 'kneelHands';
      case 'handsUp': return 'handsUp';
      case 'cower': return 'cower';
      default: return 'stand';
    }
  }
  _poseCopy(p) {
    return { hip: p.hip, spine: p.spine, head: p.head, L: [...p.L], R: [...p.R], hL: p.hL.clone(), hR: p.hR.clone(), pL: p.pL.clone(), pR: p.pR.clone() };
  }

  /** Scared by gunfire, a blast or a hostile nearby. */
  alarm(pos, strength = 1) {
    if (!this.alive || this.rescued || this.hostage) return;
    this.panic = Math.min(2, this.panic + strength);
    if (this.state === 'stand' || this.state === 'handsUp' || this.state === 'walk') {
      // most drop where they are; some run from the noise to the nearest hiding spot first
      const flee = pos && Math.random() < 0.45 && Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z) < 14;
      if (flee && this._fleeFrom(pos)) this.setState('flee');
      else this.setState('cower');
    }
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s; this.stateT = 0;
    if (s !== 'flee' && s !== 'walkOut' && s !== 'walk' && s !== 'escape') this.path = null;
  }

  _fleeFrom(pos) {
    const nav = this.game.level.nav;
    let ax = this.pos.x - pos.x, az = this.pos.z - pos.z;
    const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
    for (const rot of [0, 0.7, -0.7, 1.4, -1.4]) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const tx = this.pos.x + (ax * c - az * s) * 7, tz = this.pos.z + (ax * s + az * c) * 7;
      const k = nav.nearestWalkable(tx, tz, 2.5);
      if (k < 0) continue;
      const path = nav.findPath(this.pos.x, this.pos.z, nav.cx(k), nav.cz(k));
      if (path) { this.path = path; this.pathIdx = 0; return true; }
    }
    return false;
  }

  /** The player cut the restraints / talked them out: walk to the exit and leave the floor. */
  rescue(exit) {
    if (!this.alive || this.rescued) return false;
    this.rescued = true;
    if (this.hooded) {
      // pull the hood off
      const M = meshes();
      const headMesh = this.head.children[0];
      headMesh.userData.geoHi = this.lookHead || M.civHead; headMesh.userData.geoLo = lodOf(headMesh.userData.geoHi);
      headMesh.geometry = this.far ? headMesh.userData.geoLo : headMesh.userData.geoHi;
      headMesh.userData.heat = headMesh.userData.baseHeat = 1.0;
      this.hooded = false;
    }
    this.state = 'standUp'; this.stateT = 0;
    this.exit = exit;
    return true;
  }

  takeDamage(amount, part, dirX, dirZ, source) {
    if (!this.alive) return false;
    this.hp -= amount * (part === 'head' ? 1.6 : 1);
    this.hitSpring(dirX, dirZ, part === 'head' ? 1.5 : 1);
    this.mgr.onHurt(this, source);
    if (this.hp <= 0) { this.die(dirX, dirZ, part === 'head', source); return true; }
    if (!this.hostage && this.state !== 'flee') this.setState('cower');
    return false;
  }

  hitSpring(dirX, dirZ, k) {
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    const lx = dirX * c - dirZ * s, lz = dirX * s + dirZ * c;
    this.hit.x.v += lz * 6 * k; this.hit.z.v += -lx * 6 * k;
  }

  die(dirX, dirZ, headshot, source) {
    this.alive = false;
    this.hp = 0;
    this.state = 'dead';
    this.deathT = 0;
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    let lx = dirX * c - dirZ * s, lz = dirX * s + dirZ * c;
    const l = Math.hypot(lx, lz) || 1; lx /= l; lz /= l;
    this.fallDir = V(lx, 0, lz);
    if (this.fallDir.lengthSq() < 0.1) this.fallDir.set(0, 0, 1);
    this.fallAxis = V(0, 1, 0).cross(this.fallDir).normalize();
    this.fallAngle = 0; this.fallVel = 0;
    this.limp = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    this.game.audio.playAt(`edeath${(Math.random() * 2) | 0}`, this.pos.x, this.pos.y + 1.2, this.pos.z, { vol: headshot ? 0.3 : 0.8 });
    this.mgr.onDeath(this, source);
  }

  dispose() { this.game.scene.remove(this.root); }

  // ---------------- per frame ----------------
  update(dt) {
    const g = this.game, W = g.level.world;
    const d = this.root.position.distanceTo((g.drone?.active ? g.drone.camera : g.camera).position) * soldierOptions.lodScale;
    const far = this.far ? d > LOD_NEAR : d > LOD_FAR;
    if (far !== this.far) { this.far = far; for (const m of this.meshes) m.geometry = far ? m.userData.geoLo : m.userData.geoHi; }
    this.stateT += dt;
    if (!this.alive) { this._updateDead(dt); this._updateHitboxes(); return; }
    if (this.flashed > 0) this.flashed -= dt;
    this.panic = Math.max(0, this.panic - dt * 0.02);
    let speed = 0;
    const p = g.player;
    const dP = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    switch (this.state) {
      case 'stand': case 'handsUp': {
        // an armed operator bursting in: hands up, then down on the floor
        if (dP < 5 && p.alive && this.state === 'stand' && g.time - (this.seenAt || -99) > 0) {
          if (W.los(this.pos.x, this.pos.y + 1.6, this.pos.z, p.eye.x, p.eye.y, p.eye.z)) this.setState('handsUp');
        }
        if (this.state === 'handsUp') {
          this._face(p.pos.x - this.pos.x, p.pos.z - this.pos.z, dt, 2.5);
          if (this.stateT > 3.5 || this.panic > 0.5) this.setState('cower');
        }
        break;
      }
      case 'flee': {
        speed = 3.6;
        if (!this.path || this.pathIdx >= this.path.length) this.setState('cower');
        break;
      }
      case 'cower': break;
      case 'bound': break;
      case 'walk': speed = this.walkSpeed || 1.2; break;     // scripted routes (the mission picks the next leg)
      case 'escape': speed = this.walkSpeed || 4.5; break;
      case 'standUp': if (this.stateT > 1.1) { this.state = 'walkOut'; this.stateT = 0; this._pathToExit(); } break;
      case 'walkOut': {
        speed = 1.5;
        if (!this.path || this.pathIdx >= this.path.length) {
          if (this.stateT > 0.5) { this.gone = true; this.root.visible = false; this.mgr.onEvacuated(this); }
        }
        break;
      }
    }
    // follow the path
    let dvx = 0, dvz = 0;
    if (speed > 0 && this.path && this.pathIdx < this.path.length) {
      const t = this.path[this.pathIdx];
      const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.35) this.pathIdx++;
      else { dvx = dx / d * speed; dvz = dz / d * speed; }
    }
    const k = Math.min(1, dt * 8);
    this.vel.x += (dvx - this.vel.x) * k; this.vel.z += (dvz - this.vel.z) * k;
    if (Math.abs(this.vel.x) + Math.abs(this.vel.z) > 0.01) {
      W.slide(this.pos, this.vel.x * dt, this.vel.z * dt, 0.28, 1.7, 0.4);
      this.pos.y = W.groundAt(this.pos.x, this.pos.z, 0.2, this.pos.y + 0.4);
      if (Math.hypot(this.vel.x, this.vel.z) > 0.3) this._face(this.vel.x, this.vel.z, dt, 6);
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this._animate(dt, Math.hypot(this.vel.x, this.vel.z));
    this._updateHitboxes();
  }

  _pathToExit() {
    const e = this.exit, nav = this.game.level.nav;
    if (!e) { this.path = null; return; }
    this.path = nav.findPath(this.pos.x, this.pos.z, e.x, e.z);
    this.pathIdx = 0;
  }

  _face(dx, dz, dt, rate) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
    const want = Math.atan2(dx, dz);
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
  }

  _animate(dt, speed) {
    for (const s of [this.hit.x, this.hit.z]) { s.v += (-s.x * 90 - s.v * 11) * dt; s.x += s.v * dt; }
    const moving = this.state === 'standUp' || this.state === 'walkOut' || this.state === 'flee' || this.state === 'walk' || this.state === 'escape';
    const target = POSES[moving ? 'stand' : this._poseName()];
    const c = this.cur, k = Math.min(1, dt * (this.state === 'cower' || this.state === 'flee' ? 7 : 4));
    c.hip = lerp(c.hip, target.hip, k); c.spine = lerp(c.spine, target.spine, k); c.head = lerp(c.head, target.head, k);
    for (let i = 0; i < 3; i++) { c.L[i] = lerp(c.L[i], target.L[i], k); c.R[i] = lerp(c.R[i], target.R[i], k); }
    c.hL.lerp(target.hL, k); c.hR.lerp(target.hR, k); c.pL.lerp(target.pL, k).normalize(); c.pR.lerp(target.pR, k).normalize();
    this._apply(speed, dt);
    // shaking with fear, breathing
    const t = this.game.time + this.phase;
    const fear = this.state === 'cower' || this.state === 'bound' ? 0.012 + this.panic * 0.01 : 0.004;
    this.spine.rotation.x += Math.sin(t * (this.state === 'cower' ? 11 : 1.6)) * fear;
    this.spine.rotation.z += this.hit.z.x * 0.12;
    this.spine.rotation.x += this.hit.x.x * 0.12;
  }

  _apply(speed, dt) {
    const c = this.cur, L = this.leg.L, Rg = this.leg.R;
    let lx = c.L[0], ls = c.L[1], rx = c.R[0], rs = c.R[1], hip = c.hip;
    let hL = c.hL, hR = c.hR;
    if (speed > 0.2) {
      // gait: the same cycle as the soldiers, with swinging arms
      const run = speed > 2.4;
      this.phase += speed * dt / (run ? 1.6 : 1.1) * Math.PI;
      const A = (run ? 0.6 : 0.38) * Math.min(1, speed / 1.2);
      const sP = Math.sin(this.phase), cP = Math.cos(this.phase);
      lx = -sP * A; rx = sP * A;
      ls = Math.max(0, -cP) * A * 1.4 + 0.08; rs = Math.max(0, cP) * A * 1.4 + 0.08;
      hip = 0.95 - Math.abs(sP) * 0.03;
      hL = _v.set(0.19, (run ? 0.12 : -0.02), 0.05 - sP * A * 0.4);
      hR = _a.set(-0.19, (run ? 0.12 : -0.02), 0.05 + sP * A * 0.4);
    }
    L.th.rotation.set(lx, 0, c.L[2]); L.sh.rotation.set(ls, 0, 0);
    Rg.th.rotation.set(rx, 0, c.R[2]); Rg.sh.rotation.set(rs, 0, 0);
    this.hips.position.y = hip;
    this.spine.rotation.set(c.spine + (speed > 2.4 ? 0.15 : 0), 0, 0);
    this.head.rotation.set(c.head, 0, 0);
    this._solveArm('L', hL, c.pL);
    this._solveArm('R', hR, c.pR);
  }

  _solveArm(side, target, poleDir) {
    const arm = this.arm[side], S = arm.shoulder;
    const a = 0.3, b = 0.3;
    const dir = new THREE.Vector3().subVectors(target, S);
    const d = Math.min(a + b - 0.002, Math.max(0.1, dir.length()));
    dir.normalize();
    const pole = poleDir.clone();
    const cosA = (a * a + d * d - b * b) / (2 * a * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir)));
    if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0); perp.normalize();
    const E = S.clone().addScaledVector(dir, cosA * a).addScaledVector(perp, sinA * a);
    const Wp = S.clone().addScaledVector(dir, d);
    arm.up.quaternion.setFromUnitVectors(DOWN, E.clone().sub(S).normalize());
    const dFo = Wp.sub(E).normalize().applyQuaternion(arm.up.quaternion.clone().invert());
    arm.fo.quaternion.setFromUnitVectors(DOWN, dFo);
  }

  _updateDead(dt) {
    this.deathT += dt;
    const t = this.deathT;
    if ((t % 1) < dt) { const k = Math.max(0.38, 1 - t / 120); for (const m of this.meshes) m.userData.heat = m.userData.baseHeat * k; }
    if (this.fallAngle < Math.PI / 2 || this.fallVel > 0.01) {
      this.fallVel += (t > 0.1 ? 9 : 2) * dt * (0.3 + Math.sin(this.fallAngle) * 1.6);
      this.fallAngle += this.fallVel * dt;
      const max = this.cur.hip < 0.7 ? Math.PI / 2 - 0.25 : Math.PI / 2 - 0.05;
      if (this.fallAngle > max) { this.fallAngle = max; this.fallVel = -this.fallVel * 0.2; if (Math.abs(this.fallVel) < 0.2) this.fallVel = 0; }
    }
    this.faller.quaternion.setFromAxisAngle(this.fallAxis, this.fallAngle);
    this.faller.position.y = -Math.sin(this.fallAngle) * 0.1;
    const k = Math.min(1, t * 2) * 0.1;
    for (const s of ['L', 'R']) {
      this.leg[s].th.rotation.x = lerp(this.leg[s].th.rotation.x, this.cur.hip < 0.7 ? this.leg[s].th.rotation.x : -0.3, k);
      this.leg[s].sh.rotation.x = lerp(this.leg[s].sh.rotation.x, this.cur.hip < 0.7 ? this.leg[s].sh.rotation.x : 0.6, k);
    }
    this.spine.rotation.x = lerp(this.spine.rotation.x, this.limp[0] * 0.4, k);
    this.head.rotation.x = lerp(this.head.rotation.x, this.limp[1] * 0.8, k);
  }

  _updateHitboxes() {
    const hb = this.hb;
    this.root.updateMatrixWorld(true);
    hb.head.set(0, 0.1, 0.01).applyMatrix4(this.head.matrixWorld);
    hb.neck.setFromMatrixPosition(this.neck.matrixWorld);
    hb.hips.setFromMatrixPosition(this.hips.matrixWorld);
    for (const s of ['L', 'R']) {
      const sh = this.leg[s].sh;
      (s === 'L' ? hb.kL : hb.kR).setFromMatrixPosition(sh.matrixWorld);
      (s === 'L' ? hb.fL : hb.fR).set(0, -0.4, 0.04).applyMatrix4(sh.matrixWorld);
    }
  }
}

// ---------------- manager ----------------
export class CivilianManager {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(o) { const c = new Civilian(this, o); this.list.push(c); return c; }
  clear() { for (const c of this.list) c.dispose(); this.list = []; }
  update(dt) { for (const c of this.list) if (!c.gone) c.update(dt); }

  get hostages() { return this.list.filter((c) => c.hostage); }

  onHurt(c, source) { this.game.mission?.onCivilianHurt?.(c, source); }
  onDeath(c, source) { this.game.mission?.onCivilianKilled?.(c, source); }
  onEvacuated(c) { this.game.mission?.onEvacuated?.(c); }

  /** Gunfire and explosions: people nearby panic. */
  onNoise(pos, radius, kind) {
    if (kind !== 'gunshot') return;
    for (const c of this.list) {
      if (!c.alive || c.hostage || c.rescued) continue;
      const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
      if (d < Math.min(radius, 30)) c.alarm(pos, 1 - d / 40);
    }
  }

  flashbang(pos, radius) {
    const W = this.game.level.world;
    for (const c of this.list) {
      if (!c.alive || c.gone) continue;
      const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
      if (d > radius * 0.6 || !W.los(pos.x, pos.y + 0.1, pos.z, c.pos.x, c.pos.y + 1.2, c.pos.z)) continue;
      c.flashed = 4;
      c.alarm(null, 1);
    }
  }

  /** Bullet segment vs every person's hitboxes: nearest {civ, t, part}. */
  intersect(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    for (const c of this.list) {
      if (!c.alive || c.gone) continue;
      const cx = c.pos.x - ox, cy = c.pos.y + 0.8 - oy, cz = c.pos.z - oz;
      const tc = cx * dx + cy * dy + cz * dz;
      if (tc < -1.2 || tc > maxT + 1.2) continue;
      if (cx * cx + cy * cy + cz * cz - tc * tc > 1.44) continue;
      const hb = c.hb;
      const tests = [
        ['head', raySphere(ox, oy, oz, dx, dy, dz, hb.head.x, hb.head.y, hb.head.z, 0.13)],
        ['torso', rayCapsule(ox, oy, oz, dx, dy, dz, hb.neck.x, hb.neck.y, hb.neck.z, hb.hips.x, hb.hips.y, hb.hips.z, 0.18)],
        ['limb', rayCapsule(ox, oy, oz, dx, dy, dz, hb.hips.x, hb.hips.y, hb.hips.z, hb.kL.x, hb.kL.y, hb.kL.z, 0.09)],
        ['limb', rayCapsule(ox, oy, oz, dx, dy, dz, hb.kL.x, hb.kL.y, hb.kL.z, hb.fL.x, hb.fL.y, hb.fL.z, 0.07)],
        ['limb', rayCapsule(ox, oy, oz, dx, dy, dz, hb.hips.x, hb.hips.y, hb.hips.z, hb.kR.x, hb.kR.y, hb.kR.z, 0.09)],
        ['limb', rayCapsule(ox, oy, oz, dx, dy, dz, hb.kR.x, hb.kR.y, hb.kR.z, hb.fR.x, hb.fR.y, hb.fR.z, 0.07)],
      ];
      for (const [part, t] of tests) if (t >= 0 && t <= maxT && (!best || t < best.t)) best = { civ: c, t, part };
    }
    return best;
  }
}
