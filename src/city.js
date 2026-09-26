// The skyline around Meridian Tower from real building models
// (tools/build-city.mjs; credits in assets/city/CREDITS.md). Each tower in the
// pack stands on y = 0 at its footprint centre; the tower level places copies
// on its street grid as instanced meshes. At night random windows light up
// (dark glass in the facade texture, on a floor/bay grid in world space).
import * as THREE from 'three';
import { modelLoader } from './gltf.js';

let MODEL = null, META = null;

export async function loadCity(renderer, hq = false) {
  const loader = await modelLoader();
  try {
    META = await (await fetch('assets/city/city.json')).json();
    let g = hq ? await loader.loadAsync('assets/city/city_hq.glb').catch(() => null) : null;
    if (!g) g = await loader.loadAsync('assets/city/city.glb');
    MODEL = g.scene;
    MODEL.updateMatrixWorld(true);
  } catch (e) {
    console.warn('city skyline unavailable', e);
    MODEL = null;
  }
}

/** Tower names with their footprint (w along x, d along z) and height, or [] when the pack isn't loaded. */
export function cityTowers() {
  return MODEL ? Object.entries(META).map(([name, t]) => ({ name, ...t })) : [];
}

const litMaterials = new WeakMap();
/** A copy of the material whose dark glass lights up at random when night = 1. */
function nightMaterial(m, night) {
  if (litMaterials.has(m)) return litMaterials.get(m);
  if (!m.isMeshStandardMaterial) { litMaterials.set(m, m); return m; }
  const n = m.clone();
  n.userData.noWet = true;
  n.onBeforeCompile = (shader) => {
    shader.uniforms.night = night;
    shader.vertexShader = 'varying vec3 vCW; varying vec3 vCN; varying float vSeed;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 cw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      vCW = cw.xyz; vCN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`);
    shader.fragmentShader = 'uniform float night; varying vec3 vCW; varying vec3 vCN; varying float vSeed;\nfloat h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }\n' + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 an = abs(vCN);
          float wall = 1.0 - step(0.5, an.y);
          float u = an.x > an.z ? vCW.z : vCW.x;
          float fl = floor(vCW.y / 3.7), bay = floor(u / 1.9);
          float glass = 1.0 - smoothstep(0.16, 0.34, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
          float on = step(0.74, h31(vec3(bay, fl, floor(vSeed * 97.0)))) * glass * wall * night;
          float tone = h31(vec3(bay * 0.37, fl * 1.3, vSeed));
          totalEmissiveRadiance += on * mix(vec3(1.0, 0.82, 0.55), vec3(0.8, 0.9, 1.0), step(0.6, tone)) * (0.3 + tone * 0.6);
        }`);
  };
  n.customProgramCacheKey = () => 'citytower';
  litMaterials.set(m, n);
  return n;
}

/**
 * Adds the towers to `parent`: placements [{ name, x, y, z, turn (quarter turns), s (uniform scale) }].
 * One InstancedMesh per part of each tower type. `night` is the shared { value } uniform.
 */
export function buildSkyline(parent, placements, night) {
  if (!MODEL) return [];
  const byName = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const p of placements) {
    if (!byName.has(p.name)) byName.set(p.name, []);
    byName.get(p.name).push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.turn * Math.PI / 2), new THREE.Vector3(p.s, p.s, p.s)));
  }
  const out = [];
  for (const [name, mats] of byName) {
    const tower = MODEL.getObjectByName(name);
    if (!tower) continue;
    tower.traverse((o) => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, nightMaterial(o.material, night), mats.length);
      const rel = new THREE.Matrix4().copy(tower.matrixWorld).invert().multiply(o.matrixWorld);
      mats.forEach((p, i) => { m4.multiplyMatrices(p, rel); im.setMatrixAt(i, m4); });
      im.castShadow = false; im.receiveShadow = false;
      im.userData.heat = 0.3; im.userData.noWet = true;
      im.computeBoundingSphere();
      parent.add(im);
      out.push(im);
    });
  }
  return out;
}
