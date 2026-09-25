// Lightens the packed gun meshes in src/gundata.js without re-sculpting them:
// every part is decoded, simplified with meshoptimizer (keeping normals and
// material regions, within a sub-millimetre error that is loosened only as far
// as the triangle budget needs) and re-encoded. Also adds a very low-detail
// 'lod2' copy of each enemy gun for soldiers far from the camera.
//   node tools/slim-guns.mjs            (budgets below)
import fs from 'node:fs';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const OUT = new URL('../src/gundata.js', import.meta.url);
// triangle budget for the whole first-person gun (parts are scaled in proportion)
const BUDGET = { m4: 115000, sniper: 76000, m1014: 66000, glock: 34000 };
const LOD2 = 2600; // far enemy guns
const MIN_PART = 2500; // small parts stay as they are

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const { HEADER, DATA } = await import(OUT.href + '?t=' + Date.now());
const bin = Buffer.from(DATA, 'base64');
const at = (o, len) => new Uint8Array(bin.buffer.slice(bin.byteOffset + o, bin.byteOffset + o + len));

function decode(h) {
  const vb = new Uint8Array(h.n * 12);
  MeshoptDecoder.decodeVertexBuffer(vb, h.n, 12, at(...h.vb));
  const ib = new Uint32Array(h.ni);
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(ib.buffer), h.ni, 4, at(...h.ib));
  return { vb, ib };
}

const chunks = [];
let off = 0;
const push = (bytes) => {
  const pad = (4 - (off % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  chunks.push(b); const p = off; off += b.length; return [p, b.length];
};
/** Re-encodes a vertex/index set (12-byte vertices, remapped after vertex-cache reordering). */
function encode(h, vb, idx) {
  const I = Uint32Array.from(idx);
  const [remap, unique] = MeshoptEncoder.reorderMesh(I, true, false);
  const out = new Uint8Array(unique * 12);
  for (let v = 0; v < remap.length; v++) { const r = remap[v]; if (r !== 0xffffffff) out.set(vb.subarray(v * 12, v * 12 + 12), r * 12); }
  return { ...h, n: unique, ni: I.length, vb: push(MeshoptEncoder.encodeVertexBuffer(out, unique, 12)), ib: push(MeshoptEncoder.encodeIndexBuffer(new Uint8Array(I.buffer), I.length, 4)) };
}
/** Simplifies towards `target` triangles, loosening the error bound only as needed. */
function simplify(h, vb, ib, target, err0) {
  const n = h.n, pos = new Float32Array(n * 3), attr = new Float32Array(n * 4), dv = new DataView(vb.buffer);
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) pos[v * 3 + k] = h.lo[k] + dv.getUint16(v * 12 + k * 2, true) * h.sc[k];
    for (let k = 0; k < 3; k++) attr[v * 4 + k] = dv.getInt8(v * 12 + 6 + k) / 127;
    attr[v * 4 + 3] = vb[v * 12 + 9];
  }
  let err = err0, idx = ib;
  for (let tries = 0; tries < 6; tries++) {
    [idx] = MeshoptSimplifier.simplifyWithAttributes(ib, pos, 3, attr, 4, [0.6, 0.6, 0.6, 4], null, target * 3, err, ['ErrorAbsolute']);
    if (idx.length / 3 <= target * 1.15) break;
    err *= 1.6;
  }
  return new Uint32Array(idx);
}

const header = {};
const totals = {};
for (const [key, h] of Object.entries(HEADER)) {
  if (h.name === 'lod2') continue;
  const { vb, ib } = decode(h);
  const tris = h.ni / 3;
  const gunTris = Object.values(HEADER).filter((x) => x.gun === h.gun && x.name !== 'lod' && x.name !== 'lod2').reduce((s, x) => s + x.ni / 3, 0);
  const ratio = Math.min(1, (BUDGET[h.gun] || gunTris) / gunTris);
  let idx = ib;
  if (h.name !== 'lod' && tris > MIN_PART && ratio < 0.98) idx = simplify(h, vb, ib, Math.max(MIN_PART, Math.floor(tris * ratio)), 0.00011);
  header[key] = encode(h, vb, idx);
  if (h.name !== 'lod') totals[h.gun] = (totals[h.gun] || 0) + idx.length / 3;
  if (h.name === 'lod') {
    const li = simplify(h, vb, ib, LOD2, 0.002);
    header[`${h.gun}.lod2`] = encode({ ...h, name: 'lod2', anim: 'lod2' }, vb, li);
    console.log(`${h.gun}.lod2: ${li.length / 3} tris`);
  }
}
console.log('first-person guns:', Object.entries(totals).map(([g, t]) => `${g} ${Math.round(t / 1000)}k`).join(', '));
const b64 = Buffer.concat(chunks).toString('base64');
const src = fs.readFileSync(OUT, 'utf8');
const headLine = src.slice(0, src.indexOf('export const HEADER'));
fs.writeFileSync(OUT, `${headLine}export const HEADER = ${JSON.stringify(header)};\nexport const DATA = '${b64}';\n`);
console.log(`gundata: ${Object.keys(header).length} meshes, ${(off / 1024).toFixed(0)} KB packed`);
