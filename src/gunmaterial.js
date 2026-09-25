// Weapon shader for the sculpted guns: every vertex carries a material region
// (anodised aluminium, nitrided steel, polymer, Cerakote, rubber...) and a
// baked edge / cavity value. Edges wear through to bare metal where hands and
// gear rub, fine desert dust settles in grooves, and each finish gets its own
// micro-surface (bead blast, stippling, knurling) projected in object space.
import * as THREE from 'three';
import { G, REGION_COUNT as N } from './gunregions.js';

// region: [colour, roughness, metalness, edge colour, edge roughness, edge metalness, wear amount, clearcoat, micro type, micro strength]
// micro types: 0 bead-blast, 1 stippling, 2 diamond knurl, 3 rubber grain
const TABLE = {
  [G.ANOD]: ['#1c1d1f', 0.5, 0.45, '#a9acb0', 0.28, 1.0, 1.0, 0.35, 0, 0.6],
  [G.STEEL]: ['#16171a', 0.42, 0.7, '#7d8084', 0.27, 1.0, 0.55, 0.0, 0, 0.5],
  [G.POLY]: ['#18181a', 0.72, 0.0, '#34353a', 0.5, 0.0, 0.7, 0.0, 0, 0.9],
  [G.FDE]: ['#7d6a4d', 0.76, 0.0, '#a59478', 0.55, 0.0, 0.8, 0.0, 0, 0.9],
  [G.RUBBER]: ['#111112', 0.9, 0.0, '#1d1d1f', 0.8, 0.0, 0.3, 0.0, 3, 1.0],
  [G.BRIGHT]: ['#b3b0a8', 0.24, 1.0, '#c9c7c0', 0.18, 1.0, 0.4, 0.0, 0, 0.3],
  [G.BRASS]: ['#b08a4a', 0.3, 1.0, '#d2b070', 0.2, 1.0, 0.5, 0.0, 0, 0.3],
  [G.CAN]: ['#262624', 0.68, 0.15, '#6a6a66', 0.35, 0.8, 0.9, 0.0, 0, 0.7],
  [G.OD]: ['#4a5039', 0.74, 0.05, '#7a8165', 0.5, 0.3, 0.9, 0.0, 0, 0.8],
  [G.SHELL]: ['#8b1c17', 0.45, 0.0, '#a8322a', 0.35, 0.0, 0.4, 0.0, 0, 0.4],
  [G.BLACK]: ['#0b0b0c', 0.82, 0.1, '#1a1a1c', 0.7, 0.2, 0.2, 0.0, 0, 0.5],
  [G.WHITE]: ['#d6d5cc', 0.6, 0.0, '#e6e5dd', 0.5, 0.0, 0.2, 0.0, 0, 0.3],
  [G.POLYTEX]: ['#161618', 0.86, 0.0, '#2c2d31', 0.62, 0.0, 0.5, 0.0, 1, 1.0],
  [G.FDETEX]: ['#7a674a', 0.86, 0.0, '#9d8c6f', 0.65, 0.0, 0.5, 0.0, 1, 0.9],
  [G.KNURL]: ['#1a1b1d', 0.46, 0.6, '#9a9da1', 0.25, 1.0, 1.0, 0.0, 2, 1.0],
  [G.GRAY]: ['#4a4c4e', 0.58, 0.25, '#9fa2a5', 0.3, 1.0, 0.8, 0.0, 0, 0.6],
};

