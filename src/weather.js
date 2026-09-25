// Rain: GPU-animated rain streaks in a column that follows the camera (hidden
// under roofs using the baked roof-height map), crown splashes on the ground
// and on rooftops, wet materials, an overcast sky, lightning and thunder.
import * as THREE from 'three';
import * as TX from './textures.js';

const BOX = 44, HEIGHT = 26, DROPS = 12000, SPLASHES = 1400;

const ROOF_FN = `
  uniform sampler2D roofMap; uniform float roofMin, roofSize;
  float roofAt(vec2 xz) { return texture2D(roofMap, (xz - roofMin) / roofSize).b * 8.0; }`;

export class Rain {
  constructor(game, ao) {
    this.game = game;
    this.active = false;
    this.intensity = 0;
    this.group = new THREE.Group();
    this.group.visible = false;
    const shared = {
      time: { value: 0 }, camPos: { value: new THREE.Vector3() }, wind: { value: new THREE.Vector2(1.4, 0.5) },
      light: { value: new THREE.Color(0.55, 0.58, 0.62) }, amount: { value: 1 },
      roofMap: { value: ao.tex }, roofMin: { value: ao.min }, roofSize: { value: ao.size },
    };
    this.uniforms = shared;

    // ---- streaks: two vertices per drop, head and tail ----
    const pos = new Float32Array(DROPS * 6), tail = new Float32Array(DROPS * 2), seed = new Float32Array(DROPS * 2);
    for (let i = 0; i < DROPS; i++) {
      const x = Math.random() * BOX, y = Math.random() * HEIGHT, z = Math.random() * BOX, s = Math.random();
      pos.set([x, y, z, x, y, z], i * 6);
      tail[i * 2] = 0; tail[i * 2 + 1] = 1;
      seed[i * 2] = seed[i * 2 + 1] = s;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.streaks = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: shared, transparent: true, depthWrite: false,
      vertexShader: ROOF_FN + `
        uniform float time, amount; uniform vec3 camPos; uniform vec2 wind;
        attribute float tail, seed; varying float vA;
        void main() {
          float fall = 8.5 + seed * 2.5;
          vec3 vel = vec3(wind.x, -fall, wind.y);
          vec3 p;
          p.y = camPos.y - 6.0 + mod(position.y - time * fall, ${HEIGHT.toFixed(1)});
          p.x = camPos.x + mod(position.x + wind.x * (time) - camPos.x, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
          p.z = camPos.z + mod(position.z + wind.y * (time) - camPos.z, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
          p -= vel * tail * 0.034;                  // motion-blurred streak
          float d = distance(p, camPos);
          vA = (seed < amount ? 1.0 : 0.0) * smoothstep(0.6, 2.0, d) * (1.0 - smoothstep(14.0, 22.0, d));
          float roof = roofAt(p.xz);
          if (roof > 0.3 && p.y < roof + 0.3) vA = 0.0; // under a roof
          if (p.y < 0.0) vA = 0.0;
          vA *= 0.35 + 0.25 * seed;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform vec3 light; varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(light * 1.4, vA); }`,
    }));
    this.streaks.frustumCulled = false;
    this.streaks.userData.noThermal = true;

    // ---- splashes: GPU-cycled crowns on surfaces around the player ----
    const sp = new Float32Array(SPLASHES * 3), ss = new Float32Array(SPLASHES);
    for (let i = 0; i < SPLASHES; i++) { ss[i] = Math.random(); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('seed', new THREE.BufferAttribute(ss, 1));
    this.splashes = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: { ...shared, sprite: { value: splashTexture() }, scale: { value: 400 } }, transparent: true, depthWrite: false,
      vertexShader: ROOF_FN + `
        uniform float time, amount, scale; uniform vec3 camPos;
        attribute float seed; varying float vA; varying float vT;
        float h(float n) { return fract(sin(n * 91.345) * 47453.13); }
        void main() {
          float rate = 3.2;
          float c = time * rate + seed * 13.0;
          float cyc = floor(c), t = fract(c);
          vec2 o = vec2(h(cyc + seed * 7.1), h(cyc * 1.7 + seed * 3.3)) - 0.5;
          vec3 p = vec3(camPos.x + o.x * 26.0, 0.02, camPos.z + o.y * 26.0);
          float roof = roofAt(p.xz);
          if (roof > 0.3) p.y = roof + 0.27;
          vT = t;
          float d = distance(p, camPos);
          vA = (seed < amount ? 1.0 : 0.0) * (1.0 - t) * (1.0 - smoothstep(10.0, 13.0, d));
          vec4 mv = viewMatrix * vec4(p + vec3(0.0, t * 0.05, 0.0), 1.0);
          gl_PointSize = scale * (0.03 + t * 0.06) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D sprite; uniform vec3 light; varying float vA; varying float vT;
        void main(){ vec4 s = texture2D(sprite, gl_PointCoord); float a = s.a * vA * 0.7; if (a < 0.01) discard; gl_FragColor = vec4(light * 1.5, a); }`,
    }));
    this.splashes.frustumCulled = false;
    this.splashes.userData.noThermal = true;
    this.group.add(this.streaks, this.splashes);
    game.scene.add(this.group);

    this.overcast = null;
    this.nextFlash = 20;
    this.flash = 0;
    this.wetMats = new Map();
  }

  /** Switches rain on/off: sky, light, wet materials, puddles, sound. */
  set(on) {
    this.active = on;
    this.group.visible = on;
    this.splashes.visible = !this.indoor; // high above the street there is nothing for drops to land on
    const g = this.game;
    this._wetten(on);
    const gu = g.level.groundUniforms;
    if (gu) gu.wet.value = on ? 1 : 0;
    if (on) g.audio.startLoop?.('rain', 0.55); else g.audio.stopLoop?.('rain');
  }

  overcastSky() {
    if (!this.overcast) this.overcast = TX.overcastSkyTexture();
    return this.overcast;
  }

  _wetten(on) {
    const visit = (m) => {
      if (!m || !m.isMeshStandardMaterial || m.userData.noWet) return;
      if (!this.wetMats.has(m)) this.wetMats.set(m, { r: m.roughness, c: m.color.clone() });
      const o = this.wetMats.get(m);
      if (on) {
        // water fills the micro-roughness and darkens porous surfaces
        m.roughness = Math.max(0.06, o.r * (m.metalness > 0.5 ? 0.6 : 0.38));
        m.color.copy(o.c).multiplyScalar(m.metalness > 0.5 ? 0.9 : 0.68);
      } else { m.roughness = o.r; m.color.copy(o.c); }
    };
    for (const sc of [this.game.scene, this.game.weapons.scene]) sc.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(visit); });
  }

  update(dt, cam) {
    if (!this.active) { this.flash = 0; return; }
    const u = this.uniforms;
    u.time.value += dt;
    u.camPos.value.copy(cam.position);
    const n = this.game.night;
    u.light.value.setRGB(n ? 0.05 : 0.5, n ? 0.055 : 0.53, n ? 0.065 : 0.58);
    this.splashes.material.uniforms.scale.value = this.game.renderer.getDrawingBufferSize(_v2).y * 0.9;
    // lightning: a double flicker, then thunder after the light (sound travels ~3 s/km)
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.nextFlash = 18 + Math.random() * 35;
      this.flashT = 0;
      const dist = 0.6 + Math.random() * 3;
      this.game.audio.play('thunder', { vol: Math.min(1, 1.6 / dist), delay: dist * 2.9, rate: 0.85 + Math.random() * 0.3 });
    }
    if (this.flashT !== undefined && this.flashT < 0.6) {
      this.flashT += dt;
      const t = this.flashT;
      this.flash = (t < 0.08 ? 1 : t < 0.14 ? 0.2 : t < 0.22 ? 0.8 : Math.max(0, 1 - (t - 0.22) / 0.35) * 0.5) * (n ? 3 : 1);
    } else this.flash = 0;
  }
}
const _v2 = new THREE.Vector2();

function splashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(32, 44, 22, 8, 0, 0, Math.PI * 2); ctx.stroke(); // crown ring
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; ctx.beginPath(); ctx.arc(32 + Math.cos(a) * 20, 38 + Math.sin(a) * 6 - 10 - Math.random() * 12, 2, 0, Math.PI * 2); ctx.fill(); }
  const t = new THREE.CanvasTexture(c);
  return t;
}
