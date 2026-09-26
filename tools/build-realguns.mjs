// Builds the first-person guns from real, artist-made models (Sketchfab, via
// the Objaverse mirror; licences and credits in assets/guns/CREDITS.md).
//
// For each gun: every piece of the source model is baked into gun space
// (metres, -Z muzzle, +Y up, bore on y = 0), sorted into the animated parts
// the game moves (magazine, bolt carrier, charging handle, slide...) by
// rules on its position and material, merged by material, and written as
//   assets/guns/<gun>.glb      phones and every preset (simplified)
//   assets/guns/<gun>_hq.glb   Cinematic (full detail)
//   assets/guns/<gun>_far.glb  the enemies' copy (one piece, a few thousand triangles)
// plus assets/guns/<gun>.json with the anchors (muzzle, sight, grip, magwell).
//
// Pieces are classified per connected island of triangles, not per mesh:
// several source meshes merge separate parts (a magnifier with its mount, a
// magazine with its follower), and islands keep the rules exact.
//
// usage: node tools/build-realguns.mjs [gun ...] [--debug]
//   --debug also writes assets/guns/<gun>_debug.glb with each part tinted.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, simplify, weld, textureCompress, meshopt, cloneDocument, mergeDocuments, flatten, join, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { GUNS } from './realguns.config.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache', 'models');
const OUT = path.join(ROOT, 'assets', 'guns');
const OBJAVERSE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';

const args = process.argv.slice(2);
const debug = args.includes('--debug');
// --islands=x0,y0,z0,x1,y1,z1 : list the islands whose centre is inside that box (model space) and stop
const islandQuery = args.find((a) => a.startsWith('--islands='))?.slice(10).split(',').map(Number);
const only = args.filter((a) => !a.startsWith('--'));

/** The source GLB, downloaded once into .cache/models. */
function source(uid) {
  const file = path.join(CACHE, uid + '.glb');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(CACHE, { recursive: true });
  const idx = path.join(CACHE, 'object-paths.json');
  if (!fs.existsSync(idx)) {
    execFileSync('curl', ['-sSL', '--retry', '4', '-o', idx + '.gz', OBJAVERSE + 'object-paths.json.gz']);
    execFileSync('gunzip', ['-f', idx + '.gz']);
  }
  const rel = JSON.parse(fs.readFileSync(idx, 'utf8'))[uid];
  if (!rel) throw new Error(`${uid} is not in Objaverse`);
  console.log(`  downloading ${uid}...`);
  execFileSync('curl', ['-sSL', '--http1.1', '--retry', '4', '--retry-all-errors', '-o', file + '.part', OBJAVERSE + rel]);
  fs.renameSync(file + '.part', file);
  return file;
}

// ---------- small matrix helpers (column-major 4x4, as glTF) ----------
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const apply = (m, x, y, z, w = 1) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
function normalMatrix(m) {
  // inverse-transpose of the upper 3x3
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  // inv is row-major inverse; the transpose of it, applied to column vectors, is inv^T
  return (x, y, z) => { const v = [inv[0] * x + inv[3] * y + inv[6] * z, inv[1] * x + inv[4] * y + inv[7] * z, inv[2] * x + inv[5] * y + inv[8] * z]; const l = Math.hypot(...v) || 1; return v.map((q) => q / l); };
}

/** Model space -> gun space: R rotates the muzzle onto -Z (the rules see this space), T scales to real size and moves `origin` to 0. */
function gunTransform(cfg) {
  const s = cfg.scale;
  // optional pre-rotation (degrees about X, Y, Z, applied in that order) for models not already muzzle -Z / up +Y
  let R = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const rot = (axis, deg) => {
    const t = deg * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t);
    const m = axis === 'x' ? [1, 0, 0, 0, 0, c, sn, 0, 0, -sn, c, 0, 0, 0, 0, 1] : axis === 'y' ? [c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, 0, 0, 0, 1] : [c, sn, 0, 0, -sn, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    R = mul(m, R);
  };
  for (const [axis, deg] of cfg.rotate || []) rot(axis, deg);
  const T = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -cfg.origin[0] * s, -cfg.origin[1] * s, -cfg.origin[2] * s, 1];
  return { R, T };
}