let grungeTex = null;
/** Tileable grunge: R fine grain, G wear break-up, B scratches, A large blotches. */
function grunge() {
  if (grungeTex) return grungeTex;
  const S = 256, data = new Uint8Array(S * S * 4);
  const hash = (x, y, s) => { let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  const vnoise = (x, y, P, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const c = (dx, dy) => hash(((xi + dx) % P + P) % P, ((yi + dy) % P + P) % P, s);
    return (c(0, 0) * (1 - u) + c(1, 0) * u) * (1 - v) + (c(0, 1) * (1 - u) + c(1, 1) * u) * v;
  };
  const fbm = (x, y, P, s, o) => { let a = 0, w = 0.5, t = 0; for (let i = 0; i < o; i++) { a += vnoise(x * (1 << i), y * (1 << i), P * (1 << i), s + i) * w; t += w; w *= 0.5; } return a / t; };
  const scratch = new Float32Array(S * S);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 70; k++) {
    let x = rnd() * S, y = rnd() * S; const a = rnd() * Math.PI, len = 6 + rnd() * 30, dx = Math.cos(a), dy = Math.sin(a), w = 0.3 + rnd() * 0.7;
    for (let t = 0; t < len; t += 0.5) { const px = ((Math.round(x + dx * t) % S) + S) % S, py = ((Math.round(y + dy * t) % S) + S) % S; scratch[py * S + px] = Math.max(scratch[py * S + px], w); }
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    data[i] = fbm(x / 4, y / 4, S / 4, 1, 3) * 255;
    data[i + 1] = fbm(x / 22, y / 22, Math.round(S / 22), 5, 4) * 255;
    data[i + 2] = scratch[y * S + x] * 255;
    data[i + 3] = fbm(x / 48, y / 48, Math.round(S / 48), 9, 3) * 255;
  }
  grungeTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  grungeTex.wrapS = grungeTex.wrapT = THREE.RepeatWrapping;
  grungeTex.magFilter = THREE.LinearFilter; grungeTex.minFilter = THREE.LinearMipmapLinearFilter;
  grungeTex.generateMipmaps = true; grungeTex.anisotropy = 4;
  grungeTex.needsUpdate = true;
  return grungeTex;
}

/**
 * opts.clearcoat: allow the anodised clear layer (viewmodels); opts.dust:
 * amount of desert dust in grooves. Returns a MeshPhysicalMaterial whose
 * userData.gun holds live uniforms (canHeat for a suppressor's glow).
 */
