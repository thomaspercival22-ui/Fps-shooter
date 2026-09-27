// First-person weapon handling: viewmodel rendering and animation (ADS,
// recoil, sway, bob, sprint), firing, reloading, switching and grenade throws.
import * as THREE from 'three';
import { WEAPONS, GRENADES } from './config.js';
import { settings } from './settings.js';
import { buildM4, buildGlock, buildM1014, buildSniper, buildFragMesh, buildFlashMesh, createArms, gunMaterials as gunMaterialsRef } from './gunmodels.js';
import * as TX from './textures.js';
import { pieMesh } from './chaos.js';

const BUILDERS = { m4: buildM4, glock: buildGlock, m1014: buildM1014, sniper: buildSniper };
const DEG = Math.PI / 180;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const seg = (t, a, b) => ease((t - a) / (b - a));
function spring(s, target, k, d, dt) { // critically-damped-ish spring on {x, v}
  const a = (target - s.x) * k - s.v * d;
  s.v += a * dt; s.x += s.v * dt;
}

// muzzle flash per weapon: fireball size, plume length, brake jets, duration (s), sparks, smoke, light
const FLASH = {
  m4: { core: 0.16, side: 0.3, dur: 0.04, sparks: 2, smoke: 0.7, light: 2.5 },
  m1014: { core: 0.3, side: 0.5, dur: 0.05, sparks: 16, smoke: 1.5, light: 3.4 },
  sniper: { core: 0.2, side: 0.36, brake: 0.24, dur: 0.045, sparks: 0, smoke: 1.8, light: 3.2 },
  glock: { core: 0.12, side: 0.18, dur: 0.035, sparks: 3, smoke: 0.5, light: 1.9 },
};
let flashTexCache = null;
function flashTextures() {
  if (!flashTexCache) flashTexCache = { front: [0, 1, 2, 3].map((i) => TX.muzzleFlashTexture(i)), side: [0, 1, 2].map((i) => TX.muzzleSideTexture(i)) };
  return flashTexCache;
}

