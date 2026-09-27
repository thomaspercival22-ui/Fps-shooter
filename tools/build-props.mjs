// Builds the furniture and fixtures that dress the levels from real models:
// Poly Haven photo-scans (CC0) and a few Sketchfab models (CC BY; credits in
// assets/props/CREDITS.md). Each is brought to real size, stood on its
// footprint centre (y = 0 on the floor), simplified to a triangle budget and
// re-encoded (WebP textures, meshopt geometry):
//   assets/props/<name>.glb     every preset (512 px textures)
//   assets/props/<name>_hq.glb  Cinematic (1024 px textures)
// usage: node tools/build-props.mjs [name ...]
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, cloneDocument, flatten, join, weld, simplify, transformMesh, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache', 'models');
const OUT = path.join(ROOT, 'assets', 'props');
const OBJAVERSE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';
const PH = 'https://api.polyhaven.com';

// ph: Poly Haven id (real size already); uid: Sketchfab model (scaled so `fit` = [axis, metres]).
// rotY: turn (degrees) so the front faces -Z (chairs: the sitter faces -Z). tris: budget.
export const PROPS = {
  // offices
  officeChair: { uid: 'b228a29fa84544c2be501c295653ffe7', title: 'Office Chair', author: 'nokillnando', fit: ['y', 1.0], rotY: 180, tris: 1400 },
  computer: { uid: '561abc2fc95941609fc7bc6f232895c2', title: 'Desktop Computer', author: 'tylerhalterman', fit: ['x', 0.62], rotY: 180, tris: 2000 },
  waterCooler: { uid: '4b88c4c4e94c497ca39f831f374e89fc', title: 'Water cooler', author: 'tboiston', fit: ['y', 1.28], rotY: 0, tris: 2500 },
  // (leaves are open cards: their edges may move, a coarser bound is invisible)
  plantTall: { ph: 'potted_plant_02', tris: 2500, free: true },
  plantBush: { ph: 'potted_plant_01', tris: 3500, free: true },
  plantSmall: { ph: 'potted_plant_04', tris: 2500, free: true },
  sofa: { ph: 'sofa_02', tris: 6000, rotY: 180 },
  armchair: { ph: 'modern_arm_chair_01', tris: 4000, rotY: 180 },
  wallClock: { ph: 'wall_clock', tris: 1500, rotY: 180 },
  picture1: { ph: 'hanging_picture_frame_01', tris: 600, rotY: 180 },
  picture2: { ph: 'hanging_picture_frame_02', tris: 600, rotY: 180 },
  fireAlarm: { ph: 'fire_alarm', tris: 800, rotY: 180 },
  extinguisher: { ph: 'korean_fire_extinguisher_01', tris: 2500 },
  wetFloor: { ph: 'WetFloorSign_01', tris: 1000 },
  coffeeCart: { ph: 'CoffeeCart_01', tris: 8000, keep: /cart|mugs/ },
  cardboard: { ph: 'cardboard_box_01', tris: 800 },
  secCam: { ph: 'security_camera_01', tris: 1500 },
  shelves: { ph: 'steel_frame_shelves_01', tris: 2000, fit: ['y', 1.8] },
  drawers: { ph: 'drawer_cabinet', tris: 3000, rotY: 180 },
  projector: { ph: 'projector_screen', tris: 2000, rotY: 180 },
  boardTable: { uid: '1ba845e95a964809a9437c2a92ac59ab', title: 'Conference Table - rectangular 6m', author: 'mozillareality', fit: ['y', 0.74], tris: 700 },
  receptionDesk: { uid: 'c1e6580ddcb74d26927470ac59d40787', title: 'Reception Desk 01', author: 'koksky', fit: ['x', 4.4], tris: 1200 },
  // the compound
  monoChair: { ph: 'plastic_monobloc_chair_01', tris: 2500 },
  picnic: { ph: 'wooden_picnic_table', tris: 2000 },
  trashCan: { ph: 'metal_trash_can', tris: 2500, keep: /rust/ },
  handTruck: { ph: 'hand_truck', tris: 2500 },
  ladder: { ph: 'ladder_sectioned_01', tris: 2500 },
  barrelStove: { ph: 'barrel_stove', tris: 2000 },
  powerBox: { ph: 'power_box_01', tris: 1500 },
  // chaos mode
  pie: { uid: 'e20c3851d52c4261891b692a1dfc18c6', title: '#3DST6 Tarte au citron meringuée', author: 'mauricesvay', fit: ['x', 0.26], tris: 1500 },
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
async function polyhaven(id) {
  const dir = path.join(ROOT, '.cache', 'ph', id);
  const file = path.join(dir, id + '.gltf');
  if (fs.existsSync(file)) return file;
  const files = await (await fetch(`${PH}/files/${id}`)).json();
  const g = files.gltf['2k'].gltf;
  fs.mkdirSync(dir, { recursive: true });
  const get = (url, out) => { fs.mkdirSync(path.dirname(out), { recursive: true }); execFileSync('curl', ['-sSL', '--retry', '4', '--retry-all-errors', '-o', out, url]); };
  for (const [rel, inc] of Object.entries(g.include)) get(inc.url, path.join(dir, rel));
  get(g.url, file);
  return file;
}

async function buildProp(name, cfg) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const src = cfg.ph ? await polyhaven(cfg.ph) : sketchfab(cfg.uid);
  const doc = await io.read(src);
  const root = doc.getRoot();
  for (const a of root.listAnimations()) a.dispose();
  if (cfg.keep) for (const n of root.listNodes()) if (n.getMesh() && !cfg.keep.test(n.getName())) n.setMesh(null);
  for (const s of root.listSkins()) s.dispose();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  // bake every node's world transform into its mesh (a mesh used twice is copied), then: turn, scale,
  // stand on the floor at the footprint centre
  {
    const nodes = []; scene.traverse((n) => nodes.push(n));
    const world = new Map(nodes.map((n) => [n, n.getWorldMatrix()]));
    const used = new Set();
    for (const n of nodes) {
      let m = n.getMesh();
      if (!m) continue;
      if (used.has(m)) { const c = m.clone(); c.listPrimitives().forEach((p) => c.removePrimitive(p)); for (const p of m.listPrimitives()) c.addPrimitive(p.clone()); n.setMesh(c); m = c; }
      used.add(m);
      transformMesh(m, world.get(n));
    }
    for (const n of nodes) n.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  await doc.transform(flatten(), join(), weld({}));
  const a = ((cfg.rotY || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const R = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  for (const m of root.listMeshes()) transformMesh(m, R);
  let b = getBounds(scene);
  let k = 1;
  if (cfg.fit) { const ax = { x: 0, y: 1, z: 2 }[cfg.fit[0]]; k = cfg.fit[1] / (b.max[ax] - b.min[ax]); }
  const T = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, -k * (b.min[0] + b.max[0]) / 2, -k * b.min[1], -k * (b.min[2] + b.max[2]) / 2, 1];
  for (const m of root.listMeshes()) transformMesh(m, T);
  b = getBounds(scene);
  let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() || 0) / 3;
  await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
  if (tris > cfg.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: cfg.tris / tris, error: cfg.free ? 0.02 : 0.006, lockBorder: !cfg.free }));
  // glass panes (picture glazing) are left out: without a refraction pass they would hide what is behind them
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) if (p.getMaterial()?.getExtension('KHR_materials_transmission') || /glass/i.test(p.getMaterial()?.getName() || '')) p.dispose();
  // blended materials that are really opaque (common in exports) draw as cut-outs
  for (const m of root.listMaterials()) if (m.getAlphaMode() === 'BLEND' && m.getBaseColorFactor()[3] > 0.99) m.setAlphaMode('MASK').setAlphaCutoff(0.5);
  await doc.transform(prune(), dedup());
  let after = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) after += (p.getIndices()?.getCount() || 0) / 3;
  fs.mkdirSync(OUT, { recursive: true });
  const size = b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' x ');
  for (const [suffix, tex] of [['_hq', 1024], ['', 512]]) {
    const d = cloneDocument(doc);
    await d.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 85 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const file = path.join(OUT, `${name}${suffix}.glb`);
    await new NodeIO().registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder }).write(file, d);
    if (!suffix) console.log(`${name.padEnd(13)} ${size} m, ${tris} -> ${after} triangles, ${(fs.statSync(file).size / 1e3).toFixed(0)} kB`);
  }
  return { size: b };
}

const only = process.argv.slice(2);
const sizes = {};
for (const [name, cfg] of Object.entries(PROPS)) {
  if (only.length && !only.includes(name)) continue;
  const { size } = await buildProp(name, cfg);
  sizes[name] = { min: size.min.map((v) => +v.toFixed(3)), max: size.max.map((v) => +v.toFixed(3)) };
}
// footprints, for placing things against walls and on tables
const metaFile = path.join(OUT, 'props.json');
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
fs.writeFileSync(metaFile, JSON.stringify({ ...meta, ...sizes }, null, 1));
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), '# Level props\n\nPoly Haven photo-scans (CC0, https://polyhaven.com) and Sketchfab models (CC BY 4.0), resized, simplified and re-encoded for the game.\n\n' +
  Object.entries(PROPS).map(([n, c]) => (c.ph ? `- ${c.ph}: https://polyhaven.com/a/${c.ph} (CC0)` : `- **${c.title}** by ${c.author}: https://sketchfab.com/3d-models/${c.uid} (CC BY 4.0)`)).join('\n') + '\n');
