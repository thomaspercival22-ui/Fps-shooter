// Game orchestration: scene, renderer settings, the main loop, waves,
// scoring, pickups, explosions and flashbangs.
import * as THREE from 'three';
import { settings, getBest, setBest } from './settings.js';
import { DIFFICULTY, SCORE, GRENADES } from './config.js';
import { buildLevel } from './level.js';
import { Player } from './player.js';
import { WeaponSystem } from './weapons.js';
import { EnemyManager } from './ai.js';
import { Ballistics } from './ballistics.js';
import { Effects } from './effects.js';
import { Grenades } from './grenades.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { RAY_ALL } from './physics.js';
import { PostFX, MODE, thermalMaterial, withThermal } from './post.js';
import { Drone } from './drone.js';
import { soldierOptions } from './soldier.js';
import { nightSkyTexture } from './textures.js';

// Direction of the moon painted into the night sky texture.
const MOON_DIR = (() => {
  const lat = (0.5 - 0.22) * Math.PI, phi = (0.62 - 0.5) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(lat) * Math.cos(phi), Math.sin(lat), Math.cos(lat) * Math.sin(phi)).normalize();
})();

const DEG = Math.PI / 180;
const QUALITY = {
  low: { scale: 0.7, shadows: false, shadowSize: 1024 },
  medium: { scale: 1.0, shadows: true, shadowSize: 1024 },
  high: { scale: 1.5, shadows: true, shadowSize: 2048 },
};

export class Game {
  constructor(renderer, assets, audio, voices) {
    this.renderer = renderer;
    this.assets = assets;
    this.audio = audio;
    this.voices = voices;
    this.time = 0;
    this.state = 'menu';
    this.flashAmount = 0;
    this.pickups = [];
    this.difficulty = DIFFICULTY[settings.difficulty] || DIFFICULTY.regular;

    const scene = this.scene = new THREE.Scene();
    scene.background = assets.skyTex;
    scene.environment = assets.envMap;
    scene.environmentIntensity = 0.85;
    scene.backgroundIntensity = 1.0;
    this.fogColor = new THREE.Color(0xd3d9de);
    scene.fog = new THREE.Fog(this.fogColor, 90, 750);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1500);
    scene.add(this.camera);

    // sun (direction from the sky HDR)
    this.sunDir = assets.sunDir.clone();
    if (this.sunDir.y < 0.35) { this.sunDir.y = 0.35; this.sunDir.normalize(); }
    const sun = this.sun = new THREE.DirectionalLight(0xfff0dc, 3.1);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    scene.add(sun, sun.target);

    this.level = buildLevel(scene, assets, { shadows: true });
    this.barrelMatrices = this.level.explosiveBarrels.map((b) => { const m = new THREE.Matrix4(); b.meshes[0].getMatrixAt(b.index, m); return m; });
    this.player = new Player(this);
    this.input = new Input(this);
    this.hud = new HUD(this);
    this.hud.buildMinimap(this.level);
    this.effects = new Effects(this);
    this.ballistics = new Ballistics(this);
    this.grenades = new Grenades(this);
    this.enemies = new EnemyManager(this);
    this.weapons = new WeaponSystem(this, settings.primary);
    this.weapons.scene.environment = assets.envMap;
    this.pickupModels = { ammo: assets.models.ammo_box, health: assets.models.medical_box };
    this.post = new PostFX(renderer);
    this.drone = new Drone(this);
    this.viewMode = 'normal';
    this.thermalPalette = 0;
    this.night = false;
    this.lightDir = this.sunDir.clone();
    this.thermalSky = new THREE.Color(0.015, 0.015, 0.015);

    audio.occlusion = (x, y, z) => !this.level.world.los(this.camera.position.x, this.camera.position.y, this.camera.position.z, x, y, z);

