// Builds the enemy soldiers from real, rigged character models (Sketchfab,
// via the Objaverse mirror; credits in assets/people/CREDITS.md).
//
// Every piece that follows the skeleton (skinned parts, and pouches or kit
// hung from a bone) becomes one skinned mesh per material, so a soldier is
// a handful of draw calls; the carried weapon is removed (the game's gun
// is used). Each mesh gets a far level of detail that shares its vertices
// and only draws a simplified triangle list. Output:
//   assets/people/<kit>.glb     every preset (512 px textures)
//   assets/people/<kit>_hq.glb  Cinematic (1024 px textures)
// usage: node tools/build-people.mjs [kit ...]
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, metalRough, cloneDocument } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache', 'models');
const OUT = path.join(ROOT, 'assets', 'people');
const OBJAVERSE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';

export const PEOPLE = {
  olive: { title: 'Russian Soldier', author: 'doctortex', uid: 'e9aa211b67264dc086af1d2f4d4e3d84', near: 1, far: 0.15 },
  tan: { title: 'Ukrainian Soldier', author: 'doctortex', uid: '94f74f6bdd994733a8a40c7ff088e12f', near: 1, far: 0.15 },
  // `drop`: the carried weapon (matched against the node path)
  black: { title: 'S.W.A.T. Operator', author: 'jeandiz', uid: '9e82fabf26194896b5ad4a364d864eab', near: 0.3, far: 0.07, drop: /part_2_low/ },
  heavy: { title: 'FSB Operator', author: 'jeandiz', uid: '43a561e941704eefb1ab0614be4f0049', near: 0.3, far: 0.07, drop: /Gun_99/ },
  // civilians: office workers and hostages (Adobe Fuse characters, Mixamo rig); sizes in triangles
  civ0: { title: 'Andrew - LOD Man character', author: 'egunoff', uid: '3aaaf5c42dae43a1bd1ca447964f65b8', nearTris: 14000, farTris: 2500, civilian: true, height: 1.8 },
  civ1: { title: 'Gordon - LOD Man character', author: 'egunoff', uid: '38d97e79ef674f55834c7ceef70812a9', nearTris: 14000, farTris: 2500, civilian: true, height: 1.77 },
  civ2: { title: 'Maria - LOD Lady character', author: 'egunoff', uid: '6210c4688a8048858a8655e5f9ab0b98', nearTris: 14000, farTris: 2500, civilian: true, height: 1.66 },
  civ3: { title: 'Antony - LOD Man character', author: 'egunoff', uid: '5d85c11507974daea2b9410c58ee23aa', nearTris: 14000, farTris: 2500, civilian: true, height: 1.82 },
  civ4: { title: 'MrsFirst - LOD Lady character', author: 'egunoff', uid: '625592f5ffc9470391ce30bbc24c70db', nearTris: 14000, farTris: 2500, civilian: true, height: 1.63 },
  civ5: { title: 'Nasier - LOD Man character', author: 'egunoff', uid: 'fa435c444771472d97a8bdbd3db6f545', nearTris: 14000, farTris: 2500, civilian: true, height: 1.75 },
  civ6: { title: 'Veronica - LOD Lady character', author: 'egunoff', uid: '93375bff36fe43958668f2d2333818a2', nearTris: 14000, farTris: 2500, civilian: true, height: 1.68 },
  // Chaos mode: original cartoon characters (Mixamo rigs). `skin`: which character of a pack
  toonAlien: { title: 'Green Alien', author: 'strielecki', uid: '9096e628a04242708126cf7b7c8008a1', nearTris: 9000, farTris: 1500, toon: true, height: 1.85 },
  toonRabbit: { title: 'Gangnam Style Dancing Rabbit Character', author: 'antonmoek', uid: 'a06d60f0ab144adc982cdc94bf24e368', nearTris: 1300, farTris: 700, toon: true, height: 1.8 },
  ...Object.fromEntries([0, 1, 2, 3].map((i) => [`toon${i}`, { title: 'Low Poly Game Character Skins [ PACK | RIGGED]', author: 'micaelsampaio', uid: 'c23ffc918c7e4703aa13ec4abe9bfd4b', skin: i, nearTris: 1500, farTris: 700, toon: true, height: 1.55 }])),
};

