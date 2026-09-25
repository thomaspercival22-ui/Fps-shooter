// FPV kamikaze drone: a 7-inch quad carrying a shaped-charge warhead. The
// player flies it through its analog video link (range and walls degrade the
// signal) and detonates it on impact or on command.
import * as THREE from 'three';
import { RAY_SIGHT } from './physics.js';

const MAX_RANGE = 190;

function buildDrone() {
  const g = new THREE.Group();
  const carbon = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.45, metalness: 0.3 });
  const motorMat = new THREE.MeshStandardMaterial({ color: 0x3b3e44, roughness: 0.3, metalness: 0.9 });
  const olive = new THREE.MeshStandardMaterial({ color: 0x4b5138, roughness: 0.65, metalness: 0.15 });
  const battMat = new THREE.MeshStandardMaterial({ color: 0x1f3d6b, roughness: 0.5, metalness: 0.1 });
  const propMat = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.6, transparent: true, opacity: 0.35, depthWrite: false });
  const add = (geo, mat, x, y, z, heat, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.userData.heat = heat;
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(0.075, 0.035, 0.17), carbon, 0, 0, 0, 0.5);
  add(new THREE.BoxGeometry(0.4, 0.012, 0.026), carbon, 0, 0, 0, 0.45, 0, Math.PI / 4);
  add(new THREE.BoxGeometry(0.4, 0.012, 0.026), carbon, 0, 0, 0, 0.45, 0, -Math.PI / 4);
  add(new THREE.BoxGeometry(0.055, 0.035, 0.1), battMat, 0, 0.036, 0.01, 0.62);
  add(new THREE.BoxGeometry(0.058, 0.006, 0.014), carbon, 0, 0.055, 0.01, 0.4);
  // warhead (PG-7 style cone + body) slung underneath
  add(new THREE.CylinderGeometry(0.036, 0.036, 0.16, 14), olive, 0, -0.05, -0.02, 0.3, Math.PI / 2);
  add(new THREE.ConeGeometry(0.036, 0.1, 14), olive, 0, -0.05, -0.15, 0.3, -Math.PI / 2);
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6), motorMat, 0, -0.05, -0.215, 0.3, Math.PI / 2);
  // camera + antenna + status LED
  add(new THREE.BoxGeometry(0.026, 0.026, 0.02), carbon, 0, 0.012, -0.09, 0.55, 0.35);
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 10), motorMat, 0, 0.016, -0.101, 0.4, Math.PI / 2 + 0.35);
  add(new THREE.CylinderGeometry(0.003, 0.003, 0.12, 5), carbon, 0, 0.07, 0.08, 0.3, -0.6);
  const led = add(new THREE.SphereGeometry(0.006, 6, 6), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 5 }), 0, 0.02, 0.087, 0.5);
  const props = [];
  for (const [x, z] of [[0.141, 0.141], [-0.141, 0.141], [0.141, -0.141], [-0.141, -0.141]]) {
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.024, 12), motorMat, x, 0.014, z, 0.8);
    const p = add(new THREE.CylinderGeometry(0.089, 0.089, 0.003, 24), propMat, x, 0.03, z, 0.5);
    p.castShadow = false;
    props.push(p);
  }
  return { group: g, props, led };
}

export class Drone {
  constructor(game) {
    this.game = game;
    const b = buildDrone();
    this.model = b.group;
    this.props = b.props;
    this.camera = new THREE.PerspectiveCamera(76, 1, 0.03, 1500);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.active = false;
    this.count = 2;
    this.max = 3;
    this.state = 'idle';
    this.yaw = 0; this.pitch = 0; this.bodyPitch = 0; this.bodyRoll = 0;
    this.signal = 1;
    this.transition = 0; // seconds of static while switching views
    this._los = true; this._losT = 0; this._noiseT = 0;
    this.buzz = null;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.fov = aspect > 1.6 ? 72 : 82;
    this.camera.updateProjectionMatrix();
  }

  get armed() { return this.active && this.flightT > 1.5; }
  get speed() { return this.vel.length(); }

  reset() {
    if (this.active) this._end(false);
    this.count = 2;
    this.transition = 0;
  }

