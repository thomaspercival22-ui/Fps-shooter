// Builds the sculpted weapon meshes from src/gunparts.js and stores them in
// src/gundata.js (quantised positions, packed normals, material region and
// baked edge-wear/cavity per vertex, plus a low-detail merged copy of each gun
// for enemy soldiers). Parts are meshed in parallel worker threads.
//   node tools/build-guns.mjs            all guns
//   node tools/build-guns.mjs m4 glock   only these guns (others are kept)
//   node tools/build-guns.mjs --hq       Cinematic (gaming PC) set: 6x the triangles at a tighter
//                                        error bound, written to src/gundata_hq.js
import fs from 'fs';
import os from 'os';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

const HQ = process.argv.includes('--hq') || (!isMainThread && workerData.hq);
const OUT = new URL(HQ ? '../src/gundata_hq.js' : '../src/gundata.js', import.meta.url);
const TRIS = HQ ? 6 : 1;            // triangle budget multiplier
const ERR = HQ ? 0.35 : 1;          // starting error bound multiplier

async function buildPart(gun, index) {
  const { GUNS } = await import('../src/gunparts.js');
  await MeshoptSimplifier.ready;
  const part = GUNS[gun]()[index];
  const t0 = Date.now();
  const raw = part.mesh();
  const rawTris = raw.idx.length / 3;
  // simplify: absolute error in metres, keeping normals and region seams
  const n = raw.reg.length, attr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { attr[i * 4] = raw.nor[i * 3]; attr[i * 4 + 1] = raw.nor[i * 3 + 1]; attr[i * 4 + 2] = raw.nor[i * 3 + 2]; attr[i * 4 + 3] = raw.reg[i]; }
  // loosen the error bound step by step while the part stays far over its budget
  let idx, err = part.error * ERR;
  const budget = part.tris * TRIS;
  for (;;) {
    [idx] = MeshoptSimplifier.simplifyWithAttributes(raw.idx, raw.pos, 3, attr, 4, [0.6, 0.6, 0.6, 4], null, budget * 3, err, ['ErrorAbsolute']);
    if (idx.length / 3 <= budget * 1.35 || err > 0.0005) break;
    err *= 1.5;
  }
  const [remap, unique] = MeshoptSimplifier.compactMesh(idx = new Uint32Array(idx));
  const pos = new Float32Array(unique * 3), nor = new Float32Array(unique * 3), reg = new Uint8Array(unique);
  for (let v = 0; v < remap.length; v++) {
    const r = remap[v];
    if (r === 0xffffffff) continue;
    pos.set(raw.pos.subarray(v * 3, v * 3 + 3), r * 3); nor.set(raw.nor.subarray(v * 3, v * 3 + 3), r * 3); reg[r] = raw.reg[v];
  }
  const wear = part.wear(pos, nor);
  // store relative to the pivot the runtime group rotates about
  if (part.pivot) for (let v = 0; v < unique; v++) { pos[v * 3] -= part.pivot[0]; pos[v * 3 + 1] -= part.pivot[1]; pos[v * 3 + 2] += part.pivot[2]; }
  return { name: part.name, anim: part.anim, pivot: part.pivot, material: part.material, lod: part.lod, pos, nor, reg, wear, idx, rawTris, ms: Date.now() - t0 };
}

if (!isMainThread) {
  const r = await buildPart(workerData.gun, workerData.index);
  parentPort.postMessage(r);
  process.exit(0);
}

// ---------------- main thread ----------------
const { GUNS } = await import('../src/gunparts.js');
await MeshoptSimplifier.ready;
const repack = process.argv.includes('--repack');
const only = repack ? ['--none--'] : process.argv.slice(2).filter((a) => !a.startsWith('--'));
const guns = Object.keys(GUNS).filter((g) => !only.length || only.includes(g));
const jobs = [];
for (const g of guns) GUNS[g]().forEach((p, i) => jobs.push({ gun: g, index: i, name: p.name }));

