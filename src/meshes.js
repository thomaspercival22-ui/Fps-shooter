// Decodes the prebuilt SDF meshes (see tools/build-meshes.mjs) into geometries.
import * as THREE from 'three';
import { HEADER, DATA } from './meshdata.js';

let cache = null;
export function meshes() {
  if (cache) return cache;
  const bin = Uint8Array.from(atob(DATA), (c) => c.charCodeAt(0)).buffer;
  cache = {};
  for (const [name, h] of Object.entries(HEADER)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, h.pos, h.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, h.nor, h.n * 3), 3, true));
    g.setAttribute('region', new THREE.BufferAttribute(new Float32Array(new Uint8Array(bin, h.reg, h.n)), 1));
    g.setIndex(new THREE.BufferAttribute(h.big ? new Uint32Array(bin, h.idx, h.ni) : new Uint16Array(bin, h.idx, h.ni), 1));
    g.computeBoundingSphere();
    if (h.wrist) g.userData.wrist = h.wrist;
    cache[name] = g;
  }
  return cache;
}
