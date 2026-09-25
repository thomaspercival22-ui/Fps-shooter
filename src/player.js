// The player: movement (walk / sprint / crouch / jump, stairs), camera
// (look, recoil, view punch, head bob, shake), health and footsteps.
import * as THREE from 'three';
import { PLAYER } from './config.js';

const DEG = Math.PI / 180;

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw, y = 0) {
    this.pos.set(x, y + 0.1, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.health = PLAYER.maxHealth;
    this.alive = true;
    this.crouched = false;
    this.crouchT = 0;
    this.eyeH = PLAYER.eyeStand;
    this.grounded = true;
    this.sprinting = false;
    this.sprintBlock = 0;
    this.bobPhase = 0;
    this.stepDist = 0;
    this.horizSpeed = 0;
    this.landDip = 0;
    this.recoilAccum = 0;
    this.punchP = { x: 0, v: 0 }; this.punchY = { x: 0, v: 0 };
    this.shake = 0;
    this.lastDamage = -10;
    this.smoothY = this.pos.y;
    this.flinch = 0;
    this.lastShotTime = -10;
  }

  get height() { return this.crouched ? PLAYER.crouchHeight : PLAYER.standHeight; }

  look(dx, dy) {
    this.yaw -= dx;
    const before = this.pitch;
    this.pitch = Math.max(-85 * DEG, Math.min(85 * DEG, this.pitch - dy));
    // pulling down while recoil is pending counts as compensation
    if (dy > 0 && this.recoilAccum > 0) this.recoilAccum = Math.max(0, this.recoilAccum - (before - this.pitch));
  }

  kick(pitchDeg, yawDeg) {
    const p = pitchDeg * DEG;
    this.pitch = Math.min(85 * DEG, this.pitch + p);
    this.yaw -= yawDeg * DEG;
    this.recoilAccum += p;
    this.lastShotTime = this.game.time;
  }
  punch(p, y) { this.punchP.v += p * 1.4; this.punchY.v += y * 1.4; }

  cancelSprint() { this.sprinting = false; this.sprintBlock = 0.25; }

  toggleCrouch() {
    if (this.crouched) {
      if (!this.game.level.world.overlaps(this.pos.x, this.pos.z, PLAYER.radius * 0.9, this.pos.y + PLAYER.crouchHeight - 0.05, this.pos.y + PLAYER.standHeight)) this.crouched = false;
    } else this.crouched = true;
  }

  update(dt, input) {
    const g = this.game, W = g.level.world;
    if (!this.alive) { this._deathCam(dt); return; }

    // ---- intent ----
    const mx = input.moveX, mz = input.moveY; // strafe, forward
    const mag = Math.min(1, Math.hypot(mx, mz));
    this.sprintBlock = Math.max(0, this.sprintBlock - dt);
    const wantSprint = input.sprint && mz > 0.5 && this.sprintBlock <= 0 && !g.weapons.throwing;
    if (wantSprint && this.crouched) this.toggleCrouch();
    this.sprinting = wantSprint && !this.crouched && this.grounded;
    let speed = this.crouched ? PLAYER.crouchSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if (g.weapons.adsT > 0.5) speed *= PLAYER.adsSpeedMul;
    if (mz < 0) speed *= 0.85;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    let wx = -sy * mz + cy * mx, wz = -cy * mz - sy * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const tx = wx * speed, tz = wz * speed;
    const accel = this.grounded ? (mag > 0.05 ? 34 : 26) : 5;
    const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
    const dl = Math.hypot(dvx, dvz), maxDv = accel * dt;
    if (dl > maxDv) { this.vel.x += dvx / dl * maxDv; this.vel.z += dvz / dl * maxDv; }
    else { this.vel.x = tx; this.vel.z = tz; }

    if (input.jump && this.grounded) {
      if (this.crouched) this.toggleCrouch();
      else { this.vel.y = PLAYER.jumpVelocity; this.grounded = false; }
    }
    input.jump = false;

    // ---- move ----
    const r = PLAYER.radius, h = this.height;
    const ox = this.pos.x, oz = this.pos.z, oy = this.pos.y;
    W.slide(this.pos, this.vel.x * dt, this.vel.z * dt, r, h, PLAYER.stepHeight);
    const realVx = (this.pos.x - ox) / dt, realVz = (this.pos.z - oz) / dt;
    this.horizSpeed = Math.hypot(realVx, realVz);
    // kill velocity into walls so we don't stick
    if (Math.abs(realVx) < Math.abs(this.vel.x) * 0.5) this.vel.x = realVx;
    if (Math.abs(realVz) < Math.abs(this.vel.z) * 0.5) this.vel.z = realVz;

    this.vel.y -= PLAYER.gravity * dt;
    this.pos.y += this.vel.y * dt;
    if (this.vel.y > 0) {
      const ceil = W.ceilingAt(this.pos.x, this.pos.z, r * 0.8, oy + PLAYER.stepHeight);
      if (this.pos.y + h > ceil) { this.pos.y = ceil - h; this.vel.y = 0; }
    }
    const probe = this.grounded ? PLAYER.stepHeight : 0.05;
    const ground = W.groundAt(this.pos.x, this.pos.z, r * 0.75, Math.max(this.pos.y, oy) + PLAYER.stepHeight);
    const wasGrounded = this.grounded;
    if (this.pos.y <= ground + (wasGrounded && this.vel.y <= 0 ? probe : 0)) {
      if (!wasGrounded && this.vel.y < -3.5) {
        this.landDip = Math.min(1, -this.vel.y / 9);
        g.audio.playVariant('step', 4, { vol: 0.5 + this.landDip * 0.4 });
        if (this.vel.y < -11) this.damage((-this.vel.y - 11) * 9, null);
      }
      this.pos.y = ground; this.vel.y = 0; this.grounded = true;
    } else this.grounded = false;
    this.landDip = Math.max(0, this.landDip - dt * 3);

    // smooth out step-ups for the camera
    if (this.grounded && this.pos.y > this.smoothY) this.smoothY = Math.min(this.pos.y, this.smoothY + dt * 3.2);
    else this.smoothY = this.pos.y;

    // crouch
    this.crouchT += ((this.crouched ? 1 : 0) - this.crouchT) * Math.min(1, dt * 10);
    this.eyeH = PLAYER.eyeStand + (PLAYER.eyeCrouch - PLAYER.eyeStand) * this.crouchT;

    // footsteps + bob
    if (this.grounded && this.horizSpeed > 0.4) {
      const stride = this.sprinting ? 1.9 : this.crouched ? 1.1 : 1.55;
      this.stepDist += this.horizSpeed * dt;
      this.bobPhase = (this.stepDist / stride) * Math.PI;
      if (this.stepDist >= stride) {
        this.stepDist -= stride;
        const vol = this.crouched ? 0.12 : this.sprinting ? 0.55 : 0.32;
        g.audio.playVariant('step', 4, { vol, rate: 0.9 + Math.random() * 0.2 });
        if (!this.crouched) g.emitNoise(this.pos, this.sprinting ? 16 : 7, 'step');
      }
      this.bobPhase = (this.stepDist / stride) * Math.PI;
    }

    // recoil recovery
    if (g.time - this.lastShotTime > 0.12 && this.recoilAccum > 0) {
      const rate = g.weapons.def.recoilRecover * DEG;
      const rec = Math.min(this.recoilAccum, rate * dt * (1 + this.recoilAccum * 10));
      this.pitch -= rec; this.recoilAccum -= rec;
    }
    this._springs(dt);

    // health regen
    if (g.time - this.lastDamage > (g.difficulty.regenDelay ?? PLAYER.regenDelay) && this.health < PLAYER.maxHealth) {
      this.health = Math.min(PLAYER.maxHealth, this.health + PLAYER.regenRate * dt);
    }
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.updateCamera();
  }

  _springs(dt) {
    for (const s of [this.punchP, this.punchY]) { s.v += (-s.x * 180 - s.v * 16) * dt; s.x += s.v * dt; }
  }

  updateCamera() {
    const cam = this.game.camera;
    const bobAmp = Math.min(1, this.horizSpeed / 4.3) * (this.grounded ? 1 : 0) * (1 - this.game.weapons.adsT * 0.8);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.035 * bobAmp * (this.sprinting ? 1.5 : 1);
    const bobX = Math.cos(this.bobPhase) * 0.02 * bobAmp;
    this.eye.set(this.pos.x, this.smoothY + this.eyeH, this.pos.z);
    cam.position.set(this.eye.x + Math.cos(this.yaw) * bobX, this.eye.y + bobY - this.landDip * 0.08, this.eye.z - Math.sin(this.yaw) * bobX);
    const sh = this.shake * this.shake;
    const t = this.game.time;
    const shakeP = (Math.sin(t * 43) + Math.sin(t * 27.3)) * 0.012 * sh;
    const shakeY = (Math.sin(t * 37.7) + Math.sin(t * 21.1)) * 0.012 * sh;
    const fl = this.flinch * this.flinch;
    cam.rotation.set(
      this.pitch + this.punchP.x * DEG + shakeP + Math.sin(t * 30) * 0.02 * fl,
      this.yaw + this.punchY.x * DEG + shakeY,
      Math.sin(this.bobPhase) * 0.004 * bobAmp + this.crouchT * 0 + Math.cos(t * 25) * 0.02 * fl,
      'YXZ');
    cam.updateMatrixWorld();
  }

  damage(amount, from) {
    const g = this.game;
    if (!this.alive || g.godMode) return;
    this.health -= amount;
    this.lastDamage = g.time;
    this.flinch = Math.min(1, this.flinch + amount / 25);
    this.punch((Math.random() - 0.3) * amount * 0.15, (Math.random() - 0.5) * amount * 0.15);
    if (from) g.hud.damageFrom(from.x, from.z);
    g.hud.hurt(amount);
    if (Math.random() < 0.5) g.audio.playVariant('hurt', 2, { vol: 0.5 });
    g.audio.play(`imp_flesh${(Math.random() * 2) | 0}`, { vol: 0.6 });
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deathT = 0;
      g.onPlayerDeath();
    }
  }

  _deathCam(dt) {
    this.deathT += dt;
    const k = Math.min(1, this.deathT / 0.9);
    this.eyeH = PLAYER.eyeStand * (1 - k * 0.8) + 0.25 * k;
    this.eye.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z);
    const cam = this.game.camera;
    cam.position.copy(this.eye);
    cam.rotation.set(this.pitch * (1 - k) - k * 0.3, this.yaw, k * 1.2, 'YXZ');
    cam.updateMatrixWorld();
  }
}
