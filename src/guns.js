// Decodes the sculpted weapon meshes (see tools/build-guns.mjs): each mesh is
// a meshoptimizer-compressed vertex buffer (12 bytes: quantised position,
// normal, material region, edge wear, cavity) and index buffer.
import * as THREE from 'three';
import { MeshoptDecoder } from '../vendor/meshopt/meshopt_decoder.js';
import { HEADER, DATA } from './gundata.js';

/** Resolves once the decoder is ready; await before building any gun. */
export const gunsReady = MeshoptDecoder.ready;

let bin = null;
const cache = {};

function buffer() {
  if (bin) return bin;
  const s = atob(DATA), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  bin = u.buffer;
  return bin;
}

/** Geometry of one part, e.g. gunGeo('m4', 'upper'); userData has anim group, pivot and material kind. */
export function gunGeo(gun, name) {
  const key = `${gun}.${name}`;
  if (cache[key]) return cache[key];
  const h = HEADER[key];
  if (!h) return null;
  const b = buffer(), n = h.n;
  const vb = new Uint8Array(n * 12);
  MeshoptDecoder.decodeVertexBuffer(vb, n, 12, new Uint8Array(b, h.vb[0], h.vb[1]));
  const ib = new Uint32Array(h.ni);
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(ib.buffer), h.ni, 4, new Uint8Array(b, h.ib[0], h.ib[1]));
  const dv = new DataView(vb.buffer);
  const pos = new Float32Array(n * 3), nor = new Int8Array(n * 3), reg = new Uint8Array(n), wear = new Uint8Array(n * 2);
  for (let v = 0, o = 0; v < n; v++, o += 12) {
    pos[v * 3] = h.lo[0] + dv.getUint16(o, true) * h.sc[0];
    pos[v * 3 + 1] = h.lo[1] + dv.getUint16(o + 2, true) * h.sc[1];
    pos[v * 3 + 2] = h.lo[2] + dv.getUint16(o + 4, true) * h.sc[2];
    nor[v * 3] = dv.getInt8(o + 6); nor[v * 3 + 1] = dv.getInt8(o + 7); nor[v * 3 + 2] = dv.getInt8(o + 8);
    reg[v] = vb[o + 9]; wear[v * 2] = vb[o + 10]; wear[v * 2 + 1] = vb[o + 11];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
  g.setAttribute('region', new THREE.BufferAttribute(reg, 1));
  g.setAttribute('wear', new THREE.BufferAttribute(wear, 2, true));
  g.setIndex(new THREE.BufferAttribute(n < 65536 ? Uint16Array.from(ib) : ib, 1));
  g.computeBoundingSphere();
  g.userData = { anim: h.anim, pivot: h.pivot, material: h.material, name: h.name };
  cache[key] = g;
  return g;
}

/** Part names of a gun in build order (the enemies' 'lod' copy excluded). */
export function gunPartNames(gun) {
  return Object.values(HEADER).filter((h) => h.gun === gun && h.name !== 'lod').map((h) => h.name);
}