export function gunMaterial(opts = {}) {
  const col = [], par = [], edge = [], par2 = [];
  for (let r = 0; r < N; r++) {
    const t = TABLE[r] || TABLE[G.POLY];
    col.push(new THREE.Color(t[0]));
    edge.push(new THREE.Color(t[3]));
    par.push(new THREE.Vector4(t[1], t[2], t[6], t[8]));
    par2.push(new THREE.Vector4(t[4], t[5], t[7], t[9]));
  }
  const cc = opts.clearcoat !== false;
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 1, metalness: 0, clearcoat: cc ? 1 : 0, clearcoatRoughness: 0.35 });
  const u = {
    rgCol: { value: col }, rgEdge: { value: edge }, rgPar: { value: par }, rgPar2: { value: par2 },
    grunge: { value: grunge() }, dustCol: { value: new THREE.Color('#8f7d60') }, dustAmt: { value: opts.dust ?? 0.7 },
    canHeat: { value: 0 },
  };
  mat.userData.gun = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float region; attribute vec2 wear; varying float vRegion; varying vec2 vWear; varying vec3 vObjPos; varying vec3 vObjN;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vRegion = region; vWear = wear; vObjPos = position; vObjN = normal;');
    sh.fragmentShader = `
      uniform vec3 rgCol[${N}], rgEdge[${N}]; uniform vec4 rgPar[${N}], rgPar2[${N}];
      uniform sampler2D grunge; uniform vec3 dustCol; uniform float dustAmt, canHeat;
      varying float vRegion; varying vec2 vWear; varying vec3 vObjPos; varying vec3 vObjN;
      vec4 triG(vec3 p, vec3 w) { return texture2D(grunge, p.zy) * w.x + texture2D(grunge, p.xz) * w.y + texture2D(grunge, p.xy) * w.z; }
      float knurl(vec2 q) { q *= 6980.0; return abs(sin((q.x + q.y) * 0.5)) * abs(sin((q.x - q.y) * 0.5)); }
      vec3 gunBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd) {
        vec3 sx = normalize(dFdx(surf_pos)), sy = normalize(dFdy(surf_pos));
        vec3 r1 = cross(sy, surf_norm), r2 = cross(surf_norm, sx);
        float det = dot(sx, r1) * fd;
        vec3 g = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
        return normalize(abs(det) * surf_norm - g);
      }
      ` + sh.fragmentShader
      .replace('#include <map_fragment>', `
        int ri = int(vRegion + 0.5);
        vec3 tw = pow(abs(normalize(vObjN)), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
        vec4 gF = triG(vObjPos * 42.0, tw), gM = triG(vObjPos * 7.0, tw);
        vec4 P1 = rgPar[ri], P2 = rgPar2[ri];
        float edgeW = vWear.x, cav = vWear.y;
        // edge wear, broken up so it looks rubbed rather than painted on
        float wearM = smoothstep(0.38, 0.72, edgeW * (0.35 + 1.15 * gM.g)) * P1.z;
        float scr = smoothstep(0.5, 0.95, gF.b) * P1.z * 0.3;
        vec3 base = rgCol[ri] * (0.9 + 0.2 * gM.a);
        base = mix(base, rgEdge[ri], max(wearM, scr * 0.25));
        // fine dust in grooves and on upward faces
        float dust = clamp(cav * 1.3 * (0.55 + 0.9 * gM.b) + smoothstep(0.55, 1.0, vObjN.y) * 0.15 * gM.a, 0.0, 1.0) * dustAmt;
        dust *= 1.0 - wearM;
        base = mix(base, dustCol, dust * 0.6);
        diffuseColor.rgb *= base;
        float gunRough = mix(P1.x, P2.x, max(wearM, scr * 0.6)) * (0.86 + 0.28 * gF.r);
        gunRough = mix(gunRough, 0.95, dust * 0.8);
        float gunMetal = mix(P1.y, P2.y, max(wearM, scr * 0.6)) * (1.0 - dust * 0.8);
        // micro surface height (metres) for the bump: bead blast, stippling, knurling, rubber grain
        int micro = int(P1.w + 0.5);
        vec4 gX = triG(vObjPos * 130.0, tw);
        float kn = knurl(vObjPos.zy) * tw.x + knurl(vObjPos.xz) * tw.y + knurl(vObjPos.xy) * tw.z;
        float kFade = clamp(1.6 - length(fwidth(vObjPos)) * 6980.0 * 0.35, 0.0, 1.0);
        float mh = micro == 1 ? ((gF.r - 0.5) * 0.9 + (gX.r - 0.5) * 0.6) * 0.00016
                 : micro == 2 ? kn * 0.00022 * kFade
                 : micro == 3 ? (gX.r - 0.5) * 0.00008
                 : (gX.r - 0.5) * 0.00002;
        mh *= P2.w;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gunRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = gunMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = gunBump(-vViewPosition, normal, vec2(dFdx(mh), dFdy(mh)), faceDirection);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat = P2.z * (1.0 - dust) * (1.0 - wearM);
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (ri == ${G.CAN} && canHeat > 0.0) {
          // heat soak along the can: the blast chamber runs hottest, baffle rings brighter
          float f = -vObjPos.z;
          float glow = smoothstep(0.515, 0.55, f) * (1.0 - 0.75 * smoothstep(0.575, 0.65, f));
          glow *= 0.78 + 0.22 * smoothstep(0.2, 1.0, sin(f * 520.0));
          totalEmissiveRadiance += vec3(1.0, 0.227, 0.03) * canHeat * glow * glow * mix(vec3(0.85, 0.55, 0.4), vec3(1.2, 1.5, 1.8), glow * clamp(canHeat * 3.0 - 0.3, 0.0, 1.0));
        }`);
  };
  mat.customProgramCacheKey = () => 'gun' + (cc ? 'C' : '');
  return mat;
}
