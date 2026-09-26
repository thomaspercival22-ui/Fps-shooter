// First-person arms (sleeves, fingerless gloves, rigged hands) from a CC BY model on Sketchfab
// (via the Objaverse mirror), re-encoded for the game: WebP textures, compressed geometry.
// The skeleton is kept as is; src/arms.js poses it every frame.
// usage: node tools/build-arms.mjs
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const UID = 'e3c42c05b22944e5839deb8e003f0987';
const CREDIT = '- **First Person arms** by bumstrum: https://sketchfab.com/3d-models/e3c42c05b22944e5839deb8e003f0987 (CC BY 4.0)';
const cache = path.join(ROOT, '.cache', 'models', UID + '.glb');
if (!fs.existsSync(cache)) {
  const idx = path.join(ROOT, '.cache', 'models', 'object-paths.json');
  const rel = JSON.parse(fs.readFileSync(idx, 'utf8'))[UID];
  execFileSync('curl', ['-sSL', '--http1.1', '--retry', '4', '-o', cache, 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/' + rel]);
}
const io = new NodeIO().registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(cache);
await MeshoptEncoder.ready;
await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 90 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const out = path.join(ROOT, 'assets', 'arms');
fs.mkdirSync(out, { recursive: true });
await io.write(path.join(out, 'arms.glb'), doc);
fs.writeFileSync(path.join(out, 'CREDITS.md'), '# First-person arms\n\n' + CREDIT + '\n');
console.log('assets/arms/arms.glb', (fs.statSync(path.join(out, 'arms.glb')).size / 1e6).toFixed(2), 'MB');
