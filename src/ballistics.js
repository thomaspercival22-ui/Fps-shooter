// Projectile bullets: travel time, gravity drop, penetration of thin
// materials, damage falloff, hit detection against the world, the enemies'
// hitboxes and the player, near-miss whizzes and tracers.
import * as THREE from 'three';
import { RAY_BULLET, rayCapsule, pointSegDist } from './physics.js';

const MAX_TRACERS = 64;
const G = 9.81;

export class Ballistics {
  constructor(game) {
    this.game = game;
    this.bullets = [];
    // camera-facing tracer ribbons (one draw call)
    const geo = new THREE.BufferGeometry();
    this.tPos = new Float32Array(MAX_TRACERS * 4 * 3);
    this.tAlpha = new Float32Array(MAX_TRACERS * 4);
    const idx = [];
    for (let i = 0; i < MAX_TRACERS; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.tAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color(3.2, 2.2, 1.1) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color * vA, vA); }',
    });
    this.tracerMesh = new THREE.Mesh(geo, mat);
    this.tracerMesh.frustumCulled = false;
    game.scene.add(this.tracerMesh);
  }

  clear() { this.bullets.length = 0; }

  fire(o) {
    this.bullets.push({
      owner: o.owner, shooter: o.shooter || null,
      pos: new THREE.Vector3(o.x, o.y, o.z),
      vel: o.dir.clone().multiplyScalar(o.speed),
      speed: o.speed,
      damage: o.damage, weapon: o.weapon || null,
      traveled: 0,
      tracer: !!o.tracer,
      tail: o.tracerFrom ? o.tracerFrom.clone() : new THREE.Vector3(o.x, o.y, o.z),
      whizzed: false,
      penPower: o.weapon ? o.weapon.penetration : 1,
      hitSomething: false,
    });
  }

  update(dt) {
    const g = this.game, W = g.level.world, p = g.player;
    const dir = new THREE.Vector3();
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let remaining = dt;
      let alive = true;
      let guard = 0;
      while (alive && remaining > 0 && guard++ < 4) {
        const start = b.pos;
        const vy = b.vel.y - G * remaining;
        const ex = start.x + b.vel.x * remaining, ey = start.y + (b.vel.y + vy) * 0.5 * remaining, ez = start.z + b.vel.z * remaining;
        dir.set(ex - start.x, ey - start.y, ez - start.z);
        const len = dir.length();
        dir.divideScalar(len);
        const hw = W.raycast(start.x, start.y, start.z, dir.x, dir.y, dir.z, len, RAY_BULLET);
        let tMax = hw ? hw.t : len;
        // save world-hit data before other queries overwrite the shared hit object
        const wh = hw ? { t: hw.t, x: hw.x, y: hw.y, z: hw.z, nx: hw.nx, ny: hw.ny, nz: hw.nz, box: hw.box, exitT: hw.exitT, mat: hw.mat } : null;

        if (b.owner === 'player') {
          const he = g.enemies.intersect(start.x, start.y, start.z, dir.x, dir.y, dir.z, tMax, null);
          // suppression of enemies the round passes close to
          for (const e of g.enemies.list) {
            if (!e.alive || e.suppressedBy === b) continue;
            const d = pointSegDist(e.pos.x, e.pos.y + 1.3, e.pos.z, start.x, start.y, start.z, start.x + dir.x * tMax, start.y + dir.y * tMax, start.z + dir.z * tMax);
            if (d < 1.6) { e.suppressedBy = b; g.enemies.nearMiss(e, p.pos); }
          }
          if (he) {
            b.traveled += he.t;
            const pt = new THREE.Vector3(start.x + dir.x * he.t, start.y + dir.y * he.t, start.z + dir.z * he.t);
            this._hitEnemy(b, he, pt, dir);
            alive = false;
            break;
          }
        } else if (p.alive) {
          const top = p.pos.y + p.height - 0.1, bot = p.pos.y + 0.2;
          const tp = rayCapsule(start.x, start.y, start.z, dir.x, dir.y, dir.z, p.pos.x, bot, p.pos.z, p.pos.x, top, p.pos.z, 0.3);
          if (tp >= 0 && tp <= tMax) {
            const dmg = b.damage;
            p.damage(dmg, b.shooter ? b.shooter.pos : start);
            g.effects.bloodPuff(new THREE.Vector3(start.x + dir.x * tp, start.y + dir.y * tp, start.z + dir.z * tp), dir, 0.4);
            alive = false;
            break;
          }
          if (!b.whizzed) {
            const d = pointSegDist(p.eye.x, p.eye.y, p.eye.z, start.x, start.y, start.z, start.x + dir.x * tMax, start.y + dir.y * tMax, start.z + dir.z * tMax);
            if (d < 2.2) {
              b.whizzed = true;
              const pan = 0;
              if (b.speed > 343) g.audio.play('crack', { vol: 0.35 * (1 - d / 2.4), pan });
              g.audio.playVariant('whiz', 2, { vol: 0.5 * (1 - d / 2.4), rate: 0.9 + Math.random() * 0.25 });
              g.hud.suppress(1 - d / 2.2);
            }
          }
        }

        if (wh) {
          b.traveled += wh.t;
          const pt = new THREE.Vector3(wh.x, wh.y, wh.z);
          const n = new THREE.Vector3(wh.nx, wh.ny, wh.nz);
          const dmgMul = this._falloff(b);
          g.effects.impact(pt, n, wh.mat, b.owner === 'player' ? 1 : 0.7);
          if (b.owner === 'player' && dmgMul > 0) g.audio.playAt(`imp_${impactSound(wh.mat)}${(Math.random() * 2) | 0}`, pt.x, pt.y, pt.z, { vol: 0.35, max: 60, occlude: false });
          else if (Math.random() < 0.5) g.audio.playAt(`imp_${impactSound(wh.mat)}${(Math.random() * 2) | 0}`, pt.x, pt.y, pt.z, { vol: 0.5, max: 25, occlude: false });
          if (wh.box && wh.box.tag === 'explosive' && wh.box.barrel) g.damageBarrel(wh.box.barrel, b.damage * dmgMul);
          if (wh.box && wh.box.pen > 0) {
            const retained = Math.pow(wh.box.pen, 1 / Math.max(0.2, b.penPower));
            b.damage *= retained;
            if (b.damage > 4) {
              // exit on the far side and keep going
              const et = wh.exitT + 0.02;
              b.pos.set(start.x + dir.x * et, start.y + dir.y * et, start.z + dir.z * et);
              g.effects.impact(b.pos.clone(), dir.clone(), wh.mat, 0.5, true);
              const frac = Math.min(1, et / len);
              remaining *= (1 - frac);
              b.vel.multiplyScalar(0.85);
              b.traveled += wh.exitT - wh.t;
              continue;
            }
          }
          alive = false;
          b.pos.copy(pt);
          break;
        }
        // no hit: advance
        b.pos.set(ex, ey, ez);
        b.vel.y = vy;
        b.traveled += len;
        remaining = 0;
      }
      if (!alive || b.traveled > 700 || b.pos.y < -5) this.bullets.splice(i, 1);
      else if (b.tracer) b.tracerAlive = true;
      if (!alive && b.tracer) this._fadeTracer(b);
    }
    this._drawTracers(dt);
  }

  _falloff(b) {
    const w = b.weapon;
    if (!w) return 1;
    if (b.traveled <= w.falloffStart) return 1;
    const t = Math.min(1, (b.traveled - w.falloffStart) / (w.falloffEnd - w.falloffStart));
    return 1 - t * (1 - w.minDamageMul);
  }

  _hitEnemy(b, he, pt, dir) {
    const g = this.game, e = he.enemy, w = b.weapon;
    let mul = this._falloff(b);
    if (he.part === 'head') mul *= w ? w.headMul : 3;
    else if (he.part === 'limb') mul *= w ? w.limbMul : 0.8;
    const dmg = b.damage * mul;
    const wasFlashed = e.flashed > 0;
    const killed = e.takeDamage(dmg, he.part, dir.x, dir.z, 'player');
    g.weapons.stats.hits++;
    g.effects.bloodPuff(pt, dir, he.part === 'head' ? 1.4 : 1);
    g.audio.playAt(`imp_flesh${(Math.random() * 2) | 0}`, pt.x, pt.y, pt.z, { vol: 0.5, occlude: false });
    g.hud.hitMarker(killed ? 'kill' : he.part === 'head' ? 'head' : 'hit');
    if (killed) g.registerKill(e, { headshot: he.part === 'head', weapon: w ? w.name : '', stunned: wasFlashed, distance: b.traveled });
  }

  _fadeTracer(b) { b.tracer = false; }

  _drawTracers() {
    const cam = this.game.camera;
    const cp = cam.position;
    let n = 0;
    const d = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3(), tail = new THREE.Vector3();
    for (const b of this.bullets) {
      if (!b.tracer || n >= MAX_TRACERS) continue;
      d.copy(b.vel).normalize();
      const len = Math.min(18, b.pos.distanceTo(b.tail));
      tail.copy(b.pos).addScaledVector(d, -len);
      if (len < 0.5) continue;
      toCam.subVectors(cp, b.pos).normalize();
      side.crossVectors(d, toCam).normalize();
      const w = 0.018 + b.pos.distanceTo(cp) * 0.0012;
      const k = n * 12, ka = n * 4;
      const P = this.tPos, A = this.tAlpha;
      P[k] = b.pos.x + side.x * w; P[k + 1] = b.pos.y + side.y * w; P[k + 2] = b.pos.z + side.z * w;
      P[k + 3] = b.pos.x - side.x * w; P[k + 4] = b.pos.y - side.y * w; P[k + 5] = b.pos.z - side.z * w;
      P[k + 6] = tail.x - side.x * w; P[k + 7] = tail.y - side.y * w; P[k + 8] = tail.z - side.z * w;
      P[k + 9] = tail.x + side.x * w; P[k + 10] = tail.y + side.y * w; P[k + 11] = tail.z + side.z * w;
      A[ka] = A[ka + 1] = 0.9; A[ka + 2] = A[ka + 3] = 0;
      n++;
    }
    for (let i = n; i < MAX_TRACERS; i++) { const ka = i * 4; this.tAlpha[ka] = this.tAlpha[ka + 1] = this.tAlpha[ka + 2] = this.tAlpha[ka + 3] = 0; }
    const geo = this.tracerMesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
    geo.setDrawRange(0, Math.max(1, n) * 6);
  }
}

function impactSound(mat) {
  if (mat === 'metal') return 'metal';
  if (mat === 'wood') return 'wood';
  if (mat === 'sand' || mat === 'rubber') return 'sand';
  return 'concrete';
}
