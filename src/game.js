// Game orchestration: scene, renderer settings, the main loop, waves,
// scoring, pickups, explosions and flashbangs.
import * as THREE from 'three';
import { settings, getBest, setBest, MOBILE } from './settings.js';
import { SUN_INTENSITY, ENV_INTENSITY } from './assets.js';
import { DIFFICULTY, SCORE, GRENADES } from './config.js';
import { buildLevel } from './level.js';
import { buildTower } from './tower.js';
import { CivilianManager } from './civilian.js';
import { MISSIONS, TowerMission, SniperMission } from './missions.js';
import { Player } from './player.js';
import { WeaponSystem } from './weapons.js';
import { EnemyManager } from './ai.js';
import { Ballistics } from './ballistics.js';
import { Effects } from './effects.js';
import { Grenades } from './grenades.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { RAY_ALL } from './physics.js';
import { PostFX, MODE, SHADOW, thermalMaterial, withThermal } from './post.js';
import { Drone } from './drone.js';
import { soldierOptions, Soldier } from './soldier.js';
import { nightSkyTexture } from './textures.js';
import { Rain } from './weather.js';

// Direction of the moon painted into the night sky texture.
const MOON_DIR = (() => {
  const lat = (0.5 - 0.22) * Math.PI, phi = (0.62 - 0.5) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(lat) * Math.cos(phi), Math.sin(lat), Math.cos(lat) * Math.sin(phi)).normalize();
})();