const results = {};
const t0 = Date.now();
await new Promise((resolve, reject) => {
  let next = 0, running = 0;
  const workers = Math.max(1, Math.min(os.cpus().length, 4));
  const launch = () => {
    if (next >= jobs.length) { if (running === 0) resolve(); return; }
    const job = jobs[next++];
    running++;
    const w = new Worker(new URL(import.meta.url), { workerData: { ...job, hq: HQ }, resourceLimits: { maxOldGenerationSizeMb: 3000 } });
    w.on('message', (r) => {
      results[`${job.gun}.${r.name}`] = { gun: job.gun, ...r };
      console.log(`${job.gun}.${r.name}: ${r.rawTris} -> ${r.idx.length / 3} tris, ${r.ms} ms`);
    });
    w.on('error', reject);
    w.on('exit', () => { running--; launch(); });
  };
  for (let i = 0; i < Math.max(1, Math.min(os.cpus().length, 4)); i++) launch();
});

// low-detail merged copy per gun for enemy soldiers (parts at rest, first optic only)
for (const g of guns) {
  const parts = Object.values(results).filter((r) => r.gun === g && r.lod !== false && (!r.anim.startsWith('opt:') || r.anim === GUNS[g].lodOptic));
  let vcount = 0; for (const p of parts) vcount += p.reg.length;
  const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), reg = new Uint8Array(vcount), wear = new Uint8Array(vcount * 2), idx = [];
  let o = 0;
  for (const p of parts) {
    const pv = p.pivot || [0, 0, 0];
    for (let v = 0; v < p.reg.length; v++) {
      pos[(o + v) * 3] = p.pos[v * 3] + pv[0]; pos[(o + v) * 3 + 1] = p.pos[v * 3 + 1] + pv[1]; pos[(o + v) * 3 + 2] = p.pos[v * 3 + 2] - pv[2];
    }
    nor.set(p.nor, o * 3); reg.set(p.reg, o); wear.set(p.wear, o * 2);
    for (const i of p.idx) idx.push(i + o);
    o += p.reg.length;
  }
  const attr = new Float32Array(vcount * 4);
  for (let i = 0; i < vcount; i++) { attr[i * 4] = nor[i * 3]; attr[i * 4 + 1] = nor[i * 3 + 1]; attr[i * 4 + 2] = nor[i * 3 + 2]; attr[i * 4 + 3] = reg[i]; }
  let [li] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(idx), pos, 3, attr, 4, [0.3, 0.3, 0.3, 2], null, (GUNS[g].lodTris || 7000) * (HQ ? 3 : 1) * 3, (GUNS[g].lodError || 0.0025) * (HQ ? 0.5 : 1), ['ErrorAbsolute', 'Prune']);
  const [remap, unique] = MeshoptSimplifier.compactMesh(li = new Uint32Array(li));
  const L = { gun: g, name: 'lod', anim: 'lod', pivot: null, material: 'gun', pos: new Float32Array(unique * 3), nor: new Float32Array(unique * 3), reg: new Uint8Array(unique), wear: new Uint8Array(unique * 2), idx: li };
  for (let v = 0; v < remap.length; v++) {
    const r = remap[v];
    if (r === 0xffffffff) continue;
    L.pos.set(pos.subarray(v * 3, v * 3 + 3), r * 3); L.nor.set(nor.subarray(v * 3, v * 3 + 3), r * 3); L.reg[r] = reg[v]; L.wear.set(wear.subarray(v * 2, v * 2 + 2), r * 2);
  }
  results[`${g}.lod`] = L;
  console.log(`${g}.lod: ${li.length / 3} tris`);
  if (HQ) {
    // far-distance copy for enemies (tools/slim-guns.mjs adds this to the regular set)
    const La = new Float32Array(L.reg.length * 4);
    for (let i = 0; i < L.reg.length; i++) { La[i * 4] = L.nor[i * 3]; La[i * 4 + 1] = L.nor[i * 3 + 1]; La[i * 4 + 2] = L.nor[i * 3 + 2]; La[i * 4 + 3] = L.reg[i]; }
    const [l2] = MeshoptSimplifier.simplifyWithAttributes(li, L.pos, 3, La, 4, [0.3, 0.3, 0.3, 2], null, 8000 * 3, 0.002, ['ErrorAbsolute', 'Prune']);
    results[`${g}.lod2`] = { ...L, name: 'lod2', anim: 'lod2', idx: new Uint32Array(l2) };
    console.log(`${g}.lod2: ${l2.length / 3} tris`);
  }
}

