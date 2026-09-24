// First-person weapon handling: viewmodel rendering and animation (ADS,
// recoil, sway, bob, sprint), firing, reloading, switching and grenade throws.
import * as THREE from 'three';
import { WEAPONS, GRENADES } from './config.js';
import { buildM4, buildGlock, buildM1014, buildSniper, buildFragMesh, buildFlashMesh, Arms } from './gunmodels.js';
import * as TX from './textures.js';

const BUILDERS = { m4: buildM4, glock: buildGlock, m1014: buildM1014, sniper: buildSniper };
const DEG = Math.PI / 180;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const seg = (t, a, b) => ease((t - a) / (b - a));
function spring(s, target, k, d, dt) { // critically-damped-ish spring on {x, v}
  const a = (target - s.x) * k - s.v * d;
  s.v += a * dt; s.x += s.v * dt;
}

export class WeaponSystem {
  constructor(game, primaryKey) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    this.fill = new THREE.HemisphereLight(0xdfe8f2, 0x8a7458, 0.9);
    this.scene.add(this.sun, this.sun.target, this.fill);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 1.2, 2);
    this.scene.add(this.muzzleLight);
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.arms = new Arms();
    this.scene.add(this.arms.group);

    this.slots = {
      primary: this._make(primaryKey),
      secondary: this._make('glock'),
    };
    this.currentSlot = 'primary';
    for (const s of Object.values(this.slots)) { s.model.root.visible = false; this.rig.add(s.model.root); }
    this.cur.model.root.visible = true;

    // flash sprites
    this.flashFront = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: TX.muzzleFlashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const sideMat = new THREE.MeshBasicMaterial({ map: TX.muzzleSideTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const side = new THREE.PlaneGeometry(1, 0.5); side.translate(-0.5, 0, 0); side.rotateY(-Math.PI / 2);
    this.flashSide1 = new THREE.Mesh(side, sideMat);
    this.flashSide2 = new THREE.Mesh(side, sideMat); this.flashSide2.rotation.z = Math.PI / 2;
    this.flash = new THREE.Group();
    this.flash.add(this.flashFront, this.flashSide1, this.flashSide2);
    this.flash.traverse((o) => { o.frustumCulled = false; o.renderOrder = 5; });
    this.flash.visible = false;
    this.flashTime = 0;
    this.scene.add(this.flash);

    // grenade meshes held during throws
    this.heldFrag = buildFragMesh();
    this.heldFlash = buildFlashMesh();
    this.heldFrag.visible = this.heldFlash.visible = false;
    this.scene.add(this.heldFrag, this.heldFlash);

    this.state = 'draw';
    this.stateT = 0;
    this.drawT = 0;
    this.adsT = 0;
    this.sprintT = 0;
    this.lastShot = -1;
    this.triggerHeld = false;
    this.triggerPressed = false;
    this.shotsFired = 0;
    this.swayX = { x: 0, v: 0 }; this.swayY = { x: 0, v: 0 };
    this.kickZ = { x: 0, v: 0 }; this.kickRX = { x: 0, v: 0 }; this.kickRZ = { x: 0, v: 0 }; this.kickY = { x: 0, v: 0 };
    this.lookDX = 0; this.lookDY = 0;
    this.reload = null;
    this.throwing = null;
    this.frags = GRENADES.startFrag;
    this.flashes = GRENADES.startFlash;
    this.pendingSwitch = null;
    this.stats = { shots: 0, hits: 0 };
    this.lightTimer = 0;
    this._t = 0;
  }

  _make(key) {
    const def = WEAPONS[key];
    const model = BUILDERS[key]();
    return { key, def, model, ammo: def.mag + (def.chamber ? 1 : 0), reserve: def.reserve, boltReady: true };
  }

  get cur() { return this.slots[this.currentSlot]; }
  get def() { return this.cur.def; }
  get isScoped() { return !!this.def.scope && this.adsT > 0.85 && this.state !== 'draw'; }
  get busy() { return this.state !== 'idle'; }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.fov = aspect > 1.6 ? 46 : 52;
    this.camera.updateProjectionMatrix();
  }

  addLook(dx, dy) { this.lookDX += dx; this.lookDY += dy; }

  refill() {
    for (const s of Object.values(this.slots)) s.reserve = s.def.reserve;
    this.frags = GRENADES.maxFrag; this.flashes = GRENADES.maxFlash;
  }
  addAmmo(fraction = 0.35) {
    for (const s of Object.values(this.slots)) {
      const add = Math.ceil(s.def.reserve * fraction);
      s.reserve = Math.min(s.def.reserve * 1.5, s.reserve + add);
    }
  }

  switchWeapon(slot = null) {
    const target = slot || (this.currentSlot === 'primary' ? 'secondary' : 'primary');
    if (target === this.currentSlot && !this.pendingSwitch) return;
    if (this.throwing) return;
    this.reload = null;
    this.cur.model.parts.loose && (this.cur.model.parts.loose.visible = false);
    this.pendingSwitch = target;
    this.state = 'holster';
    this.stateT = 0;
  }

  requestReload() {
    const c = this.cur, d = c.def;
    if (this.state !== 'idle' || c.reserve <= 0) return;
    const full = d.mag + (d.chamber ? 1 : 0);
    if (c.ammo >= full) return;
    const empty = c.ammo === 0;
    if (d.shellReload) {
      this.reload = { shell: true, phase: 'start', t: 0, empty, stop: false };
    } else {
      this.reload = { shell: false, t: 0, dur: empty ? d.emptyReloadTime : d.reloadTime, empty, events: new Set() };
    }
    this.state = 'reload';
    this.game.emitNoise(this.game.player.eye, 14, 'reload');
  }

  throwGrenade(type) {
    if (this.throwing || this.state === 'draw' || this.state === 'holster') return;
    if (type === 'frag' ? this.frags <= 0 : this.flashes <= 0) return;
    if (type === 'frag') this.frags--; else this.flashes--;
    if (this.reload) { this.reload = null; }
    this.throwing = { type, t: 0, released: false, pinned: false };
    this.state = 'throw';
    const held = type === 'frag' ? this.heldFrag : this.heldFlash;
    held.visible = true;
  }

  setTrigger(down) {
    if (down && !this.triggerHeld) this.triggerPressed = true;
    this.triggerHeld = down;
    if (!down) this.shotsFired = 0;
  }

  update(dt, adsWanted) {
    this._t += dt;
    const g = this.game, p = g.player, c = this.cur, d = c.def;
    this.stateT += dt;

    // ---------- state machine ----------
    if (this.state === 'holster') {
      this.drawT = Math.max(0, 1 - this.stateT / (d.drawTime * 0.6));
      if (this.drawT <= 0) {
        c.model.root.visible = false;
        this.currentSlot = this.pendingSwitch;
        this.pendingSwitch = null;
        this.cur.model.root.visible = true;
        this.state = 'draw'; this.stateT = 0;
        g.audio.play('magTap', { vol: 0.4 });
      }
    } else if (this.state === 'draw') {
      this.drawT = Math.min(1, this.stateT / d.drawTime);
      if (this.drawT >= 1) this.state = 'idle';
    }

    const sprinting = p.sprinting;
    if (sprinting && this.reload && !this.reload.shell) { /* allow reload while sprinting */ }
    // Firing cancels sprint
    if (this.triggerHeld && sprinting) p.cancelSprint();

    // ADS
    const canAds = adsWanted && !sprinting && (this.state === 'idle' || this.state === 'bolt') && !this.throwing;
    this.adsT = Math.max(0, Math.min(1, this.adsT + (canAds ? 1 : -1) * dt / d.adsTime));
    this.sprintT = Math.max(0, Math.min(1, this.sprintT + (sprinting && this.state !== 'throw' ? 1 : -1) * dt * 5));

    // ---------- fire ----------
    const interval = 60 / d.rpm;
    if (this.triggerHeld || this.triggerPressed) {
      if (this.state === 'reload' && this.reload?.shell && c.ammo > 0) this.reload.stop = true;
      if (this.state === 'idle' && this.sprintT < 0.3 && g.time - this.lastShot >= interval && c.boltReady) {
        if (d.auto || this.triggerPressed) {
          if (c.ammo > 0) this._fire();
          else {
            if (this.triggerPressed) g.audio.play('dry', { vol: 0.6 });
            if (c.reserve > 0) this.requestReload();
          }
        }
      }
    }
    this.triggerPressed = false;

    // bolt cycling (sniper)
    if (this.state === 'bolt') {
      const t = this.stateT / d.boltTime;
      if (t >= 0.28 && !this._boltBack) { this._boltBack = true; g.audio.play('boltBack', { vol: 0.8 }); this._ejectShell(); }
      if (t >= 0.62 && !this._boltFwd) { this._boltFwd = true; g.audio.play('boltFwd', { vol: 0.8 }); }
      if (t >= 1) { this.state = 'idle'; c.boltReady = true; }
    }

    // ---------- reload ----------
    if (this.state === 'reload' && this.reload) this._updateReload(dt);
    if (this.throwing) this._updateThrow(dt);

    // auto-reload when empty
    if (this.state === 'idle' && c.ammo === 0 && c.reserve > 0 && g.time - this.lastShot > 0.25) this.requestReload();

    this._animate(dt);
  }

  _fire() {
    const g = this.game, p = g.player, c = this.cur, d = c.def;
    c.ammo--;
    this.lastShot = g.time;
    this.shotsFired++;
    this.stats.shots++;
    const cam = g.camera;
    cam.updateMatrixWorld();
    const origin = _v.setFromMatrixPosition(cam.matrixWorld);
    const fwd = _v2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    // spread (degrees)
    const moving = Math.min(1, p.horizSpeed / 4);
    let spread = THREE.MathUtils.lerp(d.hipSpread + d.moveSpread * moving, d.adsSpread + d.moveSpread * moving * 0.25, this.adsT);
    if (p.crouched) spread *= 0.75;
    if (!p.grounded) spread += 3;
    if (d.auto) spread *= 1 + Math.min(this.shotsFired, 10) * 0.03;
    const muzzleWorld = this.muzzleWorld(new THREE.Vector3());
    const pellets = d.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const dir = coneDir(fwd, (spread + (pellets > 1 ? d.pelletSpread : 0)) * DEG, cam);
      const tracer = d.tracerEvery && (this.stats.shots % d.tracerEvery === 0) && i === 0;
      g.ballistics.fire({
        owner: 'player', x: origin.x, y: origin.y, z: origin.z, dir, speed: d.velocity,
        damage: d.damage, weapon: d, tracer, tracerFrom: muzzleWorld,
      });
    }
    // recoil
    const adsMul = THREE.MathUtils.lerp(1, 0.7, this.adsT) * (p.crouched ? 0.8 : 1);
    const vk = d.recoilPitch * adsMul * (0.85 + Math.random() * 0.3);
    const hk = (Math.random() - 0.35) * 2 * d.recoilYaw * adsMul;
    p.kick(vk, hk);
    p.punch(d.viewKick * 0.6 * adsMul, (Math.random() - 0.5) * d.viewKick * 0.4);
    this.kickZ.v += (0.9 + d.viewKick * 0.6) * (1 - this.adsT * 0.5);
    this.kickRX.v += (0.8 + d.viewKick * 0.9) * (1 - this.adsT * 0.6);
    this.kickRZ.v += (Math.random() - 0.5) * 1.2 * d.viewKick;
    this.kickY.v += 0.2 * d.viewKick;
    // flash + light + sound + noise
    this.flash.visible = true;
    this.flashTime = 0.045;
    this.flashFront.rotation.z = Math.random() * Math.PI;
    const s = d.pellets > 1 ? 0.16 : d.scope ? 0.14 : 0.1;
    this.flashFront.scale.setScalar(s * (0.8 + Math.random() * 0.5));
    const side = s * (1.1 + Math.random() * 0.8);
    this.flashSide1.scale.set(side, side, side);
    this.flashSide2.scale.set(side, side, side);
    this.flash.rotation.z = Math.random() * Math.PI;
    this.muzzleLight.intensity = 2.5;
    g.effects.muzzleLight(muzzleWorld);
    g.audio.playVariant(`shot_${d.sound}_`, 3, { vol: d.sound === 'pistol' ? 0.75 : 0.9, rate: 0.97 + Math.random() * 0.06 });
    g.emitNoise(p.eye, d.sound === 'pistol' ? 55 : 85, 'gunshot');
    g.hud.onFire();
    // actions
    if (d.bolt) {
      c.boltReady = false;
      if (c.ammo > 0 || c.reserve > 0) { this.state = 'bolt'; this.stateT = 0; this._boltBack = this._boltFwd = false; }
      else c.boltReady = true;
    } else {
      setTimeout(() => this._ejectShell(), 25);
    }
    if (c.key === 'glock') this._slideKick = 1;
  }

  _ejectShell() {
    const g = this.game, d = this.def, m = this.cur.model;
    const pos = this._toWorld(m.eject, new THREE.Vector3());
    const cam = g.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion);
    const vel = right.multiplyScalar(2.2 + Math.random()).add(up.multiplyScalar(1.4 + Math.random() * 0.8)).add(back.multiplyScalar(0.3 + Math.random() * 0.4));
    vel.add(g.player.vel);
    g.effects.shell(pos, vel, d.shell);
  }

  _updateReload(dt) {
    const g = this.game, c = this.cur, d = c.def, r = this.reload;
    r.t += dt;
    if (r.shell) {
      // shotgun: start -> shells one by one -> end
      if (r.phase === 'start' && r.t >= d.reloadStart) { r.phase = 'shell'; r.t = 0; r.inserted = false; }
      else if (r.phase === 'shell') {
        if (r.t >= d.reloadPerShell * 0.7 && !r.inserted) {
          r.inserted = true;
          c.ammo++; c.reserve--;
          g.audio.play('shellIn', { vol: 0.7, rate: 0.95 + Math.random() * 0.1 });
        }
        if (r.t >= d.reloadPerShell) {
          const full = c.ammo >= d.mag + (r.empty ? 0 : 1) || c.ammo >= d.mag + 1;
          if (full || c.reserve <= 0 || r.stop) { r.phase = 'end'; r.t = 0; }
          else { r.t = 0; r.inserted = false; }
        }
      } else if (r.phase === 'end') {
        if (r.empty && !r.charged && r.t > d.reloadEnd * 0.4) { r.charged = true; g.audio.play('charge', { vol: 0.8 }); }
        if (r.t >= d.reloadEnd + (r.empty ? 0.3 : 0)) { this.reload = null; this.state = 'idle'; }
      }
      return;
    }
    const t = r.t / r.dur;
    const ev = (name, at, fn) => { if (t >= at && !r.events.has(name)) { r.events.add(name); fn(); } };
    ev('out', 0.2, () => {
      g.audio.play('magOut', { vol: 0.7 });
      if (r.empty) g.effects.droppedMag(this._toWorld(c.model.parts.mag, new THREE.Vector3()).add(new THREE.Vector3(0, -0.05, 0)), c.key);
    });
    ev('in', 0.62, () => {
      g.audio.play('magIn', { vol: 0.8 });
      const full = d.mag + (d.chamber && !r.empty ? 1 : 0);
      const need = Math.min(full - c.ammo, c.reserve);
      c.ammo += need; c.reserve -= need;
    });
    ev('tap', 0.7, () => g.audio.play('magTap', { vol: 0.5 }));
    if (r.empty) {
      if (c.key === 'm4') ev('charge', 0.8, () => g.audio.play('charge', { vol: 0.8 }));
      if (c.key === 'glock') ev('slide', 0.8, () => g.audio.play('slide', { vol: 0.8 }));
      if (c.key === 'sniper') {
        ev('bb', 0.78, () => g.audio.play('boltBack', { vol: 0.7 }));
        ev('bf', 0.86, () => g.audio.play('boltFwd', { vol: 0.7 }));
      }
    }
    if (t >= 1) { this.reload = null; this.state = 'idle'; c.boltReady = true; }
  }

  _updateThrow(dt) {
    const g = this.game, th = this.throwing;
    th.t += dt;
    if (!th.pinned && th.t > 0.18) { th.pinned = true; g.audio.play('pin', { vol: 0.7 }); }
    if (!th.released && th.t > 0.52) {
      th.released = true;
      const held = th.type === 'frag' ? this.heldFrag : this.heldFlash;
      held.visible = false;
      const cam = g.camera;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const pos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld).addScaledVector(fwd, 0.4);
      pos.y -= 0.1;
      const spd = GRENADES[th.type].throwSpeed;
      const vel = fwd.multiplyScalar(spd).add(new THREE.Vector3(0, 2.8, 0)).add(g.player.vel.clone().multiplyScalar(0.8));
      g.grenades.spawn(th.type, pos, vel, 'player');
    }
    if (th.t > 0.95) {
      this.throwing = null;
      if (this.state === 'throw') this.state = 'idle';
    }
  }

  /** World position of an object inside the viewmodel (for shells, tracers). */
  _toWorld(obj, out) {
    obj.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(obj.matrixWorld); // viewmodel camera space
    // viewmodel FOV differs from the world camera: scale depth so it lines up on screen
    const k = Math.tan(this.camera.fov * DEG / 2) / Math.tan(this.game.camera.fov * DEG / 2);
    out.x *= k; out.y *= k;
    return out.applyMatrix4(this.game.camera.matrixWorld);
  }
  muzzleWorld(out) { return this._toWorld(this.cur.model.muzzle, out); }

  _animate(dt) {
    const g = this.game, p = g.player, c = this.cur, d = c.def, m = c.model;
    const adsE = ease(this.adsT);
    // sway springs driven by look input
    const lookK = 0.0016 * (1 - adsE * 0.75);
    this.swayX.v += -this.lookDX * lookK * 60;
    this.swayY.v += -this.lookDY * lookK * 60;
    this.lookDX = 0; this.lookDY = 0;
    spring(this.swayX, 0, 120, 14, dt);
    spring(this.swayY, 0, 120, 14, dt);
    spring(this.kickZ, 0, 260, 22, dt);
    spring(this.kickRX, 0, 200, 18, dt);
    spring(this.kickRZ, 0, 160, 16, dt);
    spring(this.kickY, 0, 200, 20, dt);

    const pos = _v.copy(m.hip);
    const adsPos = _v2.set(0, -m.sightY, m.ads.z);
    pos.lerp(adsPos, adsE);
    let rx = 0, ry = 0, rz = 0;

    // bob
    const bobAmp = Math.min(1, p.horizSpeed / 4.3) * (p.grounded ? 1 : 0.2) * (1 - adsE * 0.85);
    const ph = p.bobPhase;
    pos.x += Math.sin(ph) * 0.011 * bobAmp;
    pos.y += -Math.abs(Math.cos(ph)) * 0.012 * bobAmp;
    rz += Math.sin(ph) * 0.02 * bobAmp;
    // idle breathing
    const br = (1 - adsE * 0.8);
    pos.y += Math.sin(this._t * 1.6) * 0.0022 * br;
    pos.x += Math.sin(this._t * 0.8) * 0.0012 * br;
    // sway
    rx += this.swayY.x * 0.06; ry += this.swayX.x * 0.06; rz += this.swayX.x * 0.05;
    pos.x += this.swayX.x * 0.004; pos.y += this.swayY.x * 0.004;
    // landing / vertical velocity
    pos.y += THREE.MathUtils.clamp(-p.vel.y * 0.004, -0.03, 0.03) + p.landDip * -0.04;
    // crouch cant
    rz += p.crouchT * 0.05 * (1 - adsE);
    // sprint pose
    const sp = ease(this.sprintT);
    pos.x += sp * -0.045; pos.y += sp * 0.03; pos.z += sp * 0.02;
    rx += sp * -0.22; ry += sp * 0.62; rz += sp * 0.32;
    pos.x += sp * Math.sin(ph) * 0.02; pos.y += sp * Math.abs(Math.cos(ph)) * 0.015;
    // recoil
    pos.z += this.kickZ.x * 0.018;
    pos.y += this.kickY.x * 0.004;
    rx += this.kickRX.x * 0.025;
    rz += this.kickRZ.x * 0.02;
    // draw / holster
    const dr = 1 - ease(this.drawT);
    pos.y -= dr * 0.28; rx -= dr * 0.9; rz += dr * 0.3;

    // reload / action animation
    let handL = null; let handLVisible = true; let handR = null;
    const magPart = m.parts.mag;
    if (magPart) magPart.position.set(0, 0, 0);
    if (m.parts.charge) m.parts.charge.position.set(0, 0, 0);
    if (m.parts.bolt) { m.parts.bolt.position.set(0, 0, 0); m.parts.bolt.rotation.set(0, 0, 0); }
    if (m.parts.slide) {
      this._slideKick = Math.max(0, (this._slideKick || 0) - dt * 14);
      const locked = c.ammo === 0 && !(this.reload && this.reload.events?.has('slide'));
      m.parts.slide.position.z = Math.max(locked ? 0.03 : 0, Math.sin(Math.min(1, this._slideKick) * Math.PI) * 0.03);
    }

    if (this.state === 'reload' && this.reload && !this.reload.shell) {
      const t = this.reload.t / this.reload.dur;
      const tilt = seg(t, 0, 0.14) * (1 - seg(t, 0.82, 1));
      rz += tilt * 0.55; rx += tilt * 0.18; ry += tilt * -0.15;
      pos.y += tilt * 0.025; pos.x -= tilt * 0.02;
      // mag travel: out (0.2-0.4), away, back (0.45-0.62)
      const magOut = seg(t, 0.2, 0.4) * (1 - seg(t, 0.45, 0.62));
      if (magPart) magPart.position.y = -magOut * 0.35;
      const well = m.magWell;
      const handAt = new THREE.Vector3(-0.02, well.y - 0.12 - magOut * 0.35, -well.f);
      // hand: handguard -> mag (0.1-0.2) -> down with it -> back up -> tap -> (bolt catch) -> handguard
      const toMag = seg(t, 0.1, 0.2), back = seg(t, 0.72, 0.9);
      handL = this._handTarget(m.handL, m.handL.support).lerp(handAt, toMag * (1 - back));
      if (this.reload.empty) {
        const bt = seg(t, 0.72, 0.8) * (1 - seg(t, 0.84, 0.92));
        if (c.key === 'm4') {
          if (m.parts.charge) m.parts.charge.position.z = seg(t, 0.76, 0.8) * (1 - seg(t, 0.8, 0.83)) * 0.08;
          handL.lerp(new THREE.Vector3(-0.01, 0.03, 0.14), bt);
        } else if (c.key === 'glock') {
          m.parts.slide.position.z = (1 - seg(t, 0.78, 0.82)) * 0.03;
          handL.lerp(new THREE.Vector3(-0.01, 0.02, 0.06), bt);
        } else if (c.key === 'sniper') {
          const up = seg(t, 0.74, 0.77) * (1 - seg(t, 0.9, 0.93)), bk = seg(t, 0.77, 0.82) * (1 - seg(t, 0.84, 0.89));
          m.parts.bolt.rotation.z = up * 1.1; m.parts.bolt.position.z = bk * 0.09;
          handR = new THREE.Vector3(m.boltHandle.x, m.boltHandle.y, -m.boltHandle.f + bk * 0.09);
        }
      }
    } else if (this.state === 'reload' && this.reload?.shell) {
      const r = this.reload;
      const inT = r.phase === 'start' ? ease(r.t / d.reloadStart) : r.phase === 'end' ? 1 - ease(r.t / (d.reloadEnd + (r.empty ? 0.3 : 0))) : 1;
      rz += inT * -0.5; rx += inT * 0.25; ry += inT * 0.1; pos.y += inT * 0.02;
      const loose = m.parts.loose;
      if (r.phase === 'shell') {
        const k = r.t / d.reloadPerShell;
        const saddle = new THREE.Vector3(-0.045, 0.0, 0.02);
        const port = new THREE.Vector3(0, -0.06, 0.0);
        const inPort = new THREE.Vector3(0, -0.03, -0.02);
        handL = k < 0.35 ? saddle.clone().lerp(port, ease(k / 0.35)) : k < 0.7 ? port.clone().lerp(inPort, ease((k - 0.35) / 0.35)) : inPort.clone().lerp(saddle, ease((k - 0.7) / 0.3));
        loose.visible = k < 0.7;
        loose.position.copy(handL).add(new THREE.Vector3(0.012, 0.03, 0));
      } else {
        loose.visible = false;
        handL = this._handTarget(m.handL, false).lerp(new THREE.Vector3(-0.045, 0, 0.02), inT);
        if (r.phase === 'end' && r.empty) {
          const ch = seg(r.t, 0.1, 0.25) * (1 - seg(r.t, 0.3, 0.45));
          if (m.parts.charge) m.parts.charge.position.z = ch * 0.07;
        }
      }
    } else if (this.state === 'bolt') {
      const t = this.stateT / d.boltTime;
      const up = seg(t, 0.08, 0.2) * (1 - seg(t, 0.72, 0.85));
      const bk = seg(t, 0.2, 0.36) * (1 - seg(t, 0.5, 0.66));
      m.parts.bolt.rotation.z = up * 1.1;
      m.parts.bolt.position.z = bk * 0.09;
      handR = new THREE.Vector3(m.boltHandle.x, m.boltHandle.y, -m.boltHandle.f + bk * 0.09);
      rz += up * 0.12 * (1 - adsE); pos.y -= up * 0.01;
    }

    // grenade throw
    let heldPos = null;
    if (this.throwing) {
      const t = this.throwing.t;
      const lower = seg(t, 0, 0.15) * (1 - seg(t, 0.75, 0.95));
      pos.y -= lower * 0.035; pos.x += lower * 0.03; rz -= lower * 0.3; rx -= lower * 0.1;
      handLVisible = true;
      // left hand path in camera space: bring up, wind back, throw forward
      const start = new THREE.Vector3(-0.13, -0.24, -0.42);
      const wind = new THREE.Vector3(-0.22, -0.06, -0.4);
      const rel = new THREE.Vector3(-0.04, 0.04, -0.65);
      let hp;
      if (t < 0.15) hp = start.clone().lerp(start, 0);
      else if (t < 0.42) hp = start.clone().lerp(wind, ease((t - 0.15) / 0.27));
      else if (t < 0.56) hp = wind.clone().lerp(rel, ease((t - 0.42) / 0.14));
      else hp = rel.clone().lerp(start.clone().add(new THREE.Vector3(0, -0.2, 0)), ease((t - 0.56) / 0.3));
      heldPos = hp;
    }

    this.rig.position.copy(pos);
    this.rig.rotation.set(rx, ry, rz, 'YXZ');
    this.rig.updateMatrix();
    this.rig.updateMatrixWorld(true);

    // arms
    const qRig = this.rig.quaternion;
    const rTarget = handR || this._handTarget(m.handR, false, true);
    const rWorld = rTarget.clone().applyMatrix4(this.rig.matrix);
    const qR = _q.copy(qRig).multiply(new THREE.Quaternion().setFromEuler(_e.set(m.handR.rot, 0, 0)));
    this.arms.solve('R', rWorld, qR.clone(), true);
    if (heldPos) {
      const ql = new THREE.Quaternion().setFromEuler(_e.set(-0.6, 0.3, 0.2));
      this.arms.solve('L', heldPos, ql, handLVisible);
      const held = this.throwing?.type === 'frag' ? this.heldFrag : this.heldFlash;
      held.position.copy(heldPos).add(new THREE.Vector3(0.0, 0.03, -0.03));
    } else {
      const lTarget = handL || this._handTarget(m.handL, m.handL.support);
      const lWorld = lTarget.clone().applyMatrix4(this.rig.matrix);
      const lEuler = m.handL.support ? _e.set(m.handL.rot, 0, 0) : _e.set(-Math.PI / 2 + m.handL.rot, 0, -0.3);
      const qL = qRig.clone().multiply(new THREE.Quaternion().setFromEuler(lEuler));
      this.arms.solve('L', lWorld, qL, handLVisible);
    }

    // muzzle flash attached to the muzzle
    if (this.flash.visible) {
      this.flashTime -= dt;
      m.muzzle.updateWorldMatrix(true, false);
      this.flash.position.setFromMatrixPosition(m.muzzle.matrixWorld);
      this.flash.quaternion.copy(this.rig.quaternion);
      this.muzzleLight.position.copy(this.flash.position);
      if (this.flashTime <= 0) { this.flash.visible = false; }
    }
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 60);

    // hide the viewmodel when looking through a scope
    const scoped = this.isScoped;
    this.rig.visible = !scoped;
    this.arms.group.visible = !scoped;
  }

  _handTarget(h, support, right = false) {
    const x = right ? 0.0 : support ? -0.012 : -0.004;
    return new THREE.Vector3(x, h.y, -h.f);
  }

  /** Light the viewmodel consistently with the world (sun direction, shade indoors). */
  updateLighting(sunDirWorld, inShadow, dt) {
    const cam = this.game.camera;
    const inv = cam.quaternion.clone().invert();
    const d = sunDirWorld.clone().applyQuaternion(inv);
    this.sun.position.copy(d).multiplyScalar(5);
    this.sun.target.position.set(0, 0, 0);
    const target = inShadow ? 0.15 : 2.4;
    this.sun.intensity += (target - this.sun.intensity) * Math.min(1, dt * 6);
    this.fill.intensity = inShadow ? 0.35 : 0.8;
    this.scene.environmentIntensity = inShadow ? 0.55 : 0.9;
  }
}

/** Random direction inside a cone around fwd (half-angle in radians). */
export function coneDir(fwd, halfAngle, cam) {
  const r = Math.sqrt(Math.random()) * halfAngle;
  const a = Math.random() * Math.PI * 2;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  return fwd.clone().addScaledVector(right, Math.cos(a) * Math.tan(r)).addScaledVector(up, Math.sin(a) * Math.tan(r)).normalize();
}
