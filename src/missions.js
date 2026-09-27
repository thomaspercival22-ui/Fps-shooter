// Scripted missions besides the endless compound defence:
//  - Tower: hostage rescue on floor 47 of an office tower. Hostiles are at
//    their posts (no waves), hostages are held at gunpoint and executed if the
//    assault is slow or loud, civilians hide among the desks.
//  - Overwatch: precision shooting from a ridge ~560 m from the compound.
//    Wind, a laser rangefinder, an elevation turret and a spotter; one high
//    value target who runs for the gate once he realises he is being hunted.
import * as THREE from 'three';
import { RAY_BULLET } from './physics.js';
import { Soldier } from './soldier.js';

export const MISSIONS = {
  compound: { name: 'Compound Defence', tag: 'Endless waves · hold the compound', level: 'compound' },
  tower: { name: 'Tower Hostage Rescue', tag: 'Floor 47 CQB · hostages & civilians · no waves', level: 'tower' },
  sniper: { name: 'Overwatch', tag: '550-650 m precision shots · wind · HVT', level: 'compound', primary: 'sniper' },
  chaos: { name: 'Chaos', tag: 'Cartoon mayhem · confetti guns · pies only', level: 'compound', chaos: true },
};

const rand = (a, b) => a + Math.random() * (b - a);
export const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const pick = (a) => a[(Math.random() * a.length) | 0];
const metres = (v) => (Math.abs(v) < 1 ? `${Math.round(Math.abs(v) * 100)} cm` : `${Math.abs(v).toFixed(1)} m`);

class Mission {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.over = false;
    this.endT = 0;
  }
  award(pts, label) {
    const g = this.game;
    g.score = Math.max(0, g.score + pts);
    g.hud.setScore(g.score);
    if (label) g.hud.killfeed(`<b>${label}</b> ${pts >= 0 ? '+' : '−'}${Math.abs(pts)}`);
  }
  end(success, title, sub) {
    if (this.over) return;
    this.over = true; this.success = success; this.endT = 4;
    this.game.hud.banner(title, sub, 4);
    this.game.audio.play('ui', { vol: 0.7 });
  }
  /** Counts down after the end banner, then hands the debrief to the game. */
  tick(dt) {
    if (!this.over) return;
    this.endT -= dt;
    if (this.endT <= 0 && this.game.state === 'playing') this.game.missionOver(this.debrief());
  }
  grade(points) {
    return points >= 95 ? 'S' : points >= 85 ? 'A' : points >= 70 ? 'B' : points >= 55 ? 'C' : points >= 40 ? 'D' : 'F';
  }
  accuracy() { const s = this.game.weapons.stats; return s.shots ? Math.round((s.hits / s.shots) * 100) : 0; }
}

// =====================================================================
export class TowerMission extends Mission {
  constructor(game) { super(game); this.kind = 'tower'; this.sightRange = 140; }

  start() {
    const g = this.game, sc = g.level.scenario;
    g.enemies.noIntel = true;
    // nobody expects an assault 47 floors up: they chat, notice slowly, and a shout only carries so far
    g.enemies.relaxed = true;
    g.enemies.shoutRange = 16;
    g.enemies.overhear = (e, text, kind) => this._overhear(e, text, kind);
    this.hostages = sc.hostages.map((h) => g.civilians.spawn({ ...h, hostage: true }));
    this.civs = sc.civilians.map((c) => g.civilians.spawn(c));
    const centre = (list) => list.reduce((a, q) => [a[0] + q.x / list.length, a[1] + q.z / list.length], [0, 0]);
    this.hostiles = sc.hostiles.map((h) => {
      let yaw = h.yaw;
      if (h.group) { const [cx, cz] = centre(sc.hostiles.filter((o) => o.group === h.group)); yaw = Math.atan2(cx - h.x, cz - h.z); }
      else if (yaw === 'hostages') { const [cx, cz] = centre(h.exec.map((i) => sc.hostages[i])); yaw = Math.atan2(cx - h.x, cz - h.z); }
      const e = g.enemies.spawnPlaced(h.type, h.x, h.z, { yaw, kit: h.type === 'heavy' ? 'heavy' : 'black', patrol: h.patrol, hold: !!h.exec });
      if (h.exec) e.exec = { list: h.exec.map((i) => this.hostages[i]), t: null };
      e.group = h.group || null;
      return e;
    });
    // conversation groups
    this.convos = Object.entries(sc.talk || {}).map(([name, lines]) => {
      const members = this.hostiles.filter((e, i) => sc.hostiles[i].group === name);
      const c = { name, members, lines, li: (Math.random() * lines.length) | 0, step: 0, t: 1.5 + Math.random() * 4 };
      for (const e of members) e.chat = c;
      return c;
    });
    this.exit = sc.exit;
    this.st = { rescued: 0, evacuated: 0, hostagesLost: 0, byPlayer: 0, civHurt: 0, civKilled: 0, executed: 0, arrested: 0, surrendered: 0, roe: 0 };
    this.hintT = 0;
    this.shoutCd = 0; this.pressT = 0;
    this.dangerWas = false;
    g.hud.banner('MERIDIAN TOWER · FLOOR 47', `Rescue ${this.hostages.length} hostages · ${this.hostiles.length} hostiles · watch your fire`, 5);
    g.hud.setObjective('FLOOR 47', this._line());
    g.hud.radio('TOC', 'Breach from stairwell A. Hostages in the boardroom, the CEO\'s office and the server room.');
    setTimeout(() => { if (this.game.mission === this && !this.over) g.hud.radio('TOC', 'Hostage takers will execute if they see you coming or if you miss. Flash the room, then one clean shot.'); }, 5000);
    setTimeout(() => { if (this.game.mission === this && !this.over) g.hud.radio('TOC', 'Suspects may give up. Get the drop on them and SHOUT (E): flashed, hurt or alone, most will drop it. Cuff anyone who surrenders.'); }, 14000);
  }

