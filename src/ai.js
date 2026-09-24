// Enemy AI. Each enemy perceives (vision cone + awareness build-up, hearing),
// plans with a small utility/decision system (cover, peek & shoot, flank,
// push, suppress, grenades, retreat, search, evade grenades, blinded) and
// executes with navigation + aiming. A squad director coordinates roles.
import * as THREE from 'three';
import { ENEMY_TYPES } from './config.js';
import { Soldier } from './soldier.js';
import { RAY_ALL, RAY_SIGHT, pointSegDist, raySphere, rayCapsule } from './physics.js';

const LINES = {
  contact: ['Contact front!', 'Enemy spotted!', 'Contact!', 'Eyes on target!'],
  reloading: ['Reloading!', 'Changing mags, cover me!', 'Reloading, cover!'],
  flank: ['Flanking!', 'Moving to flank!', "I'll go around!"],
  frag: ['Frag out!', 'Grenade out!'],
  flash: ['Flashbang out!', 'Flash out!'],
  grenadeWarn: ['Grenade!', 'Grenade, move!'],
  flashed: ["I can't see!", "I'm blind!", 'Flashbang!'],
  manDown: ['Man down!', "He's down!", 'We lost one!'],
  push: ["He's reloading, push!", 'Push him now!', 'Moving up!'],
  lost: ['Lost visual.', 'Where did he go?', 'Eyes open.'],
  suppress: ['Suppressing!', 'Keep his head down!'],
  hit: ["I'm hit!", 'Taking fire!'],
  retreat: ['Falling back!', 'Pulling back!'],
  heard: ['Heard something.', 'Movement!'],
  moving: ['Moving!', 'Relocating!', 'Changing position!'],
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = ([a, b]) => Math.round(rand(a, b));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
function angleDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

let nextId = 1;

export class Enemy {
  constructor(mgr, typeKey, x, z) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.id = nextId++;
    this.typeKey = typeKey;
    this.type = ENEMY_TYPES[typeKey];
    this.hp = this.type.hp;
    this.alive = true;
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.aimPitch = 0; this.yawOff = 0;
    this.soldier = new Soldier(this.game.scene, this.type.kit, this.type.weapon);
    this.soldier.setPosition(x, 0, z);
    this.voicePitch = rand(0.55, 1.0);
    // knowledge
    this.alert = 1;
    this.awareness = 0;
    this.seeing = false;
    this.seeTime = 0;
    this.lastSeen = -99;
    this.lastKnown = new THREE.Vector3(x, 0, z);
    this.reactUntil = 0;
    // orders
    this.order = 'investigate';
    this.orderT = 0;
    this.path = null; this.pathIdx = 0; this.arrived = false;
    this.speed = this.type.walk;
    this.cover = null; this.coverPhase = 'move'; this.phaseT = 0; this.peekPos = null; this.coverCycles = 0;
    this.crouch = false;
    this.role = 'default'; this.roleUntil = 0;
    // weapon
    this.ammo = this.type.mag;
    this.reloading = 0;
    this.burstLeft = 0; this.nextShot = 0; this.burstPauseUntil = 0;
    this.shotCount = 0;
    this.suppression = 0;
    this.flashed = 0;
    this.grenades = Math.random() < this.type.grenadeChance ? (Math.random() < 0.3 ? 2 : 1) : 0;
    this.hasFlash = Math.random() < this.type.flashChance;
    this.throwing = null;
    this.lastHurt = -99;
    this.lastFired = -99;
    this.retreated = false;
    this.thinkT = rand(0, 0.4);
    this.perceiveT = rand(0, 0.12);
    this.stuckT = 0; this.progressPos = new THREE.Vector3(x, 0, z);
    this.lookAround = 0;
    this.hb = { head: new THREE.Vector3(), neck: new THREE.Vector3(), hips: new THREE.Vector3(), kL: new THREE.Vector3(), fL: new THREE.Vector3(), kR: new THREE.Vector3(), fR: new THREE.Vector3() };
    this.deadT = 0;
    if (this.type.glint) this._makeGlint();
  }

  _makeGlint() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(255,255,230,0.8)'); g.addColorStop(1, 'rgba(255,255,200,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(0, 31, 64, 2); ctx.fillRect(31, 0, 2, 64);
    const t = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    s.scale.setScalar(0.5);
    s.position.set(0, 0.11, 0.2);
    s.visible = false;
    this.soldier.gun.add(s);
    this.soldier.glint = s;
  }

  get eyeY() { return this.pos.y + (this.crouch && this.coverPhase !== 'peek' ? 1.02 : 1.6); }
  eye(out) { return out.set(this.pos.x, this.eyeY, this.pos.z); }
  say(key) { this.mgr.say(this, key); }

  // ---------------- perception ----------------
  perceive(dt) {
    const g = this.game, p = g.player, W = g.level.world;
    const wasSeeing = this.seeing;
    if (!p.alive || this.flashed > 0) { this.seeing = false; this.seeTime = 0; return; }
    const eye = this.eye(_a);
    const dx = p.eye.x - eye.x, dz = p.eye.z - eye.z, dy = p.eye.y - eye.y;
    const dist = Math.hypot(dx, dy, dz);
    let visible = false, inFov = false;
    if (dist < 140) {
      const face = this.yaw + this.yawOff;
      const fx = Math.sin(face), fz = Math.cos(face);
      const cosA = (dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz));
      const half = this.alert >= 2 ? 0.2 : 0.5; // cos of half-FOV (~78° / 60°)
      inFov = cosA > half;
      const near = dist < 4.5 && !p.crouched;
      if (inFov || near) {
        visible = W.los(eye.x, eye.y, eye.z, p.eye.x, p.eye.y - 0.1, p.eye.z)
          || W.los(eye.x, eye.y, eye.z, p.pos.x, p.pos.y + p.eyeH * 0.6, p.pos.z)
          || (!p.crouched && W.los(eye.x, eye.y, eye.z, p.pos.x, p.pos.y + 0.5, p.pos.z));
      }
    }
    if (visible) {
      const firing = g.time - p.lastShotTime < 1.2;
      let rate = (this.alert >= 2 ? 3.2 : 1.1) * THREE.MathUtils.clamp(1.5 - dist / 55, 0.2, 1.5);
      if (p.crouched) rate *= 0.6;
      if (p.horizSpeed > 1) rate *= 1.35;
      if (firing) rate *= 3;
      if (!inFov) rate *= 0.4;
      rate /= g.difficulty.react;
      this.awareness = Math.min(1.5, this.awareness + rate * dt);
    } else if (this.alert < 2) {
      this.awareness = Math.max(0, this.awareness - dt * 0.12);
    }
    this.seeing = visible && this.awareness >= 1;
    if (this.seeing) {
      this.seeTime += dt;
      if (!wasSeeing) this._onSpot();
      this.lastSeen = g.time;
      this.lastKnown.copy(p.pos);
      this.mgr.shareIntel(this);
    } else {
      this.seeTime = 0;
      if (wasSeeing && this.alert >= 2 && Math.random() < 0.25) this.say('lost');
    }
  }

  _onSpot() {
    const g = this.game;
    const surprise = this.alert < 2;
    const react = rand(0.3, 0.55) * g.difficulty.react * (surprise ? 1.7 : 1) * (this.typeKey === 'marksman' ? 1.3 : 1);
    this.reactUntil = Math.max(this.reactUntil, g.time + react);
    if (surprise) { this.alert = 2; this.replan(); }
    if (g.time - this.mgr.squadLastSeen > 6) this.say('contact');
  }

  hear(pos, kind, dist) {
    const g = this.game;
    if (!this.alive) return;
    if (kind === 'gunshot') {
      const err = dist * 0.1;
      if (!this.seeing) this.lastKnown.set(pos.x + rand(-err, err), 0, pos.z + rand(-err, err));
      if (this.alert < 2) { this.alert = 2; this.awareness = Math.max(this.awareness, 0.75); this.replan(); }
      this.lastHeard = g.time;
    } else if (kind === 'step') {
      if (this.alert < 2) {
        this.lastKnown.set(pos.x + rand(-1.5, 1.5), 0, pos.z + rand(-1.5, 1.5));
        this.awareness = Math.max(this.awareness, 0.6);
        if (this.order !== 'investigate') { this.order = 'investigate'; this.path = null; this.say('heard'); }
        this.alert = Math.max(this.alert, 1);
      } else if (!this.seeing) {
        this.lastKnown.set(pos.x, 0, pos.z);
      }
    } else if (kind === 'reload') {
      if (this.alert >= 2 && dist < 24) this.mgr.playerReloadHeard = g.time;
    }
  }

  // ---------------- damage ----------------
  takeDamage(amount, part, dirX, dirZ, source) {
    const g = this.game;
    if (!this.alive) return false;
    if (part === 'torso' && this.type.armor) amount *= this.type.armor;
    this.hp -= amount;
    this.lastHurt = g.time;
    this.suppression = Math.min(3, this.suppression + 1);
    this.soldier.flinch(dirX, dirZ, part === 'head' ? 1.5 : 1);
    if (source === 'player') {
      this.lastKnown.copy(g.player.pos);
      this.awareness = 1.2;
      if (this.alert < 2) { this.alert = 2; }
    }
    if (this.hp <= 0) { this.die(dirX, dirZ, part === 'head'); return true; }
    g.audio.playAt(`ehurt${(Math.random() * 2) | 0}`, this.pos.x, this.pos.y + 1.5, this.pos.z, { vol: 0.8 });
    if (Math.random() < 0.3) this.say('hit');
    // cut a peek short when shot
    if (this.order === 'cover' && this.coverPhase === 'peek') { this.coverPhase = 'hide'; this.phaseT = rand(0.8, 1.6); }
    if (this.hp < this.type.hp * 0.35 && !this.retreated) this.replan();
    return false;
  }

  die(dirX, dirZ, headshot) {
    const g = this.game;
    this.alive = false;
    this.hp = 0;
    if (this.cover) this.cover.occupant = null;
    this.soldier.die(dirX, dirZ, headshot);
    g.audio.playAt(`edeath${(Math.random() * 2) | 0}`, this.pos.x, this.pos.y + 1.4, this.pos.z, { vol: headshot ? 0.3 : 0.9 });
    this.mgr.onDeath(this);
  }

  replan() { this.thinkT = 0; }

  // ---------------- decision making ----------------
  think() {
    const g = this.game, mgr = this.mgr, p = g.player;
    if (this.flashed > 0) { this.setOrder('blind'); return; }
    if (this.throwing) return;

    // 1) incoming grenade: get away
    const gren = g.grenades.dangerNear(this.pos, 7.5);
    if (gren) { this.evade(gren); return; }
    if (this.order === 'evade' && this.orderT < 1.2) return;

    if (this.alert < 2) {
      if (this.order !== 'investigate' && this.order !== 'search') this.setOrder('investigate');
      return;
    }
    const tSince = g.time - this.lastSeen;
    const dist = this.pos.distanceTo(this.lastKnown);

    // 2) badly hurt: fall back once
    if (this.hp < this.type.hp * 0.35 && !this.retreated) {
      this.retreated = true;
      const c = this.chooseCover({ retreat: true });
      if (c) { this.takeCover(c); this.say('retreat'); return; }
    }

    // 3) squad roles
    if (this.role === 'rusher' && g.time < this.roleUntil) { if (this.order !== 'push') this.setOrder('push'); return; }
    if (this.role === 'rusher') this.role = 'default';
    if (this.role === 'flanker') {
      if (g.time > this.roleUntil) this.role = 'default';
      else if (this.order !== 'cover' || !this.cover || !this.cover.flank) {
        const c = this.chooseCover({ flank: true });
        if (c) { c.flank = true; this.takeCover(c, true); return; }
        this.role = 'default';
      }
      if (this.order === 'cover' && this.coverPhase === 'move') return;
    }
    if (this.type.aggressive && p.alive && (dist < 22 || tSince > 4)) {
      if (this.order !== 'push' && (this.order !== 'cover' || this.coverCycles >= 1)) { this.setOrder('push'); return; }
    }

    // 4) player dug in out of sight: flush with a grenade
    if (tSince > 3 && tSince < 14 && this.grenades > 0 && mgr.canThrow() && dist > 6 && dist < 30 && Math.random() < 0.55 * g.difficulty.grenade) {
      const flash = this.hasFlash && Math.random() < 0.5;
      if (this.tryThrow(flash ? 'flash' : 'frag')) return;
    }

    // 5) lost contact for a while: search
    if (tSince > 11 && this.order !== 'search') {
      if (mgr.searchers() < 2 || Math.random() < 0.3) { this.setOrder('search'); return; }
    }
    if (this.order === 'search' && tSince > 11) return;

    // 6) cover logic
    if (this.order !== 'cover' || !this.cover) {
      const c = this.chooseCover({});
      if (c) this.takeCover(c);
      else this.setOrder('push');
      return;
    }
    if (this.coverPhase === 'hide' && this.coverCompromised()) {
      const c = this.chooseCover({ exclude: this.cover });
      if (c) { this.takeCover(c); if (Math.random() < 0.4) this.say('moving'); }
      else this.setOrder('push');
      return;
    }
    if (this.coverCycles >= (this.typeKey === 'marksman' ? 5 : 3) && this.coverPhase === 'hide') {
      // reposition, often advancing
      const c = this.chooseCover({ exclude: this.cover, advance: true });
      if (c) { this.takeCover(c); if (Math.random() < 0.4) this.say('moving'); }
      else this.coverCycles = 0;
    }
  }

  setOrder(o) {
    if (this.order === o) return;
    if (this.cover && o !== 'cover') { this.cover.occupant = null; this.cover = null; }
    this.order = o; this.orderT = 0; this.path = null; this.arrived = false;
    this.lookAround = 0;
  }

  takeCover(c, flank = false) {
    if (this.cover) this.cover.occupant = null;
    this.setOrder('cover');
    this.cover = c; c.occupant = this;
    this.coverPhase = 'move'; this.coverCycles = 0;
    this.peekPos = c._peek ? c._peek.clone() : null;
    this.navigate(c.x, c.z, flank);
  }

  navigate(x, z, avoidView = false) {
    const g = this.game, nav = g.level.nav, p = g.player;
    let costFn = null;
    if (avoidView && p.alive) {
      // prefer routes the player is not looking at
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), px = p.pos.x, pz = p.pos.z;
      costFn = (cx, cz) => {
        const dx = cx - px, dz = cz - pz, d = Math.hypot(dx, dz);
        if (d > 35) return 0;
        const dot = (dx * fx + dz * fz) / (d + 0.01);
        return dot > 0.35 ? 3 * (1 - d / 35) : 0;
      };
    }
    this.path = nav.findPath(this.pos.x, this.pos.z, x, z, costFn);
    this.pathIdx = 0;
    this.arrived = !this.path;
  }

  /** Scores cover points against the threat (player's last known position). */
  chooseCover({ retreat = false, flank = false, exclude = null, advance = false } = {}) {
    const g = this.game, W = g.level.world, covers = g.level.covers;
    const T = _b.set(this.lastKnown.x, this.lastKnown.y + 1.5, this.lastKnown.z);
    if (g.player.alive && this.seeing) T.copy(g.player.eye);
    const [pMin, pMax] = this.type.preferDist;
    const myDist = Math.hypot(this.pos.x - T.x, this.pos.z - T.z);
    const squadAngle = this.mgr.squadAngle(T, this);
    const cands = [];
    for (const c of covers) {
      if (c === exclude || (c.occupant && c.occupant !== this && c.occupant.alive)) continue;
      const dE = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
      if (dE > (flank ? 40 : 28)) continue;
      const dxT = T.x - c.x, dzT = T.z - c.z;
      const dT = Math.hypot(dxT, dzT);
      if (dT < 4) continue;
      if ((dxT * c.dx + dzT * c.dz) / dT < 0.3) continue; // cover must face the threat
      if (retreat && dT < myDist + 4) continue;
      if (advance && dT > myDist - 2 && dT > pMax) continue;
      let s = -Math.abs(dT - (pMin + pMax) / 2) * 0.35 - dE * 0.35 + Math.random() * 1.5;
      if (dT < pMin) s -= (pMin - dT) * 1.5;
      if (flank && squadAngle !== null) {
        const a = Math.abs(angleDiff(squadAngle, Math.atan2(c.x - T.x, c.z - T.z)));
        if (a < 0.9) continue;
        s += a * 4;
      }
      if (g.grenades.dangerNear(c, 8)) s -= 50;
      for (const e of this.mgr.list) if (e !== this && e.alive && e.cover && Math.hypot(e.cover.x - c.x, e.cover.z - c.z) < 3) s -= 4;
      cands.push({ c, s, dT });
    }
    cands.sort((a, b) => b.s - a.s);
    let best = null, bestS = -Infinity;
    for (let i = 0; i < Math.min(14, cands.length); i++) {
      const { c, s, dT } = cands[i];
      // protected when hidden?
      const hideY = c.low ? 0.95 : 1.55;
      if (W.los(T.x, T.y, T.z, c.x, hideY, c.z, RAY_ALL)) continue;
      // can we shoot from here?
      let fire = false; c._peek = null;
      if (c.low) fire = W.los(c.x, 1.55, c.z, T.x, T.y - 0.2, T.z);
      else {
        for (const o of [0.9, -0.9, 1.4, -1.4]) {
          const px = c.x + c.tx * o, pz = c.z + c.tz * o;
          if (!g.level.nav.walkable(px, pz)) continue;
          if (W.los(px, 1.55, pz, T.x, T.y - 0.2, T.z)) { fire = true; c._peek = new THREE.Vector3(px, 0, pz); break; }
        }
      }
      let score = s + (fire ? 6 : this.typeKey === 'marksman' ? -10 : -3);
      if (dT > this.type.range) score -= 20;
      if (score > bestS) { bestS = score; best = c; }
    }
    return best;
  }

  coverCompromised() {
    const g = this.game, p = g.player, c = this.cover;
    if (!c || !p.alive) return false;
    if (g.time - this.lastSeen > 3) return false;
    const y = c.low ? 0.95 : 1.55;
    return g.level.world.los(p.eye.x, p.eye.y, p.eye.z, c.x, y, c.z);
  }

  evade(gren) {
    const g = this.game, nav = g.level.nav;
    let ax = this.pos.x - gren.pos.x, az = this.pos.z - gren.pos.z;
    const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
    let best = null;
    for (const rot of [0, 0.6, -0.6, 1.2, -1.2, 2]) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const dx = ax * c - az * s, dz = ax * s + az * c;
      const tx = this.pos.x + dx * 9, tz = this.pos.z + dz * 9;
      const k = nav.nearestWalkable(tx, tz, 3);
      if (k >= 0) { best = [nav.cx(k), nav.cz(k)]; break; }
    }
    if (this.order !== 'evade') { this.say('grenadeWarn'); }
    this.setOrder('evade');
    if (best) this.navigate(best[0], best[1]);
  }

  tryThrow(kind) {
    const g = this.game, W = g.level.world;
    const from = _a.set(this.pos.x, this.pos.y + 1.7, this.pos.z);
    const tgt = _c.copy(this.lastKnown); tgt.y = 0.3;
    for (const T of [1.2, 1.6, 2.1]) {
      const vx = (tgt.x - from.x) / T, vz = (tgt.z - from.z) / T;
      const vy = (tgt.y - from.y + 0.5 * 9.81 * T * T) / T;
      // check the arc
      let ok = true;
      let px = from.x, py = from.y, pz = from.z;
      for (let i = 1; i <= 10 && ok; i++) {
        const t = (T * i) / 10;
        const nx = from.x + vx * t, ny = from.y + vy * t - 4.905 * t * t, nz = from.z + vz * t;
        const dx = nx - px, dy = ny - py, dz = nz - pz, d = Math.hypot(dx, dy, dz);
        const h = W.raycast(px, py, pz, dx / d, dy / d, dz / d, d, RAY_ALL);
        if (h && i < 8) ok = false;
        px = nx; py = ny; pz = nz;
      }
      if (!ok) continue;
      const err = 1 + rand(-0.08, 0.08) * g.difficulty.spread;
      this.throwing = { t: 0, kind, released: false, v: new THREE.Vector3(vx * err + rand(-0.4, 0.4), vy * (1 + rand(-0.04, 0.04)), vz * err + rand(-0.4, 0.4)) };
      this.grenades--;
      this.mgr.lastThrow = g.time;
      this.say(kind === 'flash' ? 'flash' : 'frag');
      if (kind === 'flash') this.mgr.planRush();
      this.path = null;
      return true;
    }
    return false;
  }

  startReload() {
    if (this.reloading > 0) return;
    this.reloading = this.type.reload;
    this.burstLeft = 0;
    if (this.alert >= 2 && Math.random() < 0.6) this.say('reloading');
    this.game.audio.playAt('magOut', this.pos.x, this.pos.y + 1.2, this.pos.z, { vol: 0.5, max: 25 });
  }

  // ---------------- per-frame ----------------
  update(dt) {
    const g = this.game;
    if (!this.alive) { this.deadT += dt; this.soldier.update(dt, g.level.world); return; }
    this.orderT += dt;
    this.suppression = Math.max(0, this.suppression - dt * 0.6);
    if (this.flashed > 0) {
      this.flashed -= dt;
      if (this.flashed <= 0) { this.flashed = 0; this.awareness = 0.6; this.replan(); }
    }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.reloading = 0; this.ammo = this.type.mag; g.audio.playAt('magIn', this.pos.x, this.pos.y + 1.2, this.pos.z, { vol: 0.5, max: 25 }); }
    }
    this.perceiveT -= dt;
    if (this.perceiveT <= 0) { this.perceive(0.12 - this.perceiveT); this.perceiveT = 0.12; }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.think(); this.thinkT = rand(0.35, 0.6); }

    this.act(dt);

    // pose
    const s = this.soldier, P = s.pose;
    P.crouch += ((this.crouch ? 1 : 0) - P.crouch) * Math.min(1, dt * 6);
    P.aim = this.flashed > 0 ? 0 : (this.alert >= 2 || this.order === 'investigate' ? (this.seeing || this.order === 'cover' || this.burstLeft > 0 ? 1 : 0.75) : 0.2);
    if (this.order === 'push' || (this.order === 'cover' && this.coverPhase === 'move')) P.aim = this.seeing ? 1 : 0.4;
    P.pitch = this.aimPitch;
    P.yawOff = this.yawOff;
    P.flashed += ((this.flashed > 0 ? 1 : 0) - P.flashed) * Math.min(1, dt * 8);
    P.reload = this.reloading > 0 ? 1 - this.reloading / this.type.reload : -1;
    P.throw = this.throwing ? Math.min(1, this.throwing.t / 0.9) : -1;
    const c = Math.cos(-this.yaw), sn = Math.sin(-this.yaw);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    s.move.speed = sp;
    s.move.fx = sp > 0.1 ? (this.vel.x * c - this.vel.z * sn) / sp : 0;
    s.move.fz = sp > 0.1 ? (this.vel.x * sn + this.vel.z * c) / sp : 1;
    s.setPosition(this.pos.x, this.pos.y, this.pos.z);
    s.yaw = this.yaw;
    s.update(dt, g.level.world, g.camera.position);
    this._updateHitboxes();
  }

  act(dt) {
    const g = this.game, p = g.player, W = g.level.world;
    let wantSpeed = 0, faceX = null, faceZ = null;
    this.crouch = false;

    if (this.throwing) {
      const th = this.throwing;
      th.t += dt;
      faceX = th.v.x; faceZ = th.v.z;
      if (th.t >= 0.55 && !th.released) {
        th.released = true;
        const hand = _a.set(this.pos.x, this.pos.y + 1.75, this.pos.z);
        g.grenades.spawn(th.kind, hand.clone(), th.v.clone(), 'enemy');
      }
      if (th.t >= 0.95) { this.throwing = null; this.replan(); }
    }

    switch (this.order) {
      case 'investigate': {
        if (!this.path && !this.arrived) this.navigate(this.lastKnown.x, this.lastKnown.z);
        // moving in on the player's rough position: tactical jog
        wantSpeed = this.alert >= 1 ? Math.max(this.type.walk, this.type.speed * 0.78) : this.type.walk;
        if (this.arrived) { this._lookAround(dt); if (this.orderT > 4) this.setOrder('search'); }
        break;
      }
      case 'search': {
        if (!this.path && !this.arrived) {
          const lk = this.lastKnown;
          const tx = lk.x + rand(-6, 6), tz = lk.z + rand(-6, 6);
          this.navigate(tx, tz);
        }
        wantSpeed = 2.2;
        this.crouch = false;
        if (this.arrived) {
          this._lookAround(dt);
          if (this.lookAround > 3) { this.arrived = false; this.path = null; this.lookAround = 0; }
        }
        if (this.orderT > 20) { this.lastKnown.copy(p.pos).add(new THREE.Vector3(rand(-8, 8), 0, rand(-8, 8))); this.orderT = 0; }
        break;
      }
      case 'cover': this._actCover(dt); wantSpeed = this._coverSpeed; break;
      case 'push': {
        if (!this.path || this.orderT > 1.2) {
          this.orderT = 0;
          const lk = this.lastKnown;
          const d = Math.hypot(lk.x - this.pos.x, lk.z - this.pos.z);
          const stop = this.type.aggressive || this.role === 'rusher' ? 2.5 : this.type.preferDist[0];
          if (d > stop || !this.seeing) {
            // approach with some lateral offset so they don't beeline
            const off = this.seeing ? rand(-3, 3) : 0;
            this.navigate(lk.x + off, lk.z + off);
          } else {
            // strafe while engaging
            const ang = Math.atan2(lk.x - this.pos.x, lk.z - this.pos.z) + (Math.random() < 0.5 ? 1.57 : -1.57);
            this.navigate(this.pos.x + Math.sin(ang) * 3, this.pos.z + Math.cos(ang) * 3);
          }
        }
        wantSpeed = this.seeing && !this.type.aggressive && this.role !== 'rusher' ? this.type.walk * 1.5 : this.type.speed;
        break;
      }
      case 'evade': wantSpeed = this.type.speed * 1.1; if (this.arrived && this.orderT > 1.5) this.replan(); break;
      case 'blind': {
        // stumble around, arms up
        if (!this.path || this.arrived) this.navigate(this.pos.x + rand(-2, 2), this.pos.z + rand(-2, 2));
        wantSpeed = 0.8;
        break;
      }
    }
    if (this.throwing) wantSpeed = 0;
    if (this.reloading > 0 && this.order !== 'evade' && this.order !== 'cover') wantSpeed = Math.min(wantSpeed, this.type.walk);

    // ---- locomotion ----
    let dvx = 0, dvz = 0;
    if (this.path && this.pathIdx < this.path.length && wantSpeed > 0) {
      const t = this.path[this.pathIdx];
      let dx = t.x - this.pos.x, dz = t.z - this.pos.z;
      let d = Math.hypot(dx, dz);
      if (d < 0.35) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) { this.path = null; this.arrived = true; }
      } else {
        const slow = this.pathIdx === this.path.length - 1 ? Math.min(1, d / 1.2 + 0.3) : 1;
        dvx = dx / d * wantSpeed * slow; dvz = dz / d * wantSpeed * slow;
      }
    }
    // separation from other enemies
    for (const e of this.mgr.list) {
      if (e === this || !e.alive) continue;
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.8 && d > 0.001) { dvx += dx / d * (0.8 - d) * 4; dvz += dz / d * (0.8 - d) * 4; }
    }
    const k = Math.min(1, dt * 10);
    this.vel.x += (dvx - this.vel.x) * k;
    this.vel.z += (dvz - this.vel.z) * k;
    const ox = this.pos.x, oz = this.pos.z;
    W.slide(this.pos, this.vel.x * dt, this.vel.z * dt, 0.3, 1.75, 0.42);
    this.pos.y = W.groundAt(this.pos.x, this.pos.z, 0.2, this.pos.y + 0.42);
    // stuck detection
    if (wantSpeed > 0 && this.path) {
      this.stuckT += dt;
      if (this.stuckT > 1.5) {
        if (this.pos.distanceTo(this.progressPos) < 0.4) { this.path = null; this.arrived = false; if (this.order === 'cover' && this.cover) this.navigate(this.cover.x, this.cover.z); }
        this.stuckT = 0; this.progressPos.copy(this.pos);
      }
    }
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz) / Math.max(dt, 1e-4);
    if (moved < Math.hypot(this.vel.x, this.vel.z) * 0.3) { this.vel.x *= 0.5; this.vel.z *= 0.5; }

    // footsteps (audible to the player: helps hear flankers)
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.8) {
      this.stepAcc = (this.stepAcc || 0) + sp * dt;
      if (this.stepAcc > (sp > 3 ? 1.9 : 1.4)) {
        this.stepAcc = 0;
        g.audio.playAt(`step${(Math.random() * 4) | 0}`, this.pos.x, this.pos.y, this.pos.z, { vol: sp > 3 ? 0.9 : 0.5, ref: 2, max: 32 });
      }
    }

    // ---- facing ----
    const knowRecent = g.time - this.lastSeen < 8 || this.alert >= 2;
    if (this.seeing && this.flashed <= 0) { faceX = p.pos.x - this.pos.x; faceZ = p.pos.z - this.pos.z; }
    else if (faceX === null && knowRecent && this.alert >= 2 && this.order !== 'evade' && !(this.order === 'cover' && this.coverPhase === 'move' && sp > 2)) {
      faceX = this.lastKnown.x - this.pos.x; faceZ = this.lastKnown.z - this.pos.z;
    } else if (faceX === null && sp > 0.3) { faceX = this.vel.x; faceZ = this.vel.z; }
    if (faceX !== null && (faceX !== 0 || faceZ !== 0)) {
      const want = Math.atan2(faceX, faceZ);
      const diff = angleDiff(this.yaw, want);
      const turn = (this.alert >= 2 ? 7 : 3.5) * dt;
      this.yaw += Math.max(-turn, Math.min(turn, diff));
      this.yawOff = THREE.MathUtils.clamp(angleDiff(this.yaw, want), -0.7, 0.7);
    } else this.yawOff *= 0.9;
    // aim pitch
    const tgt = this.seeing ? p.eye : _c.set(this.lastKnown.x, this.lastKnown.y + 1.2, this.lastKnown.z);
    const hd = Math.hypot(tgt.x - this.pos.x, tgt.z - this.pos.z);
    this.aimPitch = Math.atan2(tgt.y - 0.25 - this.eyeY, Math.max(0.5, hd));

    this._tryFire(dt);
    if (this.soldier.glint) this.soldier.glint.visible = this.seeing && this.flashed <= 0 && Math.random() < 0.9;
  }

  _actCover(dt) {
    const g = this.game, c = this.cover;
    this._coverSpeed = 0;
    if (!c) return;
    if (this.coverPhase === 'move') {
      if (!this.path && !this.arrived) this.navigate(c.x, c.z);
      this._coverSpeed = this.type.speed;
      if (this.arrived || Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < 0.4) {
        this.coverPhase = 'hide'; this.phaseT = rand(0.4, 1.2); this.path = null; this.arrived = false;
      }
      return;
    }
    if (this.coverPhase === 'hide') {
      this.crouch = c.low;
      if (!c.low && this.peekPos && Math.hypot(c.x - this.pos.x, c.z - this.pos.z) > 0.35) {
        if (!this.path) this.navigate(c.x, c.z);
        this._coverSpeed = 2.4;
      }
      if (this.ammo < this.type.mag * 0.5 && this.reloading <= 0) this.startReload();
      this.phaseT -= dt * (g.time - this.mgr.playerReloadHeard < 2 ? 3 : 1);
      if (this.phaseT <= 0 && this.reloading <= 0) {
        this.coverPhase = 'peek';
        this.phaseT = rand(1.3, 2.8) * (this.typeKey === 'marksman' ? 1.6 : 1) * (this.typeKey === 'heavy' ? 1.5 : 1);
        this.path = null; this.arrived = false;
        if (this.peekPos && !c.low) this.navigate(this.peekPos.x, this.peekPos.z);
      }
      return;
    }
    // peek
    this.crouch = false;
    if (this.peekPos && !c.low && this.path) this._coverSpeed = 2.4;
    this.phaseT -= dt;
    const hurtRecently = g.time - this.lastHurt < 0.3;
    if (this.phaseT <= 0 || hurtRecently || this.ammo <= 0 || this.suppression > 2) {
      this.coverPhase = 'hide';
      this.phaseT = rand(0.7, 2.0) * (this.suppression > 1 ? 1.6 : 1);
      this.coverCycles++;
      this.path = null; this.arrived = false;
      if (this.peekPos && !c.low) this.navigate(c.x, c.z);
    }
  }

  _lookAround(dt) {
    this.lookAround += dt;
    this.yaw += Math.sin(this.lookAround * 1.3) * dt * 1.2;
  }

  _tryFire(dt) {
    const g = this.game, p = g.player;
    if (this.reloading > 0 || this.throwing || !p.alive) { this.burstLeft = 0; return; }
    let target = null, suppress = false;
    const peeking = this.order === 'cover' && this.coverPhase === 'peek';
    const hidden = this.order === 'cover' && this.coverPhase === 'hide';
    if (this.flashed > 0) {
      if (Math.random() < dt * 0.6) { target = _c.set(this.lastKnown.x + rand(-5, 5), 1.2, this.lastKnown.z + rand(-5, 5)); suppress = true; this.burstLeft = randInt(this.type.burst); }
      else if (this.burstLeft <= 0) return;
      else { target = _c.set(this.lastKnown.x + rand(-5, 5), 1.2, this.lastKnown.z + rand(-5, 5)); suppress = true; }
    } else if (this.seeing && g.time >= this.reactUntil && !hidden) {
      target = _c.copy(p.eye);
      const headChance = this.typeKey === 'marksman' ? 0.35 : 0.12;
      target.y -= Math.random() < headChance ? 0.08 : 0.4;
    } else if (peeking && g.time - this.lastSeen < 4 && this.typeKey !== 'marksman') {
      // suppressive fire at the last known position
      target = _c.set(this.lastKnown.x, this.lastKnown.y + 1.1, this.lastKnown.z);
      suppress = true;
      if (Math.random() < dt * 0.3) this.say('suppress');
    }
    if (!target) { this.burstLeft = 0; return; }
    const eye = this.eye(_a);
    const dx = target.x - eye.x, dz = target.z - eye.z;
    if (Math.abs(angleDiff(this.yaw + this.yawOff, Math.atan2(dx, dz))) > 0.45) return;
    if (suppress && !g.level.world.los(eye.x, eye.y, eye.z, target.x, target.y, target.z) && !this.flashed) {
      // don't waste rounds into the cover right in front of us
      const d = Math.hypot(dx, dz);
      const h = g.level.world.raycast(eye.x, eye.y, eye.z, dx / d, (target.y - eye.y) / d, dz / d, d, RAY_SIGHT);
      if (h && h.t < 3) return;
    }
    if (g.time < this.burstPauseUntil) return;
    if (this.burstLeft <= 0) this.burstLeft = randInt(this.type.burst) * (suppress ? 1 : 1);
    if (g.time < this.nextShot) return;
    // friendly fire check
    for (const e of this.mgr.list) {
      if (e === this || !e.alive) continue;
      const d = pointSegDist(e.pos.x, e.pos.y + 1.2, e.pos.z, eye.x, eye.y, eye.z, target.x, target.y, target.z);
      if (d < 0.7 && e.pos.distanceTo(this.pos) < eye.distanceTo(target)) { this.burstLeft = 0; this.burstPauseUntil = g.time + 0.5; return; }
    }
    this._fireAt(target, suppress);
    this.burstLeft--;
    this.nextShot = g.time + (60 / this.type.rpm) * rand(0.9, 1.15);
    if (this.burstLeft <= 0) this.burstPauseUntil = g.time + rand(...this.type.burstPause) * (suppress ? 1.6 : 1);
  }

  _fireAt(target, suppress) {
    const g = this.game, p = g.player, T = this.type, D = g.difficulty;
    const eye = this.eye(_a);
    const aim = _b.copy(target);
    const dist = eye.distanceTo(aim);
    if (!suppress) {
      // lead the target
      const tFlight = dist / T.velocity;
      aim.addScaledVector(p.vel, tFlight * 0.85);
    }
    const settle = 1 + 1.5 * Math.max(0, 1 - this.seeTime / 1.5);
    const moving = Math.hypot(this.vel.x, this.vel.z) > 1 ? 1.6 : 1;
    let err = T.spread * D.spread * (1 + dist / 40) * (1 + p.horizSpeed / 6) * moving * (1 + this.suppression * 0.6) * settle;
    if (suppress) err *= 2.2;
    if (this.flashed > 0) err *= 6;
    if (p.crouched && this.seeing) err *= 1.1;
    err *= 1 + Math.min(this.shotCount % 12, 8) * 0.04;
    const dir = aim.sub(eye).normalize();
    const pellets = T.pellets || 1;
    const muzzle = this.soldier.muzzleWorld(_c);
    // shoot from slightly in front of the eye so we don't hit our own cover lip
    const ox = eye.x + dir.x * 0.3, oy = eye.y - 0.05 + dir.y * 0.3, oz = eye.z + dir.z * 0.3;
    this.shotCount++;
    for (let i = 0; i < pellets; i++) {
      const d = jitter(dir, (err + (pellets > 1 ? 2.2 : 0)) * Math.PI / 180);
      g.ballistics.fire({
        owner: 'enemy', shooter: this, x: ox, y: oy, z: oz, dir: d, speed: T.velocity,
        damage: T.damage * D.dmg, tracer: T.tracer && i === 0 && (this.shotCount % T.tracer === 0), tracerFrom: muzzle.clone(),
      });
    }
    this.ammo--;
    if (this.ammo <= 0) this.startReload();
    this.soldier.muzzleFlash();
    this.lastFired = g.time;
    g.audio.playAt(`shot_${T.sound}_${(Math.random() * 3) | 0}`, muzzle.x, muzzle.y, muzzle.z, { vol: 1.15, ref: 6, travel: true, max: 400 });
    g.effects.enemyMuzzle(muzzle);
  }

  _updateHitboxes() {
    const s = this.soldier, hb = this.hb;
    s.root.updateMatrixWorld(true);
    s.headWorld(hb.head);
    hb.neck.setFromMatrixPosition(s.neck.matrixWorld);
    s.hipsWorld(hb.hips);
    s.kneeWorld('L', hb.kL); s.footWorld('L', hb.fL);
    s.kneeWorld('R', hb.kR); s.footWorld('R', hb.fR);
  }
}