/** Splits an indexed triangle list into connected islands (triangles sharing a welded vertex). */
function islands(pos, idx) {
  const n = pos.length / 3;
  // weld coincident vertices first (UV seams split them)
  const key = new Map(), weldId = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
    let id = key.get(k); if (id === undefined) { id = key.size; key.set(k, id); }
    weldId[i] = id;
  }
  const parent = new Int32Array(key.size).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(weldId[idx[t]]), b = find(weldId[idx[t + 1]]), c = find(weldId[idx[t + 2]]);
    parent[b] = a; parent[find(c)] = a;
  }
  const groups = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(weldId[idx[t]]);
    let g = groups.get(r); if (!g) groups.set(r, (g = []));
    g.push(t);
  }
  return [...groups.values()];
}

/**
 * Every triangle island of every mesh under `scene`, rotated by R (model space as the rules see it):
 * { info, material, pos, nor, uv, idx } with compact per-island vertex arrays.
 */
function gatherIslands(scene, R) {
  const out = [];
  const leaves = [];
  const walk = (node) => { if (node.getMesh()) leaves.push(node); node.listChildren().forEach(walk); };
  scene.listChildren().forEach(walk);
  for (const node of leaves) {
    const W = mul(R, node.getWorldMatrix());
    const nm = normalMatrix(W);
    const flip = (W[0] * (W[5] * W[10] - W[9] * W[6]) - W[4] * (W[1] * W[10] - W[9] * W[2]) + W[8] * (W[1] * W[6] - W[5] * W[2])) < 0;
    const nodePath = []; for (let n = node; n; n = n.getParentNode()) nodePath.unshift(n.getName());
    for (const prim of node.getMesh().listPrimitives()) {
      if (prim.getMode() !== 4) continue; // triangles only
      const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), UV = prim.getAttribute('TEXCOORD_0');
      const count = P.getCount();
      const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
      const e = [];
      for (let i = 0; i < count; i++) {
        P.getElement(i, e); pos.set(apply(W, e[0], e[1], e[2]), i * 3);
        if (N) { N.getElement(i, e); nor.set(nm(e[0], e[1], e[2]), i * 3); }
        if (UV) { UV.getElement(i, e); uv[i * 2] = e[0]; uv[i * 2 + 1] = e[1]; }
      }
      const I = prim.getIndices();
      const idx = I ? Array.from(I.getArray()) : Array.from({ length: count }, (_, i) => i);
      if (flip) for (let t = 0; t < idx.length; t += 3) { const q = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = q; }
      const material = prim.getMaterial();
      for (const isl of islands(pos, idx)) {
        const remap = new Map(), ip = [], inor = [], iuv = [], ii = [];
        const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
        for (const t of isl) for (let k = 0; k < 3; k++) {
          const v = idx[t + k];
          let nv = remap.get(v);
          if (nv === undefined) {
            nv = ip.length / 3; remap.set(v, nv);
            ip.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); inor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); iuv.push(uv[v * 2], uv[v * 2 + 1]);
            for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[v * 3 + a]); max[a] = Math.max(max[a], pos[v * 3 + a]); }
          }
          ii.push(nv);
        }
        const info = { mat: material?.getName() || '', path: nodePath.join('/'), c: min.map((v, a) => (v + max[a]) / 2), s: max.map((v, a) => v - min[a]), min, max, tris: isl.length };
        out.push({ info, material, pos: ip, nor: inor, uv: iuv, idx: ii });
      }
    }
  }
  return out;
}