  _line() {
    const h = this.hostiles.filter((e) => e.alive && !e.surrendered).length;
    const b = this.hostages.filter((c) => c.alive && !c.rescued).length;
    return `HOSTILES ${h} · HOSTAGES ${b}${this.st.surrendered ? ` · ARRESTS ${this.st.arrested}/${this.st.surrendered}` : ''} · ${fmtTime(this.t)}`;
  }

  update(dt) {
    const g = this.game, p = g.player, W = g.level.world;
    if (!this.over && p.alive) this.t += dt;
    // hostage takers: once they know the assault is on they start killing their hostages; a missed
    // shot, a wound that doesn't drop them, or an operator getting too close makes them do it at once
    let danger = false;
    for (const e of this.hostiles) {
      if (!e.alive || !e.exec || e.surrendered) continue;
      const X = e.exec;
      const targets = X.list.filter((h) => h.alive && !h.rescued);
      if (!targets.length) continue;
      if (!X.provoked && p.alive) {
        const dP = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
        const toP = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z) - e.yaw;
        const facing = Math.cos(toP) > -0.2;
        const sees = dP < 8 && facing && W.los(e.pos.x, e.pos.y + 1.6, e.pos.z, p.eye.x, p.eye.y, p.eye.z);
        if (e.hp < e.type.hp || dP < 3.5 || sees) this._provoke(e, e.hp < e.type.hp ? 'wounded' : 'close');
      }
      if (e.alert < 2 && !X.provoked) continue;
      // gunfire elsewhere on the floor: he gets nervous, and sooner or later he will do it anyway
      if (X.t === null) X.t = rand(30, 45) * g.difficulty.react;
      if (X.provoked || X.t < 10) danger = true;
      if (e.flashed > 0) { X.t = Math.max(X.t, 2.2); continue; }   // a flashbang buys time
      if (e.reloading > 0 || e.throwing) continue;
      X.t -= dt;
      if (X.t <= 0) { this._execute(e, targets[0]); X.t = 1.3; }
    }
    this._talk(dt);
    this._pressure(dt);
    this.shoutCd = Math.max(0, this.shoutCd - dt);
    // cuffing: walk up to a suspect who gave up
    for (const e of this.hostiles) {
      if (!e.alive || !e.surrendered || e.cuffed || !p.alive) continue;
      if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) > 1.5) continue;
      e.cuff();
      this.st.arrested++;
      this.award(300, 'SUSPECT ARRESTED');
      g.hud.pickup('SUSPECT ARRESTED');
      g.audio.play('magIn', { vol: 0.7, rate: 1.4 });
    }
    if (danger && !this.dangerWas) g.audio.play('ui', { vol: 0.8, rate: 0.7 });
    this.dangerWas = danger;
    // cutting hostages loose: the room has to be clear
    this.hintT -= dt;
    for (const h of this.hostages) {
      if (!h.alive || h.rescued || !p.alive) continue;
      if (Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z) > 1.8) continue;
      const threat = this.hostiles.some((e) => e.alive && !e.surrendered && e.pos.distanceTo(h.pos) < 10
        && W.los(e.pos.x, e.pos.y + 1.5, e.pos.z, h.pos.x, h.pos.y + 1.0, h.pos.z));
      if (threat) { if (this.hintT <= 0) { g.hud.pickup('ROOM NOT CLEAR'); this.hintT = 2.5; } continue; }
      h.rescue(this.exit);
      this.st.rescued++;
      this.award(500, h.name === 'CEO' ? 'CEO SECURED' : 'HOSTAGE SECURED');
      g.hud.pickup(h.name === 'CEO' ? 'CEO SECURED' : 'HOSTAGE SECURED');
      g.audio.play('pickup', { vol: 0.9 });
    }
    // end conditions
    const hostilesLeft = this.hostiles.filter((e) => e.alive && !e.surrendered).length;
    const bound = this.hostages.filter((c) => c.alive && !c.rescued).length;
    const living = this.hostages.filter((c) => c.alive).length;
    if (!this.over && p.alive) {
      if (living === 0) this.end(false, 'MISSION FAILED', 'Every hostage is dead');
      else if (hostilesLeft === 0 && bound === 0) {
        const bonus = Math.max(0, Math.round((420 - this.t) * 4));
        if (bonus) this.award(bonus, 'TIME BONUS');
        this.end(true, 'FLOOR SECURE', `${this.st.rescued} of ${this.hostages.length} hostages rescued · ${fmtTime(this.t)}`);
      }
    }
    g.hud.setObjective('FLOOR 47', this._line(), danger ? 'HOSTAGE IN DANGER' : '');
    this.tick(dt);
  }

  /** Groups that don't know the assault is on keep talking; each exchange is a line and a reply. */
  _talk(dt) {
    for (const c of this.convos) {
      const m = c.members.filter((e) => e.alive && !e.surrendered);
      if (m.length < 2 || m.some((e) => e.alert >= 2 || e.suspicious)) { c.speaker = null; continue; }
      c.t -= dt;
      if (c.t > 0) continue;
      const pair = c.lines[c.li % c.lines.length];
      const e = m[c.step % m.length], text = pair[c.step];
      c.speaker = e;
      e.talkT = 1.2 + text.length * 0.05;
      this._overhear(e, text, 'talk');
      c.step++;
      if (c.step >= pair.length) { c.step = 0; c.li++; c.t = e.talkT + 6 + Math.random() * 7; }
      else c.t = e.talkT + 0.4 + Math.random() * 0.6;
    }
  }
  /** A hostile speaks: a muffled voice from where he stands, and the words if the player is in earshot. */
  _overhear(e, text, kind = 'talk') {
    const g = this.game, p = g.player, W = g.level.world;
    const shout = kind === 'shout';
    g.audio.playAt(`${shout ? 'shout' : 'murmur'}${(Math.random() * 3) | 0}`, e.pos.x, e.pos.y + 1.6, e.pos.z, { vol: shout ? 0.9 : 0.5, ref: 2, max: shout ? 40 : 22 });
    const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
    const clear = W.los(e.pos.x, e.pos.y + 1.6, e.pos.z, p.eye.x, p.eye.y, p.eye.z);
    const range = (shout ? 30 : 13) * (clear ? 1 : 0.45);
    if (p.alive && d < range) g.hud.overheard(text, shout);
  }

  /** How likely a suspect is to give up right now (0-1): flashed, hurt, alone, caught at close range. */
  _giveUpChance(e, shouted) {
    const g = this.game, p = g.player;
    const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
    let c = shouted ? 0.2 : 0;
    if (e.flashed > 0) c += 0.5;
    if (e.hp < e.type.hp * 0.6) c += 0.25;
    if (d < 5) c += 0.15;
    if (!e.seeing) c += 0.15;                                   // caught unawares
    // the player's muzzle is on him
    const f = _v.set(0, 0, -1).applyQuaternion(g.camera.quaternion), to = _w.set(e.pos.x, e.pos.y + 1.2, e.pos.z).sub(g.camera.position);
    if (f.dot(to.normalize()) > Math.cos(0.14)) c += 0.2;
    const mates = this.hostiles.filter((o) => o !== e && o.alive && !o.surrendered && ((e.group && o.group === e.group) || o.pos.distanceTo(e.pos) < 8)).length;
    if (!mates) c += 0.15; else c -= 0.1 * Math.min(2, mates);
    if (e.exec) c += e.exec.provoked ? -0.15 : 0.05;
    if (e.typeKey === 'heavy') c -= 0.15;
    return Math.max(0, Math.min(0.95, c * (g.difficulty.react || 1)));
  }
  /** SHOUT: "Police! Drop the weapon!" Everyone who can hear it clearly weighs it up; refusing means he knows where you are. */
  onShout() {
    const g = this.game, p = g.player, W = g.level.world;
    if (this.over || !p.alive || this.shoutCd > 0) return;
    this.shoutCd = 1.3;
    g.audio.playAt(`shout${(Math.random() * 3) | 0}`, p.eye.x, p.eye.y, p.eye.z, { vol: 1, ref: 3, max: 30 });
    g.hud.pickup(['POLICE! DROP THE WEAPON!', 'POLICE! GET ON THE GROUND!', 'DROP IT! HANDS WHERE I CAN SEE THEM!'][(Math.random() * 3) | 0]);
    for (const e of this.hostiles) {
      if (!e.alive || e.surrendered) continue;
      const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
      const clear = W.los(p.eye.x, p.eye.y, p.eye.z, e.pos.x, e.pos.y + 1.6, e.pos.z);
      if (d > (clear ? 16 : 6)) continue;
      if (Math.random() < this._giveUpChance(e, true)) { e.surrender('shout'); continue; }
      // refuses: he knows where you are now
      e.alert = 2; e.awareness = Math.max(e.awareness, 1); e.lastKnown.copy(p.pos); e.lastSeen = g.time; e.replan();
      if (e.exec && e.flashed <= 0 && clear) this._provoke(e, 'close');
      if (Math.random() < 0.6) this._overhear(e, ['Screw you!', 'Back off or they die!', 'Never!'][(Math.random() * 3) | 0], 'shout');
    }
  }
  /** Without a word: a suspect flashed or badly hurt with you right on him may give up anyway. */
  _pressure(dt) {
    const g = this.game, p = g.player, W = g.level.world;
    this.pressT -= dt;
    if (this.pressT > 0 || !p.alive) return;
    this.pressT = 0.5;
    for (const e of this.hostiles) {
      if (!e.alive || e.surrendered || (e.exec && e.exec.provoked && e.flashed <= 0)) continue;
      const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
      if (d > 7 || (e.flashed <= 0 && e.hp > e.type.hp * 0.45)) continue;
      if (!W.los(p.eye.x, p.eye.y, p.eye.z, e.pos.x, e.pos.y + 1.2, e.pos.z)) continue;
      if (Math.random() < this._giveUpChance(e, false) * 0.25) e.surrender('pressure');
    }
  }
  onSurrender(e) {
    const g = this.game;
    this.st.surrendered++;
    this._overhear(e, ['Don\'t shoot! Don\'t shoot!', 'Okay, okay! I give up!', 'I\'m down! I\'m down!', 'Don\'t shoot, I\'m unarmed!'][(Math.random() * 4) | 0], 'shout');
    this.award(200, 'SUSPECT SURRENDERED');
    g.hud.pickup('SUSPECT SURRENDERED · CUFF HIM');
  }
  /** Shooting a suspect who has given up breaks the rules of engagement. */
  onSurrenderedShot(e) {
    const g = this.game;
    this.st.roe++;
    this.award(-800, 'SURRENDERED SUSPECT SHOT');
    g.hud.banner('SURRENDERED SUSPECT SHOT', 'Rules of engagement violated', 2.5);
  }

  /** Something tipped the hostage taker off: he kills a hostage within a heartbeat. */
  _provoke(e, why) {
    const X = e.exec;
    if (!X || X.provoked || !e.alive) return;
    X.provoked = true;
    e.alert = 2; e.awareness = Math.max(e.awareness, 1);
    const react = rand(0.3, 0.55) * this.game.difficulty.react;
    X.t = X.t === null ? react : Math.min(X.t, react);
    this.game.hud.pickup(why === 'miss' ? 'MISSED · HOSTAGE IN DANGER' : why === 'wounded' ? 'SUSPECT STILL UP' : 'HE HAS SEEN YOU');
  }
  /** A round cracking past or landing near a hostage taker or his hostages sets him off. */
  onImpact(pt) {
    for (const e of this.hostiles) {
      if (!e.alive || !e.exec || e.exec.provoked) continue;
      const near = Math.hypot(pt.x - e.pos.x, pt.z - e.pos.z) < 4 || e.exec.list.some((h) => h.alive && Math.hypot(pt.x - h.pos.x, pt.z - h.pos.z) < 3);
      if (near) this._provoke(e, 'miss');
    }
  }
  onNearMiss(e) { if (e.exec) this._provoke(e, 'miss'); }

  /** The hostage taker turns on a hostage and fires. */
  _execute(e, h) {
    const g = this.game;
    e.yaw = Math.atan2(h.pos.x - e.pos.x, h.pos.z - e.pos.z);
    e.yawOff = 0;
    e.soldier.yaw = e.yaw;
    e.soldier.root.updateMatrixWorld(true);
    const eye = e.eye(_v);
    const muzzle = e.soldier.muzzleWorld(new THREE.Vector3());
    for (let i = 0; i < 2; i++) {
      const tgt = _w.copy(h.hb.head).add(new THREE.Vector3(rand(-0.04, 0.04), rand(-0.12, 0.02), rand(-0.04, 0.04)));
      const dir = tgt.sub(eye).normalize();
      g.ballistics.fire({ owner: 'enemy', shooter: e, x: eye.x + dir.x * 0.3, y: eye.y - 0.05 + dir.y * 0.3, z: eye.z + dir.z * 0.3, dir, speed: e.type.velocity, damage: 90, tracerFrom: muzzle });
    }
    e.soldier.muzzleFlash();
    e.lastFired = g.time;
    g.audio.playGunshotAt(e.type.sound, muzzle.x, muzzle.y, muzzle.z, { vol: 1.15, ref: 6, travel: true, max: 1000, wet: 1 });
    g.effects.enemyMuzzle(muzzle);
    g.enemies.onNoise(e.pos, 60, 'gunshot');
    g.civilians.onNoise(e.pos, 60, 'gunshot');
  }

  onCivilianHurt(c, source) {
    if (source !== 'player' || !c.alive) return;
    this.st.civHurt++;
    this.award(-250, c.hostage ? 'HOSTAGE HIT' : 'CIVILIAN HIT');
  }
  onCivilianKilled(c, source) {
    const g = this.game;
    if (c.hostage) {
      this.st.hostagesLost++;
      if (source === 'player') { this.st.byPlayer++; this.award(-1500, 'HOSTAGE KILLED'); g.hud.banner('HOSTAGE KILLED', 'Check your fire', 2.5); }
      else { this.st.executed++; g.hud.banner('HOSTAGE EXECUTED', '', 2.2); }
    } else {
      this.st.civKilled++;
      if (source === 'player') { this.st.byPlayer++; this.award(-1000, 'CIVILIAN KILLED'); g.hud.banner('CIVILIAN KILLED', 'Rules of engagement violated', 2.5); }
    }
  }
  onEvacuated() { this.st.evacuated++; }
  onEnemyKilled() {}

  debrief() {
    const s = this.st, g = this.game;
    const killed = this.hostiles.filter((e) => !e.alive).length;
    let pts = 100 - s.hostagesLost * 22 - s.byPlayer * 30 - s.civHurt * 8 - s.roe * 25 - Math.max(0, (this.t - 300) / 12) + Math.min(10, this.accuracy() / 8) + s.arrested * 3;
    if (!this.success) pts = Math.min(pts, 35);
    const grade = this.grade(pts);
    return {
      mission: 'tower', success: !!this.success, title: this.success ? 'FLOOR SECURE' : 'MISSION FAILED', grade,
      score: g.score,
      rows: [
        ['Result', this.success ? '<span class="hl">Complete</span>' : 'Failed'], ['Grade', `<span class="hl">${grade}</span>`],
        ['Time', fmtTime(this.t)], ['Hostages rescued', `${s.rescued} / ${this.hostages.length}`],
        ['Hostiles neutralised', `${killed + s.surrendered} / ${this.hostiles.length}`], ['Suspects arrested', `${s.arrested} / ${s.surrendered}`],
        ['Civilians harmed', s.civHurt + s.civKilled], ['Surrendered suspects shot', s.roe],
        ['Accuracy', `${this.accuracy()}%`], ['Score', `<span class="hl">${g.score}</span>`],
      ],
    };
  }
}