const DEG = Math.PI / 180;
const QUALITY = {
  low: { scale: 0.7, shadows: false, shadowSize: 1024, soft: false },
  medium: { scale: 1.0, shadows: true, shadowSize: 1024, soft: false },
  high: { scale: 1.75, shadows: true, shadowSize: 2048, soft: true },
  ultra: { scale: 2.5, shadows: true, shadowSize: 4096, soft: true },
  cinematic: { scale: 2.5, shadows: true, shadowSize: 8192, soft: true },
  auto: { scale: 1.35, shadows: true, shadowSize: 2048, soft: true },
};
// phones: every full-screen HDR buffer scales with the pixel count, so cap the render scale
const MOBILE_SCALE = { cinematic: 1.5, ultra: 2.0, high: 1.5, auto: 1.35, medium: 1.0, low: 0.7 };

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
    scene.environmentIntensity = ENV_INTENSITY;
    scene.backgroundIntensity = 1.0;
    this.fogColor = new THREE.Color(0xd3d9de);
    // classic distance fog for the lower presets; Ultra/High use the post-processed atmosphere
    this.fog = new THREE.Fog(this.fogColor, 90, 750);
    scene.fog = this.fog;
    this.atmos = { fogColor: new THREE.Color(), sunColor: new THREE.Color(), sunDir: new THREE.Vector3(), fogDensity: 0.00045, fogFalloff: 0.012 };
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
    scene.add(this.camera);

    // sun (direction from the sky HDR)
    this.sunDir = assets.sunDir.clone();
    if (this.sunDir.y < 0.35) { this.sunDir.y = 0.35; this.sunDir.normalize(); }
    const sun = this.sun = new THREE.DirectionalLight(0xfff0dc, SUN_INTENSITY);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -SHADOW.half; sc.right = SHADOW.half; sc.top = SHADOW.half; sc.bottom = -SHADOW.half; sc.near = SHADOW.near; sc.far = SHADOW.far;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    scene.add(sun, sun.target);

    this.levels = {};
    this.levelKind = null;
    this.mission = null;
    this._useLevel('compound');
    this.player = new Player(this);
    this.input = new Input(this);
    this.hud = new HUD(this);
    this.hud.buildMinimap(this.level);
    this.effects = new Effects(this);
    this.ballistics = new Ballistics(this);
    this.grenades = new Grenades(this);
    this.enemies = new EnemyManager(this);
    this.civilians = new CivilianManager(this);
    this.weapons = new WeaponSystem(this, settings.primary);
    this.weapons.scene.environment = assets.envMap;
    this.pickupModels = { ammo: assets.models.ammo_box, health: assets.models.medical_box };
    this.post = new PostFX(renderer);
    this.drone = new Drone(this);
    this.rain = new Rain(this, this.level.ao);
    // the player's own body: seen from the FPV drone, and casting the player's shadow
    this.playerBody = new Soldier(scene, 'tan', 'rifle');
    this.playerBody.root.traverse((o) => { o.layers.set(2); o.userData.fixedLayer = true; });
    this.playerBody.root.visible = false;
    sun.shadow.camera.layers.enable(2);
    this.weather = 'clear';
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
  /**
   * Makes a level current, building it the first time. The level we leave is
   * detached and its GPU buffers freed (its data stays, so switching back is quick).
   */
  _useLevel(kind) {
    if (this.levelKind === kind) return false;
    const old = this.level;
    if (old) {
      this.scene.remove(old.root);
      if (old.lamps.parent) old.lamps.parent.remove(old.lamps);
      old.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    }
    let L = this.levels[kind];
    if (!L) {
      const root = new THREE.Group();
      root.name = `level:${kind}`;
      L = kind === 'tower' ? buildTower(root, this.assets, { shadows: true }) : buildLevel(root, this.assets, { shadows: true });
      L.root = root;
      this.levels[kind] = L;
    }
    this.scene.add(L.root);
    this.level = L;
    this.levelKind = kind;
    this.barrelMatrices = L.explosiveBarrels.map((b) => { const m = new THREE.Matrix4(); b.meshes[0].getMatrixAt(b.index, m); return m; });
    this.hud?.buildMinimap(L);
    this.audio.setEnvironment(L.indoor ? 'indoor' : 'outdoor');
    if (this.rain) {
      const u = this.rain.uniforms;
      u.roofMap.value = L.ao.tex; u.roofMin.value = L.ao.min; u.roofSize.value = L.ao.size;
      this.rain.indoor = !!L.indoor;
    }
    return true;
  }

  /** Builds (if needed) and switches to the mission's level, then compiles its shaders off the main thread. */
  async prepareMission(missionKey) {
    const M = MISSIONS[missionKey] || MISSIONS.compound;
    if (!this._useLevel(M.level)) return;
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch { /* compiled on first use instead */ }
  }

  applyQuality() {
    const name = QUALITY[settings.quality] ? settings.quality : 'medium';
    const q = { ...QUALITY[name] };
    if (MOBILE) { q.scale = Math.min(q.scale, MOBILE_SCALE[name]); q.shadowSize = Math.min(q.shadowSize, 2048); }
    const dpr = window.devicePixelRatio || 1;
    this.maxScale = Math.min(dpr, q.scale);
    this.renderScale = name === 'auto' ? Math.min(1.0, this.maxScale) : Math.min(dpr, q.scale);
    this.cinematic = name === 'cinematic' && !MOBILE;
    if (name === 'cinematic') {
      // supersampled: at least 1.5x even on a 1080p screen, up to about a 4K frame
      const px = window.innerWidth * window.innerHeight;
      this.renderScale = this.maxScale = Math.min(q.scale, Math.max(dpr, 1.5), Math.sqrt(8.3e6 / px));
    }
    const r = this.renderer;
    this.post.setQuality(name);
    const fog = this.post.ao ? null : this.fog;
    const type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (r.shadowMap.enabled !== q.shadows || r.shadowMap.type !== type || this.scene.fog !== fog) {
      r.shadowMap.enabled = q.shadows;
      r.shadowMap.type = type;
      this.scene.fog = fog;
      this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
    }
    // shadows are redrawn once per frame by render(), not on every render call
    r.shadowMap.autoUpdate = false;
    const size = Math.min(q.shadowSize, r.capabilities.maxTextureSize);
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    }
    // finer shadow texels need less bias
    this.sun.shadow.bias = -0.0004 * 1024 / size - 0.00005;
    this.sun.shadow.normalBias = 0.012 + 0.024 * 1024 / size;
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
    this.effects?.setFog(this.fogColor, this.fog.near, this.fog.far, bufH / (2 * Math.tan(this.camera.fov * DEG / 2)));
  }

  // ---------------- flow ----------------
  start() {
    this.difficulty = DIFFICULTY[settings.difficulty] || DIFFICULTY.regular;
    const M = MISSIONS[settings.mission] || MISSIONS.compound;
    this.missionKey = MISSIONS[settings.mission] ? settings.mission : 'compound';
    this.enemies.clear();
    this.civilians.clear();
    if (this._useLevel(M.level)) this.renderer.compile(this.scene, this.camera);
    this.level.shadowFocus = null;
    const primary = M.primary || settings.primary;
    const optic = primary === 'm4' ? settings.optic : 'holo';
    if (this.weapons.slots.primary.key !== primary || this.weapons.optic !== optic) {
      this.weapons = new WeaponSystem(this, primary);
      this.weapons.scene.environment = this.assets.envMap;
      this.onResize();
    } else {
      for (const s of Object.values(this.weapons.slots)) {
        s.ammo = s.def.mag + (s.def.chamber ? 1 : 0); s.boltReady = true; s.heat = 0; s.suppHeat = 0; s.jammed = false; s.dustOpen = false;
        if (s.mags) this.weapons._fillMags(s); else s.reserve = s.def.reserve;
      }
      this.weapons.frags = GRENADES.startFrag; this.weapons.flashes = GRENADES.startFlash;
      if (this.weapons.currentSlot !== 'primary') { this.weapons.cur.model.root.visible = false; this.weapons.currentSlot = 'primary'; this.weapons.cur.model.root.visible = true; }
      this.weapons.state = 'draw'; this.weapons.stateT = 0; this.weapons.reload = null; this.weapons.throwing = null; this.weapons.adsT = 0;
      this.weapons.heldFrag.visible = this.weapons.heldFlash.visible = false;
      this.weapons.stats = { shots: 0, hits: 0 };
      this.weapons.zoomIdx = 0; this.weapons.zero = 100;
    }
    this.grenades.clear();
    this.ballistics.clear();
    this.effects.clear();
    for (const pk of this.pickups) this.scene.remove(pk.mesh);
    this.pickups = [];
    this._resetBarrels();
    const s = this.level.sniper && this.missionKey === 'sniper' ? this.level.sniper.hide : this.level.playerSpawn;
    this.player.reset(s.x, s.z, s.yaw, s.y || 0);
    this.ballistics.wind.set(0, 0, 0);
    this.camera.near = 0.1; this.camera.updateProjectionMatrix();
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
    this.hud.setObjective(null);
    this.drone.reset(); // before the mission, which may issue fewer drones
    this.mission?.dispose?.();
    this.mission = this.missionKey === 'tower' ? new TowerMission(this) : this.missionKey === 'sniper' ? new SniperMission(this) : null;
    document.body.classList.toggle('sniper-mission', this.missionKey === 'sniper');
    this.audio.setEnvironment(this.level.indoor ? 'indoor' : this.missionKey === 'sniper' ? 'ridge' : 'outdoor');
    if (this.mission) this.mission.start();
    else { this.hud.setWave(1, 0); this.hud.banner('OPERATION TIPS MANIA', 'Hold the compound', 3.5); }
    this.audio.startAmbience();
    this.flashAmount = 0;
    this.viewMode = 'normal';
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
      this.fogColor.set(0x06080d); this.fog.near = 20; this.fog.far = 230;
      this.atmos.fogColor.setRGB(0.006, 0.008, 0.014); this.atmos.sunColor.setRGB(0.01, 0.012, 0.02);
      this.atmos.fogDensity = 0.004; this.atmos.fogFalloff = 0.02;
      this.sun.color.set(0x9db4ff); this.sun.intensity = 0.45;
      this.lightDir.copy(MOON_DIR);
      if (!this.level.lamps.parent) s.add(this.level.lamps);
    } else {
      s.background = this.assets.skyTex; s.backgroundIntensity = 1.0;
      s.environmentIntensity = ENV_INTENSITY;
      this.fogColor.set(0xd3d9de); this.fog.near = 90; this.fog.far = 750;
      // desert haze: the horizon colour of the sky, lit warm towards the sun
      const hz = this.assets.horizon, hm = Math.max(hz.r, hz.g, hz.b) || 1;
      this.atmos.fogColor.setRGB(hz.r / hm * 0.78, hz.g / hm * 0.78, hz.b / hm * 0.8);
      this.atmos.sunColor.setRGB(1.0, 0.8, 0.55);
      this.atmos.fogDensity = 0.00045; this.atmos.fogFalloff = 0.012;
      this.sun.color.set(0xfff0dc); this.sun.intensity = SUN_INTENSITY;
      this.lightDir.copy(this.sunDir);
      if (this.level.lamps.parent) s.remove(this.level.lamps);
    }
    this.level.setNight?.(night);
    this._applyWeather(settings.weather === 'rain');
    if (this.missionKey === 'sniper' && this.state === 'playing') {
      // Overwatch: the target is 600 m out, so the air has to be clear enough to shoot through
      this.fog.near = Math.max(this.fog.near * 4, 300); this.fog.far = Math.max(this.fog.far * 3.2, 1400);
      this.atmos.fogDensity *= 0.35;
    }
    this.fog.color.copy(this.fogColor);
    this.atmos.sunDir.copy(this.lightDir);
    this.effects.setLight(night ? 0.07 : 1);
    this.onResize();
  }

  /** Storm: overcast sky, flat grey light, soft shadows, rain haze, wet world. */
  _applyWeather(rain) {
    this.weather = rain ? 'rain' : 'clear';
    const s = this.scene, n = this.night;
    this.sun.shadow.intensity = rain ? 0.35 : 1;
    if (rain) {
      s.background = this.rain.overcastSky(); s.backgroundIntensity = n ? 0.035 : 0.9; // storm clouds hide the stars
      s.environmentIntensity = n ? 0.03 : ENV_INTENSITY * 0.55;
      this.sun.intensity = n ? 0.25 : SUN_INTENSITY * 0.28;
      this.sun.color.set(n ? 0x8da0c8 : 0xdde4ee);
      this.fogColor.set(n ? 0x050608 : 0x8c9196); this.fog.near = n ? 12 : 25; this.fog.far = n ? 160 : 280;
      if (n) this.atmos.fogColor.setRGB(0.004, 0.005, 0.007); else this.atmos.fogColor.setRGB(0.33, 0.35, 0.37);
      this.atmos.sunColor.setRGB(n ? 0.005 : 0.06, n ? 0.005 : 0.06, n ? 0.006 : 0.065);
      this.atmos.fogDensity = n ? 0.008 : 0.0055; this.atmos.fogFalloff = 0.01;
    }
    this.baseEnv = s.environmentIntensity;
    this.rain.set(rain);
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
    this.civilians.clear();
    this.mission?.dispose?.();
    this.mission = null;
    document.body.classList.remove('sniper-mission');
    this.grenades.clear();
    this.ballistics.clear();
    this.drone.reset();            // a drone still in the air: land it and stop its motor
    this.audio.ctx?.resume();
    this.audio.stopAmbience();
    this.audio.stopLoop('rain');
    this.audio.setLowHealth(0);
    this.voices.cancel();
  }

  onPlayerDeath() {
    this.input.enabled = false;
    this.weapons.setTrigger(false);
    this.hud.banner('K.I.A.', '', 2.5);
    this.deathTimer = 2.8;
    this.voices.cancel();
  }

  /** A scripted mission ended (success or failure): show its debrief. */
  missionOver(debrief) {
    this.state = 'dead';
    this.input.enabled = false;
    this.weapons.setTrigger(false);
    this.hud.show(false);
    document.exitPointerLock?.();
    this.onGameOver?.(debrief);
  }

  _gameOver() {
    if (this.mission) {
      const d = this.mission.debrief();
      d.title = 'K.I.A.'; d.success = false; d.rows[0] = ['Result', 'Killed in action'];
      this.missionOver(d);
      return;
    }
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
  emitNoise(pos, radius, kind) { this.enemies.onNoise(pos, radius, kind); this.civilians.onNoise(pos, radius, kind); }

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
    this.mission?.onEnemyKilled?.(e);
    if (this.missionKey === 'sniper') return;
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
    const rs = this.mission?.resupply || this.level.resupply;
    this.resupplyT -= dt;
    if (Math.hypot(rs.x - p.pos.x, rs.z - p.pos.z) < rs.r + 0.6 && this.resupplyT <= 0 && p.alive) {
      // a mission's ammo box can carry less than the HQ crate (Overwatch: rifle rounds only)
      const frags = rs.frags ?? GRENADES.maxFrag, flashes = rs.flashes ?? GRENADES.maxFlash, drones = rs.drones ?? 2;
      const needs = Object.values(w.slots).some((s) => s.reserve < s.def.reserve) || w.frags < frags || w.flashes < flashes || this.drone.count < drones;
      if (needs) {
        w.refill(frags, flashes);
        this.drone.count = Math.max(this.drone.count, drones);
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
      // a short fuse (in game time, so a pause holds it) before the tank lets go
      (this.barrelFuses ||= []).push({ b, t: this.time + 0.12 + Math.random() * 0.12 });
    }
  }
  _updateBarrels() {
    const F = this.barrelFuses;
    if (!F || !F.length) return;
    for (let i = F.length - 1; i >= 0; i--) {
      const { b, t } = F[i];
      if (this.time < t) continue;
      F.splice(i, 1);
      const m = new THREE.Matrix4().makeScale(0, 0, 0);
      for (const mesh of b.meshes) { mesh.setMatrixAt(b.index, m); mesh.instanceMatrix.needsUpdate = true; }
      b.box.y0 = -100; b.box.y1 = -100;
      this.explode(new THREE.Vector3(b.x, 0.5, b.z), 8, 190, 'barrel');
    }
  }

  _resetBarrels() {
    this.barrelFuses = [];
    this.level.explosiveBarrels.forEach((b, i) => {
      b.alive = true; b.hp = 30; b.box.y0 = 0; b.box.y1 = 0.93;
      for (const mesh of b.meshes) { mesh.setMatrixAt(b.index, this.barrelMatrices[i]); mesh.instanceMatrix.needsUpdate = true; }
    });
  }

  explode(pos, R, dmg, owner) {
    const W = this.level.world, p = this.player;
    this.effects.explosion(pos);
    this.audio.playAt(this.audio.pick('explosion_') || 'explosion', pos.x, pos.y, pos.z, { vol: 1.7, ref: 12, travel: true, max: 900, occlude: false, wet: 0.7 });
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
    // people caught in the blast
    for (const c of this.civilians.list) {
      if (!c.alive || c.gone) continue;
      const cc = new THREE.Vector3(c.pos.x, c.pos.y + 0.9, c.pos.z);
      const d = cc.distanceTo(pos);
      if (d >= R) { if (d < R * 3) c.alarm(pos, 1); continue; }
      const vis = W.los(pos.x, pos.y + 0.3, pos.z, cc.x, cc.y, cc.z, RAY_ALL);
      const dir = cc.clone().sub(pos).normalize();
      c.takeDamage(dmg * Math.pow(1 - d / R, 1.3) * (vis ? 1 : 0.2), 'blast', dir.x, dir.z, owner === 'player' || owner === 'drone' ? 'player' : 'env');
    }
    this.civilians.onNoise(pos, 60, 'gunshot');
    // chain reactions
    for (const b of this.level.explosiveBarrels) {
      if (b.alive && Math.hypot(b.x - pos.x, b.z - pos.z) < R * 0.7) this.damageBarrel(b, 100);
    }
  }

  flashbangAt(pos) {
    const W = this.level.world, p = this.player;
    this.effects.explosion(pos, true);
    this.audio.playAt('flashbang', pos.x, pos.y, pos.z, { vol: 1.5, ref: 12, travel: true, max: 700, occlude: false, wet: 0.8 });
    this.enemies.flashbang(pos, GRENADES.flash.radius);
    this.civilians.flashbang(pos, GRENADES.flash.radius);
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
    const V = this.level.menuView || { cx: 0, cy: 2, cz: -6, r: 58, y: 16 }, a = this.menuAngle;
    this.camera.position.set(V.cx + Math.sin(a) * V.r, V.y, V.cz + Math.cos(a) * V.r);
    this.camera.lookAt(V.cx, V.cy, V.cz);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this._followShadow(new THREE.Vector3(0, 0, 0));
    this.effects.update(dt);
    this.enemies.list.forEach((e) => e.update(dt));
    this.civilians.update(dt);
  }

  update(dt) {
    this.time += dt;
    const input = this.input, p = this.player, w = this.weapons;
    if (input.consume('pause')) { this.pause(); return; }
    if (input.consume('nvg')) this.toggleNvg();
    if (input.consume('thermal')) this.cycleThermal();
    if (input.consume('zoom')) w.cycleZoom();
    if (input.consume('zeroUp')) w.dialZero(50);
    if (input.consume('zeroDown')) w.dialZero(-50);
    if (input.consume('lase')) { if (this.mission?.lase) this.mission.lase(); else this.lase(); }
    if (input.consume('drone') && p.alive) { if (this.drone.active) this.drone.exit(); else if (!this.drone.deploy()) this.hud.pickup(this.drone.count <= 0 ? 'NO DRONES LEFT' : ''); }
    this.level.grassUniforms.uTime.value = this.time;
    this.rain.update(dt, this.drone.active ? this.drone.camera : this.camera);
    this.level.groundUniforms.rainTime.value = this.time;
    if (this.rain.active) this.scene.environmentIntensity = this.baseEnv * (1 + this.rain.flash * 6);
    if (this.drone.active) { this._updateDroneControl(dt); return; }
    this.drone.update(dt, input, [0, 0]);

    // look
    let [dx, dy] = input.takeLook();
    const d = w.def;
    const adsE = w.adsT;
    const zoomMul = d.scope ? settings.adsSens / (w.scopeZoom * 0.55) : settings.adsSens;
    let mul = 1 + (zoomMul - 1) * adsE;
    this._computeAimTarget();
    if (settings.aimAssist && input.touchMode && this.aimTarget && this.aimTarget.friction) mul *= 0.55;
    if (p.alive) { p.look(dx * mul, dy * mul); w.addLook(dx * mul, dy * mul); }
    this._aimSnap(dt);

    // actions
    if (p.alive) {
      if (input.consume('reload')) w.requestReload();
      if (input.consume('firemode')) w.toggleFireMode();
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
    const zoom = 1 + ((d.scope ? w.scopeZoom : d.adsZoom) - 1) * (d.scope ? (w.isScoped ? 1 : 0) : w.adsT);
    const fov = this.baseFov / zoom;
    soldierOptions.lodScale = (1 / zoom) * (this.cinematic ? 0.4 : 1); // people seen through a scope keep their detail
    // long sightlines: push the near plane out while looking through a scope (the gun is drawn separately)
    const near = this.missionKey === 'sniper' ? (w.isScoped ? 2.5 : 0.3) : 0.1;
    if (Math.abs(this.camera.fov - fov) > 0.01 || this.camera.near !== near) { this.camera.fov = fov; this.camera.near = near; this.camera.updateProjectionMatrix(); }
    if (w.isScoped) {
      // scope sway (steadier when crouched / still)
      // Overwatch: crouched in the hide the rifle rests on its bipod on the sandbags; only breathing moves it
      const rested = this.missionKey === 'sniper' && p.crouched && p.horizSpeed < 0.3;
      const sw = (rested ? 0.1 : p.crouched ? 0.3 : 1) * (1 + Math.min(1, p.horizSpeed / 3) * 2) * 0.0018;
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

    // lighting follows the player (or what a sniper is looking at)
    this._followShadow(this.level.shadowFocus || p.pos);
    this._shadowCheckT -= dt;
    if (this._shadowCheckT <= 0) {
      this._shadowCheckT = 0.15;
      const c = this.camera.position, L = this.lightDir;
      this.inShadow = !!this.level.world.raycast(c.x, c.y - 0.1, c.z, L.x, L.y, L.z, 60, RAY_ALL);
    }
    w.updateLighting(this.lightDir, this.inShadow, dt, this.night ? 0.1 : 1);
    // eye adaptation: indoors (a roof overhead) the exposure slowly opens up
    const roofed = this.level.world.ceilingAt(p.pos.x, p.pos.z, 0.2, p.pos.y + 1.9) < p.pos.y + 8;
    const expTarget = roofed ? 1.55 : 1.0;
    this.audio.loopMuffle('rain', roofed);
    this.eyeExposure = (this.eyeExposure || 1) + (expTarget - (this.eyeExposure || 1)) * Math.min(1, dt * (roofed ? 0.9 : 1.6));
    this._updateLasers();

    this.hud.update(dt);
    if (!p.alive) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this._gameOver();
    }
  }

  _updateWorld(dt) {
    this._updatePlayerBody(dt);
    this.enemies.update(dt);
    this.grenades.update(dt);
    this.ballistics.update(dt);
    this.effects.update(dt);
    this._updatePickups(dt);
    this._updateBarrels();
    this.civilians.update(dt);
    if (this.mission) this.mission.update(dt);
    else this._updateWaves(dt);
  }

  /** Rangefinder outside the sniper mission: just the distance. */
  lase() {
    const cam = this.camera, f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), o = cam.position;
    const h = this.level.world.raycast(o.x, o.y, o.z, f.x, f.y, f.z, 1400);
    this.hud.rangeReadout(h ? `${Math.round(h.t)} m` : '----');
  }

  /** While flying the FPV drone the operator stays put (and can still be shot). */
  _updateDroneControl(dt) {
    const input = this.input, p = this.player, d = this.drone;
    const look = input.takeLook();
    if (input.fire && !this._droneFirePrev) d.detonate();
    this._droneFirePrev = input.fire;
    if (input.consume('swap')) d.exit();
    for (const k of ['reload', 'crouch', 'frag', 'flash', 'slot1', 'slot2', 'firemode']) input.consume(k);
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
    const digital = playing && !droneView && this.player.alive && this.weapons.isScoped && this.weapons.def.scope === 'digital';
    const mode = droneView ? MODE.fpv : digital ? MODE.scope : playing ? MODE[this.viewMode] : MODE.normal;
    const thermal = mode === MODE.thermal;
    r.setRenderTarget(P.rt);
    r.autoClear = false;
    r.clear();
    d.model.visible = !d.active; // the FPV camera sits inside the drone
    r.shadowMap.needsUpdate = r.shadowMap.enabled;
    if (thermal) { cam.layers.enableAll(); cam.layers.disable(2); this._renderThermal(this.scene, cam); }
    else if (P.ao) {
      // 1) opaque world  2) AO + atmosphere  3) particles, tracers, decals and glows on top
      this._splitLayers();
      cam.layers.set(0);
      if (droneView) cam.layers.enable(2);
      r.render(this.scene, cam);
      const A = this.atmos, gu = this.level.groundUniforms;
      A.wet = this.weather === 'rain' && !this.level.indoor ? 1 : 0;
      A.contact = !this.night && this.weather !== 'rain' ? 1 : 0.35;
      A.heightMap = gu.heightMap.value; A.macroMap = gu.macroMap.value;
      P.world(cam, A);
      cam.layers.set(1); cam.layers.enable(3);
      const bg = this.scene.background;
      this.scene.background = null;
      r.render(this.scene, cam);
      this.scene.background = bg;
      cam.layers.enableAll();
      if (!droneView) cam.layers.disable(2);
    } else {
      cam.layers.enableAll();
      if (!droneView) cam.layers.disable(2);
      r.render(this.scene, cam);
    }
    if (playing && !droneView && this.player.alive && this.weapons.rig.visible) {
      r.clearDepth();
      r.shadowMap.needsUpdate = r.shadowMap.enabled && !thermal;
      if (thermal) this._renderThermal(this.weapons.scene, this.weapons.camera);
      else r.render(this.weapons.scene, this.weapons.camera);
    }
    r.autoClear = true;
    const n = this.night;
    const lowHealth = playing && this.player.alive ? Math.max(0, 1 - this.player.health / 45) : 0;
    const signal = droneView ? (d.active ? d.signal * (1 - d.transition / 0.6) : 0) : 1;
    // sun glare: where the sun is on screen, and whether anything blocks it
    let sunTarget = 0;
    const sp = this._sunScreen || (this._sunScreen = new THREE.Vector3());
    if (!this.night && playing && mode !== MODE.nvg && mode !== MODE.thermal) {
      sp.copy(cam.position).addScaledVector(this.lightDir, 1000).project(cam);
      if (sp.z < 1 && Math.abs(sp.x) < 1.3 && Math.abs(sp.y) < 1.3) {
        const edge = 1 - Math.max(0, Math.max(Math.abs(sp.x), Math.abs(sp.y)) - 0.85) / 0.45;
        const c = cam.position, L = this.lightDir;
        this._sunCheckT = (this._sunCheckT || 0) - 1;
        if (this._sunCheckT <= 0) { this._sunCheckT = 4; this._sunBlocked = !!this.level.world.raycast(c.x, c.y, c.z, L.x, L.y, L.z, 120); }
        sunTarget = this._sunBlocked ? 0 : Math.max(0, edge);
      }
    }
    this._sunVis = (this._sunVis || 0) + (sunTarget - (this._sunVis || 0)) * 0.15;
    const sunUV = this._sunUV || (this._sunUV = new THREE.Vector2());
    sunUV.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    // light shafts when looking towards the sun
    let rays = 0;
    if (!this.night && mode === MODE.normal && this.weather !== 'rain') {
      const f = this._fwd || (this._fwd = new THREE.Vector3());
      f.set(0, 0, -1).applyQuaternion(cam.quaternion);
      rays = 0.55 * THREE.MathUtils.smoothstep(f.dot(this.lightDir), 0.35, 0.92);
    }
    P.finish({
      world: !thermal, rays, haze: this.night || this.weather === 'rain' ? 0 : 1, tonemap: 1,
      sunVis: this._sunVis * 0.8, sunUV,
      mode, time: this.time, lowHealth, signal, palette: this.thermalPalette,
      exposure: (n ? (droneView ? 2.4 : 1.3) : (droneView || !playing ? 1.0 : (this.eyeExposure || 1))) * (1 + this.rain.flash * 0.9),
      bloomStrength: n ? 0.14 : 0.07, threshold: n ? 0.7 : 1.5,
      nvgGain: mode === MODE.scope ? (n ? 14 : 1) : n ? 9 : 1.1, noise: n ? 0.22 : 0.07,
      vignette: mode === MODE.fpv ? 0.15 : 0.35, grain: n ? 0.032 : 0.018,
    });
    this.hud.captureAfterimage(r.domElement);
  }

  /** Poses the player's body from the player state (visible to the drone camera and in shadows). */
  _updatePlayerBody(dt) {
    const b = this.playerBody, p = this.player;
    b.root.visible = this.state === 'playing' && p.alive;
    if (!b.root.visible) return;
    b.setPosition(p.pos.x, p.pos.y, p.pos.z);
    b.yaw = p.yaw + Math.PI;
    const P = b.pose;
    P.aim = 1; P.pitch = -p.pitch; P.crouch += ((p.crouched ? 1 : 0) - P.crouch) * Math.min(1, dt * 8); P.yawOff = 0;
    const c = Math.cos(-b.yaw), sn = Math.sin(-b.yaw);
    const lx = p.vel.x * c - p.vel.z * sn, lz = p.vel.x * sn + p.vel.z * c, sp = Math.hypot(lx, lz);
    b.move.speed = sp; b.move.fx = sp > 0.05 ? lx / sp : 0; b.move.fz = sp > 0.05 ? lz / sp : 0;
    b.update(dt, this.level.world, this.camera.position);
  }

  /** Puts particles, tracers, sprites and other transparent things on layer 1 (drawn after AO/fog); lights on both. */
  _splitLayers() {
    this.scene.traverse((o) => {
      if (o.isLight) { o.layers.enableAll(); return; }
      if (o.userData.muzzleFlash || o.userData.fixedLayer) return;
      if (!o.isMesh && !o.isPoints && !o.isSprite && !o.isLine) return;
      const m = o.material;
      o.layers.set(o.isPoints || o.isSprite || (m && !Array.isArray(m) && m.transparent) ? 1 : 0);
    });
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
    const mask = cam.layers.mask;
    cam.layers.disable(3);
    withThermal(() => this.renderer.render(scene, cam), this.night ? 0.16 : 0.3);
    scene.overrideMaterial = null;
    for (const o of hidden) o.visible = true;
    // muzzle flashes are burning gas: add them on top, where they read as the hottest thing in view
    scene.background = null;
    cam.layers.set(3);
    this.renderer.render(scene, cam);
    cam.layers.mask = mask;
    scene.background = bg; scene.fog = fog;
  }
}

function hfovToV(hfovDeg, aspect) {
  const h = hfovDeg * DEG;
  return 2 * Math.atan(Math.tan(h / 2) / aspect) / DEG;
}