async function buildGun(name, cfg) {
  console.log(`${name}: ${cfg.title}`);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(source(cfg.uid));
  const root = doc.getRoot();
  const { R, T } = gunTransform(cfg);
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const buckets = new Map(); // `${part}|${material}` -> { part, material, pos, nor, uv, idx }
  const stats = {};
  const add = (isl, part, M) => {
    const k = `${part}|${root.listMaterials().indexOf(isl.material)}`;
    let bkt = buckets.get(k);
    if (!bkt) buckets.set(k, (bkt = { part, material: isl.material, pos: [], nor: [], uv: [], idx: [] }));
    const base = bkt.pos.length / 3;
    for (let i = 0; i < isl.pos.length; i += 3) bkt.pos.push(...apply(M, isl.pos[i], isl.pos[i + 1], isl.pos[i + 2]));
    for (const v of isl.nor) bkt.nor.push(v);
    for (const v of isl.uv) bkt.uv.push(v);
    for (const v of isl.idx) bkt.idx.push(base + v);
    stats[part] = (stats[part] || 0) + isl.idx.length / 3;
  };
  for (const isl of gatherIslands(scene, R)) {
    const info = isl.info;
    if (islandQuery) {
      const [x0, y0, z0, x1, y1, z1] = islandQuery, c = info.c;
      if (c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1 && c[2] >= z0 && c[2] <= z1) console.log(`  c=${c.map((v) => v.toFixed(3)).join(',')} s=${info.s.map((v) => v.toFixed(3)).join(',')} t=${info.tris} ${info.mat} ${info.path.split('/').pop().slice(0, 24)}${cfg.drop && cfg.drop(info) ? ' DROP' : ''}`);
      continue;
    }
    if (cfg.drop && cfg.drop(info)) { stats.dropped = (stats.dropped || 0) + info.tris; continue; }
    let part = 'body';
    for (const [p, rule] of cfg.parts || []) if (rule(info)) { part = p; break; }
    // some moving parts are fused into a bigger piece (a bolt into its receiver): cut them out by triangle
    const cuts = (cfg.split || []).filter(([, islandRule]) => islandRule(info));
    if (cuts.length) {
      const sub = {}; // part -> triangle list
      for (let t = 0; t < isl.idx.length; t += 3) {
        const c = [0, 1, 2].map((a) => (isl.pos[isl.idx[t] * 3 + a] + isl.pos[isl.idx[t + 1] * 3 + a] + isl.pos[isl.idx[t + 2] * 3 + a]) / 3);
        const hit = cuts.find(([, , triRule]) => triRule(c));
        const p = hit ? hit[0] : part;
        (sub[p] || (sub[p] = [])).push(isl.idx[t], isl.idx[t + 1], isl.idx[t + 2]);
      }
      for (const [p, idx] of Object.entries(sub)) add({ ...isl, idx }, p, T);
      continue;
    }
    add(isl, part, T);
  }
  // attachments from other models (a suppressor): merged in, then seated on an anchor of this gun
  for (const att of cfg.attach || []) {
    const adoc = await io.read(source(att.uid));
    const before = new Set(root.listScenes());
    mergeDocuments(doc, adoc);
    const ascene = root.listScenes().find((sc) => !before.has(sc));
    const { R: AR } = gunTransform({ scale: 1, origin: [0, 0, 0], rotate: att.rotate });
    const picked = gatherIslands(ascene, AR).filter((isl) => att.select(isl.info));
    const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    for (const isl of picked) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], isl.info.min[a]); max[a] = Math.max(max[a], isl.info.max[a]); }
    // scale to the real length, centre on the bore, rear end `overlap` behind the anchor
    const k = att.length / (max[2] - min[2]);
    const at = apply(T, ...cfg.anchors[att.at]);
    const tx = at[0] - (min[0] + max[0]) / 2 * k, ty = at[1] - (min[1] + max[1]) / 2 * k, tz = at[2] + att.overlap - max[2] * k;
    const M = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, tx, ty, tz, 1];
    for (const isl of picked) add(isl, att.part, M);
    for (const n of ascene.listChildren()) ascene.removeChild(n);
    ascene.dispose();
    stats[`${att.part}Length`] = +(att.length).toFixed(3);
  }
  if (islandQuery) return { credit: cfg.credit };
  console.log('  triangles by part:', JSON.stringify(stats));
  // rebuild the scene: one node per part, one primitive per material
  for (const s of root.listScenes()) for (const n of s.listChildren()) s.removeChild(n);
  for (const n of root.listNodes()) n.dispose();
  for (const m of root.listMeshes()) m.dispose();
  const out = scene;
  const buf = root.listBuffers()[0] || doc.createBuffer();
  const partNodes = {};
  for (const bkt of buckets.values()) {
    let pn = partNodes[bkt.part];
    if (!pn) { pn = partNodes[bkt.part] = doc.createNode(bkt.part); out.addChild(pn); }
    const acc = (arr, type, T) => doc.createAccessor().setArray(new T(arr)).setType(type).setBuffer(buf);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', acc(bkt.pos, 'VEC3', Float32Array))
      .setAttribute('NORMAL', acc(bkt.nor, 'VEC3', Float32Array))
      .setAttribute('TEXCOORD_0', acc(bkt.uv, 'VEC2', Float32Array))
      .setIndices(acc(bkt.idx, 'SCALAR', bkt.pos.length / 3 > 65535 ? Uint32Array : Uint16Array))
      .setMaterial(bkt.material);
    const mesh = doc.createMesh(`${bkt.part}_${bkt.material?.getName() || 'mat'}`).addPrimitive(prim);
    pn.addChild(doc.createNode(mesh.getName()).setMesh(mesh));
  }
  // materials: glass without the refraction pass, per-gun tweaks
  for (const m of root.listMaterials()) {
    const tr = m.getExtension('KHR_materials_transmission');
    if (tr) { m.setExtension('KHR_materials_transmission', null); m.setAlphaMode('BLEND'); m.setBaseColorFactor([0.55, 0.62, 0.66, 0.18]); m.setRoughnessFactor(0.03); m.setMetallicFactor(0.2); }
    cfg.material?.(m);
  }
  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_transmission') ext.dispose();
  await doc.transform(prune(), dedup());
  // part bounds (gun space) for pivots
  const bounds = {};
  for (const bkt of buckets.values()) {
    const b = bounds[bkt.part] || (bounds[bkt.part] = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
    for (let i = 0; i < bkt.pos.length; i += 3) for (let a = 0; a < 3; a++) { b.min[a] = Math.min(b.min[a], bkt.pos[i + a]); b.max[a] = Math.max(b.max[a], bkt.pos[i + a]); }
  }
  const pivots = {};
  for (const [part, fn] of Object.entries(cfg.pivots || {})) if (bounds[part]) pivots[part] = fn(bounds[part]).map((v) => +v.toFixed(5));
  // anchors are given in model coordinates (like the rules) and stored in gun space
  const toGun = (p) => apply(T, ...p).map((v) => +v.toFixed(4));
  const anchors = {};
  for (const [k, v] of Object.entries(cfg.anchors || {})) anchors[k] = Array.isArray(v) ? toGun(v) : v;
  // with a suppressor on, the muzzle (flash and gas) is the front of the can
  if (bounds.supp) { anchors.muzzleBare = anchors.muzzle; anchors.muzzle = [anchors.muzzle[0], anchors.muzzle[1], +bounds.supp.min[2].toFixed(4)]; }
  anchors.bounds = Object.fromEntries(Object.entries(bounds).map(([k, b]) => [k, { min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)) }]));
  anchors.pivots = pivots;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ title: cfg.title, parts: Object.keys(partNodes), ...anchors }, null, 1));
  const tiers = [['_hq', cfg.hq ?? 1, 2048], ['', cfg.ratio, cfg.tex || 1024]];
  for (const [suffix, ratio, tex] of tiers) {
    const d = cloneDocument(doc);
    await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
    const steps = [weld({})];
    if (ratio < 1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: cfg.error ?? 0.0006, lockBorder: true }));
    steps.push(prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 90 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await d.transform(...steps);
    const file = path.join(OUT, `${name}${suffix}.glb`);
    await new NodeIO().registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder }).write(file, d);
    let tris = 0; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() || 0) / 3;
    console.log(`  ${path.relative(ROOT, file)}: ${tris} triangles, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
  }
  {
    // third-person copy, carried by the enemies: one piece (the hidden bolt carrier left out),
    // a few thousand triangles, small textures
    const d = cloneDocument(doc);
    for (const n of d.getRoot().listNodes()) if (n.getName() === 'bcg') n.dispose();
    await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
    let full = 0; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) full += (p.getIndices()?.getCount() || 0) / 3;
    await d.transform(flatten(), join(), weld({}));
    // seen from metres away: tiny detached pieces may go, and UV seams may move
    const ratio = Math.min(1, (cfg.farTris ?? 4000) / full);
    for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const idx = new Uint32Array(p.getIndices().getArray()), pos = p.getAttribute('POSITION');
      const P = new Float32Array(pos.getCount() * 3), e = [];
      for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, e); P.set(e, i * 3); }
      const target = Math.max(3, Math.floor(idx.length * ratio / 3) * 3);
      const [out] = MeshoptSimplifier.simplify(idx, P, 3, target, 0.02, ['Prune', 'Permissive']);
      p.setIndices(d.createAccessor().setArray(out).setType('SCALAR').setBuffer(d.getRoot().listBuffers()[0]));
      compactPrimitive(p);
    }
    // a model with many materials would cost a draw call each, for every enemy carrying it: each
    // material's average colour and finish go into vertex colours, on one metal and one non-metal material
    const mats = d.getRoot().listMaterials();
    if (mats.length > 4) {
      const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const look = new Map();
      for (const m of mats) {
        let c = m.getBaseColorFactor().slice(0, 3), metal = m.getMetallicFactor(), rough = m.getRoughnessFactor();
        const bt = m.getBaseColorTexture(), mr = m.getMetallicRoughnessTexture();
        const ch = (st, k) => st.channels[Math.min(k, st.channels.length - 1)].mean / 255; // (greyscale images have one channel)
        if (bt) { const st = await sharp(Buffer.from(bt.getImage())).stats(); c = c.map((v, k) => v * lin(ch(st, k))); }
        if (mr) { const st = await sharp(Buffer.from(mr.getImage())).stats(); rough *= ch(st, 1); metal *= ch(st, 2); }
        // studio-black finishes read as silhouettes: lift them to real black paint and polymer (as realguns.js does at runtime)
        const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        if (lum < 0.04) c = lum > 0.004 ? c.map((v) => v * 0.04 / lum) : [0.04, 0.04, 0.04];
        look.set(m, { c, metal: metal > 0.5 && lum > 0.1 });
      }
      const matMetal = d.createMaterial('metal').setMetallicFactor(1).setRoughnessFactor(0.36);
      const matFinish = d.createMaterial('finish').setMetallicFactor(0.1).setRoughnessFactor(0.58);
      const buf = d.getRoot().listBuffers()[0];
      for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
        const L = look.get(p.getMaterial()) || { c: [0.5, 0.5, 0.5], metal: false };
        const n = p.getAttribute('POSITION').getCount(), col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set(L.c, i * 3);
        for (const sem of p.listSemantics()) if (sem !== 'POSITION' && sem !== 'NORMAL') p.setAttribute(sem, null);
        p.setAttribute('COLOR_0', d.createAccessor().setArray(col).setType('VEC3').setBuffer(buf));
        p.setMaterial(L.metal ? matMetal : matFinish);
      }
      await d.transform(join(), prune());
    }
    await d.transform(prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 85 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const file = path.join(OUT, `${name}_far.glb`);
    await new NodeIO().registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder }).write(file, d);
    let tris = 0, prims = 0; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) { tris += (p.getIndices()?.getCount() || 0) / 3; prims++; }
    console.log(`  ${path.relative(ROOT, file)}: ${tris} triangles in ${prims} draw calls, ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
  }
  if (debug) {
    const d = cloneDocument(doc);
    const pal = { body: [0.6, 0.6, 0.6], mag: [0.9, 0.2, 0.2], bcg: [0.2, 0.8, 0.2], charge: [0.2, 0.4, 1], dust: [1, 0.9, 0.1], slide: [0.9, 0.3, 0.9], bolt: [0.2, 0.9, 0.9], trigger: [1, 0.5, 0], supp: [0.5, 0.2, 0.7], loose: [0.3, 0.3, 0.1] };
    for (const pn of d.getRoot().listScenes()[0].listChildren()) {
      const mat = d.createMaterial(pn.getName()).setBaseColorFactor([...(pal[pn.getName()] || [1, 1, 1]), 1]).setRoughnessFactor(0.6);
      pn.traverse((n) => { for (const p of n.getMesh()?.listPrimitives() || []) p.setMaterial(mat); });
    }
    await MeshoptSimplifier.ready;
    await d.transform(weld({}), simplify({ simplifier: MeshoptSimplifier, ratio: 0.1, error: 0.002 }), prune());
    await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(path.join(ROOT, '.cache', `${name}_debug.glb`), d);
  }
  return { credit: cfg.credit };
}

const credits = [];
for (const [name, cfg] of Object.entries(GUNS)) {
  if (only.length && !only.includes(name)) { credits.push(cfg.credit); continue; }
  credits.push((await buildGun(name, cfg)).credit);
}
for (const cfg of Object.values(GUNS)) for (const att of cfg.attach || []) if (att.credit && !credits.some((c) => c.url === att.credit.url)) credits.push(att.credit);
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), '# First-person gun models\n\nAll are licensed under Creative Commons Attribution 4.0 (CC BY 4.0); they were scaled to real dimensions, split into moving parts, simplified and re-encoded for the game.\n\n' +
  credits.map((c) => `- **${c.title}** by ${c.author}: ${c.url} (${c.license})`).join('\n') + '\n');
