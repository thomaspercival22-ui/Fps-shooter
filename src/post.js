// HDR post-processing: the scene renders into a floating-point target, then
// a bloom chain and a single composite pass apply filmic tone mapping,
// colour grading, lens effects and the vision modes (night vision, thermal,
// FPV drone analog video).
import * as THREE from 'three';

export const MODE = { normal: 0, nvg: 1, thermal: 2, fpv: 3 };

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const BRIGHT = `
uniform sampler2D tSrc; uniform float threshold; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + texel * vec2(-0.5,-0.5)).rgb + texture2D(tSrc, vUv + texel * vec2(0.5,-0.5)).rgb
         + texture2D(tSrc, vUv + texel * vec2(-0.5,0.5)).rgb + texture2D(tSrc, vUv + texel * vec2(0.5,0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - threshold * 0.5, 0.0, threshold);
  soft = soft * soft / (4.0 * threshold + 1e-4);
  float k = max(soft, l - threshold) / max(l, 1e-4);
  gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0);
}`;

// dual-filter (Kawase) down / up sampling
const DOWN = `
uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0,1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(1.0,1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;
const UP = `
uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + texel * vec2(-2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + texel * vec2(0.0, 2.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(1.0, 1.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + texel * vec2(2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(1.0, -1.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + texel * vec2(0.0, -2.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb * 2.0;
  gl_FragColor = vec4(c / 12.0, 1.0);
}`;

const COMPOSITE = `
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform float bloomStrength, exposure, mode, time, grain, vignette, saturation, fringe, lowHealth;
uniform float nvgGain, noiseAmt, signal, thermalPalette, useBloom, contrast;
uniform vec3 nvgTint, lift, gain;
uniform vec2 res, sunUV;
uniform float sunVis;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 color){
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = inM * (color / 0.6); color = RRTAndODTFit(color); color = outM * color; return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 ironbow(float t){
  return clamp(vec3(1.5 * t + 0.05, 1.8 * t * t - 0.1, 0.55 * sin(3.14159 * t) + 0.9 * max(0.0, t - 0.8) * 3.0), 0.0, 1.0);
}

void main(){
  vec2 uv = vUv;
  float m = mode;
  if (m > 2.5) {
    // FPV analog video: barrel distortion + line jitter when the signal is weak
    vec2 c = uv - 0.5;
    c *= 1.0 + 0.22 * dot(c, c);
    uv = c * 0.94 + 0.5;
    float bad = 1.0 - signal;
    float line = floor(uv.y * 220.0);
    uv.x += (hash(vec2(line, floor(time * 30.0))) - 0.5) * 0.03 * bad * bad;
    if (hash(vec2(floor(time * 12.0), 3.0)) < bad * 0.35) uv.y += (hash(vec2(time, 1.0)) - 0.5) * 0.05 * bad;
  }
  vec3 col;
  vec2 dc = (uv - 0.5) * fringe;
  if (m < 0.5 || m > 2.5) col = vec3(texture2D(tScene, uv + dc).r, texture2D(tScene, uv).g, texture2D(tScene, uv - dc).b);
  else col = texture2D(tScene, uv).rgb;
  vec3 bloom = useBloom > 0.5 ? texture2D(tBloom, uv).rgb : vec3(0.0);
  float n = hash(uv * res + fract(time * 7.13) * 100.0) - 0.5;

  if (m < 0.5 || m > 2.5) {
    col += bloom * bloomStrength;
    if (sunVis > 0.001) {
      // sun glare, anamorphic streak and lens ghosts
      vec2 asp = vec2(res.x / res.y, 1.0);
      vec2 d = (uv - sunUV) * asp;
      float r = length(d);
      col += vec3(1.0, 0.94, 0.82) * (exp(-r * 10.0) * 2.2 + exp(-r * 2.6) * 0.3) * sunVis;
      col += vec3(1.0, 0.88, 0.72) * exp(-abs(d.y) * 110.0) * exp(-abs(d.x) * 2.4) * 0.45 * sunVis;
      vec2 axis = vec2(0.5) - sunUV;
      for (int i = 1; i <= 4; i++) {
        float fi = float(i);
        vec2 gp = sunUV + axis * (0.55 + fi * 0.42);
        float gr = length((uv - gp) * asp);
        float rad = 0.025 + 0.018 * fi;
        vec3 tint = i == 2 ? vec3(0.9, 0.6, 0.35) : vec3(0.45, 0.65, 1.0);
        col += tint * smoothstep(rad, rad * 0.6, gr) * 0.06 * sunVis;
      }
    }
    col = aces(col * exposure);
    // grade: lift shadows / tint highlights, saturation, contrast
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, saturation - lowHealth * 0.55);
    col = col * gain + lift * (1.0 - col);
    col = clamp((col - 0.5) * contrast + 0.5, 0.0, 1.0);
    col = toSRGB(col);
    col += n * grain;
  } else if (m < 1.5) {
    // Night vision: image intensifier with auto-brightness, phosphor tint and scintillation
    float l = dot(col + bloom * 2.2, vec3(0.3, 0.59, 0.11)) * nvgGain;
    l = 1.0 - exp(-l * 1.6);
    l += n * noiseAmt * (1.2 - l);
    l = clamp(l * 1.06 + 0.02, 0.0, 1.0);
    col = nvgTint * pow(l, 0.85);
    // honeycomb / tube texture
    col *= 0.93 + 0.07 * hash(floor(uv * res / 2.0));
    vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0);
    float d = min(length(p - vec2(-0.29, 0.0)), length(p + vec2(-0.29, 0.0)));
    col *= smoothstep(0.53, 0.47, d);
    col *= mix(1.0, smoothstep(0.55, 0.2, d), 0.35);
  } else {
    // Thermal: red channel carries heat. Low-res sensor, blur, auto contrast, palette.
    vec2 sensor = vec2(480.0, 480.0 * res.y / res.x);
    vec2 suv = (floor(uv * sensor) + 0.5) / sensor;
    vec2 t = 1.0 / sensor;
    float h = texture2D(tScene, suv).r * 0.5 + (texture2D(tScene, suv + vec2(t.x, 0.0)).r + texture2D(tScene, suv - vec2(t.x, 0.0)).r
            + texture2D(tScene, suv + vec2(0.0, t.y)).r + texture2D(tScene, suv - vec2(0.0, t.y)).r) * 0.125;
    h = clamp((h - 0.08) / 0.92, 0.0, 1.0);
    h = pow(h, 0.9) + n * 0.035;
    h = clamp(h, 0.0, 1.0);
    if (thermalPalette < 0.5) col = vec3(h);
    else if (thermalPalette < 1.5) col = vec3(1.0 - h);
    else col = ironbow(h);
    col *= 0.96 + 0.04 * sin(uv.y * res.y * 1.2);
  }

  // lens vignette
  vec2 vq = (vUv - 0.5) * vec2(res.x / res.y, 1.0);
  col *= mix(1.0, smoothstep(1.05, 0.25, length(vq)), vignette);

  if (m > 2.5) {
    float bad = 1.0 - signal;
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, vec3(lum), 0.25);
    col *= 0.9 + 0.1 * sin(vUv.y * res.y * 1.6 + time * 40.0);
    float st = hash(vec2(floor(vUv.x * res.x / 2.0), floor(vUv.y * res.y / 2.0)) + fract(time * 13.7));
    col = mix(col, vec3(st), clamp(bad * bad * 1.3, 0.0, 1.0));
    col += (st - 0.5) * 0.08;
    vec2 cc = vUv - 0.5; col *= smoothstep(0.75, 0.45, length(cc * vec2(1.0, 1.25)));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
  constructor(renderer) {
    this.r = renderer;
    const ext = renderer.extensions;
    const hdr = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    this.type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.samples = 4;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: this.type, samples: this.samples });
    this.levels = [];
    for (let i = 0; i < 5; i++) this.levels.push(new THREE.WebGLRenderTarget(4, 4, { type: this.type, depthBuffer: false }));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(g, null);
    this.quad.frustumCulled = false;
    const mk = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
    this.bright = mk(BRIGHT, { tSrc: { value: null }, threshold: { value: 1.2 }, texel: { value: new THREE.Vector2() } });
    this.down = mk(DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
    this.up = mk(UP, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.comp = mk(COMPOSITE, {
      tScene: { value: null }, tBloom: { value: null }, bloomStrength: { value: 0.08 }, exposure: { value: 1 },
      mode: { value: 0 }, time: { value: 0 }, grain: { value: 0.018 }, vignette: { value: 0.35 }, saturation: { value: 1.06 },
      fringe: { value: 0.0025 }, lowHealth: { value: 0 }, nvgGain: { value: 8 }, noiseAmt: { value: 0.25 }, signal: { value: 1 },
      thermalPalette: { value: 0 }, useBloom: { value: 1 }, contrast: { value: 1.04 },
      nvgTint: { value: new THREE.Color(0.52, 1.0, 0.62) }, lift: { value: new THREE.Color(0.012, 0.014, 0.02) }, gain: { value: new THREE.Color(1.02, 1.0, 0.97) },
      res: { value: new THREE.Vector2(1, 1) }, sunUV: { value: new THREE.Vector2(0.5, 0.5) }, sunVis: { value: 0 },
    });
    this.bloom = true;
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.rt.setSize(w, h);
    let lw = w, lh = h;
    for (const l of this.levels) { lw = Math.max(1, Math.ceil(lw / 2)); lh = Math.max(1, Math.ceil(lh / 2)); l.setSize(lw, lh); }
    this.comp.uniforms.res.value.set(w, h);
  }

  setQuality(q) {
    this.bloom = q !== 'low';
    const s = q === 'low' ? 0 : 4;
    if (s !== this.samples) {
      this.samples = s;
      this.rt.dispose();
      this.rt = new THREE.WebGLRenderTarget(this.w || 4, this.h || 4, { type: this.type, samples: s });
    }
  }

  _pass(mat, target, clear = true) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    if (clear) this.r.clear(true, false, false);
    this.r.render(this.quad, this.cam);
  }

  /** Runs bloom + composite and writes the final image to the screen. */
  finish(u) {
    const r = this.r;
    const auto = r.autoClear;
    r.autoClear = false;
    const C = this.comp.uniforms;
    const useBloom = this.bloom && u.mode !== MODE.thermal;
    if (useBloom) {
      const L = this.levels;
      this.bright.uniforms.tSrc.value = this.rt.texture;
      this.bright.uniforms.threshold.value = u.threshold ?? 1.2;
      this.bright.uniforms.texel.value.set(1 / this.w, 1 / this.h);
      this._pass(this.bright, L[0]);
      for (let i = 1; i < L.length; i++) {
        this.down.uniforms.tSrc.value = L[i - 1].texture;
        this.down.uniforms.texel.value.set(1 / L[i - 1].width, 1 / L[i - 1].height);
        this._pass(this.down, L[i]);
      }
      for (let i = L.length - 1; i > 0; i--) {
        this.up.uniforms.tSrc.value = L[i].texture;
        this.up.uniforms.texel.value.set(0.5 / L[i].width, 0.5 / L[i].height);
        this._pass(this.up, L[i - 1], false);
      }
      C.tBloom.value = L[0].texture;
    }
    C.useBloom.value = useBloom ? 1 : 0;
    C.tScene.value = this.rt.texture;
    C.mode.value = u.mode;
    C.time.value = u.time;
    C.exposure.value = u.exposure ?? 1;
    C.bloomStrength.value = u.bloomStrength ?? 0.08;
    C.lowHealth.value = u.lowHealth ?? 0;
    C.nvgGain.value = u.nvgGain ?? 8;
    C.noiseAmt.value = u.noise ?? 0.25;
    C.signal.value = u.signal ?? 1;
    C.thermalPalette.value = u.palette ?? 0;
    C.vignette.value = u.vignette ?? 0.35;
    C.grain.value = u.grain ?? 0.018;
    if (u.tint) C.nvgTint.value.copy(u.tint);
    C.sunVis.value = u.sunVis ?? 0;
    if (u.sunUV) C.sunUV.value.copy(u.sunUV);
    this._pass(this.comp, null);
    r.autoClear = auto;
  }
}

// ---------- thermal rendering ----------
// Every mesh is drawn with one material that writes its temperature. The
// temperature comes from object.userData.heat (set when objects are built).
export const thermalMaterial = new THREE.ShaderMaterial({
  uniforms: { heat: { value: 0.3 } },
  vertexShader: `
    #include <common>
    varying vec3 vN; varying vec3 vView;
    void main(){
      #include <beginnormal_vertex>
      #include <defaultnormal_vertex>
      #include <begin_vertex>
      #include <project_vertex>
      vN = normalize(transformedNormal);
      vView = normalize(-mvPosition.xyz);
    }`,
  fragmentShader: `
    uniform float heat; varying vec3 vN; varying vec3 vView;
    void main(){
      float ndv = abs(dot(normalize(vN), normalize(vView)));
      // bodies radiate most straight on; edges read a little cooler
      float h = heat * (0.72 + 0.28 * ndv);
      gl_FragColor = vec4(h, h, h, 1.0);
    }`,
  side: THREE.DoubleSide,
});

export function withThermal(fn, ambient) {
  const proto = THREE.Mesh.prototype;
  const orig = proto.onBeforeRender;
  proto.onBeforeRender = function () {
    const h = this.userData.heat;
    thermalMaterial.uniforms.heat.value = h === undefined ? ambient : h * (this.userData.env ? ambient / 0.3 : 1);
    thermalMaterial.uniformsNeedUpdate = true;
  };
  try { fn(); } finally { proto.onBeforeRender = orig; }
}