function jitter(dir, halfAngle) {
  const r = Math.sqrt(Math.random()) * halfAngle, a = Math.random() * Math.PI * 2;
  const up = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u);
  return dir.clone().addScaledVector(u, Math.cos(a) * Math.tan(r)).addScaledVector(v, Math.sin(a) * Math.tan(r)).normalize();
}

// ---------------- manager / squad director ----------------
export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.squadLastSeen = -99;
    this.lastThrow = -99;
    this.playerReloadHeard = -99;
    this.lastRush = -99;
    this.lastFlank = -99;
    this.directorT = 0;
    this.intelT = 0;
    this.lineTimes = {};
  }

  get alive() { return this.list.filter((e) => e.alive); }
  aliveCount() { let n = 0; for (const e of this.list) if (e.alive) n++; return n; }

  spawn(typeKey, x, z, intel) {
    const e = new Enemy(this, typeKey, x, z);
    const p = this.game.player;
    // command gives them a rough idea where the player is
    const err = intel ?? 12;
    e.lastKnown.set(p.pos.x + rand(-err, err), 0, p.pos.z + rand(-err, err));
    e.yaw = Math.atan2(-x, -z);
    this.list.push(e);
    return e;
  }

  clear() {
    for (const e of this.list) e.soldier.dispose();
    this.list = [];
  }

  shareIntel(src) {
    const g = this.game;
    this.squadLastSeen = g.time;
    for (const e of this.list) {
      if (e === src || !e.alive || e.seeing) continue;
      if (e.pos.distanceTo(src.pos) > 45) continue; // radio range
      e.lastKnown.copy(src.lastKnown);
      e.lastSeen = Math.max(e.lastSeen, g.time - 1.5);
      if (e.alert < 2) { e.alert = 2; e.awareness = Math.max(e.awareness, 0.8); e.replan(); }
    }
  }

  onNoise(pos, radius, kind) {
    const W = this.game.level.world;
    for (const e of this.list) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (d > radius) continue;
      let r = radius;
      if (kind !== 'gunshot' && !W.los(e.pos.x, 1.6, e.pos.z, pos.x, pos.y + 0.5, pos.z)) r *= 0.5;
      if (d < r) e.hear(pos, kind, d);
    }
  }

  /** Bullet passing close by: suppression + alert. */
  nearMiss(e, fromPos) {
    if (!e.alive) return;
    e.suppression = Math.min(3, e.suppression + 0.6);
    if (e.alert < 2) { e.alert = 2; e.awareness = Math.max(e.awareness, 0.9); e.lastKnown.copy(fromPos); e.replan(); }
  }

  flashbang(pos, radius) {
    const W = this.game.level.world;
    for (const e of this.list) {
      if (!e.alive) continue;
      const eye = e.eye(_a);
      const d = eye.distanceTo(pos);
      if (d > radius) continue;
      if (!W.los(pos.x, pos.y + 0.1, pos.z, eye.x, eye.y, eye.z)) continue;
      const face = e.yaw + e.yawOff;
      const dx = pos.x - eye.x, dz = pos.z - eye.z;
      const facing = (dx * Math.sin(face) + dz * Math.cos(face)) / Math.max(0.01, Math.hypot(dx, dz));
      const k = (facing > 0.3 ? 1 : facing > -0.3 ? 0.55 : 0.25) * Math.min(1, 1.4 - d / radius);
      const dur = 5.5 * k;
      if (dur > 0.8) {
        e.flashed = Math.max(e.flashed, dur);
        e.seeing = false; e.awareness = 0; e.burstLeft = 0;
        e.throwing = null;
        e.say('flashed');
        e.replan();
      }
    }
  }

  canThrow() {
    const g = this.game;
    return g.time - this.lastThrow > 10 / g.difficulty.grenade;
  }

  searchers() { let n = 0; for (const e of this.list) if (e.alive && e.order === 'search') n++; return n; }

  squadAngle(T, except) {
    let sx = 0, sz = 0, n = 0;
    for (const e of this.list) {
      if (!e.alive || e === except || e.alert < 2) continue;
      const a = Math.atan2(e.pos.x - T.x, e.pos.z - T.z);
      sx += Math.sin(a); sz += Math.cos(a); n++;
    }
    return n ? Math.atan2(sx, sz) : null;
  }

  planRush() {
    // after a flashbang, the nearest teammates storm in
    const g = this.game;
    const cands = this.list.filter((e) => e.alive && e.typeKey !== 'marksman' && e.alert >= 2).sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos));
    for (const e of cands.slice(0, 2)) { e.role = 'rusher'; e.roleUntil = g.time + 5.5; e.replan(); }
    this.lastRush = g.time;
  }

  onDeath(e) {
    const g = this.game;
    // nearest living squadmate calls it out and everyone locks onto the player
    let near = null, nd = 35;
    for (const o of this.list) {
      if (!o.alive) continue;
      const d = o.pos.distanceTo(e.pos);
      if (d < nd) { nd = d; near = o; }
      if (d < 30 && o.alert < 2) { o.alert = 2; o.awareness = 0.9; o.lastKnown.copy(g.player.pos); o.replan(); }
    }
    if (near && Math.random() < 0.7) near.say('manDown');
    g.onEnemyKilled(e);
  }

  say(e, key) {
    const g = this.game, now = g.time;
    if (now - (this.lineTimes[key] || -99) < 5) return;
    if (now - (this.lineTimes._any || -99) < 1.2) return;
    const d = e.pos.distanceTo(g.player.pos);
    if (d > 60) return;
    this.lineTimes[key] = now; this.lineTimes._any = now;
    const line = pick(LINES[key]);
    g.hud.radio(e.type.name, line);
    if (d < 45) g.voices.say(line, e.voicePitch, 1.15, Math.max(0.15, 0.9 - d / 60));
  }

  update(dt) {
    for (const e of this.list) e.update(dt);
    // director
    this.directorT -= dt;
    if (this.directorT <= 0) { this.directorT = 1; this._direct(); }
    // cleanup old bodies
    const dead = this.list.filter((e) => !e.alive);
    if (dead.length > 10) {
      dead.sort((a, b) => b.deadT - a.deadT);
      const old = dead[0];
      old.soldier.dispose();
      this.list.splice(this.list.indexOf(old), 1);
    }
  }

  _direct() {
    const g = this.game, p = g.player;
    const combat = this.list.filter((e) => e.alive && e.alert >= 2 && e.flashed <= 0);
    // one flanker at a time when the squad is engaged
    if (combat.length >= 2 && g.time - this.lastFlank > 9) {
      const hasFlanker = combat.some((e) => e.role === 'flanker' && g.time < e.roleUntil);
      if (!hasFlanker) {
        const cands = combat.filter((e) => e.typeKey !== 'marksman' && e.typeKey !== 'heavy' && e.hp > e.type.hp * 0.5 && e.reloading <= 0 && !e.throwing);
        if (cands.length) {
          const e = pick(cands);
          e.role = 'flanker'; e.roleUntil = g.time + 22;
          e.replan();
          e.say('flank');
          this.lastFlank = g.time;
        }
      }
    }
    // exploit weakness: player reloading / blinded / badly hurt -> push
    const weak = g.time - this.playerReloadHeard < 2 || g.flashAmount > 0.5 || p.health < 35;
    if (weak && g.time - this.lastRush > 7) {
      const cands = combat.filter((e) => e.typeKey !== 'marksman' && e.pos.distanceTo(p.pos) < 28).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
      const n = g.difficulty.maxAlive >= 7 ? 2 : 1;
      for (const e of cands.slice(0, n)) { e.role = 'rusher'; e.roleUntil = g.time + 5; e.replan(); }
      if (cands.length) { cands[0].say('push'); this.lastRush = g.time; }
    }
    // HQ intel keeps the pressure on if the squad has lost the player for long
    this.intelT += 1;
    if (g.time - this.squadLastSeen > 18 && this.intelT > 15) {
      this.intelT = 0;
      for (const e of this.list) {
        if (!e.alive || e.seeing) continue;
        e.lastKnown.set(p.pos.x + rand(-7, 7), 0, p.pos.z + rand(-7, 7));
        e.alert = Math.max(e.alert, 1);
        if (e.order !== 'cover') { e.setOrder('investigate'); }
      }
    }
  }

  /** Bullet segment vs every enemy's hitboxes: returns nearest {enemy, t, part}. */
  intersect(ox, oy, oz, dx, dy, dz, maxT, ignore) {
    let best = null;
    for (const e of this.list) {
      if (!e.alive || e === ignore) continue;
      // broad phase: sphere around the body
      const cx = e.pos.x - ox, cy = e.pos.y + 1 - oy, cz = e.pos.z - oz;
      const tc = cx * dx + cy * dy + cz * dz;
      if (tc < -1.2 || tc > maxT + 1.2) continue;
      const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
      if (d2 > 1.44) continue;
      const hb = e.hb;
      const tests = [
        ['head', raySph(ox, oy, oz, dx, dy, dz, hb.head, 0.14)],
        ['torso', rayCap(ox, oy, oz, dx, dy, dz, hb.neck, hb.hips, 0.2)],
        ['limb', rayCap(ox, oy, oz, dx, dy, dz, hb.hips, hb.kL, 0.1)],
        ['limb', rayCap(ox, oy, oz, dx, dy, dz, hb.kL, hb.fL, 0.08)],
        ['limb', rayCap(ox, oy, oz, dx, dy, dz, hb.hips, hb.kR, 0.1)],
        ['limb', rayCap(ox, oy, oz, dx, dy, dz, hb.kR, hb.fR, 0.08)],
      ];
      for (const [part, t] of tests) {
        if (t >= 0 && t <= maxT && (!best || t < best.t)) best = { enemy: e, t, part };
      }
    }
    return best;
  }
}

function raySph(ox, oy, oz, dx, dy, dz, c, r) { return raySphere(ox, oy, oz, dx, dy, dz, c.x, c.y, c.z, r); }
function rayCap(ox, oy, oz, dx, dy, dz, a, b, r) { return rayCapsule(ox, oy, oz, dx, dy, dz, a.x, a.y, a.z, b.x, b.y, b.z, r); }