  deploy() {
    const g = this.game, p = g.player;
    if (this.active || this.count <= 0 || !p.alive) return false;
    this.count--;
    const cam = g.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = Math.max(fwd.y, 0.1); fwd.normalize();
    const start = p.eye.clone().add(new THREE.Vector3(0, 0.25, 0));
    const h = g.level.world.raycast(start.x, start.y, start.z, fwd.x, fwd.y, fwd.z, 1.2);
    this.pos.copy(start).addScaledVector(fwd, h ? Math.max(0.2, h.t - 0.3) : 0.9);
    this.vel.copy(fwd).multiplyScalar(4).add(new THREE.Vector3(0, 2, 0));
    this.yaw = p.yaw; this.pitch = -0.08;
    this.bodyPitch = 0; this.bodyRoll = 0;
    this.battery = 1; this.flightT = 0; this.lostT = 0;
    this.state = 'flying';
    this.active = true;
    this.signal = 1;
    this.transition = 0.6;
    this.home = p.pos.clone();
    g.scene.add(this.model);
    this._startBuzz();
    g.audio.play('ui', { vol: 0.6 });
    if (!p.crouched) p.toggleCrouch(); // the operator kneels while flying
    g.hud.droneMode(true);
    return true;
  }

  _startBuzz() {
    const a = this.game.audio;
    if (!a.ctx || !a.buffers.droneLoop) return;
    const src = a.ctx.createBufferSource();
    src.buffer = a.buffers.droneLoop; src.loop = true;
    const gain = a.ctx.createGain(); gain.gain.value = 0;
    const pan = a.ctx.createStereoPanner();
    src.connect(gain); gain.connect(pan); pan.connect(a.sfx);
    src.start();
    this.buzz = { src, gain, pan };
  }
  _stopBuzz() { if (this.buzz) { try { this.buzz.src.stop(); } catch { /* already stopped */ } this.buzz = null; } }

  /** Nearby armed drone diving at speed: enemies try to get away from it. */
  dangerNear(pos, r) {
    if (!this.armed || this.state !== 'flying' || this.speed < 5) return null;
    return this.pos.distanceTo(pos) < r ? this : null;
  }

  shotDown() {
    if (!this.active || this.state === 'falling') return;
    this.state = 'falling';
    this.game.effects.impact(this.pos.clone(), new THREE.Vector3(0, 1, 0), 'metal', 1.2);
    this.game.audio.playAt('imp_metal0', this.pos.x, this.pos.y, this.pos.z, { vol: 0.8 });
    this.game.hud.osdMessage('HIT · LOSING CONTROL', 1.5);
  }

  detonate() {
    if (!this.active) return;
    const pos = this.pos.clone();
    this._end(true);
    this.game.explode(pos, 7.5, 260, 'drone');
  }

  exit() { if (this.active) this._end(false, 'LINK TERMINATED'); }

  _end(exploded, msg) {
    const g = this.game;
    this.active = false;
    this.state = 'idle';
    g.scene.remove(this.model);
    this._stopBuzz();
    this.transition = 0.55;
    g.hud.osdMessage(msg || (exploded ? 'SIGNAL LOST' : 'NO SIGNAL'), 0.55);
    setTimeout(() => { if (!this.active) g.hud.droneMode(false); }, 550);
  }