function source(uid) {
  const file = path.join(CACHE, uid + '.glb');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(CACHE, { recursive: true });
  const idx = path.join(CACHE, 'object-paths.json');
  if (!fs.existsSync(idx)) { execFileSync('curl', ['-sSL', '--retry', '4', '-o', idx + '.gz', OBJAVERSE + 'object-paths.json.gz']); execFileSync('gunzip', ['-f', idx + '.gz']); }
  const rel = JSON.parse(fs.readFileSync(idx, 'utf8'))[uid];
  execFileSync('curl', ['-sSL', '--http1.1', '--retry', '4', '--retry-all-errors', '-o', file + '.part', OBJAVERSE + rel]);
  fs.renameSync(file + '.part', file);
  return file;
}

// column-major 4x4 helpers
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function invert(m) {
  const inv = new Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  return inv.map((v) => v / det);
}
const apply = (m, x, y, z, w = 1) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
const norm3 = (v) => { const l = Math.hypot(...v) || 1; return v.map((q) => q / l); };

async function buildPerson(kit, cfg) {
  console.log(`${kit}: ${cfg.title} by ${cfg.author}`);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(source(cfg.uid));
  const root = doc.getRoot();
  await doc.transform(metalRough()); // spec-gloss materials to metal-rough
  const skin = root.listSkins()[cfg.skin || 0];
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const jointIndex = new Map(joints.map((j, i) => [j, i]));
  // which bone a rigid attachment hangs from: its nearest ancestor joint, or for kit
  // exported loose (pouches, spare magazines, patches) the bone it sits on
  const wpos = (n) => n.getWorldMatrix().slice(12, 15);
  const segDist = (p, a, b) => {
    const ab = [0, 1, 2].map((k) => b[k] - a[k]), ap = [0, 1, 2].map((k) => p[k] - a[k]);
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1)));
    return Math.hypot(...ap.map((v, k) => v - ab[k] * t));
  };
  // loose kit hangs on the torso or legs (in the node pose the hands can be anywhere, e.g. on a rifle)
  const bodyJoint = (j) => !/Arm|Hand|Shoulder/.test(j.getName());
  const nearestBone = (p) => {
    let best = null, bd = Infinity;
    for (const j of joints.filter(bodyJoint)) {
      const kids = j.listChildren().filter((c) => jointIndex.has(c));
      const a = wpos(j);
      for (const b of kids.length ? kids.map(wpos) : [a]) { const d = segDist(p, a, b); if (d < bd) { bd = d; best = j; } }
    }
    return best;
  };
  const centre = (node) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], W = node.getWorldMatrix(), e = [];
    for (const prim of node.getMesh().listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      for (let i = 0; i < P.getCount(); i += 7) { P.getElement(i, e); apply(W, e[0], e[1], e[2]).forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); }); }
    }
    return lo.map((v, k) => (v + hi[k]) / 2);
  };
  const jointOf = (node) => { for (let n = node.getParentNode(); n; n = n.getParentNode()) if (jointIndex.has(n)) return n; return nearestBone(centre(node)); };
  const pathOf = (node) => { const p = []; for (let n = node; n; n = n.getParentNode()) p.unshift(n.getName()); return p.join('/'); };
  const buckets = new Map(); // material -> { pos, nor, uv, j, w, idx }
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const meshNodes = [];
  scene.traverse((n) => { if (n.getMesh()) meshNodes.push(n); });
  let dropped = 0;
  for (const node of meshNodes) {
    if (cfg.drop && cfg.drop.test(pathOf(node))) { dropped++; continue; }
    if (cfg.skin !== undefined && node.getSkin() !== skin) continue; // another character of the pack
    const skinned = !!node.getSkin();
    const bone = skinned ? null : jointOf(node);
    // rigid attachments: into bind space of their bone (world_rest = boneRest * IBM * v_bind)
    let M = null, bi = 0;
    if (!skinned) {
      bi = jointIndex.get(bone);
      const IB = []; ibm.getElement(bi, IB);
      M = mul(invert(mul(bone.getWorldMatrix(), IB)), node.getWorldMatrix());
    }
    for (const prim of node.getMesh().listPrimitives()) {
      const mat = prim.getMaterial();
      if (prim.getMode() !== 4) continue;
      const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), UV = prim.getAttribute('TEXCOORD_0');
      const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      let b = buckets.get(mat);
      if (!b) buckets.set(mat, (b = { pos: [], nor: [], uv: [], j: [], w: [], idx: [] }));
      const base = b.pos.length / 3, e = [];
      // a skinned primitive's joints index its own skin: remap to the shared skin
      const primSkin = node.getSkin();
      const remap = skinned ? primSkin.listJoints().map((jn) => jointIndex.get(jn) ?? 0) : null;
      for (let i = 0; i < P.getCount(); i++) {
        P.getElement(i, e);
        b.pos.push(...(M ? apply(M, e[0], e[1], e[2]) : e.slice(0, 3)));
        if (N) { N.getElement(i, e); b.nor.push(...(M ? norm3(apply(M, e[0], e[1], e[2], 0)) : e.slice(0, 3))); } else b.nor.push(0, 1, 0);
        if (UV) { UV.getElement(i, e); b.uv.push(e[0], e[1]); } else b.uv.push(0, 0);
        if (skinned) { J.getElement(i, e); b.j.push(...e.slice(0, 4).map((q) => remap[q] ?? 0)); W.getElement(i, e); b.w.push(...e.slice(0, 4)); } else { b.j.push(bi, 0, 0, 0); b.w.push(1, 0, 0, 0); }
      }
      const I = prim.getIndices();
      const idx = I ? I.getArray() : Array.from({ length: P.getCount() }, (_, i) => i);
      for (const v of idx) b.idx.push(base + v);
    }
  }
  // Re-bind in the modelling pose (T or A pose, from the inverse bind matrices),
  // cleaned up for the game's retargeting: metres, Y up, facing +Z, feet on the
  // ground, unscaled joints named like Mixamo's (Hips, LeftArm, ...), no wrapper nodes.
  const clean = (n) => n.replace(/^mixamorig[:_]?/, '').replace(/_\d+$/, '');
  const Bw = joints.map((j, i) => { const e = []; ibm.getElement(i, e); return invert(e); });
  const at = (name) => { const i = joints.findIndex((j) => clean(j.getName()) === name); if (i < 0) throw new Error(`${kit}: no ${name} joint`); return i; };
  const bpos = (i) => Bw[i].slice(12, 15), npos = (i) => joints[i].getWorldMatrix().slice(12, 15);
  const sub = (a, b) => a.map((v, k) => v - b[k]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const X = norm3(sub(bpos(at('LeftUpLeg')), bpos(at('RightUpLeg'))));
  let Y = sub(bpos(at('Neck')), bpos(at('Hips'))); Y = norm3(sub(Y, X.map((v) => v * dot(Y, X))));
  const Z = cross(X, Y);
  // unit scale: limb lengths do not change with pose, so compare them in the node pose (metres) and bind pose
  const chain = ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'];
  let ln = 0, lb = 0;
  for (let c = 0; c < chain.length; c += 3) for (let k = 0; k < 2; k++) {
    const a = at(chain[c + k]), b = at(chain[c + k + 1]);
    ln += Math.hypot(...sub(npos(b), npos(a))); lb += Math.hypot(...sub(bpos(b), bpos(a)));
  }
  let sc = ln / lb;
  {
    // the node pose may not be in metres either (FBX exports in centimetres): then scale to a real height
    let lo = Infinity, hi = -Infinity;
    for (const b of buckets.values()) for (let i = 1; i < b.pos.length; i += 3) { const y = dot(Y, [b.pos[i - 1], b.pos[i], b.pos[i + 1]]); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const h = (hi - lo) * sc;
    if (h < 1.45 || h > 2.05 || cfg.height) sc *= (cfg.height || 1.76) / h;
  }
  const toM = (v) => [dot(X, v) * sc, dot(Y, v) * sc, dot(Z, v) * sc]; // skin space -> metres (rotation + scale)
  let floor = Infinity;
  for (const b of buckets.values()) for (let i = 1; i < b.pos.length; i += 3) floor = Math.min(floor, toM([b.pos[i - 1], b.pos[i], b.pos[i + 1]])[1]);
  const hip = toM(bpos(at('Hips')));
  const off = [-hip[0], -floor, -hip[2]];
  const toModel = (v) => toM(v).map((q, k) => q + off[k]);
  for (const b of buckets.values()) for (let i = 0; i < b.pos.length; i += 3) {
    const p = toModel(b.pos.slice(i, i + 3)), n = norm3(toM(b.nor.slice(i, i + 3)));
    for (let k = 0; k < 3; k++) { b.pos[i + k] = p[k]; b.nor[i + k] = n[k]; }
  }
  // joint frames: bind position, bind rotation with its scale removed
  const frames = Bw.map((m, i) => {
    const cols = [0, 1, 2].map((c) => norm3(toM([m[c * 4], m[c * 4 + 1], m[c * 4 + 2]])));
    return { R: cols, p: toModel(bpos(i)) };
  });
  const quat = (c) => { // rotation matrix (columns) -> quaternion [x, y, z, w]
    const [m00, m10, m20] = c[0], [m01, m11, m21] = c[1], [m02, m12, m22] = c[2], t = m00 + m11 + m22;
    let q;
    if (t > 0) { const s = 0.5 / Math.sqrt(t + 1); q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
    else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
    else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
    else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
    const l = Math.hypot(...q); return q.map((v) => v / l);
  };
  const T = (R) => [0, 1, 2].map((r) => [R[0][r], R[1][r], R[2][r]]); // transpose (columns of R^T)
  const mulR = (A, B) => B.map((col) => [0, 1, 2].map((r) => A[0][r] * col[0] + A[1][r] * col[1] + A[2][r] * col[2]));
  const mulRv = (A, v) => [0, 1, 2].map((r) => A[0][r] * v[0] + A[1][r] * v[1] + A[2][r] * v[2]);
  const ibms = [];
  joints.forEach((j, i) => {
    const f = frames[i], par = j.getParentNode(), pi = jointIndex.get(par);
    const pf = pi === undefined ? { R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], p: [0, 0, 0] } : frames[pi];
    const Rt = T(pf.R);
    j.setRotation(quat(mulR(Rt, f.R))).setTranslation(mulRv(Rt, sub(f.p, pf.p))).setScale([1, 1, 1]).setName(clean(j.getName()));
    // inverse of [R | p]: [R^T | -R^T p]
    const RT = T(f.R), tp = mulRv(RT, f.p).map((v) => -v);
    ibms.push(RT[0][0], RT[0][1], RT[0][2], 0, RT[1][0], RT[1][1], RT[1][2], 0, RT[2][0], RT[2][1], RT[2][2], 0, tp[0], tp[1], tp[2], 1);
  });
  const buf = root.listBuffers()[0];
  skin.setInverseBindMatrices(doc.createAccessor().setArray(new Float32Array(ibms)).setType('MAT4').setBuffer(buf));
  // the joint hierarchy goes straight under the scene; everything else is rebuilt
  const tops = joints.filter((j) => !jointIndex.has(j.getParentNode()));
  for (const t of tops) { t.getParentNode()?.removeChild(t); for (const p of t.listParents()) if (p.propertyType === 'Scene') p.removeChild(t); scene.addChild(t); }
  skin.setSkeleton(tops[0]);
  for (const node of meshNodes) node.setMesh(null).setSkin(null);
  for (const n of root.listNodes()) if (!jointIndex.has(n)) n.dispose();
  for (const c of scene.listChildren()) if (!jointIndex.has(c)) scene.removeChild(c);
  const bodyParent = scene;
  let top = 0;
  for (const b of buckets.values()) for (let i = 1; i < b.pos.length; i += 3) top = Math.max(top, b.pos[i]);
  console.log(`  ${(sc * 100).toFixed(2)} cm per unit, height ${top.toFixed(2)} m, hips ${frames[at('Hips')].p[1].toFixed(3)} m`);
  await MeshoptSimplifier.ready;
  const handJoint = new Set(joints.map((j, i) => (/Hand/.test(j.getName()) ? i : -1)).filter((i) => i >= 0));
  let tris = 0, farTris = 0;
  for (const [mat, b] of buckets) {
    const acc = (arr, type, T) => doc.createAccessor().setArray(new T(arr)).setType(type).setBuffer(buf);
    const count = b.pos.length / 3;
    const IT = count > 65535 ? Uint32Array : Uint16Array;
    const attrs = { POSITION: acc(b.pos, 'VEC3', Float32Array), NORMAL: acc(b.nor, 'VEC3', Float32Array), TEXCOORD_0: acc(b.uv, 'VEC2', Float32Array), JOINTS_0: acc(b.j, 'VEC4', Uint16Array), WEIGHTS_0: acc(b.w, 'VEC4', Float32Array) };
    // near: UV seams stay closed and open edges of cloth panels stay put; far (seen
    // from tens of metres): seams and panel edges may move and small bits go
    // the hands keep every vertex up close: merged across fingers, they would tear when the fingers curl
    const lock = new Uint8Array(count);
    for (let v = 0; v < count; v++) {
      let best = 0; for (let k = 1; k < 4; k++) if (b.w[v * 4 + k] > b.w[v * 4 + best]) best = k;
      lock[v] = handJoint.has(b.j[v * 4 + best]) ? 1 : 0;
    }
    const lod = (ratio) => {
      if (ratio >= 1) return new Uint32Array(b.idx);
      const target = Math.max(3, Math.floor(b.idx.length * ratio / 3) * 3);
      if (ratio < 0.2) return MeshoptSimplifier.simplify(new Uint32Array(b.idx), new Float32Array(b.pos), 3, target, 0.05, ['Permissive', 'Prune'])[0];
      // (clothes and hair made of many open panels: their edges can only be kept by budget)
      const w = cfg.nearTris ? [0, 0, 0] : [0.3, 0.3, 0.3];
      return MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(b.idx), new Float32Array(b.pos), 3, new Float32Array(b.nor), 3, w, lock, target, cfg.nearTris ? 0.02 : 0.01, cfg.nearTris ? ['Permissive'] : ['LockBorder'])[0];
    };
    const total = [...buckets.values()].reduce((n, x) => n + x.idx.length / 3, 0);
    const near = cfg.nearTris ? Math.min(1, cfg.nearTris / total) : cfg.near, far = cfg.farTris ? Math.min(0.19, cfg.farTris / total) : cfg.far;
    for (const [suffix, ratio] of [['', near], ['_far', far]]) {
      const ix = lod(ratio);
      const prim = doc.createPrimitive().setIndices(acc(ix, 'SCALAR', IT)).setMaterial(mat);
      for (const [k, a] of Object.entries(attrs)) prim.setAttribute(k, a);
      const mesh = doc.createMesh((mat?.getName() || 'body') + suffix).addPrimitive(prim);
      const n = doc.createNode((mat?.getName() || 'body') + suffix).setMesh(mesh).setSkin(skin);
      bodyParent.addChild(n);
      if (suffix) farTris += ix.length / 3; else tris += ix.length / 3;
    }
  }
  // glass eyes: opaque (no refraction pass)
  for (const m of root.listMaterials()) if (m.getExtension('KHR_materials_transmission')) m.setExtension('KHR_materials_transmission', null);
  for (const a of root.listAnimations()) a.dispose();
  await doc.transform(prune(), dedup());
  console.log(`  ${buckets.size} materials, ${tris} triangles near, ${farTris} far, dropped ${dropped} weapon nodes`);
  fs.mkdirSync(OUT, { recursive: true });
  await MeshoptEncoder.ready;
  for (const [suffix, tex] of [['_hq', 1024], ['', 512]]) {
    const d = cloneDocument(doc);
    // one quantization volume for every part: they then share one skin (and at runtime one skeleton)
    await d.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 88 }), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizationVolume: 'scene' }));
    const file = path.join(OUT, `${kit}${suffix}.glb`);
    await new NodeIO().registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder }).write(file, d);
    console.log(`  ${path.relative(ROOT, file)}: ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
  }
}

const only = process.argv.slice(2);
for (const [kit, cfg] of Object.entries(PEOPLE)) if (!only.length || only.includes(kit)) await buildPerson(kit, cfg);
const list = (kind) => [...new Set(Object.values(PEOPLE).filter((c) => (c.toon ? 'toon' : c.civilian ? 'civ' : 'soldier') === kind).map((c) => `- **${c.title}** by ${c.author}: https://sketchfab.com/3d-models/${c.uid} (CC BY 4.0)`))].join('\n');
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), '# People\n\nRigged characters licensed under Creative Commons Attribution 4.0 (CC BY 4.0); weapons removed, parts merged, simplified and re-encoded for the game.\n\n## Soldiers\n\n' +
  list('soldier') + '\n\n## Civilians\n\n' + list('civ') + '\n\n## Chaos mode cartoon characters\n\n' + list('toon') + '\n');