// =====================================================================
export class SniperMission extends Mission {
  constructor(game) {
    super(game);
    this.kind = 'sniper';
    this.sightRange = 900;
    this.exposure = 0;
  }

  /** Hostiles far away only find the hide by the muzzle blast and dust of repeated shots. */
  sightMul(dist, firing) { return dist < 140 ? 1 : firing ? 0.5 * this.exposure : 0; }
  /** Rifle fire from the compound at 600 m: close enough to crack past, rarely a hit. */
  enemyErrMul(dist) { return dist > 150 ? 0.1 : 1; }

  start() {
    const g = this.game, L = g.level, sc = L.sniper;
    this.hide = sc.hide;
    this.resupply = { x: sc.hide.x + sc.ammo[0], z: sc.hide.z + sc.ammo[1], r: 0.9, frags: 0, flashes: 0, drones: 1 };
    g.enemies.noIntel = true;
    g.enemies.farThreat = new THREE.Vector3(sc.hide.x, sc.hide.y, sc.hide.z);
    this.hostiles = sc.hostiles.map((h) => {
      const e = g.enemies.spawnPlaced(h.type, h.x, h.z, { yaw: h.yaw, patrol: h.patrol, hold: !!h.hold });
      if (h.y) { e.pos.y = h.y; e.soldier.setPosition(h.x, h.y, h.z); }
      if (h.bodyguard) e.bodyguard = true;
      return e;
    });
    this.guards = this.hostiles.filter((e) => e.bodyguard);
    // the spotter kneels at the parapet beside the shooter, on his spotting scope
    const hy = sc.hide.yaw, fx = -Math.sin(hy), fz = -Math.cos(hy), rx = Math.cos(hy), rz = -Math.sin(hy);
    this.spotter = new Soldier(g.scene, 'tan', 'rifle');
    this.spotter.setPosition(sc.hide.x + rx * 1.45 + fx * 0.35, sc.hide.y, sc.hide.z + rz * 1.45 + fz * 0.35);
    this.spotter.yaw = Math.atan2(fx, fz);
    this.spotterAlive = true;
    this.calls = [];
    // the counter-sniper on the guard house roof: once shooting starts he hunts for the hide
    this.marksman = this.hostiles.find((e) => e.typeKey === 'marksman') || null;
    this.counterT = null; this.counterShots = 0; this.nextCounterShot = 0; this.spotterDeathAt = -1;
    this.pendingSpot = null;
    this.nextWindCall = 45;
    this.hvt = g.civilians.spawn({ ...sc.hvt, name: 'HVT' });
    this.hvt.hvt = true;
    this.hvt.route = sc.hvt.route; this.hvt.routeI = 0; this.hvt.escapeTo = sc.hvt.escape;
    this.workers = sc.workers.map((c) => g.civilians.spawn(c));
    for (const w of this.workers) if (w.route) w.routeI = 0;
    this.st = { hvtKilled: false, escaped: false, civKilled: 0, civHurt: 0, first: 0, shots: 0, longest: 0 };
    this.hvtDownT = -1;
    this.limit = 420;
    // wind: a steady breeze with slow gusts
    this.windDir = Math.random() * Math.PI * 2;
    this.windBase = rand(2.0, 6.5);
    this.wind = new THREE.Vector3();
    this._updateWind(0);
    g.weapons.frags = 0; g.weapons.flashes = 0;
    g.drone.count = 1;
    g.hud.banner('OPERATION OVERWATCH', 'Eliminate the HVT before he leaves the compound', 5);
    g.hud.setObjective('OVERWATCH', this._line());
    const rng = Math.round(Math.hypot(sc.hide.x, sc.hide.z) / 10) * 10;
    this.say(`HVT is the grey-haired man in the grey suit, near the HQ building. Compound centre ${rng} m.`, 1.5);
    this.say(`Wind ${this.windBase.toFixed(1)} m/s from ${this._clock()}. Lase your target, dial the range, hold for wind. I'll call your shots.`, 6);
    this.say('Careful: they have a marksman. Once we start shooting, the clock is running.', 12, () => this.counterT === null);
  }