// ---------------- pack ----------------
// Each mesh is stored as meshoptimizer-compressed buffers: 12-byte vertices
// (16-bit quantised position, 8-bit normal, region, edge wear, cavity) and
// 32-bit indices, both reordered for the GPU's vertex cache first.
await MeshoptEncoder.ready;
let old = {};
if (only.length && fs.existsSync(OUT)) {
  const m = await import(OUT.href + '?t=' + Date.now());
  old = { HEADER: m.HEADER, DATA: m.DATA };
}
const chunks = [];
let off = 0;
const push = (bytes) => {
  const pad = (4 - (off % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  chunks.push(b); const at = off; off += b.length; return [at, b.length];
};
function encode(meta, q, lo, sc, nq, reg, wear, indices) {
  const n = reg.length, I = Uint32Array.from(indices);
  const [remap, unique] = MeshoptEncoder.reorderMesh(I, true, false);
  const vb = new Uint8Array(unique * 12), dv = new DataView(vb.buffer);
  for (let v = 0; v < n; v++) {
    const r = remap[v];
    if (r === 0xffffffff) continue;
    const o = r * 12;
    dv.setUint16(o, q[v * 3], true); dv.setUint16(o + 2, q[v * 3 + 1], true); dv.setUint16(o + 4, q[v * 3 + 2], true);
    dv.setInt8(o + 6, nq[v * 3]); dv.setInt8(o + 7, nq[v * 3 + 1]); dv.setInt8(o + 8, nq[v * 3 + 2]);
    vb[o + 9] = reg[v]; vb[o + 10] = wear[v * 2]; vb[o + 11] = wear[v * 2 + 1];
  }
  return {
    ...meta, n: unique, ni: I.length, lo, sc,
    vb: push(MeshoptEncoder.encodeVertexBuffer(vb, unique, 12)),
    ib: push(MeshoptEncoder.encodeIndexBuffer(new Uint8Array(I.buffer), I.length, 4)),
  };
}
const metaOf = (h) => ({ gun: h.gun, name: h.name, anim: h.anim, pivot: h.pivot, material: h.material });
const header = {};
// keep untouched guns from the previous build
if (old.HEADER) {
  const bin = Buffer.from(old.DATA, 'base64');
  const at = (o, len) => new Uint8Array(bin.buffer.slice(bin.byteOffset + o, bin.byteOffset + o + len));
  for (const [key, h] of Object.entries(old.HEADER)) {
    if (guns.includes(h.gun)) continue;
    if (h.vb) { header[key] = { ...h, vb: push(at(...h.vb)), ib: push(at(...h.ib)) }; continue; }
    // older uncompressed layout
    const q = new Uint16Array(at(h.pos, h.n * 6).buffer), nq = new Int8Array(at(h.nor, h.n * 3).buffer);
    const idx = h.big ? new Uint32Array(at(h.idx, h.ni * 4).buffer) : new Uint16Array(at(h.idx, h.ni * 2).buffer);
    header[key] = encode(metaOf(h), q, h.lo, h.sc, nq, at(h.reg, h.n), at(h.wear, h.n * 2), idx);
  }
}
let tris = 0;
for (const [key, r] of Object.entries(results)) {
  const n = r.reg.length;
  // quantise positions to 16 bits inside the part's bounds
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], r.pos[v * 3 + a]); hi[a] = Math.max(hi[a], r.pos[v * 3 + a]); }
  const sc = hi.map((h, a) => Math.max(1e-6, h - lo[a]) / 65535);
  const q = new Uint16Array(n * 3), nq = new Int8Array(n * 3);
  for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) {
    q[v * 3 + a] = Math.round((r.pos[v * 3 + a] - lo[a]) / sc[a]);
    nq[v * 3 + a] = Math.round(Math.max(-1, Math.min(1, r.nor[v * 3 + a])) * 127);
  }
  tris += r.idx.length / 3;
  header[key] = encode(metaOf(r), q, lo.map((v) => +v.toFixed(7)), sc.map((v) => +v.toPrecision(8)), nq, r.reg, r.wear, r.idx);
}
const b64 = Buffer.concat(chunks).toString('base64');
fs.writeFileSync(OUT, `// Generated by tools/build-guns.mjs${HQ ? ' --hq' : ''} from src/gunparts.js. Do not edit.\nexport const HEADER = ${JSON.stringify(header)};\nexport const DATA = '${b64}';\n`);
console.log(`gundata: ${Object.keys(header).length} meshes, ${tris} tris (rebuilt), ${(off / 1024).toFixed(0)} KB compressed, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
