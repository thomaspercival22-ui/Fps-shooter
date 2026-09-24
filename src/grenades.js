// Thrown grenades (frag + flashbang) with bouncing physics and fuses.
import * as THREE from 'three';
import { GRENADES } from './config.js';
import { buildFragMesh, buildFlashMesh } from './gunmodels.js';

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
    const mesh = this.templates[type].clone();
    mesh.scale.setScalar(1.15);
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    mesh.position.copy(pos);
    this.game.scene.add(mesh);
    const g = {
      type, owner, mesh, pos: mesh.position, vel: vel.clone(),
      fuse: GRENADES[type].fuse * (owner === 'enemy' && type === 'frag' ? 0.85 : 1),
      spin: new THREE.Vector3(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6),
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
}
