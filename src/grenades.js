// Thrown grenades (frag + flashbang) with bouncing physics and fuses, and
// chaos mode's cream pies, which fly until they hit something and splat.
import * as THREE from 'three';
import { GRENADES } from './config.js';
import { buildFragMesh, buildFlashMesh } from './gunmodels.js';
import { RAY_ALL, rayCapsule } from './physics.js';
import { pieMesh } from './chaos.js';

const _d = new THREE.Vector3(), _n = new THREE.Vector3(), _hit = new THREE.Vector3();

export class Grenades {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.templates = { frag: buildFragMesh(), flash: buildFlashMesh() };
  }

  clear() {
    for (const g of this.list) this.game.scene.remove(g.mesh);
    this.list = [];
  }

  spawn(type, pos, vel, owner) {
    if (type === 'pie' && !this.templates.pie) this.templates.pie = pieMesh();
    const mesh = this.templates[type].clone();
    mesh.scale.setScalar(type === 'pie' ? 1 : 1.15);
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    mesh.position.copy(pos);
    this.game.scene.add(mesh);
    const g = {
      type, owner, mesh, pos: mesh.position, vel: vel.clone(),
      fuse: GRENADES[type].fuse * (owner === 'enemy' && type === 'frag' ? 0.85 : 1),
      spin: type === 'pie' ? new THREE.Vector3(0, (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 4), 0) : new THREE.Vector3(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6),
      lastBounce: 0, age: 0,
    };
    this.list.push(g);
    // enemies notice grenades landing near them
    return g;
  }

  /** Nearest live frag within r of pos (for AI evasion). */
  dangerNear(pos, r) {
    let best = null, bd = r;
    for (const g of this.list) {
      if (g.type !== 'frag' || g.age < 0.3) continue;
      const d = Math.hypot(g.pos.x - pos.x, g.pos.z - pos.z);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }

  update(dt) {
    const G = this.game, W = G.level.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      if (g.type === 'pie') { this._updatePie(g, dt, i); continue; }
      g.age += dt;
      g.fuse -= dt;
      g.vel.y -= 9.81 * dt;
      const imp = W.bounceSphere(g.pos, g.vel, 0.05, dt, 0.32, 0.62);
      if (imp > 1.2 && g.age - g.lastBounce > 0.08) {
        g.lastBounce = g.age;
        G.audio.playAt('bounce', g.pos.x, g.pos.y, g.pos.z, { vol: Math.min(1, imp / 6), max: 40, rate: g.type === 'flash' ? 1.2 : 1 });
        g.spin.multiplyScalar(0.6);
      }
      // rolling on the ground
      if (g.pos.y <= 0.051) { g.vel.x *= Math.max(0, 1 - dt * 1.8); g.vel.z *= Math.max(0, 1 - dt * 1.8); }
      g.mesh.rotation.x += g.spin.x * dt; g.mesh.rotation.y += g.spin.y * dt; g.mesh.rotation.z += g.spin.z * dt;
      if (g.fuse <= 0) {
        G.scene.remove(g.mesh);
        this.list.splice(i, 1);
        if (g.type === 'frag') G.explode(g.pos.clone(), GRENADES.frag.radius, GRENADES.frag.damage, g.owner);
        else G.flashbangAt(g.pos.clone());
      }
    }
  }

  /** A pie in flight: no bounce, it splats on the first thing (or person) in its way. */
  _updatePie(g, dt, i) {
    const G = this.game, W = G.level.world, p = G.player;
    g.age += dt;
    const x = g.pos.x, y = g.pos.y, z = g.pos.z;
    g.vel.y -= 9.81 * dt;
    _d.copy(g.vel).multiplyScalar(dt);
    const len = _d.length();
    _d.divideScalar(len || 1);
    let best = len, victim = null;
    const hw = W.raycast(x, y, z, _d.x, _d.y, _d.z, len, RAY_ALL);
    if (hw) { best = hw.t; _n.set(hw.nx, hw.ny, hw.nz); }
    if (g.owner === 'player') {
      for (const e of G.enemies.list) {
        if (!e.alive || e.surrendered) continue;
        const top = e.pos.y + (e.crouch ? 1.25 : 1.75);
        const t = rayCapsule(x, y, z, _d.x, _d.y, _d.z, e.pos.x, e.pos.y + 0.15, e.pos.z, e.pos.x, top, e.pos.z, 0.42);
        if (t >= 0 && t < best) { best = t; victim = e; }
      }
    } else if (p.alive) {
      const t = rayCapsule(x, y, z, _d.x, _d.y, _d.z, p.pos.x, p.pos.y + 0.2, p.pos.z, p.pos.x, p.pos.y + p.height, p.pos.z, 0.36);
      if (t >= 0 && t < best) { best = t; victim = p; }
    }
    // spinning flat like a frisbee, nose tipped a little into the flight
    g.mesh.rotation.y += g.spin.y * dt;
    g.mesh.rotation.x = THREE.MathUtils.clamp(-g.vel.y * 0.04, -0.4, 0.4);
    if (!hw && !victim) {
      g.pos.addScaledVector(_d, len);
      if (g.age > 6 || g.pos.y < -5) { G.scene.remove(g.mesh); this.list.splice(i, 1); }
      return;
    }
    _hit.set(x + _d.x * best, y + _d.y * best, z + _d.z * best);
    if (victim) _n.copy(_d).negate();
    G.scene.remove(g.mesh);
    this.list.splice(i, 1);
    G.pieSplat(_hit.clone(), _n.clone(), g.owner, victim, _d.clone());
  }
}