export class WeaponSystem {
  constructor(game, primaryKey) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    // the weapon and hands shadow themselves (sight on the receiver, hand on the grip)
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -0.45, right: 0.45, top: 0.45, bottom: -0.45, near: 4.2, far: 5.9 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.0006;
    this.fill = new THREE.HemisphereLight(0xdfe8f2, 0x8a7458, 0.9);
    this.scene.add(this.sun, this.sun.target, this.fill);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 1.2, 2);
    this.scene.add(this.muzzleLight);
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.arms = createArms();
    this.scene.add(this.arms.group);
    this.arms.group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });

    this.slots = {
      primary: this._make(primaryKey),
      secondary: this._make('glock'),
    };
    this.currentSlot = 'primary';
    this.optic = primaryKey === 'm4' ? settings.optic : 'holo';
    for (const s of Object.values(this.slots)) { s.model.root.visible = false; this.rig.add(s.model.root); }
    this.cur.model.root.visible = true;

    // muzzle flash: a fireball facing down the bore, two crossed flame plumes along it and, on a
    // braked rifle, the side jets from the brake ports (texture variants picked at random per shot)
    const FT = flashTextures();
    this.flashTex = FT;
    const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
    this.flashFront = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: FT.front[0], ...add }));
    const sideMat = new THREE.MeshBasicMaterial({ map: FT.side[0], side: THREE.DoubleSide, ...add });
    const side = new THREE.PlaneGeometry(1, 0.5); side.translate(-0.5, 0, 0); side.rotateY(-Math.PI / 2);
    this.flashSide1 = new THREE.Mesh(side, sideMat);
    this.flashSide2 = new THREE.Mesh(side, sideMat); this.flashSide2.rotation.z = Math.PI / 2;
    const jetMat = new THREE.MeshBasicMaterial({ map: FT.front[1], ...add });
    this.brakeJets = [-1, 1].map((sgn) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), jetMat); m.userData.sgn = sgn; return m; });
    // soft halo of light round the fireball
    this.flashGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: TX.glowTexture(), color: 0xffa050, ...add }));
    this.flashGlow.position.z = -0.03;
    this.flash = new THREE.Group();
    this.flash.add(this.flashGlow, this.flashFront, this.flashSide1, this.flashSide2, ...this.brakeJets);
    this.flash.traverse((o) => { o.frustumCulled = false; o.renderOrder = 5; });
    this.flash.visible = false;
    this.flashTime = 0;
    this.scene.add(this.flash);
    // hot propellant gas leaving the muzzle: invisible to the eye (above all through a
    // suppressor) but a bright bloom to thermal imagers and, fainter, to night vision
    this.gas = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.gas.visible = false; this.gas.renderOrder = 5; this.gasT = 0; this.gasLife = 0.1; this.gasSize = 0.1;
    this.scene.add(this.gas);

    // grenade meshes held during throws
    this.heldFrag = buildFragMesh();
    this.heldFlash = buildFlashMesh();
    this.heldFrag.visible = this.heldFlash.visible = false;
    this.scene.add(this.heldFrag, this.heldFlash);

    // temperatures for thermal imaging
    const m = gunMaterialsRef();
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material === m.glove || o.material === m.knuckle || o.userData.hand) o.userData.heat = 0.9;
      else if (o.material === m.sleeve) o.userData.heat = 0.8;
      else o.userData.heat = 0.34;
      if (o.material.transparent || o.material.blending === THREE.AdditiveBlending) o.userData.noThermal = true;
    });
    // muzzle flashes live on layer 3: drawn on top of the thermal image too (hot gas)
    this.flash.traverse((o) => { o.userData.muzzleFlash = true; o.layers.set(3); });
    this.gas.userData.muzzleFlash = true; this.gas.layers.set(3);
    this.camera.layers.enableAll();

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
    this.fireMode = 'auto';
    this.stats = { shots: 0, hits: 0 };
    this.zoomIdx = 0;
    this.zero = 100;
    this.lightTimer = 0;
    this._t = 0;
  }

  _make(key) {
    let def = WEAPONS[key];
    // optional digital night vision scope on the M4 (3.5x, day colour / night mono)
    const nv = key === 'm4' && settings.optic === 'nv';
    if (nv) def = { ...def, name: 'M4A1 NV', scope: 'digital', adsZoom: 3.5, adsTime: 0.26, desc: def.desc };
    // the player's carbine carries a suppressor
    if (key === 'm4') def = { ...def, suppressed: true, sound: 'm4s' };
    const model = BUILDERS[key](key === 'm4' ? { optic: nv ? 'nv' : 'holo', suppressed: true } : undefined);
    const slot = { key, def, model, ammo: def.mag + (def.chamber ? 1 : 0), reserve: def.reserve, boltReady: true, heat: 0, jammed: false, dustOpen: false };
    if (!def.shellReload) this._fillMags(slot);
    slot.meshes = [];
    slot.suppHeat = 0;
    slot.suppMeshes = [];
    if (model.parts.supp) model.parts.supp.traverse((o) => { if (o.isMesh) { slot.suppMeshes.push(o); o.userData.supp = true; } });
    model.root.traverse((o) => { if (o.isMesh) slot.meshes.push(o); });
    return slot;
  }

  /** Magazine-fed weapons track every magazine and its rounds. */
  _fillMags(s) {
    s.mags = new Array(Math.round(s.def.reserve / s.def.mag)).fill(s.def.mag);
    this._sync(s);
  }
  _sync(s) { if (s.mags) s.reserve = s.mags.reduce((a, b) => a + b, 0); }

  toggleFireMode() {
    if (!this.def.auto) return;
    this.fireMode = this.fireMode === 'semi' ? 'auto' : 'semi';
    this.game.audio.play('dry', { vol: 0.5, rate: 1.4 });
  }

  get cur() { return this.slots[this.currentSlot]; }
  get def() { return this.cur.def; }
  get isScoped() { return !!this.def.scope && this.adsT > 0.85 && this.state !== 'draw'; }
  /** Current magnification (variable-power scopes step through def.zooms). */
  get scopeZoom() { const z = this.def.zooms; return z ? z[Math.min(this.zoomIdx, z.length - 1)] : this.def.adsZoom; }
  cycleZoom() {
    const z = this.def.zooms;
    if (!z) return false;
    this.zoomIdx = (this.zoomIdx + 1) % z.length;
    this.game.audio.play('magTap', { vol: 0.35, rate: 1.6 });
    return true;
  }
  /** Elevation turret: range the scope is zeroed at (metres). */
  dialZero(step) {
    if (!this.def.zeroable) return false;
    this.zero = Math.max(100, Math.min(1000, this.zero + step));
    this.game.audio.play('magTap', { vol: 0.3, rate: 2.2 });
    return true;
  }
  get busy() { return this.state !== 'idle'; }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.fov = aspect > 1.6 ? 46 : 52;
    this.camera.updateProjectionMatrix();
  }

  addLook(dx, dy) { this.lookDX += dx; this.lookDY += dy; }

  refill(frags = GRENADES.maxFrag, flashes = GRENADES.maxFlash) {
    for (const s of Object.values(this.slots)) { if (s.mags) this._fillMags(s); else s.reserve = s.def.reserve; }
    this.frags = Math.max(this.frags, frags); this.flashes = Math.max(this.flashes, flashes);
  }
  addAmmo(fraction = 0.35) {
    for (const s of Object.values(this.slots)) {
      if (s.mags) {
        const maxMags = Math.round(s.def.reserve / s.def.mag * 1.5);
        const n = Math.max(1, Math.round(s.def.reserve / s.def.mag * fraction));
        for (let i = 0; i < n && s.mags.length < maxMags; i++) s.mags.push(s.def.mag);
        this._sync(s);
      } else {
        s.reserve = Math.min(s.def.reserve * 1.5, s.reserve + Math.ceil(s.def.reserve * fraction));
      }
    }
  }

  switchWeapon(slot = null) {
    const target = slot || (this.currentSlot === 'primary' ? 'secondary' : 'primary');
    if (target === this.currentSlot && !this.pendingSwitch) return;
    if (this.throwing) return;
    this.reload = null; this.reloadQueued = false;
    this.cur.model.parts.loose && (this.cur.model.parts.loose.visible = false);
    this.pendingSwitch = target;
    this.state = 'holster';
    this.stateT = 0;
  }

  requestReload() {
    const c = this.cur, d = c.def;
    // asked while the bolt is cycling or the gun is still coming up: do it as soon as it's ready
    if (this.state === 'bolt' || this.state === 'draw' || this.state === 'throw') { this.reloadQueued = true; return; }
    this.reloadQueued = false;
    if (this.state !== 'idle') return;
    if (c.jammed) { this.state = 'clear'; this.stateT = 0; this._clearEv = new Set(); return; }
    if (c.reserve <= 0) return;
    if (c.mags && Math.max(0, ...c.mags) <= Math.max(0, c.ammo - (d.chamber ? 1 : 0))) return; // nothing better in the pouches
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
    if (type === 'frag' && this.game.chaos) type = 'pie'; // chaos mode: the frag pouch holds pies
    if (this.reload) { this.reload = null; }
    this.throwing = { type, t: 0, released: false, pinned: type === 'pie' };
    this.state = 'throw';
    this._held(type).visible = true;
  }
  /** The grenade (or pie) in the left hand during a throw. */
  _held(type) {
    if (type === 'pie' && !this.heldPie) {
      this.heldPie = pieMesh();
      this.heldPie.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.userData.heat = 0.45; } });
      this.heldPie.visible = false;
      this.scene.add(this.heldPie);
    }
    return type === 'pie' ? this.heldPie : type === 'frag' ? this.heldFrag : this.heldFlash;
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
    if (this.reloadQueued && this.state === 'idle') this.requestReload();

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
        const auto = d.auto && this.fireMode !== 'semi';
        if (auto || this.triggerPressed) {
          if (c.jammed) { if (this.triggerPressed) { g.audio.play('dry', { vol: 0.7 }); g.hud.malfunction(); } }
          else if (c.ammo > 0) this._fire();
          else {
            // click on an empty chamber, then start reloading (one less button to find on a phone)
            if (this.triggerPressed) { g.audio.play('dry', { vol: 0.6 }); if (c.reserve > 0) this.requestReload(); }
            if (c.reserve > 0) this.requestReload();
          }
        }
      }
    }
    this.triggerPressed = false;

    // clearing a stoppage: tap the magazine, rack the action
    if (this.state === 'clear') {
      const t = this.stateT, ev = this._clearEv;
      if (t > 0.18 && !ev.has('tap')) { ev.add('tap'); g.audio.play('magTap', { vol: 0.7 }); }
      if (t > 0.5 && !ev.has('rack')) {
        ev.add('rack');
        g.audio.play(c.key === 'glock' ? 'slide' : c.key === 'sniper' ? 'boltBack' : 'charge', { vol: 0.8 });
        if (c.ammo > 0) { c.ammo--; this._ejectShell(); } // the stuck round flies out
      }
      if (t > 1.05) { c.jammed = false; this.state = 'idle'; c.boltReady = true; }
    }
    // barrel heat: cools slowly, smokes after a long string of fire
    for (const s of Object.values(this.slots)) {
      s.heat = Math.max(0, s.heat - dt * 0.045);
      s.suppHeat = Math.max(0, (s.suppHeat || 0) - dt * 0.0045); // a suppressor holds its heat for minutes
    }
    const smoke = Math.max(c.heat, (c.suppHeat || 0) * 0.8);
    if (smoke > 0.22 && g.time - this.lastShot > 0.3 && Math.random() < smoke * dt * 14) {
      const mp = this.muzzleWorld(new THREE.Vector3());
      g.effects.dust.emit({ x: mp.x, y: mp.y, z: mp.z, vx: (Math.random() - 0.5) * 0.1, vy: 0.25 + Math.random() * 0.2, vz: (Math.random() - 0.5) * 0.1,
        size: 0.025, grow: 5, drag: 0.8, grav: -0.05, maxLife: 1.6 + Math.random(), r: 0.8, g: 0.8, b: 0.8, a: 0.22 * c.heat, fade: 1.2, spin: 0.5 });
    }
    for (const mesh of c.meshes) if (!mesh.userData.supp && mesh.userData.heat !== undefined && mesh.userData.heat < 0.85) mesh.userData.heat = 0.34 + c.heat * 0.5;
    // the can soaks up the gas heat: white-hot through thermal, dull red glow after mag dumps
    const sh = Math.min(1, c.suppHeat || 0);
    for (const mesh of c.suppMeshes) mesh.userData.heat = 0.32 + sh * 0.75;
    // visible glow only after mag dumps; faint in daylight, obvious at night (the exposure does the rest)
    if (c.suppMeshes.length) {
      const glow = Math.max(0, ((c.suppHeat || 0) - 0.6) / 0.6) ** 2 * 0.3;
      const u = c.suppMeshes[0].material.userData.gun;
      if (u) u.canHeat.value = glow; else c.suppMeshes[0].material.emissiveIntensity = glow;
    }

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
    c.heat = Math.min(1, c.heat + d.heatPerShot);
    c.dustOpen = true;
    this._bcgKick = 1;
    // stoppages happen, more often with a hot, dirty gun
    if (c.ammo > 0 && Math.random() < d.jam * (1 + c.heat * 3)) { c.jammed = true; setTimeout(() => this.game.hud.malfunction(), 120); }
    this.lastShot = g.time;
    g.mission?.onPlayerShot?.();
    this.shotsFired++;
    this.stats.shots++;
    const cam = g.camera;
    cam.updateMatrixWorld();
    const origin = _v.setFromMatrixPosition(cam.matrixWorld);
    const fwd = _v2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    // scope zeroed at a range: the bore points up just enough for the round to drop onto the reticle there
    if (d.zeroable && this.adsT > 0.5) {
      const right = _v3.set(1, 0, 0).applyQuaternion(cam.quaternion);
      fwd.applyAxisAngle(right, 0.5 * Math.asin(Math.min(1, 9.81 * this.zero / (d.velocity * d.velocity))));
    }
    // spread (degrees)
    const moving = Math.min(1, p.horizSpeed / 4);
    let spread = THREE.MathUtils.lerp(d.hipSpread + d.moveSpread * moving, d.adsSpread + d.moveSpread * moving * 0.25, this.adsT);
    if (p.crouched) spread *= 0.75;
    if (!p.grounded) spread += 3;
    if (d.auto) spread *= 1 + Math.min(this.shotsFired, 10) * 0.03;
    spread *= 1 + c.heat * 0.35; // a hot barrel walks the group open
    const muzzleWorld = this.muzzleWorld(new THREE.Vector3());
    const pellets = d.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const dir = coneDir(fwd, (spread + (pellets > 1 ? d.pelletSpread : 0)) * DEG, cam);
      const tracer = !g.chaos && d.tracerEvery && (this.stats.shots % d.tracerEvery === 0) && i === 0;
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
    // a suppressor traps the flash: only a faint glow at the cap, a bigger "first round pop" after a rest
    const firstPop = d.suppressed && g.time - (this._prevShot ?? -9) > 1.2;
    this._prevShot = g.time;
    const F = d.suppressed ? null : FLASH[c.key] || FLASH.m4;
    const vis = g.night ? 1 : 0.8;           // the same flash reads far brighter in the dark
    const s = d.suppressed ? (firstPop ? 0.05 : 0.026) : F.core;
    const T = this.flashTex, pick = (a) => a[(Math.random() * a.length) | 0];
    this.flashFront.material.map = pick(T.front);
    this.flashSide1.material.map = pick(T.side);
    this.flashFront.material.opacity = this.flashSide1.material.opacity = vis;
    this.flashFront.scale.setScalar(s * (0.75 + Math.random() * 0.5));
    const side = d.suppressed ? 0.0001 : F.side * (0.8 + Math.random() * 0.45);
    this.flashSide1.scale.set(side, side * (0.8 + Math.random() * 0.4), side);
    this.flashSide2.scale.set(side, side * (0.8 + Math.random() * 0.4), side);
    this.flash.rotation.z = Math.random() * Math.PI;
    for (const j of this.brakeJets) {
      j.visible = !!F?.brake;
      if (!j.visible) continue;
      const b = F.brake * (0.8 + Math.random() * 0.4);
      j.scale.set(b * 1.3, b * 0.75, 1);
      j.position.set(j.userData.sgn * b * 0.55, 0, 0.02);
      j.rotation.set(0, 0, (Math.random() - 0.5) * 0.4);
      j.material.opacity = vis * 0.85;
    }
    this.flashTime = F ? F.dur : 0.045;
    this.flashGlow.visible = !!F;
    if (F) { this.flashGlow.scale.setScalar(F.core * 2.6); this.flashGlow.material.opacity = g.night ? 0.45 : 0.25; }
    this.muzzleLight.intensity = d.suppressed ? (firstPop ? 0.5 : 0.12) : F.light;
    if (g.chaos) {
      // chaos mode: a party popper, not a gunshot
      this.flash.visible = false; this.muzzleLight.intensity = 0;
      g.effects.confetti(muzzleWorld, _v3.set(0, 0, -1).applyQuaternion(cam.quaternion), pellets > 1 ? 26 : 14, 14, 0.18);
    } else {
      if (!d.suppressed || firstPop) g.effects.muzzleLight(muzzleWorld);
      if (F) g.effects.muzzleBlast(muzzleWorld, _v3.set(0, 0, -1).applyQuaternion(cam.quaternion), F);
    }
    if (d.suppressed) c.suppHeat = Math.min(1.25, (c.suppHeat || 0) + 0.0125);
    this.gasLife = this.gasT = d.suppressed ? 0.13 : 0.1;
    this.gasSize = d.suppressed ? 0.1 + Math.min(1, c.suppHeat) * 0.04 : d.pellets > 1 ? 0.36 : 0.28;
    // recordings carry their own space; the reverb only adds a touch of the room / terrain
    const A = g.audio, send = A.recorded ? (g.level.indoor ? 0.08 : 0.04) : (d.suppressed ? 0.15 : 0.3);
    if (g.chaos) A.play(A.pick('popper') || 'popper0', { vol: 0.8, rate: (d.pellets > 1 ? 0.8 : d.sound === 'pistol' ? 1.15 : 1) * (0.92 + Math.random() * 0.16), send });
    else A.play(A.gunshotName(d.sound), { vol: d.suppressed ? 0.75 : d.sound === 'pistol' ? 0.85 : 0.95, rate: 0.985 + Math.random() * 0.03, send });
    g.emitNoise(p.eye, d.sound === 'pistol' ? 55 : d.suppressed ? 38 : 85, 'gunshot');
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
    if (this.game.chaos) return; // nothing to eject from a confetti gun
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
      if (c.mags) {
        // swap magazines: keep the partial one on a tactical reload, drop it when empty
        const chambered = d.chamber && !r.empty && c.ammo > 0 ? 1 : 0;
        const left = c.ammo - chambered;
        c.mags.sort((a, b) => b - a);
        const fresh = c.mags.shift();
        if (!r.empty && left > 0) c.mags.push(left);
        c.ammo = fresh + chambered;
        this._sync(c);
      } else {
        const full = d.mag + (d.chamber && !r.empty ? 1 : 0);
        const need = Math.min(full - c.ammo, c.reserve);
        c.ammo += need; c.reserve -= need;
      }
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
      this._held(th.type).visible = false;
      const cam = g.camera;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const pos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld).addScaledVector(fwd, 0.4);
      pos.y -= 0.1;
      const spd = GRENADES[th.type].throwSpeed;
      // a pie goes flatter, towards the crosshair (it has to hit someone, not land near them)
      const vel = fwd.multiplyScalar(spd).add(new THREE.Vector3(0, th.type === 'pie' ? 2.2 : 2.8, 0)).add(g.player.vel.clone().multiplyScalar(0.8));
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
    // M4: dust cover springs open on the first shot; the bolt carrier cycles and locks back on empty
    if (m.parts.dust) m.parts.dust.rotation.z += ((c.dustOpen ? -1.85 : 0) - m.parts.dust.rotation.z) * Math.min(1, dt * 30);
    if (m.parts.bcg) {
      this._bcgKick = Math.max(0, (this._bcgKick || 0) - dt * 16);
      const held = c.ammo === 0 && !(this.reload && this.reload.events?.has('charge'));
      m.parts.bcg.position.z = Math.max(held ? 0.034 : 0, Math.sin(Math.min(1, this._bcgKick) * Math.PI) * 0.034);
    }
    if (m.parts.slide) {
      this._slideKick = Math.max(0, (this._slideKick || 0) - dt * 14);
      const locked = c.ammo === 0 && !(this.reload && this.reload.events?.has('slide'));
      m.parts.slide.position.z = Math.max(locked ? 0.03 : 0, Math.sin(Math.min(1, this._slideKick) * Math.PI) * 0.03);
    }

    if (this.state === 'clear') {
      const t = this.stateT / 1.05;
      const tilt = seg(t, 0, 0.15) * (1 - seg(t, 0.85, 1));
      rz += tilt * 0.5; rx += tilt * 0.12; pos.y += tilt * 0.02;
      const well = m.magWell;
      const toMag = seg(t, 0.05, 0.17) * (1 - seg(t, 0.24, 0.34));
      const toRack = seg(t, 0.3, 0.42) * (1 - seg(t, 0.62, 0.78));
      handL = this._handTarget(m.handL, m.handL.support)
        .lerp(new THREE.Vector3(-0.02, well.y - 0.12, -well.f), toMag)
        .lerp(c.key === 'glock' ? new THREE.Vector3(-0.01, 0.02, 0.06) : new THREE.Vector3(-0.01, 0.03, 0.14), toRack);
      const pull = seg(t, 0.42, 0.5) * (1 - seg(t, 0.5, 0.56));
      if (m.parts.charge) m.parts.charge.position.z = pull * 0.08;
      if (m.parts.slide) m.parts.slide.position.z = pull * 0.03;
      if (m.parts.bcg) m.parts.bcg.position.z = pull * 0.034;
      if (m.parts.bolt) { m.parts.bolt.rotation.z = pull * 1.1; m.parts.bolt.position.z = pull * 0.09; }
      if (m.parts.mag) m.parts.mag.position.y = seg(t, 0.17, 0.2) * (1 - seg(t, 0.2, 0.26)) * 0.006;
    } else if (this.state === 'reload' && this.reload && !this.reload.shell) {
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
      this.arms.solve('L', heldPos, ql, handLVisible, false, 'ball');
      const held = this._held(this.throwing?.type);
      if (this.throwing?.type === 'pie') {
        // carried flat on the palm like a waiter's plate, tipped so the cream shows
        held.position.copy(heldPos).add(new THREE.Vector3(-0.01, 0.06, -0.08));
        held.rotation.set(0.35, this.throwing.t * 2, 0);
        held.scale.setScalar(0.62); // seen this close, a full-size pie would fill the screen
      } else held.position.copy(heldPos).add(new THREE.Vector3(0.0, 0.03, -0.03));
    } else {
      const lTarget = handL || this._handTarget(m.handL, m.handL.support);
      const lWorld = lTarget.clone().applyMatrix4(this.rig.matrix);
      const lEuler = m.handL.support ? _e.set(m.handL.rot, 0, 0) : _e.set(-Math.PI / 2 + m.handL.rot, 0, 0);
      const qL = qRig.clone().multiply(new THREE.Quaternion().setFromEuler(lEuler));
      this.arms.solve('L', lWorld, qL, handLVisible, !!m.handL.support && !handL);
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
    // gas bloom: expands and drifts forward as it cools; only thermal and NV sensors see it
    const sensor = g.viewMode === 'thermal' ? 1 : g.viewMode === 'nvg' ? 0.05 : 0;
    this.gasT = Math.max(0, this.gasT - dt);
    this.gas.visible = this.gasT > 0 && sensor > 0 && this.rig.visible;
    if (this.gas.visible) {
      const k = 1 - this.gasT / this.gasLife;
      m.muzzle.updateWorldMatrix(true, false);
      this.gas.position.setFromMatrixPosition(m.muzzle.matrixWorld).addScaledVector(_v2.set(0, 0, -1).applyQuaternion(this.rig.quaternion), 0.02 + k * this.gasSize * 0.8);
      this.gas.scale.setScalar(this.gasSize * (0.6 + k * 1.1));
      this.gas.material.opacity = sensor * (1 - k) ** 1.5 * 1.4;
    }

    // hide the viewmodel when looking through a scope
    const scoped = this.isScoped;
    this.rig.visible = !scoped;
    this.arms.group.visible = !scoped;
  }

  _handTarget(h, support, right = false) {
    const x = right || support ? 0.0 : -0.004;
    return new THREE.Vector3(x, h.y, -h.f);
  }

  /** Light the viewmodel consistently with the world (sun direction, shade indoors). */
  updateLighting(sunDirWorld, inShadow, dt, k = 1) {
    const cam = this.game.camera;
    const inv = cam.quaternion.clone().invert();
    const d = sunDirWorld.clone().applyQuaternion(inv);
    this.sun.position.copy(d).multiplyScalar(5);
    this.sun.target.position.set(0, 0, 0);
    const target = (inShadow ? 0.15 : 2.4) * k;
    this.sun.intensity += (target - this.sun.intensity) * Math.min(1, dt * 6);
    this.fill.intensity = (inShadow ? 0.35 : 0.8) * k;
    this.scene.environmentIntensity = (inShadow ? 0.55 : 0.9) * Math.max(k, 0.05);
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
