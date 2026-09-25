// Shader for SDF-modelled clothing and gear. Each vertex has a region id
// (shirt, trousers, plate carrier, webbing, helmet, gloves...). Colours,
// roughness and surface relief come per region; camouflage and the fabric
// weave are projected triplanar in object space, so there are no UV seams.
import * as THREE from 'three';
import { fbm } from './textures.js';

export const R = {
  SHIRT: 0, PANTS: 1, VEST: 2, BLACK: 3, HELMET: 4, FACE: 5, GLOVE: 6, PALM: 7, BOOT: 8, POUCH: 9, LENS: 10, TPR: 11,
};
const N = 12;

/** Tileable camouflage in the given four colours (base, two blob colours, dark branches). */
export function camoTexture(cols, seed = 1, S = 512) {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  const rgb = cols.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const P = S / 64;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / 64, v = y / 64;
    const n = (k, s, o = 4) => fbm(u * k + s * 0.37, v * k + s * 0.19, s + seed * 11, o, P * k);
    let col = rgb[0];
    if (n(0.75, 31) > 0.56) col = rgb[1];
    if (n(1.25, 37) > 0.61) col = rgb[2];
    if (Math.abs(n(2.0, 43, 3) - 0.5) < 0.033 && n(0.5, 47, 2) > 0.44) col = rgb[3];
    if (n(1.0, 41) > 0.66) col = rgb[3].map((q, i) => (q + rgb[1][i]) / 2);
    const f = 0.93 + Math.random() * 0.09;
    const k = (y * S + x) * 4;
    img.data[k] = col[0] * f; img.data[k + 1] = col[1] * f; img.data[k + 2] = col[2] * f; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

let weave = null;
/** Ripstop weave height (R) + fine noise (G), tileable. */
function weaveTexture() {
  if (weave) return weave;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const wx = Math.sin(x * Math.PI / 2) * (((y >> 1) & 1) ? 1 : -1), wy = Math.sin(y * Math.PI / 2) * (((x >> 1) & 1) ? 1 : -1);
    const grid = (x % 32 < 2 || y % 32 < 2) ? 1 : 0;
    const h = 0.5 + 0.18 * (wx + wy) * 0.5 + grid * 0.3;
    const k = (y * S + x) * 4;
    img.data[k] = Math.max(0, Math.min(255, h * 255)); img.data[k + 1] = Math.random() * 255; img.data[k + 2] = 0; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  weave = new THREE.CanvasTexture(c);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping; weave.anisotropy = 8;
  return weave;
}

/**
 * palette: { colors: {region: hex}, rough: {region: value}, camo: texture for SHIRT/PANTS,
 *            pantsCamo: texture (optional), camoScale }
 */
export function fabricMaterial(palette) {
  const colors = new Array(N).fill(0).map(() => new THREE.Color(0x777777));
  const rough = new Array(N).fill(0.85), metal = new Array(N).fill(0), weaveK = new Array(N).fill(1), molle = new Array(N).fill(0), camoK = new Array(N).fill(0);
  for (const [k, v] of Object.entries(palette.colors || {})) colors[k].set(v);
  for (const [k, v] of Object.entries(palette.rough || {})) rough[k] = v;
  for (const [k, v] of Object.entries(palette.metal || {})) metal[k] = v;
  camoK[R.SHIRT] = 1; camoK[R.PANTS] = palette.pantsCamo === false ? 0 : 2;
  molle[R.VEST] = 1; molle[R.POUCH] = 0.6;
  for (const r of [R.HELMET, R.LENS, R.BOOT, R.PALM, R.TPR]) weaveK[r] = r === R.BOOT || r === R.PALM ? 0.35 : 0;
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 1, metalness: 0, sheen: 0.6, sheenRoughness: 0.7, sheenColor: 0x807866 });
  const u = {
    regionColor: { value: colors }, regionRough: { value: rough }, regionMetal: { value: metal }, regionWeave: { value: weaveK },
    regionMolle: { value: molle }, regionCamo: { value: camoK },
    camoMap: { value: palette.camo }, camoMap2: { value: palette.pantsCamo || palette.camo }, weaveMap: { value: weaveTexture() },
    camoScale: { value: palette.camoScale || 2.2 }, bumpK: { value: palette.bump ?? 1 },
  };
  mat.userData.fabric = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = 'attribute float region; varying float vRegion; varying vec3 vObjPos; varying vec3 vObjN;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vRegion = region; vObjPos = position; vObjN = normal;');
    shader.fragmentShader = `
      uniform vec3 regionColor[${N}]; uniform float regionRough[${N}], regionMetal[${N}], regionWeave[${N}], regionMolle[${N}], regionCamo[${N}];
      uniform sampler2D camoMap, camoMap2, weaveMap; uniform float camoScale, bumpK;
      varying float vRegion; varying vec3 vObjPos; varying vec3 vObjN;
      vec4 tri(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }
      vec3 fabricBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd) {
        vec3 sx = normalize(dFdx(surf_pos)), sy = normalize(dFdy(surf_pos));
        vec3 r1 = cross(sy, surf_norm), r2 = cross(surf_norm, sx);
        float det = dot(sx, r1) * fd;
        vec3 g = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
        return normalize(abs(det) * surf_norm - g);
      }
      ` + shader.fragmentShader
      .replace('#include <map_fragment>', `
        int ri = int(vRegion + 0.5);
        vec3 tw = pow(abs(normalize(vObjN)), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
        vec3 base = regionColor[ri];
        float cm = regionCamo[ri];
        if (cm > 0.5) {
          vec3 camo = cm > 1.5 ? tri(camoMap2, vObjPos * camoScale, tw).rgb : tri(camoMap, vObjPos * camoScale, tw).rgb;
          base = camo;
        }
        // fabric relief: ripstop weave plus MOLLE webbing rows on the carrier and pouches
        float fh = (tri(weaveMap, vObjPos * 9.0, tw).r - 0.5) * regionWeave[ri] * 0.05;
        float mol = regionMolle[ri];
        if (mol > 0.0) {
          float row = fract(vObjPos.y / 0.0254);
          float web = smoothstep(0.02, 0.2, row) * (1.0 - smoothstep(0.55, 0.72, row));
          float tack = step(0.9, fract((vObjPos.x + vObjPos.z) / 0.038));
          fh += (web * 0.07 + tack * 0.02) * mol;
          base *= 1.0 - (1.0 - web) * 0.18 * mol;
        }
        float grime = tri(weaveMap, vObjPos * 1.3, tw).g;
        base *= 0.92 + grime * 0.12;
        diffuseColor.rgb *= base;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = regionRough[ri];')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = regionMetal[ri];')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = fabricBump(-vViewPosition, normal, vec2(dFdx(fh), dFdy(fh)) * bumpK, faceDirection);`);
  };
  mat.customProgramCacheKey = () => 'fabric';
  return mat;
}
