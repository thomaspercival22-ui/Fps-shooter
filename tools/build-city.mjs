// Builds the skyline around Meridian Tower from real building models
// (Sketchfab, CC BY; credits in assets/city/CREDITS.md). Packs that hold many
// buildings are split into separate towers (pieces whose footprints overlap
// stay together); each tower is brought to real size, stood on the ground at
// its footprint centre and joined into as few draw calls as its materials
// allow. Everything goes into one file:
//   assets/city/city.glb      phones (256 px textures)
//   assets/city/city_hq.glb   desktop (512 px)
//   assets/city/city.json     each tower's footprint and height, for placing them
// The towers are seen from 180 m up, 90-560 m away: no collision is needed.
// usage: node tools/build-city.mjs
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, cloneDocument, join, weld, transformMesh, mergeDocuments, unpartition, metalRough } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache', 'models');
const OUT = path.join(ROOT, 'assets', 'city');
const OBJAVERSE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';

// scale: metres per model unit. skip: node names left out. minH: pieces lower than this (m) are not towers.
export const SOURCES = {
  midcity: { uid: 'ba4303059c514a869790b08ff9b1f1bf', title: 'Mid City Metro', author: 'jvaughan', scale: 1, skip: /^Object_31$/, minH: 40 },
  nyc: { uid: 'e7922fe0f7b14ed786f84529f9217dac', title: 'New York Buildings', author: 'sumitmangela', scale: 62, minH: 40 },
  usbank: { uid: '82227908aa5c446395c4b9847284da4a', title: 'US Bank Tower', author: 'mitya-petrov', scale: 1 },
  whitehall: { uid: 'd0db0e12b3484594a1c9eb35186b7c0f', title: 'Whitehall Building', author: 'novusod', scale: 1 },
  rand: { uid: '9ecf85f8298b49aca24a02d673ded5a9', title: 'Rand Tower', author: 'hamma085', scale: 0.01 },
  ward: { uid: '8c753bdec75e41aeb1af609148735305', title: 'Montgomery Ward Tower Building', author: 'hamma085', scale: 0.01 },
};

function sketchfab(uid) {
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

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function meshBounds(m) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], v = [0, 0, 0];
  for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); } } }
  return { lo, hi };
}

/** One source pack -> a document whose scene holds one node per tower (meshes in metres, footprint centred, base at y = 0). */
async function towers(key, cfg, io) {
  const doc = await io.read(sketchfab(cfg.uid));
  const root = doc.getRoot();
  // everything lit the same way: specular-glossiness converted, unlit (baked) materials made standard
  await doc.transform(metalRough());
  for (const m of root.listMaterials()) m.setExtension('KHR_materials_unlit', null);
  for (const a of root.listAnimations()) a.dispose();
  for (const s of root.listSkins()) s.dispose();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const nodes = []; scene.traverse((n) => nodes.push(n));
  const world = new Map(nodes.map((n) => [n, n.getWorldMatrix()]));
  // bake world transforms and scale into the meshes (a mesh used twice is copied)
  const k = cfg.scale, S = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1];
  const parts = [], used = new Set();
  for (const n of nodes) {
    let m = n.getMesh();
    if (!m || (cfg.skip && cfg.skip.test(n.getName()))) continue;
    if (used.has(m)) { const c = m.clone(); c.listPrimitives().forEach((p) => c.removePrimitive(p)); for (const p of m.listPrimitives()) c.addPrimitive(p.clone()); m = c; }
    used.add(m);
    transformMesh(m, world.get(n));
    transformMesh(m, S);
    parts.push({ mesh: m, ...meshBounds(m) });
  }
  for (const n of nodes) { n.setMesh(null); n.setMatrix(I4); }
  // towers: pieces whose footprints overlap belong together
  const par = parts.map((_, i) => i), find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i], b = parts[j];
    if (a.lo[0] < b.hi[0] && b.lo[0] < a.hi[0] && a.lo[2] < b.hi[2] && b.lo[2] < a.hi[2]) par[find(j)] = find(i);
  }
  const groups = new Map();
  parts.forEach((p, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p); });
  const scene2 = doc.createScene(key);
  const info = {};
  let n = 0;
  for (const list of groups.values()) {
    const lo = [0, 1, 2].map((q) => Math.min(...list.map((p) => p.lo[q]))), hi = [0, 1, 2].map((q) => Math.max(...list.map((p) => p.hi[q])));
    if (hi[1] - lo[1] < (cfg.minH || 0)) continue;
    const name = `${key}${n++}`;
    const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2, 1];
    const tower = doc.createNode(name);
    for (const p of list) { transformMesh(p.mesh, T); tower.addChild(doc.createNode(name + '_part').setMesh(p.mesh)); }
    scene2.addChild(tower);
    const tris = list.reduce((t, p) => t + p.mesh.listPrimitives().reduce((a, q) => a + (q.getIndices()?.getCount() || q.getAttribute('POSITION').getCount()) / 3, 0), 0);
    info[name] = { w: +(hi[0] - lo[0]).toFixed(1), d: +(hi[2] - lo[2]).toFixed(1), h: +(hi[1] - lo[1]).toFixed(1), tris: Math.round(tris), src: key };
  }
  for (const s of root.listScenes()) if (s !== scene2) s.dispose();
  root.setDefaultScene(scene2);
  await doc.transform(prune());
  return { doc, info };
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptEncoder.ready;
let all = null;
const info = {};
for (const [key, cfg] of Object.entries(SOURCES)) {
  const { doc, info: part } = await towers(key, cfg, io);
  Object.assign(info, part);
  console.log(`${key.padEnd(10)} ${Object.entries(part).map(([n, t]) => `${n} ${t.w}x${t.d}x${t.h}`).join(', ')}`);
  if (!all) { all = doc; continue; }
  mergeDocuments(all, doc);
}
// one scene holding every tower
const root = all.getRoot(), main = root.getDefaultScene();
for (const s of root.listScenes()) if (s !== main) { for (const c of s.listChildren()) main.addChild(c); s.dispose(); }
// from 90-560 m away only the colour reads: normal, roughness and occlusion maps are left out
for (const m of root.listMaterials()) {
  if (m.getAlphaMode() === 'BLEND' && m.getBaseColorFactor()[3] > 0.99) m.setAlphaMode('OPAQUE');
  m.setDoubleSided(false);
  m.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
  m.setMetallicFactor(0).setRoughnessFactor(0.85);
}
await all.transform(unpartition(), weld({}), join({ keepNamed: false }), prune(), dedup());
fs.mkdirSync(OUT, { recursive: true });
for (const [suffix, size] of [['_hq', 512], ['', 256]]) {
  const d = cloneDocument(all);
  await d.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = path.join(OUT, `city${suffix}.glb`);
  await new NodeIO().registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder }).write(file, d);
  let tris = 0; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() || 0) / 3;
  console.log(`city${suffix}.glb ${(fs.statSync(file).size / 1e6).toFixed(2)} MB, ${Object.keys(info).length} towers, ${tris} triangles, ${d.getRoot().listTextures().length} textures, ${d.getRoot().listMeshes().length} meshes`);
}
fs.writeFileSync(path.join(OUT, 'city.json'), JSON.stringify(info, null, 1));
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), '# City skyline\n\nSketchfab models (CC BY 4.0), split into single towers, resized and re-encoded for the game.\n\n' +
  Object.values(SOURCES).map((c) => `- **${c.title}** by ${c.author}: https://sketchfab.com/3d-models/${c.uid} (CC BY 4.0)`).join('\n') + '\n');