  update(dt, input, look) {
    const g = this.game, W = g.level.world;
    if (this.transition > 0) this.transition = Math.max(0, this.transition - dt);
    if (!this.active) return;
    this.flightT += dt;
    this.battery = Math.max(0, this.battery - dt / 160);

    // signal: range and obstacles between the drone and the operator
    this._losT -= dt;
    if (this._losT <= 0) {
      this._losT = 0.2;
      const e = g.player.eye;
      this._los = W.los(e.x, e.y + 0.3, e.z, this.pos.x, this.pos.y, this.pos.z, RAY_SIGHT);
    }
    const d = this.pos.distanceTo(g.player.eye);
    const target = THREE.MathUtils.clamp(1.15 - d / MAX_RANGE, 0, 1) * (this._los ? 1 : 0.62) * (0.95 + Math.random() * 0.05);
    this.signal += (target - this.signal) * Math.min(1, dt * 4);
    if (this.signal < 0.04) this.lostT += dt; else this.lostT = 0;
    if (this.lostT > 1.5 && this.state === 'flying') { this.state = 'falling'; g.hud.osdMessage('SIGNAL LOST', 2); }
    if (this.battery <= 0 && this.state === 'flying') { this.state = 'falling'; g.hud.osdMessage('BATTERY EMPTY', 2); }

    const control = this.state === 'flying';
    if (control) {
      this.yaw -= look[0] * 1.1;
      this.pitch = THREE.MathUtils.clamp(this.pitch - look[1] * 1.1, -1.4, 0.7);
    }
    const cp = Math.cos(this.pitch);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const old = this.vel.clone();
    if (control) {
      const top = input.sprint ? 26 : 14;
      const want = fwd.clone().multiplyScalar(input.moveY * top).addScaledVector(right, input.moveX * top * 0.7);
      want.y += input.upHeld ? 6 : input.downHeld ? -6 : 0;
      const dv = want.sub(this.vel);
      const acc = 18 * dt;
      if (dv.length() > acc) dv.setLength(acc);
      this.vel.add(dv);
    } else {
      this.vel.y -= 9.81 * dt;
      this.vel.multiplyScalar(1 - dt * 0.3);
    }
    const impact = W.bounceSphere(this.pos, this.vel, 0.16, dt, 0.2, 0.6);
    // hit something hard enough: the warhead goes off once armed
    if (impact > 3.2 || (this.state === 'falling' && impact > 1)) {
      if (this.armed) { this.detonate(); return; }
      g.effects.impact(this.pos.clone(), new THREE.Vector3(0, 1, 0), 'metal', 1);
      this._end(false, 'CRASHED');
      return;
    }
    // proximity fuse on enemies
    if (this.armed) {
      for (const e of g.enemies.list) {
        if (e.alive && this.pos.distanceTo(e.hb.neck) < 1.1) { this.detonate(); return; }
      }
    }
    if (this.pos.y > 90) { this.pos.y = 90; this.vel.y = Math.min(0, this.vel.y); }

    // body tilt from acceleration (what makes FPV footage feel real)
    const acc = this.vel.clone().sub(old).divideScalar(Math.max(dt, 1e-3));
    const fwdFlat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    const tp = THREE.MathUtils.clamp(-acc.dot(fwdFlat) * 0.035 - this.vel.dot(fwdFlat) * 0.018, -0.7, 0.5);
    const tr = THREE.MathUtils.clamp(-acc.dot(right) * 0.035 - look[0] * 6, -0.8, 0.8);
    this.bodyPitch += (tp - this.bodyPitch) * Math.min(1, dt * 6);
    this.bodyRoll += (tr - this.bodyRoll) * Math.min(1, dt * 6);

    this.model.position.copy(this.pos);
    this.model.rotation.set(this.bodyPitch, this.yaw, this.bodyRoll, 'YXZ');
    for (const p of this.props) p.rotation.y += dt * 90;
    this.camera.position.copy(this.pos).add(new THREE.Vector3(0, 0.03, 0));
    const shake = (Math.random() - 0.5) * 0.004 * (1 + this.speed / 10);
    this.camera.rotation.set(this.pitch + this.bodyPitch * 0.35 + shake, this.yaw, this.bodyRoll * 0.9 + shake, 'YXZ');
    this.camera.updateMatrixWorld();

    // motor sound (heard at the operator's position) + enemies hear the buzz
    if (this.buzz) {
      const a = g.audio.listener;
      const dist = Math.hypot(this.pos.x - a.x, this.pos.y - a.y, this.pos.z - a.z);
      const load = control ? 0.85 + this.speed / 30 + (input.upHeld ? 0.2 : 0) : 0.6;
      this.buzz.src.playbackRate.value += (load - this.buzz.src.playbackRate.value) * Math.min(1, dt * 5);
      this.buzz.gain.gain.value = Math.min(0.5, 2.2 / (1 + dist * 0.5));
      const rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
      this.buzz.pan.pan.value = dist > 0.5 ? THREE.MathUtils.clamp(((this.pos.x - a.x) * rx + (this.pos.z - a.z) * rz) / dist, -1, 1) * 0.8 : 0;
    }
    this._noiseT -= dt;
    if (this._noiseT <= 0) { this._noiseT = 1; g.enemies.onNoise(this.pos, 32, 'drone'); }
  }
}