    this.renderScale = 1;
    this.frameTimes = [];
    this.scaleTimer = 0;
    this.applyQuality();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 250));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });

    this.menuAngle = 0;
    this._shadowCheckT = 0;
    this.inShadow = false;
    this.aimTarget = null;
    this.snap = null;
    this.prevAds = 0;
    this.heartT = 0;
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------- setup ----------------
  applyQuality() {
    const q = QUALITY[settings.quality] || QUALITY.medium;
    const dpr = window.devicePixelRatio || 1;
    this.maxScale = Math.min(dpr, settings.quality === 'high' ? 1.75 : settings.quality === 'auto' ? 1.35 : q.scale);
    this.renderScale = settings.quality === 'auto' ? Math.min(1.0, this.maxScale) : Math.min(dpr, q.scale);
    const shadows = settings.quality === 'auto' ? true : q.shadows;
    const size = settings.quality === 'high' ? 2048 : 1024;
    const r = this.renderer;
    if (r.shadowMap.enabled !== shadows) {
      r.shadowMap.enabled = shadows;
      this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
    }
    r.shadowMap.type = settings.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.post.setQuality(settings.quality === 'low' ? 'low' : 'high');
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    }
    this.onResize();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.baseFov = hfovToV(settings.fov, aspect);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.weapons?.resize(aspect);
    this.drone?.resize(aspect);
    this.hud?.resize(w, h);
    if (this.post) { const b = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.post.setSize(b.x, b.y); }
    const bufH = h * this.renderScale;
    this.effects?.setFog(this.fogColor, this.scene.fog.near, this.scene.fog.far, bufH / (2 * Math.tan(this.camera.fov * DEG / 2)));
  }

  // ---------------- flow ----------------
  start() {
    this.difficulty = DIFFICULTY[settings.difficulty] || DIFFICULTY.regular;
    if (this.weapons.slots.primary.key !== settings.primary) {
      this.weapons = new WeaponSystem(this, settings.primary);
      this.weapons.scene.environment = this.assets.envMap;
      this.onResize();
    } else {
      for (const s of Object.values(this.weapons.slots)) { s.ammo = s.def.mag + (s.def.chamber ? 1 : 0); s.reserve = s.def.reserve; s.boltReady = true; }
      this.weapons.frags = GRENADES.startFrag; this.weapons.flashes = GRENADES.startFlash;
      if (this.weapons.currentSlot !== 'primary') { this.weapons.cur.model.root.visible = false; this.weapons.currentSlot = 'primary'; this.weapons.cur.model.root.visible = true; }
      this.weapons.state = 'draw'; this.weapons.stateT = 0; this.weapons.reload = null; this.weapons.throwing = null; this.weapons.adsT = 0;
      this.weapons.heldFrag.visible = this.weapons.heldFlash.visible = false;
      this.weapons.stats = { shots: 0, hits: 0 };
    }
    this.enemies.clear();
    this.grenades.clear();
    this.ballistics.clear();
    this.effects.clear();
    for (const pk of this.pickups) this.scene.remove(pk.mesh);
    this.pickups = [];
    this._resetBarrels();
    const s = this.level.playerSpawn;
    this.player.reset(s.x, s.z, s.yaw);
    this.input.reset();
    this.input.setAdsButton(false);
    this.score = 0;
    this.stats = { kills: 0, headshots: 0, grenadeKills: 0, longest: 0, started: this.time };
    this.wave = 0;
    this.waveState = 'intermission';
    this.waveTimer = 4;
    this.toSpawn = [];
    this.spawnTimer = 0;
    this.resupplyT = 0;
    this.state = 'playing';
    this.input.enabled = true;
    this.hud.show(true);
    this.hud.setScore(0);
    this.hud.setWave(1, 0);
    this.hud.banner('OPERATION TIPS MANIA', 'Hold the compound', 3.5);
    this.audio.startAmbience();
    this.flashAmount = 0;
    this.viewMode = 'normal';
    this.drone.reset();
    this.hud.droneMode(false);
    this.setTimeOfDay(settings.time === 'night');
  }

  /** Day: sun + HDR sky. Night: moonlight, stars, sodium lamps, darker fog. */
  setTimeOfDay(night) {
    this.night = night;
    soldierOptions.night = night;
    const s = this.scene;
    if (night) {
      if (!this.nightSky) this.nightSky = nightSkyTexture();
      s.background = this.nightSky; s.backgroundIntensity = 0.6;
      s.environmentIntensity = 0.05;
      this.fogColor.set(0x06080d); s.fog.near = 20; s.fog.far = 230;
      this.sun.color.set(0x9db4ff); this.sun.intensity = 0.45;
      this.lightDir.copy(MOON_DIR);
      if (!this.level.lamps.parent) s.add(this.level.lamps);
    } else {
      s.background = this.assets.skyTex; s.backgroundIntensity = 1.0;
      s.environmentIntensity = 0.85;
      this.fogColor.set(0xd3d9de); s.fog.near = 90; s.fog.far = 750;
      this.sun.color.set(0xfff0dc); this.sun.intensity = 3.1;
      this.lightDir.copy(this.sunDir);
      if (this.level.lamps.parent) s.remove(this.level.lamps);
    }
    s.fog.color.copy(this.fogColor);
    this.effects.setLight(night ? 0.07 : 1);
    this.onResize();
  }

  toggleNvg() {
    this.viewMode = this.viewMode === 'nvg' ? 'normal' : 'nvg';
    this.audio.play(this.viewMode === 'nvg' ? 'nvg' : 'magTap', { vol: 0.6 });
  }
  cycleThermal() {
    if (this.viewMode !== 'thermal') { this.viewMode = 'thermal'; this.thermalPalette = 0; }
    else if (++this.thermalPalette > 2) { this.viewMode = 'normal'; this.thermalPalette = 0; }
    this.audio.play('thermal', { vol: 0.5 });
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.fire = false;
    this.weapons.setTrigger(false);
    document.exitPointerLock?.();
    this.audio.ctx?.suspend();
    this.voices.cancel();
    this.onPause?.();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.reset();
    this.input.enabled = true;
    this.audio.unlock();
    this.last = performance.now();
  }
  quit() {
    this.state = 'menu';
    this.input.enabled = false;
    this.hud.show(false);
    this.enemies.clear();
    this.grenades.clear();
    this.ballistics.clear();
    this.audio.ctx?.resume();
    this.audio.stopAmbience();
    this.voices.cancel();
  }

  onPlayerDeath() {
    this.input.enabled = false;
    this.weapons.setTrigger(false);
    this.hud.banner('K.I.A.', '', 2.5);
    this.deathTimer = 2.8;
    this.voices.cancel();
  }

  _gameOver() {
    this.state = 'dead';
    this.hud.show(false);
    document.exitPointerLock?.();
    const acc = this.weapons.stats.shots ? Math.round((this.weapons.stats.hits / this.weapons.stats.shots) * 100) : 0;
    const best = getBest();
    const isBest = !best || this.score > best.score;
    if (isBest) setBest({ score: this.score, wave: this.wave, difficulty: settings.difficulty });
    this.onGameOver?.({
      score: this.score, wave: this.wave, kills: this.stats.kills, headshots: this.stats.headshots,
      accuracy: acc, longest: Math.round(this.stats.longest), time: Math.round(this.time - this.stats.started), isBest,
      grenadeKills: this.stats.grenadeKills,
    });
  }

  // ---------------- waves ----------------
  _startWave() {
    this.wave++;
    const n = this.wave;
    const count = Math.min(40, 4 + n * 2 + Math.floor(n / 3) * 2);
    const list = [];
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      let t = 'rifleman';
      if (n >= 2 && r < 0.2) t = 'assaulter';
      else if (n >= 3 && r < 0.34) t = 'marksman';
      else if (n >= 4 && r < 0.34 + Math.min(0.2, 0.06 + n * 0.015)) t = 'heavy';
      list.push(t);
    }
    this.toSpawn = list;
    this.waveTotal = count;
    this.waveState = 'active';
    this.spawnTimer = 1;
    this.hud.banner(`WAVE ${n}`, `${count} hostiles inbound`, 3);
    this.audio.play('ui', { vol: 0.6 });
  }

  _updateWaves(dt) {
    if (this.waveState === 'intermission') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this._startWave();
      return;
    }
    const alive = this.enemies.aliveCount();
    const maxAlive = this.difficulty.maxAlive + Math.floor(this.wave / 3);
    this.spawnTimer -= dt;
    if (this.toSpawn.length && alive < maxAlive && this.spawnTimer <= 0) {
      const sp = this._pickSpawn();
      const squad = Math.min(this.toSpawn.length, maxAlive - alive, 2 + (Math.random() < 0.5 ? 1 : 0));
      for (let i = 0; i < squad; i++) {
        const t = this.toSpawn.shift();
        const nav = this.level.nav;
        const k = nav.nearestWalkable(sp.x + (Math.random() - 0.5) * 4, sp.z + (Math.random() - 0.5) * 4, 4);
        const x = k >= 0 ? nav.cx(k) : sp.x, z = k >= 0 ? nav.cz(k) : sp.z;
        this.enemies.spawn(t, x, z, 14);
      }
      this.spawnTimer = 3 + Math.random() * 4;
    }
    this.hud.setWave(this.wave, this.toSpawn.length + alive);
    if (!this.toSpawn.length && alive === 0) {
      const bonus = SCORE.waveBase * this.wave;
      this.score += bonus;
      this.hud.setScore(this.score);
      this.hud.banner('WAVE CLEARED', `+${bonus} · Resupply at HQ`, 3.5);
      this.weapons.frags = Math.min(GRENADES.maxFrag, this.weapons.frags + 1);
      this.weapons.flashes = Math.min(GRENADES.maxFlash, this.weapons.flashes + 1);
      this.waveState = 'intermission';
      this.waveTimer = 14;
    }
  }

  _pickSpawn() {
    const p = this.player, W = this.level.world;
    const cands = this.level.spawnPoints.map((s) => {
      const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
      const seen = W.los(p.eye.x, p.eye.y, p.eye.z, s.x, 1.5, s.z);
      return { s, score: (d > 35 ? 10 : -20) + (seen ? -15 : 0) + Math.random() * 12 - Math.abs(d - 60) * 0.1 };
    }).sort((a, b) => b.score - a.score);
    return cands[0].s;
  }

  // ---------------- combat events ----------------
  emitNoise(pos, radius, kind) { this.enemies.onNoise(pos, radius, kind); }

  registerKill(e, info) {
    let pts = SCORE.kill;
    const tags = [];
    if (info.headshot) { pts += SCORE.headshot; tags.push('HEADSHOT'); this.stats.headshots++; }
    if (info.grenade) { pts += SCORE.grenadeKill; tags.push('GRENADE'); this.stats.grenadeKills++; }
    if (info.drone) { pts += SCORE.grenadeKill; tags.push('FPV DRONE'); }
    if (info.stunned) { pts += SCORE.stunnedKill; tags.push('STUNNED'); }
    if (info.distance > 50) { pts += Math.round(info.distance); tags.push(`${Math.round(info.distance)}m`); }
    this.stats.kills++;
    this.stats.longest = Math.max(this.stats.longest, info.distance || 0);
    this.score += pts;
    this.hud.setScore(this.score);
    this.hud.killfeed(`${tags.length ? `<b>${tags.join(' · ')}</b> ` : ''}${e.type.name} <b>+${pts}</b>`);
  }

  onEnemyKilled(e) {
    const r = Math.random();
    const kind = r < 0.5 ? 'ammo' : r < 0.72 ? 'health' : null;
    if (kind) this._dropPickup(kind, e.pos.x + (Math.random() - 0.5), e.pos.z + (Math.random() - 0.5));
    if (e.grenades > 0 && Math.random() < 0.5) this._dropPickup('frag', e.pos.x + 0.4, e.pos.z);
  }

  _dropPickup(kind, x, z) {
    let mesh;
    if (kind === 'frag') { mesh = this.grenades.templates.frag.clone(); mesh.scale.setScalar(1.3); }
    else { mesh = this.pickupModels[kind].clone(); if (kind === 'ammo') mesh.scale.setScalar(1.2); }
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const y = this.level.world.groundAt(x, z, 0.1, 3);
    mesh.position.set(x, y + (kind === 'frag' ? 0.05 : 0), z);
    mesh.rotation.y = Math.random() * 6;
    this.scene.add(mesh);
    this.pickups.push({ kind, mesh, x, z, t: 0 });
  }

  _updatePickups(dt) {
    const p = this.player, w = this.weapons;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      const d = Math.hypot(pk.x - p.pos.x, pk.z - p.pos.z);
      let take = false;
      if (d < 1.4 && p.alive) {
        if (pk.kind === 'ammo') { w.addAmmo(0.3); this.hud.pickup('+ AMMO'); take = true; }
        else if (pk.kind === 'health' && p.health < 100) { p.health = Math.min(100, p.health + 45); this.hud.pickup('+ MEDKIT'); take = true; }
        else if (pk.kind === 'frag' && w.frags < GRENADES.maxFrag) { w.frags++; this.hud.pickup('+ FRAG'); take = true; }
      }
      if (take) this.audio.play('pickup', { vol: 0.7 });
      if (take || pk.t > 45) { this.scene.remove(pk.mesh); this.pickups.splice(i, 1); }
    }
    // resupply crate
    const rs = this.level.resupply;
    this.resupplyT -= dt;
    if (Math.hypot(rs.x - p.pos.x, rs.z - p.pos.z) < rs.r + 0.6 && this.resupplyT <= 0 && p.alive) {
      const needs = Object.values(w.slots).some((s) => s.reserve < s.def.reserve) || w.frags < GRENADES.maxFrag || w.flashes < GRENADES.maxFlash || this.drone.count < 2;
      if (needs) {
        w.refill();
        this.drone.count = Math.max(this.drone.count, 2);
        this.hud.pickup('RESUPPLIED');
        this.audio.play('pickup', { vol: 0.9 });
        this.resupplyT = 25;
      }
    }
  }

  damageBarrel(b, dmg) {
    if (!b.alive) return;
    b.hp -= dmg;
    if (b.hp <= 0) {
      b.alive = false;
      setTimeout(() => {
        const m = new THREE.Matrix4().makeScale(0, 0, 0);
        for (const mesh of b.meshes) { mesh.setMatrixAt(b.index, m); mesh.instanceMatrix.needsUpdate = true; }
        b.box.y0 = -100; b.box.y1 = -100;
        this.explode(new THREE.Vector3(b.x, 0.5, b.z), 8, 190, 'barrel');
      }, 120 + Math.random() * 120);
    }
  }

  _resetBarrels() {
    this.level.explosiveBarrels.forEach((b, i) => {
      b.alive = true; b.hp = 30; b.box.y0 = 0; b.box.y1 = 0.93;
      for (const mesh of b.meshes) { mesh.setMatrixAt(b.index, this.barrelMatrices[i]); mesh.instanceMatrix.needsUpdate = true; }
    });
  }

  explode(pos, R, dmg, owner) {
    const W = this.level.world, p = this.player;
    this.effects.explosion(pos);
    this.audio.playAt('explosion', pos.x, pos.y, pos.z, { vol: 1.7, ref: 12, travel: true, max: 900, occlude: false });
    this.enemies.onNoise(pos, 130, 'gunshot');
    // player
    const chest = new THREE.Vector3(p.pos.x, p.pos.y + p.eyeH * 0.7, p.pos.z);
    const dP = chest.distanceTo(pos);
    p.shake = Math.max(p.shake, Math.min(1.4, 1.6 - dP / 14));
    if (dP < 7) this.audio.tinnitus(Math.min(1, 1.2 - dP / 7), 3.5);
    if (dP < R && p.alive) {
      const vis = W.los(pos.x, pos.y + 0.3, pos.z, chest.x, chest.y, chest.z, RAY_ALL) || W.los(pos.x, pos.y + 0.3, pos.z, p.eye.x, p.eye.y, p.eye.z, RAY_ALL);
      const f = vis ? 1 : 0.2;
      const mul = owner === 'player' || owner === 'drone' ? 0.55 : owner === 'enemy' ? this.difficulty.dmg : 0.9;
      const dmgP = dmg * Math.pow(1 - dP / R, 1.4) * f * mul;
      if (dmgP > 1) p.damage(dmgP, pos);
    }
    // enemies
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const c = new THREE.Vector3(e.pos.x, e.pos.y + 1.1, e.pos.z);
      const d = c.distanceTo(pos);
      if (d >= R) continue;
      const vis = W.los(pos.x, pos.y + 0.3, pos.z, c.x, c.y, c.z, RAY_ALL);
      const dd = dmg * Math.pow(1 - d / R, 1.3) * (vis ? 1 : 0.2);
      const dir = c.clone().sub(pos).normalize();
      const killed = e.takeDamage(dd, 'blast', dir.x, dir.z, owner === 'player' || owner === 'drone' ? 'player' : 'env');
      if (killed && owner !== 'enemy') this.registerKill(e, { grenade: owner === 'player', drone: owner === 'drone', distance: 0 });
    }
    // chain reactions
    for (const b of this.level.explosiveBarrels) {
      if (b.alive && Math.hypot(b.x - pos.x, b.z - pos.z) < R * 0.7) this.damageBarrel(b, 100);
    }
  }

  flashbangAt(pos) {
    const W = this.level.world, p = this.player;
    this.effects.explosion(pos, true);
    this.audio.playAt('flashbang', pos.x, pos.y, pos.z, { vol: 1.5, ref: 12, travel: true, max: 700, occlude: false });
    this.enemies.flashbang(pos, GRENADES.flash.radius);
    this.enemies.onNoise(pos, 90, 'gunshot');
    const d = p.eye.distanceTo(pos);
    if (d < 25 && p.alive && W.los(pos.x, pos.y + 0.1, pos.z, p.eye.x, p.eye.y, p.eye.z)) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const dir = pos.clone().sub(p.eye).normalize();
      const facing = fwd.dot(dir);
      const k = (facing > 0.5 ? 1 : facing > 0 ? 0.65 : facing > -0.5 ? 0.3 : 0.12) * THREE.MathUtils.clamp(1.35 - d / 18, 0, 1);
      if (k > 0.06) this.hud.flash(k, 1 + 4.5 * k);
    }
    if (d < 15) this.audio.tinnitus(Math.min(1, 1.1 - d / 15), 2.5 + (15 - d) * 0.2);
  }

  // ---------------- loop ----------------
  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'playing') this.update(dt);
    else if (this.state === 'menu' || this.state === 'dead') this._menuCamera(dt);
    this.render();
    this._dynamicResolution(dt);
  }

  _menuCamera(dt) {
    this.menuAngle += dt * 0.04;
    const r = 58, a = this.menuAngle;
    this.camera.position.set(Math.sin(a) * r, 16, Math.cos(a) * r);
    this.camera.lookAt(0, 2, -6);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this._followShadow(new THREE.Vector3(0, 0, 0));
    this.effects.update(dt);
    this.enemies.list.forEach((e) => e.update(dt));
  }

  update(dt) {
    this.time += dt;
    const input = this.input, p = this.player, w = this.weapons;
    if (input.consume('pause')) { this.pause(); return; }
    if (input.consume('nvg')) this.toggleNvg();
    if (input.consume('thermal')) this.cycleThermal();
    if (input.consume('drone') && p.alive) { if (this.drone.active) this.drone.exit(); else if (!this.drone.deploy()) this.hud.pickup(this.drone.count <= 0 ? 'NO DRONES LEFT' : ''); }
    this.level.grassUniforms.uTime.value = this.time;
    if (this.drone.active) { this._updateDroneControl(dt); return; }
    this.drone.update(dt, input, [0, 0]);

    // look
    let [dx, dy] = input.takeLook();
    const d = w.def;
    const adsE = w.adsT;
    const zoomMul = d.scope ? settings.adsSens / (d.adsZoom * 0.55) : settings.adsSens;
    let mul = 1 + (zoomMul - 1) * adsE;
    this._computeAimTarget();
    if (settings.aimAssist && input.touchMode && this.aimTarget && this.aimTarget.friction) mul *= 0.55;
    if (p.alive) { p.look(dx * mul, dy * mul); w.addLook(dx * mul, dy * mul); }
    this._aimSnap(dt);

    // actions
    if (p.alive) {
      if (input.consume('reload')) w.requestReload();
      if (input.consume('swap')) w.switchWeapon();
      if (input.consume('slot1')) w.switchWeapon('primary');
      if (input.consume('slot2')) w.switchWeapon('secondary');
      if (input.consume('crouch')) p.toggleCrouch();
      if (input.consume('frag')) w.throwGrenade('frag');
      if (input.consume('flash')) w.throwGrenade('flash');
      w.setTrigger(input.fire);
    } else input.events.clear();

    p.update(dt, input);
    // un-toggle touch ADS when sprinting
    if (p.sprinting && input.touchMode && input.ads) input.setAdsButton(false);
    w.update(dt, input.ads && p.alive);
    // camera zoom
    const zoom = 1 + (d.adsZoom - 1) * (d.scope ? (w.isScoped ? 1 : 0) : w.adsT);
    const fov = this.baseFov / zoom;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (w.isScoped) {
      // scope sway (steadier when crouched / still)
      const sw = (p.crouched ? 0.3 : 1) * (1 + Math.min(1, p.horizSpeed / 3) * 2) * 0.0018;
      this.camera.rotation.x += Math.sin(this.time * 0.9) * sw;
      this.camera.rotation.y += Math.sin(this.time * 0.6 + 1) * sw * 1.3;
      this.camera.updateMatrixWorld();
    }

    this._updateWorld(dt);
    this._spotEnemies();

    // audio listener + health feedback
    this.audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, p.yaw);
    const lowK = p.alive ? Math.max(0, 1 - p.health / 35) : 0;
    this.audio.setLowHealth(lowK * 0.8);
    if (lowK > 0) {
      this.heartT -= dt;
      if (this.heartT <= 0) { this.audio.play('heartbeat', { vol: 0.4 + lowK * 0.5 }); this.heartT = 1.05 - lowK * 0.35; }
    }

    // lighting follows the player
    this._followShadow(p.pos);
    this._shadowCheckT -= dt;
    if (this._shadowCheckT <= 0) {
      this._shadowCheckT = 0.15;
      const c = this.camera.position, L = this.lightDir;
      this.inShadow = !!this.level.world.raycast(c.x, c.y - 0.1, c.z, L.x, L.y, L.z, 60, RAY_ALL);
    }
    w.updateLighting(this.lightDir, this.inShadow, dt, this.night ? 0.1 : 1);
    this._updateLasers();

    this.hud.update(dt);
    if (!p.alive) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this._gameOver();
    }
  }

  _updateWorld(dt) {
    this.enemies.update(dt);
    this.grenades.update(dt);
    this.ballistics.update(dt);
    this.effects.update(dt);
    this._updatePickups(dt);
    this._updateWaves(dt);
  }

  /** While flying the FPV drone the operator stays put (and can still be shot). */
  _updateDroneControl(dt) {
    const input = this.input, p = this.player, d = this.drone;
    const look = input.takeLook();
    if (input.fire && !this._droneFirePrev) d.detonate();
    this._droneFirePrev = input.fire;
    if (input.consume('swap')) d.exit();
    for (const k of ['reload', 'crouch', 'frag', 'flash', 'slot1', 'slot2']) input.consume(k);
    input.jump = false;
    d.update(dt, input, look);
    this.weapons.setTrigger(false);
    p.update(dt, { moveX: 0, moveY: 0, sprint: false, jump: false });
    this.weapons.update(dt, false);
    this._updateWorld(dt);
    this.audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, p.yaw);
    this._followShadow(d.active ? d.pos : p.pos);
    this.effects.lasers.mesh.visible = false;
    this.hud.update(dt);
    if (!p.alive) {
      if (d.active) d.exit();
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this._gameOver();
    }
  }

  /** Infrared aiming lasers: the player's PEQ and (at night) the enemies'. Only visible through NVG. */
  _updateLasers() {
    const fx = this.effects.lasers;
    if (this.viewMode !== 'nvg' || !this.player.alive) { fx.mesh.visible = false; return; }
    const W = this.level.world, list = [];
    const cast = (from, dir, max) => {
      const h = W.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, max);
      return { from, to: from.clone().addScaledVector(dir, h ? h.t : max), hit: !!h };
    };
    const w = this.weapons;
    if (w.currentSlot === 'primary' && !this.player.sprinting && w.state !== 'reload') {
      const from = w.muzzleWorld(new THREE.Vector3());
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      list.push(cast(from, dir, 200));
    }
    if (this.night) {
      for (const e of this.enemies.list) {
        if (!e.alive || e.alert < 2 || e.soldier.pose.aim < 0.7 || e.flashed > 0) continue;
        const m = e.soldier.muzzle;
        m.updateWorldMatrix(true, false);
        const from = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
        const dir = new THREE.Vector3(0, 0, 1).transformDirection(e.soldier.gun.matrixWorld);
        list.push(cast(from, dir, 150));
      }
    }
    fx.draw(list, this.camera);
  }

  _followShadow(pos) {
    const sun = this.sun;
    // snap to shadow texels to avoid shimmering
    const texel = (this.sun.shadow.camera.right * 2) / this.sun.shadow.mapSize.x;
    const x = Math.round(pos.x / texel) * texel, z = Math.round(pos.z / texel) * texel;
    sun.target.position.set(x, 0, z);
    sun.position.set(x + this.lightDir.x * 100, this.lightDir.y * 100, z + this.lightDir.z * 100);
    sun.target.updateMatrixWorld();
  }

  _computeAimTarget() {
    const cam = this.camera, W = this.level.world;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = null, bestAng = 8 * DEG;
    const v = new THREE.Vector3();
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      v.copy(e.hb.neck).lerp(e.hb.hips, 0.35).sub(cam.position);
      const dist = v.length();
      if (dist > 150) continue;
      const ang = Math.acos(Math.min(1, fwd.dot(v) / dist));
      if (ang < bestAng) { bestAng = ang; best = { e, ang, dist, dir: v.clone().divideScalar(dist) }; }
    }
    if (best) {
      const c = best.e.hb.neck.clone().lerp(best.e.hb.hips, 0.35);
      if (!W.los(cam.position.x, cam.position.y, cam.position.z, c.x, c.y, c.z)) best = null;
    }
    if (best) {
      const size = Math.atan(0.35 / best.dist);
      best.onCross = best.ang < size;
      best.friction = best.ang < size + 2.5 * DEG;
    }
    this.aimTarget = best;
  }

  _aimSnap(dt) {
    const w = this.weapons, p = this.player;
    if (settings.aimAssist && this.input.touchMode && this.prevAds < 0.05 && w.adsT >= 0.05 && this.aimTarget && this.aimTarget.ang < 7 * DEG) {
      const d = this.aimTarget.dir;
      this.snap = { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), t: 0.16 };
    }
    this.prevAds = w.adsT;
    if (this.snap) {
      const k = Math.min(1, dt / this.snap.t);
      let dy = this.snap.yaw - p.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      p.yaw += dy * k * 0.8; p.pitch += (this.snap.pitch - p.pitch) * k * 0.8;
      this.snap.t -= dt;
      if (this.snap.t <= 0) this.snap = null;
    }
  }

  _spotEnemies() {
    // enemies in the player's view show up on the minimap
    this._spotT = (this._spotT || 0) - 1;
    if (this._spotT > 0) return;
    this._spotT = 6;
    const cam = this.camera, W = this.level.world;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      if (!frustum.containsPoint(e.hb.neck)) continue;
      if (W.los(cam.position.x, cam.position.y, cam.position.z, e.hb.neck.x, e.hb.neck.y, e.hb.neck.z)) e.spottedByPlayer = this.time;
    }
  }

  _dynamicResolution(dt) {
    if (settings.quality !== 'auto' || this.state !== 'playing') return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    let s = this.renderScale;
    if (avg > 1 / 42) s -= 0.1;
    else if (avg > 1 / 52) s -= 0.05;
    else if (avg < 1 / 58) { this.scaleTimer++; if (this.scaleTimer > 3) { s += 0.05; this.scaleTimer = 0; } }
    s = THREE.MathUtils.clamp(s, 0.55, this.maxScale);
    if (Math.abs(s - this.renderScale) > 0.01) { this.renderScale = s; this.onResize(); }
  }

  render() {
    const r = this.renderer, P = this.post, d = this.drone;
    const playing = this.state === 'playing';
    const droneView = playing && (d.active || d.transition > 0);
    const cam = d.active ? d.camera : this.camera;
    const mode = droneView ? MODE.fpv : playing ? MODE[this.viewMode] : MODE.normal;
    const thermal = mode === MODE.thermal;
    r.setRenderTarget(P.rt);
    r.autoClear = false;
    r.clear();
    d.model.visible = !d.active; // the FPV camera sits inside the drone
    if (thermal) this._renderThermal(this.scene, cam);
    else r.render(this.scene, cam);
    if (playing && !droneView && this.player.alive && this.weapons.rig.visible) {
      r.clearDepth();
      if (thermal) this._renderThermal(this.weapons.scene, this.weapons.camera);
      else r.render(this.weapons.scene, this.weapons.camera);
    }
    r.autoClear = true;
    const n = this.night;
    const lowHealth = playing && this.player.alive ? Math.max(0, 1 - this.player.health / 45) : 0;
    const signal = droneView ? (d.active ? d.signal * (1 - d.transition / 0.6) : 0) : 1;
    P.finish({
      mode, time: this.time, lowHealth, signal, palette: this.thermalPalette,
      exposure: n ? (droneView ? 2.4 : 1.3) : 1.0,
      bloomStrength: n ? 0.14 : 0.07, threshold: n ? 0.7 : 1.5,
      nvgGain: n ? 9 : 1.1, noise: n ? 0.22 : 0.07,
      vignette: mode === MODE.fpv ? 0.15 : 0.35, grain: n ? 0.032 : 0.018,
    });
    this.hud.captureAfterimage(r.domElement);
  }

  /** Thermal pass: every visible mesh writes its temperature; effects that have no heat are hidden. */
  _renderThermal(scene, cam) {
    const hidden = [];
    scene.traverse((o) => {
      if (!o.visible) return;
      if (o.isPoints || o.isSprite || o.isLine || o.userData.noThermal || (o.isMesh && o.material && o.material.transparent)) { o.visible = false; hidden.push(o); }
    });
    const bg = scene.background, fog = scene.fog;
    scene.background = scene === this.scene ? this.thermalSky : null;
    scene.fog = null;
    scene.overrideMaterial = thermalMaterial;
    withThermal(() => this.renderer.render(scene, cam), this.night ? 0.16 : 0.3);
    scene.overrideMaterial = null;
    scene.background = bg; scene.fog = fog;
    for (const o of hidden) o.visible = true;
  }
}

function hfovToV(hfovDeg, aspect) {
  const h = hfovDeg * DEG;
  return 2 * Math.atan(Math.tan(h / 2) / aspect) / DEG;
}

