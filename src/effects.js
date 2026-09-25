// Visual effects: particles (dust, sparks, smoke, fire, debris, blood mist),
// bullet-hole and scorch decals, ejected brass, dropped magazines, flashes.
import * as THREE from 'three';
import * as TX from './textures.js';
import { gunMaterials } from './gunmodels.js';

class Particles {
  constructor(scene, max, map, blending, { depthWrite = false } = {}) {
    this.max = max;
    this.p = []; // {x,y,z,vx,vy,vz,life,maxLife,size,grow,r,g,b,a,drag,grav,rot,spin}
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite, blending,
      uniforms: { map: { value: map }, scale: { value: 500 }, fogColor: { value: new THREE.Color() }, fogNear: { value: 50 }, fogFar: { value: 600 }, lightK: { value: 1 } },
      vertexShader: `
        attribute vec4 color; attribute float size; attribute float rot;
        uniform float scale; varying vec4 vC; varying float vR; varying float vFog;
        uniform float fogNear; uniform float fogFar;
        void main(){
          vC = color; vR = rot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(size * scale / max(0.1, -mv.z), 900.0);
          vFog = smoothstep(fogNear, fogFar, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 fogColor; uniform float lightK; varying vec4 vC; varying float vR; varying float vFog;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float s = sin(vR), co = cos(vR);
          vec2 uv = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
          vec4 t = texture2D(map, uv);
          vec4 o = t * vC;
          o.rgb *= lightK;
          o.rgb = mix(o.rgb, fogColor * o.a, vFog * 0.8);
          gl_FragColor = o;
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }
  emit(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({ drag: 0, grav: 0, grow: 0, spin: 0, rot: Math.random() * 6.28, a: 1, fade: 1, ...o, life: 0 });
  }
  update(dt) {
    const P = this.p;
    let n = 0;
    for (let i = P.length - 1; i >= 0; i--) {
      const q = P[i];
      q.life += dt;
      if (q.life >= q.maxLife) { P.splice(i, 1); continue; }
    }
    for (const q of P) {
      const dr = Math.max(0, 1 - q.drag * dt);
      q.vx *= dr; q.vy = q.vy * dr - q.grav * dt; q.vz *= dr;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.01 && q.grav > 0) { q.y = 0.01; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
      q.rot += q.spin * dt;
      const t = q.life / q.maxLife;
      const alpha = q.a * (q.fadeIn ? Math.min(1, t / q.fadeIn) : 1) * (1 - Math.pow(t, q.fade));
      const k = n * 3, kc = n * 4;
      this.pos[k] = q.x; this.pos[k + 1] = q.y; this.pos[k + 2] = q.z;
      this.col[kc] = q.r; this.col[kc + 1] = q.g; this.col[kc + 2] = q.b; this.col[kc + 3] = alpha;
      this.size[n] = q.size * (1 + q.grow * t);
      this.rot[n] = q.rot;
      n++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    for (const k of ['position', 'color', 'size', 'rot']) geo.attributes[k].needsUpdate = true;
  }
}

/** Infrared aiming lasers: invisible to the naked eye, bright under night vision. */
class IRBeams {
  constructor(scene, max = 20) {
    this.max = max;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 8 * 3);
    this.alpha = new Float32Array(max * 8);
    const idx = [];
    for (let i = 0; i < max; i++) { const b = i * 8; idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b + 4, b + 5, b + 6, b + 4, b + 6, b + 7); }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(2.6) * vA, vA); }',
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.userData.noThermal = true;
    scene.add(this.mesh);
  }
  draw(list, cam) {
    const P = this.pos, A = this.alpha, cp = cam.position;
    const d = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    let n = 0;
    for (const b of list) {
      if (n >= this.max) break;
      d.subVectors(b.to, b.from); const len = d.length(); if (len < 0.1) continue; d.divideScalar(len);
      toCam.subVectors(cp, b.from).normalize();
      side.crossVectors(d, toCam).normalize();
      const w0 = 0.004 + b.from.distanceTo(cp) * 0.0009, w1 = 0.004 + b.to.distanceTo(cp) * 0.0009;
      const k = n * 24, ka = n * 8;
      const put = (o, v) => { P[k + o] = v.x; P[k + o + 1] = v.y; P[k + o + 2] = v.z; };
      put(0, b.from.clone().addScaledVector(side, w0)); put(3, b.from.clone().addScaledVector(side, -w0));
      put(6, b.to.clone().addScaledVector(side, -w1)); put(9, b.to.clone().addScaledVector(side, w1));
      A[ka] = A[ka + 1] = 0.9; A[ka + 2] = A[ka + 3] = 0.35;
      // the dot where the laser lands
      const s = 0.03 + b.to.distanceTo(cp) * 0.004;
      const c = b.to;
      put(12, c.clone().addScaledVector(right, -s).addScaledVector(up, -s)); put(15, c.clone().addScaledVector(right, s).addScaledVector(up, -s));
      put(18, c.clone().addScaledVector(right, s).addScaledVector(up, s)); put(21, c.clone().addScaledVector(right, -s).addScaledVector(up, s));
      A[ka + 4] = A[ka + 5] = A[ka + 6] = A[ka + 7] = b.hit ? 1 : 0;
      n++;
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
    geo.setDrawRange(0, n * 12);
    this.mesh.visible = n > 0;
  }
}

const IMPACT_COLORS = {
  concrete: [0.62, 0.6, 0.56], plaster: [0.78, 0.7, 0.58], sand: [0.72, 0.6, 0.45],
  metal: [0.45, 0.42, 0.4], wood: [0.5, 0.4, 0.28], rubber: [0.15, 0.15, 0.15],
};

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    const smoke = TX.smokeTexture(), glow = TX.glowTexture();
    this.dust = new Particles(scene, 500, smoke, THREE.NormalBlending);
    this.smoke = new Particles(scene, 160, smoke, THREE.NormalBlending);
    this.sparks = new Particles(scene, 300, glow, THREE.AdditiveBlending);
    this.fire = new Particles(scene, 120, smoke, THREE.AdditiveBlending);
    this.debris = new Particles(scene, 300, glow, THREE.NormalBlending);

    // decals
    const holeMat = new THREE.MeshStandardMaterial({ map: TX.bulletHoleTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9 });
    this.holes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), holeMat, 220);
    this.holes.count = 0; this.holeIdx = 0;
    this.holes.frustumCulled = false;
    this.holes.receiveShadow = true;
    scene.add(this.holes);
    const scorchMat = new THREE.MeshStandardMaterial({ map: TX.scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 1 });
    this.scorch = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), scorchMat, 24);
    this.scorch.count = 0; this.scorchIdx = 0; this.scorch.frustumCulled = false;
    scene.add(this.scorch);

    // brass
    const m = gunMaterials();
    this.shellTypes = {
      rifle: { geo: new THREE.CylinderGeometry(0.0048, 0.0048, 0.045, 8), mat: m.brass, r: 0.01, snd: 'brass' },
      pistol: { geo: new THREE.CylinderGeometry(0.005, 0.005, 0.019, 8), mat: m.brass, r: 0.008, snd: 'brass' },
      shotgun: { geo: new THREE.CylinderGeometry(0.0105, 0.0105, 0.07, 10), mat: m.shell, r: 0.015, snd: 'shellPlastic' },
    };
    this.shellMeshes = {};
    for (const [k, t] of Object.entries(this.shellTypes)) {
      const im = new THREE.InstancedMesh(t.geo, t.mat, 40);
      im.count = 0; im.frustumCulled = false; im.castShadow = false;
      scene.add(im);
      this.shellMeshes[k] = { im, list: [] };
    }
    this.mags = [];
    this.magGeo = new THREE.BoxGeometry(0.028, 0.17, 0.07);
    this.magMat = m.fde;

    // lights for muzzle flashes and explosions
    this.lasers = new IRBeams(scene);
    this.lasers.mesh.visible = false;
    this.flashLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    this.enemyLight = new THREE.PointLight(0xffa050, 0, 7, 2);
    this.boomLight = new THREE.PointLight(0xffc080, 0, 28, 2);
    scene.add(this.flashLight, this.enemyLight, this.boomLight);
    this.flashSprites = [];
    const fm = new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    for (let i = 0; i < 4; i++) { const s = new THREE.Sprite(fm.clone()); s.visible = false; scene.add(s); this.flashSprites.push({ s, t: 0, dur: 0 }); }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._z = new THREE.Vector3(0, 0, 1);
  }

  /** Unlit particles (dust, smoke) must darken with the scene at night; glowing ones don't. */
  setLight(k) { for (const ps of [this.dust, this.smoke, this.debris]) ps.mat.uniforms.lightK.value = k; }

  setFog(color, near, far, scale) {
    for (const ps of [this.dust, this.smoke, this.sparks, this.fire, this.debris]) {
      ps.mat.uniforms.fogColor.value.copy(color);
      ps.mat.uniforms.fogNear.value = near;
      ps.mat.uniforms.fogFar.value = far;
      ps.mat.uniforms.scale.value = scale;
    }
  }

  clear() {
    for (const ps of [this.dust, this.smoke, this.sparks, this.fire, this.debris]) ps.p.length = 0;
    this.holes.count = 0; this.holeIdx = 0;
    this.scorch.count = 0; this.scorchIdx = 0;
    for (const s of Object.values(this.shellMeshes)) { s.list.length = 0; s.im.count = 0; }
    for (const m of this.mags) this.game.scene.remove(m.mesh);
    this.mags = [];
  }

  impact(pt, n, mat, scale = 1, exit = false) {
    const col = IMPACT_COLORS[mat] || IMPACT_COLORS.concrete;
    const dusty = mat !== 'metal';
    const count = exit ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const s = 0.12 + Math.random() * 0.2;
      this.dust.emit({
        x: pt.x + n.x * 0.05, y: pt.y + n.y * 0.05, z: pt.z + n.z * 0.05,
        vx: n.x * (0.6 + Math.random() * 1.6) + (Math.random() - 0.5) * 0.6, vy: n.y * (0.6 + Math.random() * 1.2) + Math.random() * 0.6, vz: n.z * (0.6 + Math.random() * 1.6) + (Math.random() - 0.5) * 0.6,
        size: s * scale * (mat === 'sand' ? 1.8 : 1), grow: 2.5, drag: 2.5, grav: -0.1, maxLife: 0.9 + Math.random() * 0.8,
        r: col[0], g: col[1], b: col[2], a: dusty ? 0.75 : 0.35, fade: 1.5, spin: (Math.random() - 0.5) * 2,
      });
    }
    // chips / debris
    for (let i = 0; i < (mat === 'sand' ? 3 : 5); i++) {
      this.debris.emit({
        x: pt.x, y: pt.y, z: pt.z,
        vx: n.x * (1 + Math.random() * 3) + (Math.random() - 0.5) * 2.5, vy: n.y * (1 + Math.random() * 3) + Math.random() * 2.5, vz: n.z * (1 + Math.random() * 3) + (Math.random() - 0.5) * 2.5,
        size: 0.012 + Math.random() * 0.018, grav: 9.8, drag: 0.5, maxLife: 0.6 + Math.random() * 0.5,
        r: col[0] * 0.5, g: col[1] * 0.5, b: col[2] * 0.5, a: 1, fade: 4,
      });
    }
    if (mat === 'metal') {
      for (let i = 0; i < 6; i++) {
        this.sparks.emit({
          x: pt.x, y: pt.y, z: pt.z,
          vx: n.x * (2 + Math.random() * 4) + (Math.random() - 0.5) * 5, vy: n.y * 3 + Math.random() * 4, vz: n.z * (2 + Math.random() * 4) + (Math.random() - 0.5) * 5,
          size: 0.025 + Math.random() * 0.02, grav: 9.8, drag: 1, maxLife: 0.2 + Math.random() * 0.3,
          r: 1.6, g: 1.0, b: 0.45, a: 1, fade: 2,
        });
      }
    }
    if (mat !== 'sand' || n.y < 0.9) this.decal(pt, n, mat === 'metal' ? 0.045 : 0.06 + Math.random() * 0.03, mat);
  }

  decal(pt, n, size, mat) {
    const q = this._q.setFromUnitVectors(this._z, n);
    const roll = new THREE.Quaternion().setFromAxisAngle(this._z, Math.random() * Math.PI * 2);
    q.multiply(roll);
    this._m.compose(pt.clone().addScaledVector(n, 0.004), q, this._s.set(size, size, size));
    this.holes.setMatrixAt(this.holeIdx, this._m);
    const tint = mat === 'metal' ? new THREE.Color(0.55, 0.55, 0.6) : mat === 'wood' ? new THREE.Color(0.8, 0.65, 0.5) : new THREE.Color(1, 1, 1);
    this.holes.setColorAt(this.holeIdx, tint);
    this.holeIdx = (this.holeIdx + 1) % 220;
    this.holes.count = Math.min(220, this.holes.count + 1);
    this.holes.instanceMatrix.needsUpdate = true;
    if (this.holes.instanceColor) this.holes.instanceColor.needsUpdate = true;
  }

  bloodPuff(pt, dir, k = 1) {
    for (let i = 0; i < 5 * k; i++) {
      this.dust.emit({
        x: pt.x, y: pt.y, z: pt.z,
        vx: dir.x * (0.5 + Math.random() * 1.5) + (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.2) * 1.2, vz: dir.z * (0.5 + Math.random() * 1.5) + (Math.random() - 0.5) * 0.8,
        size: 0.1 + Math.random() * 0.15 * k, grow: 2, drag: 3, grav: 0.8, maxLife: 0.4 + Math.random() * 0.4,
        r: 0.35, g: 0.03, b: 0.02, a: 0.8, fade: 1.2,
      });
    }
  }

  muzzleLight(pos) { this.flashLight.position.copy(pos); this.flashLight.intensity = 5; }
  enemyMuzzle(pos) {
    this.enemyLight.position.copy(pos); this.enemyLight.intensity = 3.5;
    this.dust.emit({ x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 0.3, vz: 0, size: 0.25, grow: 3, drag: 2, maxLife: 0.6, r: 0.7, g: 0.7, b: 0.7, a: 0.25, fade: 1 });
  }

  shell(pos, vel, type) {
    const t = this.shellTypes[type];
    const S = this.shellMeshes[type];
    if (S.list.length >= 40) S.list.shift();
    S.list.push({ pos: pos.clone(), vel: vel.clone(), rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), spin: new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30), bounces: 0, rest: 0, r: t.r, snd: t.snd });
  }

  droppedMag(pos, key) {
    const mesh = new THREE.Mesh(this.magGeo, key === 'glock' ? gunMaterials().polymer : key === 'sniper' ? gunMaterials().steel : this.magMat);
    if (key === 'glock') mesh.scale.set(0.9, 0.7, 0.55);
    mesh.castShadow = true;
    mesh.position.copy(pos);
    this.game.scene.add(mesh);
    const v = new THREE.Vector3(0, -1, 0).applyQuaternion(this.game.camera.quaternion).multiplyScalar(1.5);
    v.add(this.game.player.vel);
    this.mags.push({ mesh, vel: v, spin: new THREE.Vector3(Math.random() * 4, Math.random() * 4, Math.random() * 4), rest: false, t: 0 });
    if (this.mags.length > 8) { const old = this.mags.shift(); this.game.scene.remove(old.mesh); }
  }

  explosion(pos, flash = false) {
    const fs = this.flashSprites.find((f) => f.t >= f.dur) || this.flashSprites[0];
    fs.s.position.copy(pos).add(new THREE.Vector3(0, 0.3, 0));
    fs.s.visible = true; fs.t = 0; fs.dur = flash ? 0.25 : 0.18; fs.size = flash ? 9 : 7;
    fs.s.material.color.setRGB(flash ? 3 : 3, flash ? 3 : 2.2, flash ? 3 : 1.3);
    this.boomLight.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0));
    this.boomLight.intensity = flash ? 120 : 90;
    this.boomLight.color.set(flash ? 0xeef4ff : 0xffb070);
    if (flash) {
      for (let i = 0; i < 10; i++) this.smoke.emit({ x: pos.x, y: pos.y + 0.1, z: pos.z, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 1.2, vz: (Math.random() - 0.5) * 2, size: 0.5 + Math.random() * 0.5, grow: 3, drag: 1.5, grav: -0.15, maxLife: 3 + Math.random() * 2, r: 0.85, g: 0.85, b: 0.85, a: 0.5, fade: 1.3 });
      for (let i = 0; i < 20; i++) this.sparks.emit({ x: pos.x, y: pos.y + 0.1, z: pos.z, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 8, size: 0.04, grav: 9.8, drag: 1, maxLife: 0.3 + Math.random() * 0.4, r: 2, g: 2, b: 2, a: 1, fade: 2 });
      return;
    }
    for (let i = 0; i < 16; i++) {
      this.fire.emit({ x: pos.x + (Math.random() - 0.5) * 0.6, y: pos.y + 0.3 + Math.random() * 0.5, z: pos.z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 6, vy: 1 + Math.random() * 5, vz: (Math.random() - 0.5) * 6, size: 1.2 + Math.random() * 1.2, grow: 1.2, drag: 4, grav: -1, maxLife: 0.35 + Math.random() * 0.35, r: 2.2, g: 1.2, b: 0.45, a: 0.9, fade: 1.5, spin: (Math.random() - 0.5) * 3 });
    }
    for (let i = 0; i < 26; i++) {
      const g = 0.25 + Math.random() * 0.15;
      this.smoke.emit({ x: pos.x + (Math.random() - 0.5), y: pos.y + 0.4 + Math.random(), z: pos.z + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 5, vy: 1 + Math.random() * 3.5, vz: (Math.random() - 0.5) * 5, size: 1.2 + Math.random() * 1.5, grow: 2.5, drag: 1.6, grav: -0.35, maxLife: 4 + Math.random() * 4, r: g, g: g * 0.95, b: g * 0.9, a: 0.75, fade: 1.4, fadeIn: 0.05, spin: (Math.random() - 0.5) });
    }
    for (let i = 0; i < 18; i++) {
      this.dust.emit({ x: pos.x, y: pos.y + 0.1, z: pos.z, vx: (Math.random() - 0.5) * 14, vy: Math.random() * 1.5, vz: (Math.random() - 0.5) * 14, size: 0.6 + Math.random() * 0.8, grow: 3, drag: 3, grav: 0, maxLife: 1.5 + Math.random(), r: 0.72, g: 0.62, b: 0.48, a: 0.6, fade: 1.3 });
    }
    for (let i = 0; i < 40; i++) {
      this.debris.emit({ x: pos.x, y: pos.y + 0.2, z: pos.z, vx: (Math.random() - 0.5) * 16, vy: 2 + Math.random() * 9, vz: (Math.random() - 0.5) * 16, size: 0.02 + Math.random() * 0.05, grav: 9.8, drag: 0.4, maxLife: 1 + Math.random() * 1.2, r: 0.15, g: 0.13, b: 0.1, a: 1, fade: 5 });
    }
    for (let i = 0; i < 24; i++) {
      this.sparks.emit({ x: pos.x, y: pos.y + 0.3, z: pos.z, vx: (Math.random() - 0.5) * 18, vy: Math.random() * 10, vz: (Math.random() - 0.5) * 18, size: 0.05, grav: 9.8, drag: 0.6, maxLife: 0.4 + Math.random() * 0.6, r: 2, g: 1.2, b: 0.5, a: 1, fade: 2 });
    }
    // scorch mark
    if (pos.y < 0.5) {
      this._m.compose(new THREE.Vector3(pos.x, 0.02, pos.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.random() * 6)), this._s.set(4, 4, 4));
      this.scorch.setMatrixAt(this.scorchIdx, this._m);
      this.scorchIdx = (this.scorchIdx + 1) % 24;
      this.scorch.count = Math.min(24, this.scorch.count + 1);
      this.scorch.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt) {
    const g = this.game, W = g.level.world;
    for (const ps of [this.dust, this.smoke, this.sparks, this.fire, this.debris]) ps.update(dt);
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 110);
    this.enemyLight.intensity = Math.max(0, this.enemyLight.intensity - dt * 80);
    this.boomLight.intensity = Math.max(0, this.boomLight.intensity - dt * 260);
    for (const f of this.flashSprites) {
      if (!f.s.visible) continue;
      f.t += dt;
      const k = 1 - f.t / f.dur;
      if (k <= 0) { f.s.visible = false; continue; }
      f.s.scale.setScalar(f.size * (1.2 - k * 0.4));
      f.s.material.opacity = k;
    }
    // shells
    const m = this._m, q = this._q, s = this._s.set(1, 1, 1);
    for (const [, S] of Object.entries(this.shellMeshes)) {
      let n = 0;
      for (let i = S.list.length - 1; i >= 0; i--) {
        const sh = S.list[i];
        if (sh.rest > 0) {
          sh.rest += dt;
          if (sh.rest > 12) { S.list.splice(i, 1); continue; }
        } else {
          sh.vel.y -= 9.81 * dt;
          const imp = W.bounceSphere(sh.pos, sh.vel, sh.r, dt, 0.35, 0.55);
          sh.rot.x += sh.spin.x * dt; sh.rot.y += sh.spin.y * dt; sh.rot.z += sh.spin.z * dt;
          if (imp > 0.8 && sh.bounces < 3) {
            sh.bounces++;
            sh.spin.multiplyScalar(0.6);
            g.audio.playAt(sh.snd === 'brass' ? `brass${(Math.random() * 3) | 0}` : 'shellPlastic', sh.pos.x, sh.pos.y, sh.pos.z, { vol: 0.35 / sh.bounces, max: 15, occlude: false, rate: 0.9 + Math.random() * 0.2 });
          }
          if (sh.pos.y <= sh.r + 0.002 && sh.vel.lengthSq() < 0.05) { sh.rest = 0.001; sh.rot.x = Math.PI / 2; sh.rot.z = 0; }
        }
      }
      for (const sh of S.list) {
        q.setFromEuler(sh.rot);
        m.compose(sh.pos, q, s);
        S.im.setMatrixAt(n++, m);
      }
      S.im.count = n;
      S.im.instanceMatrix.needsUpdate = true;
    }
    for (const mg of this.mags) {
      if (mg.rest) continue;
      mg.vel.y -= 9.81 * dt;
      const imp = W.bounceSphere(mg.mesh.position, mg.vel, 0.04, dt, 0.25, 0.5);
      mg.mesh.rotation.x += mg.spin.x * dt; mg.mesh.rotation.y += mg.spin.y * dt; mg.mesh.rotation.z += mg.spin.z * dt;
      if (imp > 1) g.audio.playAt('magTap', mg.mesh.position.x, mg.mesh.position.y, mg.mesh.position.z, { vol: 0.4, max: 15, occlude: false });
      if (mg.mesh.position.y < 0.05 && mg.vel.lengthSq() < 0.05) { mg.rest = true; mg.mesh.rotation.set(0, mg.mesh.rotation.y, Math.PI / 2); mg.mesh.position.y = 0.016; }
    }
  }
}