  /** Radio from the spotter after a delay (paused with the game; silent once he is down). */
  say(text, delay = 0.5, cond = null, fx = null) { this.calls.push({ t: this.t + delay, text, cond, fx }); }
  _radio(dt) {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i];
      if (this.t < c.t) continue;
      this.calls.splice(i, 1);
      if (this.spotterAlive && (!c.cond || c.cond())) { if (c.text) this.game.hud.radio('SPOTTER', c.text); c.fx?.(); }
    }
  }
  /** Clock direction the wind blows from, seen from the hide looking at the compound. */
  _clock() {
    const fwdA = Math.atan2(-Math.sin(this.hide.yaw), -Math.cos(this.hide.yaw)), fromA = Math.atan2(-this.wind.x, -this.wind.z);
    let rel = fromA - fwdA; while (rel < 0) rel += Math.PI * 2;
    return `${((Math.round((Math.PI * 2 - rel) / (Math.PI / 6)) + 11) % 12) + 1} o'clock`;
  }

  dispose() { this.spotter?.dispose(); this.game.hud.scopeMark(null); }

  _line() {
    const h = this.hostiles.filter((e) => e.alive).length;
    const left = Math.max(0, this.limit - this.t);
    return `${this.st.hvtKilled ? 'HVT DOWN' : 'HVT ALIVE'} · HOSTILES ${h} · SPOTTER ${this.spotterAlive ? 'OK' : 'KIA'} · ${fmtTime(left)}`;
  }

  _updateWind() {
    const g = this.game, T = g.time;
    const gust = 1 + 0.28 * Math.sin(T * 0.21) + 0.14 * Math.sin(T * 0.67 + 1.3);
    const dirW = this.windDir + 0.18 * Math.sin(T * 0.05);
    this.windSpeed = this.windBase * gust;
    this.wind.set(Math.sin(dirW) * this.windSpeed, 0, Math.cos(dirW) * this.windSpeed);
    g.ballistics.wind.copy(this.wind);
  }

  update(dt) {
    const g = this.game, p = g.player;
    if (!this.over && p.alive) this.t += dt;
    this._updateWind(dt);
    this.exposure = Math.max(0, this.exposure - dt * 0.012);
    this._updateHVT(dt);
    this._escort();
    this._radio(dt);
    this._updateSpotter(dt);
    this._counterSnipe(dt);
    if (this.spotterAlive && this.t > this.nextWindCall) {
      this.nextWindCall = this.t + 40 + Math.random() * 20;
      this.say(`Wind check: ${this.windSpeed.toFixed(1)} m/s from ${this._clock()}.`, 0);
    }
    for (const w of this.workers) this._walkRoute(w, dt, 1.1);
    // end conditions
    const alive = this.hostiles.filter((e) => e.alive).length;
    if (!this.over && p.alive) {
      if (this.st.escaped) this.end(false, 'HVT ESCAPED', 'He made it out of the compound');
      else if (this.st.hvtKilled && alive === 0) this.end(true, 'MISSION COMPLETE', 'HVT and his security detail eliminated');
      else if (this.st.hvtKilled && this.t - this.hvtDownT > 75) this.end(true, 'EXFIL', `HVT eliminated · ${alive} hostiles left behind`);
      else if (this.t >= this.limit) this.end(!!this.st.hvtKilled, this.st.hvtKilled ? 'EXFIL' : 'TIME UP', this.st.hvtKilled ? 'Time to go' : 'The HVT is still alive');
    }
    // shadows: sharpest where the scope looks
    this._shadowFocus();
    const warn = !this.spotterAlive && this.marksman?.alive ? 'MARKSMAN ON YOU · SPOTTER DOWN'
      : this.counterT !== null && this.marksman?.alive ? (this.counterT < 20 ? 'MARKSMAN HAS YOUR POSITION' : 'MARKSMAN SEARCHING')
        : this.exposure >= 0.9 ? 'POSITION COMPROMISED' : '';
    g.hud.setObjective('OVERWATCH', this._line(), warn);
    this.tick(dt);
  }

  _walkRoute(c, dt, speed) {
    if (!c.alive || !c.route || c.state === 'cower' || c.state === 'flee' || c.state === 'escape' || c.gone) return;
    if (c.state === 'stand' && (c.waitT = (c.waitT || 0) - dt) > 0) return;
    if (!c.path || c.pathIdx >= c.path.length) {
      if (c.state === 'walk') { c.state = 'stand'; c.waitT = rand(4, 10); return; }
      const pt = c.route[c.routeI % c.route.length];
      c.routeI++;
      c.path = this.game.level.nav.findPath(c.pos.x, c.pos.z, pt[0], pt[1]);
      c.pathIdx = 0;
      c.state = 'walk';
      c.walkSpeed = speed;
    }
  }

  _updateHVT(dt) {
    const h = this.hvt;
    if (!h.alive || h.gone) return;
    if (h.state === 'escape') {
      if (!h.path || h.pathIdx >= h.path.length) {
        h.escapeWait = (h.escapeWait || 0) + dt;
        if (h.escapeWait > 1.5) { h.gone = true; h.root.visible = false; this.st.escaped = true; }
      }
      return;
    }
    this._walkRoute(h, dt, 1.2);
  }

  /** The bodyguards walk a couple of metres behind the HVT until something happens. */
  _escort() {
    const h = this.hvt;
    this.guards.forEach((e, i) => {
      if (!e.alive || e.alert > 0 || !h.alive || h.gone) return;
      const s = i ? 1 : -1, c = Math.cos(h.yaw), sn = Math.sin(h.yaw);
      const tx = h.pos.x - sn * 1.8 + c * s * 1.3, tz = h.pos.z - c * 1.8 - sn * s * 1.3;
      const P = e.post;
      if (Math.hypot(P.x - tx, P.z - tz) > 1.2) { P.x = tx; P.z = tz; e.path = null; }
      P.yaw = h.yaw + s * 0.6;
    });
  }

  /** Alarm people near where a round landed or someone fell. */
  _alarmAt(pos, r) {
    const g = this.game;
    for (const c of g.civilians.list) {
      if (!c.alive || c.gone) continue;
      if (Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z) > r) continue;
      if (c === this.hvt) this._hvtRun();
      else { c.route = null; c.alarm(pos, 1.2); }
    }
    for (const e of g.enemies.list) {
      if (!e.alive || Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) > r + 8) continue;
      if (e.alert < 2) { e.alert = 2; e.awareness = Math.max(e.awareness, 0.8); e.lastKnown.copy(g.enemies.farThreat); e.replan(); }
    }
  }
  _hvtRun() {
    const h = this.hvt, g = this.game;
    if (!h.alive || h.state === 'escape') return;
    h.state = 'escape'; h.stateT = 0;
    h.path = g.level.nav.findPath(h.pos.x, h.pos.z, h.escapeTo.x, h.escapeTo.z);
    h.pathIdx = 0;
    h.walkSpeed = 4.6;
    this.say('HVT is running for the west gate! Take the shot!', 0);
  }

  onPlayerShot() {
    const g = this.game;
    this.st.shots++;
    this.exposure = Math.min(1.5, this.exposure + 0.3);
    // the muzzle blast gives the hide away: start (and speed up) the marksman's hunt
    if (this.counterT === null) this.counterT = 48 * g.difficulty.react;
    else this.counterT -= 4;
    // who was on the reticle? the spotter follows that round
    const cam = g.camera, o = cam.position, f = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    // the reticle at the moment of the shot, to plot the splash against
    const aim = { o: o.clone(), f: f.clone(), r: new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), u: new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion) };
    let best = null, bestA = 0.009;
    const consider = (who, kind) => {
      const c = who.hb.neck.clone().lerp(who.hb.hips, 0.45).sub(o);
      const R = c.length(), D = f.dot(c), a = Math.acos(Math.min(1, D / R));
      if (a < bestA) { bestA = a; best = { target: who, kind, R, D, aim, hit: null, splash: null, tgt: null, struck: false, zero: g.weapons.zero } };
    };
    for (const e of g.enemies.list) if (e.alive) consider(e, 'enemy');
    for (const c of g.civilians.list) if (c.alive && !c.gone) consider(c, c.hvt ? 'hvt' : 'civ');
    this.pendingSpot = best;
    g.hud.scopeMark('stale');
  }
  /** Ballistics picks up the spotting job for the next player round. */
  takeSpot() { const s = this.pendingSpot; this.pendingSpot = null; return s; }

  /** The spotter's call once the round has landed. */
  onShotResult(s) {
    if (!this.spotterAlive || this.over) return;
    const g = this.game, m = this._mils(s.aim, s.splash);
    const mark = (kind, label) => () => g.hud.scopeMark({ x: m.x, y: m.y, kind, label });
    if (s.hit) {
      const civ = !s.hit.who.hvt && g.civilians.list.includes(s.hit.who);
      if (s.hit.who !== s.target) { this.say(s.hit.who.hvt ? 'You hit the HVT!' : s.hit.who.alive === false ? 'You dropped the man next to him.' : 'You hit the man next to him.', 0.7, null, mark(civ ? 'civ' : 'hit', civ ? 'CIVILIAN' : s.hit.who.hvt ? 'HVT HIT' : 'WRONG MAN')); return; }
      if (s.kind === 'enemy') this.say(s.hit.killed ? pick(['Hit. Target down.', 'Good hit, he\'s down.', 'Centre mass. Target down.']) : 'Hit. He\'s still moving, send another.', 0.7, null, mark('hit', 'HIT'));
      else this.say(null, 0.7, null, mark(civ ? 'civ' : 'hit', civ ? 'CIVILIAN' : 'HVT HIT'));
      return;
    }
    // the miss, measured at the target's range: splash against where he was as the round arrived
    const t = this._mils(s.aim, s.tgt), R = s.tgt.distanceTo(s.aim.o), dx = m.x - t.x, dy = m.y - t.y;
    const hi = dy * R / 1000, rt = dx * R / 1000, short = s.struck && s.aim.f.dot(_w.copy(s.splash).sub(s.aim.o)) < s.D - 2;
    if (Math.hypot(dx, dy) > 12) {
      const dial = Math.round(s.R / 50) * 50;
      this.say(`Way off, I lost the splash. Target is ${Math.round(s.R)} m, you're dialled for ${s.zero}.${Math.abs(dial - s.zero) >= 50 ? ` Dial ${dial}.` : ''}`, 0.8, null, () => g.hud.scopeMark(null));
      return;
    }
    const miss = [];
    if (Math.abs(hi) > 0.08) miss.push(`${metres(hi)} ${hi > 0 ? 'high' : 'low'}`);
    if (Math.abs(rt) > 0.08) miss.push(`${metres(rt)} ${rt > 0 ? 'right' : 'left'}`);
    // where the round went on the reticle: the dot he marks is the hold for the next one
    const where = [], tag = [];
    if (Math.abs(m.y) >= 0.1) { where.push(`${Math.abs(m.y).toFixed(1)} mil ${m.y > 0 ? 'high' : 'low'}`); tag.push(`${Math.abs(m.y).toFixed(1)} ${m.y > 0 ? 'HIGH' : 'LOW'}`); }
    if (Math.abs(m.x) >= 0.1) { where.push(`${Math.abs(m.x).toFixed(1)} mil ${m.x > 0 ? 'right' : 'left'}`); tag.push(`${Math.abs(m.x).toFixed(1)} ${m.x > 0 ? 'RIGHT' : 'LEFT'}`); }
    const label = tag.length ? tag.join(' · ') : 'ON CROSSHAIR';
    let text;
    if (short && miss.length < 2 && Math.hypot(dx, dy) < 1.5) text = `Miss, ${miss.length ? `${miss[0]}, ` : ''}you hit the cover in front of him. Wait for a clear shot.`;
    else if (!miss.length) text = 'Just missed him, a hair off. Same hold, send it.';
    else if (!where.length) text = `Miss, ${miss.join(', ')}. Round went right where your crosshair was, fix your hold.`;
    else if (!this.markedOnce) text = `Miss, ${miss.join(', ')}. I've marked your splash on the reticle, ${where.join(', ')}. Put that dot on him and send it.`;
    else text = `Miss, ${miss.join(', ')}. Splash ${where.join(', ')}. Hold the dot on him.`;
    this.markedOnce = true;
    this.say(text, 0.8, null, mark('miss', label));
  }

  /** A point seen through the scope: mils right and up of where the crosshair sat when the shot broke. */
  _mils(a, pt) {
    const p = _v.copy(pt).sub(a.o), z = Math.max(1e-3, p.dot(a.f));
    return { x: Math.atan2(p.dot(a.r), z) * 1000, y: Math.atan2(p.dot(a.u), z) * 1000 };
  }

  _updateSpotter(dt) {
    const g = this.game, s = this.spotter;
    if (this.spotterAlive) {
      const P = s.pose;
      P.crouch = 1; P.aim = 0.1; P.pitch = -0.08; P.yawOff = Math.sin(g.time * 0.27) * 0.12;
      s.move.speed = 0;
      if (this.spotterDeathAt > 0 && this.t >= this.spotterDeathAt) this._killSpotter();
    }
    s.update(dt, g.level.world, g.camera.position);
  }
  _killSpotter() {
    const g = this.game, m = this.marksman;
    this.spotterAlive = false;
    g.hud.scopeMark(null);
    this.calls.length = 0;
    const from = m ? m.pos : g.enemies.farThreat;
    const dx = this.spotter.root.position.x - from.x, dz = this.spotter.root.position.z - from.z, l = Math.hypot(dx, dz) || 1;
    this.spotter.die(dx / l, dz / l, true);
    g.effects.bloodPuff(this.spotter.root.position.clone().add(new THREE.Vector3(0, 1.0, 0)), new THREE.Vector3(dx / l, 0, dz / l), 1.2);
    g.audio.play('imp_flesh0', { vol: 0.9 });
    g.hud.banner('SPOTTER DOWN', 'Marksman on the guard house roof — you are on your own', 3.5);
    this.st.spotterKilled = true;
    this.award(-500, 'SPOTTER KILLED');
  }

  /** The rooftop marksman looks for the hide, then shoots the spotter and walks his rounds onto the shooter. */
  _counterSnipe(dt) {
    const g = this.game, m = this.marksman;
    if (!m || this.counterT === null || this.over) return;
    if (!m.alive) {
      if (!this.marksmanCalled) { this.marksmanCalled = true; this.say('Marksman down. Good shot, he was looking right at us.', 0.6); }
      return;
    }
    this.counterT -= dt;
    m.alert = 2; m.lastKnown.copy(g.enemies.farThreat); m.lastSeen = g.time;
    if (m.soldier.glint) m.soldier.glint.visible = this.counterT < 20 && Math.sin(g.time * 7) > -0.3;
    if (this.counterT < 20 && !this.warned) { this.warned = true; this.say('Scope glint on the guard house roof, left of the HQ! He\'s on us, take him out!', 0); }
    if (this.counterT > 0 || g.time < this.nextCounterShot || m.flashed > 0 || m.reloading > 0) return;
    this.nextCounterShot = g.time + rand(5.5, 8.5) * g.difficulty.react;
    const p = g.player;
    if (this.spotterAlive) {
      const tgt = this.spotter.root.position.clone().add(new THREE.Vector3(0, 0.95, 0));
      const tof = this._marksmanShot(tgt, this.counterShots === 0 ? 1.6 : 0.05);
      if (this.counterShots === 0) this.say('Rounds on our position! That was close!', tof + 0.4);
      else this.spotterDeathAt = this.t + tof;
    } else {
      // walking his fire in on the shooter's head, the only part showing over the sandbags
      const err = Math.max(0.1, 1.4 - (this.counterShots - 2) * 0.42);
      this._marksmanShot(new THREE.Vector3(p.eye.x, p.eye.y - 0.06, p.eye.z), err, 150);
    }
    this.counterShots++;
  }
  _marksmanShot(target, err, damage = 0) {
    const g = this.game, m = this.marksman, T = m.type;
    const eye = m.eye(new THREE.Vector3());
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * err;
    const aim = target.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.8, Math.sin(a + 1) * r * 0.5));
    const dist = eye.distanceTo(aim), tof = dist / T.velocity, w = g.ballistics.wind;
    aim.y += 4.9 * tof * tof;                                   // he holds for drop...
    aim.x -= 0.5 * w.x * 0.55 * tof * tof; aim.z -= 0.5 * w.z * 0.55 * tof * tof; // ...and for the wind
    const dir = aim.sub(eye).normalize();
    m.yaw = Math.atan2(dir.x, dir.z);
    const muzzle = m.soldier.muzzleWorld(new THREE.Vector3());
    g.ballistics.fire({ owner: 'enemy', shooter: m, x: eye.x + dir.x * 0.4, y: eye.y + dir.y * 0.4, z: eye.z + dir.z * 0.4, dir, speed: T.velocity, damage: (damage || T.damage * 1.6) * g.difficulty.dmg, tracer: true, tracerFrom: muzzle });
    m.soldier.muzzleFlash(); m.lastFired = g.time;
    g.audio.playGunshotAt(T.sound, muzzle.x, muzzle.y, muzzle.z, { vol: 1.3, ref: 6, travel: true, max: 1200, wet: 1 });
    g.effects.enemyMuzzle(muzzle);
    return tof;
  }
  onImpact(pt) { this._alarmAt(pt, 18); }
  onEnemyKilled(e) {
    this._alarmAt(e.pos, 28);
    this.st.longest = Math.max(this.st.longest, e.pos.distanceTo(this.game.player.pos));
  }
  onCivilianHurt(c, source) {
    if (c === this.hvt) return;
    if (source === 'player' && c.alive) { this.st.civHurt++; this.award(-250, 'CIVILIAN HIT'); }
  }
  onCivilianKilled(c, source) {
    const g = this.game;
    if (c === this.hvt) {
      this.st.hvtKilled = true;
      this.hvtDownT = this.t;
      const d = Math.round(c.pos.distanceTo(g.player.pos));
      this.award(1000 + d, `HVT ELIMINATED · ${d} m`);
      g.hud.banner('HVT DOWN', `${d} m · hostiles are looking for you`, 3);
      this.say('Good hit. HVT is down. Clean up the security detail or we exfil in 75 seconds.', 0.6);
      this._alarmAt(c.pos, 40);
      return;
    }
    if (source === 'player') { this.st.civKilled++; this.award(-1000, 'CIVILIAN KILLED'); g.hud.banner('CIVILIAN KILLED', 'Positive identification before every shot', 2.5); }
  }

  /** Laser rangefinder + spotter's call: range, dial, wind hold (mils). */
  lase() {
    const g = this.game, cam = g.camera;
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const o = cam.position;
    const hw = g.level.world.raycast(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, 1400, RAY_BULLET);
    let t = hw ? hw.t : Infinity;
    const he = g.enemies.intersect(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, Math.min(t, 1400), null);
    if (he) t = he.t;
    const hc = g.civilians.intersect(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, Math.min(t, 1400));
    if (hc) t = hc.t;
    if (!isFinite(t)) { g.hud.rangeReadout('----'); return; }
    const R = Math.round(t);
    g.hud.rangeReadout(`${R} m`);
    const v = g.weapons.def.velocity, tof = R / v;
    const right = _w.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const cross = this.wind.x * right.x + this.wind.z * right.z;           // + pushes the round right
    const drift = 0.5 * cross * 0.55 * tof * tof;
    const mils = Math.abs(drift) / R * 1000;
    const dial = Math.round(R / 50) * 50; // the turret clicks in 50 m steps
    const hold = mils < 0.05 ? 'no wind hold' : `hold ${mils.toFixed(1)} mil ${drift > 0 ? 'left' : 'right'}`;
    if (this.spotterAlive) g.hud.radio('SPOTTER', `${R} metres. Dial ${dial}, ${hold}.`);
    g.audio.play('magTap', { vol: 0.3, rate: 2.6 });
    return R;
  }

  _shadowFocus() {
    const g = this.game, cam = g.camera;
    this._focusT = (this._focusT || 0) - 1;
    if (this._focusT > 0 && this.focus) return;
    this._focusT = 6;
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const o = cam.position;
    let fx = 0, fz = 0;
    if (fwd.y < -0.01) { const t = -o.y / fwd.y; fx = o.x + fwd.x * t; fz = o.z + fwd.z * t; }
    const r = Math.hypot(fx, fz), lim = 60;
    if (r > lim) { fx *= lim / r; fz *= lim / r; }
    if (!this.focus) this.focus = new THREE.Vector3(fx, 0, fz);
    else this.focus.lerp(_w.set(fx, 0, fz), 0.5);
    g.level.shadowFocus = this.focus;
  }

  debrief() {
    const s = this.st, g = this.game;
    const killed = this.hostiles.filter((e) => !e.alive).length;
    let pts = (s.hvtKilled ? 60 : 0) + (killed / this.hostiles.length) * 30 + Math.min(10, this.accuracy() / 8) - s.civKilled * 25 - s.civHurt * 8 - (s.spotterKilled ? 15 : 0);
    if (!this.success) pts = Math.min(pts, 35);
    const grade = this.grade(pts);
    return {
      mission: 'sniper', success: !!this.success, title: this.success ? 'MISSION COMPLETE' : 'MISSION FAILED', grade, score: g.score,
      rows: [
        ['Result', this.success ? '<span class="hl">Complete</span>' : 'Failed'], ['Grade', `<span class="hl">${grade}</span>`],
        ['HVT', s.hvtKilled ? 'Eliminated' : s.escaped ? 'Escaped' : 'Alive'], ['Hostiles', `${killed} / ${this.hostiles.length}`], ['Spotter', s.spotterKilled ? 'Killed' : 'Alive'],
        ['Longest shot', `${Math.round(Math.max(s.longest, g.stats.longest))} m`], ['Shots fired', s.shots],
        ['Accuracy', `${this.accuracy()}%`], ['Civilians harmed', s.civHurt + s.civKilled], ['Time', fmtTime(this.t)], ['Score', `<span class="hl">${g.score}</span>`],
      ],
    };
  }
}
