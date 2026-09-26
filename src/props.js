// Furniture and fixtures from real models (tools/build-props.mjs; credits in
// assets/props/CREDITS.md), loaded at boot and placed by the level builders
// as instanced meshes. Every prop stands on y = 0 at its footprint centre and
// faces -Z. A prop that fails to load leaves the sculpted stand-in in place.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshopt/meshopt_decoder.js';

const MODELS = {};
let META = {};

export async function loadProps(renderer, hq = false) {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  try { META = await (await fetch('assets/props/props.json')).json(); } catch (e) { console.warn('props unavailable', e); return; }
  await Promise.all(Object.keys(META).map(async (name) => {
    try {
      let g = hq ? await loader.loadAsync(`assets/props/${name}_hq.glb`).catch(() => null) : null;
      if (!g) g = await loader.loadAsync(`assets/props/${name}.glb`);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material;
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = aniso;
        m.userData.noWet = true;
      });
      g.scene.updateMatrixWorld(true);
      MODELS[name] = g.scene;
    } catch (e) {
      console.warn(`prop ${name} unavailable`, e);
    }
  }));
}

/** The loaded model, or null. */
export function propModel(name) { return MODELS[name] || null; }
/** Footprint {min, max} in metres (facing -Z), or null. */
export function propBounds(name) { return MODELS[name] ? META[name] : null; }

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

/**
 * Collects placements and builds one InstancedMesh per part of each prop.
 * put(name, x, y, z, ry, sx) returns false when the prop isn't loaded (the caller keeps its stand-in).
 */
export class PropSet {
  constructor() { this.list = new Map(); }
  has(name) { return !!MODELS[name]; }
  put(name, x, y, z, ry = 0, sx = 1, s = 1) {
    if (!MODELS[name]) return false;
    if (!this.list.has(name)) this.list.set(name, []);
    this.list.get(name).push(new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromAxisAngle(UP, ry), _s.set(sx * s, s, s)));
    return true;
  }
  /** World-space footprint of a placement (axis-aligned; ry in quarter turns), for colliders. */
  footprint(name, x, z, ry = 0, sx = 1) {
    const b = META[name];
    const r = ((Math.round(ry / (Math.PI / 2)) % 4) + 4) % 4;
    const hx = (b.max[0] - b.min[0]) / 2 * sx, hz = (b.max[2] - b.min[2]) / 2;
    const [ax, az] = r % 2 ? [hz, hx] : [hx, hz];
    return { x0: x - ax, z0: z - az, x1: x + ax, z1: z + az, h: b.max[1] };
  }
  /**
   * One InstancedMesh per part, per 12 m cell (so rooms out of view are culled). Only tall props
   * (people-height and up) cast shadows: chairs and desk clutter would double their triangles for little.
   */
  build(parent, { heat = 0.31, shadows = true } = {}) {
    const out = [];
    for (const [name, mats] of this.list) {
      const cells = new Map();
      for (const p of mats) {
        const k = `${Math.floor(p.elements[12] / 12)},${Math.floor(p.elements[14] / 12)}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(p);
      }
      const tall = META[name].max[1] - META[name].min[1] > 1.2;
      for (const list of cells.values()) {
        MODELS[name].traverse((o) => {
          if (!o.isMesh) return;
          const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
          const m = new THREE.Matrix4();
          list.forEach((p, i) => { m.multiplyMatrices(p, o.matrixWorld); im.setMatrixAt(i, m); });
          im.castShadow = shadows && tall;
          im.receiveShadow = true;
          im.userData.heat = heat; im.userData.env = true;
          im.computeBoundingSphere();
          parent.add(im);
          out.push(im);
        });
      }
    }
    return out;
  }
}
