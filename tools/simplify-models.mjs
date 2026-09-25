// Decimates the photo-scanned props to phone-friendly triangle budgets.
// meshoptimizer keeps UV seams, open borders and normals intact, so the
// scans look identical at gameplay distance. Unused vertices are dropped
// and the .bin is repacked. Idempotent: simplified files are marked.
import fs from 'node:fs';
import { MeshoptSimplifier as S } from 'meshoptimizer';

const DIR = new URL('../assets/models/', import.meta.url).pathname;
// target triangles per model (whole model)
const BUDGET = {
  metal_jerrycan: 2600, portable_generator: 7000, exterior_aircon_unit: 4500, covered_car: 7000,
  utility_box_02: 2600, propane_tank: 2200, trashbag: 1800, security_light: 1800, old_tyre: 1500,
  ammo_box: 2000, medical_box: 2000,
};
const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPED = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array, 5120: Int8Array, 5122: Int16Array };

await S.ready;

for (const [id, budget] of Object.entries(BUDGET)) {
  const file = `${DIR}${id}/${id}.gltf`;
  if (!fs.existsSync(file)) continue;
  const gltf = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (gltf.asset.extras?.simplified) { console.log('skip', id); continue; }
  const binPath = `${DIR}${id}/${gltf.buffers[0].uri}`;
  const bin = fs.readFileSync(binPath);

  const read = (ai) => {
    const a = gltf.accessors[ai], bv = gltf.bufferViews[a.bufferView];
    const n = COMPS[a.type], sz = SIZE[a.componentType];
    if (bv.byteStride && bv.byteStride !== n * sz) throw new Error(`${id}: interleaved buffers not supported`);
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const bytes = bin.subarray(off, off + a.count * n * sz);
    return new TYPED[a.componentType](bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };

  const prims = gltf.meshes.flatMap((m) => m.primitives);
  const total = prims.reduce((s, p) => s + gltf.accessors[p.indices].count / 3, 0);
  const ratio = Math.min(1, budget / total);
  const out = new Map(); // accessor index -> new typed array
  let after = 0;
  for (const p of prims) {
    const idx = new Uint32Array(read(p.indices));
    const pos = read(p.attributes.POSITION);
    const nrm = p.attributes.NORMAL !== undefined ? read(p.attributes.NORMAL) : null;
    const target = Math.max(3, Math.floor((idx.length * ratio) / 3) * 3);
    let [simp] = nrm
      ? S.simplifyWithAttributes(idx, pos, 3, nrm, 3, [0.35, 0.35, 0.35], null, target, 0.02, ['LockBorder'])
      : S.simplify(idx, pos, 3, target, 0.02, ['LockBorder']);
    simp = new Uint32Array(simp);
    const [remap, unique] = S.compactMesh(simp);
    // shared vertex accessors would need a joint remap; this set never shares them
    for (const ai of Object.values(p.attributes)) {
      const src = read(ai), n = COMPS[gltf.accessors[ai].type];
      const dst = new src.constructor(unique * n);
      for (let v = 0; v < remap.length; v++) {
        const r = remap[v];
        if (r !== 0xffffffff) for (let k = 0; k < n; k++) dst[r * n + k] = src[v * n + k];
      }
      out.set(ai, dst);
      gltf.accessors[ai].count = unique;
      if (ai === p.attributes.POSITION) {
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let v = 0; v < unique; v++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], dst[v * 3 + k]); mx[k] = Math.max(mx[k], dst[v * 3 + k]); }
        gltf.accessors[ai].min = mn; gltf.accessors[ai].max = mx;
      }
    }
    const ia = gltf.accessors[p.indices];
    const small = unique < 65536;
    out.set(p.indices, small ? Uint16Array.from(simp) : simp);
    ia.componentType = small ? 5123 : 5125;
    ia.count = simp.length;
    delete ia.min; delete ia.max;
    after += simp.length / 3;
  }

  // repack: one bufferView per accessor, 4-byte aligned
  const chunks = [];
  let offset = 0;
  const views = [];
  gltf.accessors.forEach((a, ai) => {
    const data = out.get(ai) || read(ai);
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    const target = gltf.bufferViews[a.bufferView].target;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes); offset += bytes.length;
    a.bufferView = ai; delete a.byteOffset;
  });
  gltf.bufferViews = views;
  gltf.buffers[0].byteLength = offset;
  gltf.asset.extras = { ...(gltf.asset.extras || {}), simplified: true };
  fs.writeFileSync(binPath, Buffer.concat(chunks));
  fs.writeFileSync(file, JSON.stringify(gltf));
  console.log(`${id}: ${total} -> ${after} tris, ${(bin.length / 1024) | 0}K -> ${(offset / 1024) | 0}K`);
}
