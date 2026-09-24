// Copies the parts of three.js the game needs into vendor/ so the game has
// zero network dependencies at runtime (required for offline play).
import fs from 'fs';
import path from 'path';

const src = 'node_modules/three';
const dst = 'vendor/three';
const files = [
  ['build/three.module.min.js', 'build/three.module.min.js'],
  ['build/three.core.min.js', 'build/three.core.min.js'],
  ['examples/jsm/loaders/GLTFLoader.js', 'addons/loaders/GLTFLoader.js'],
  ['examples/jsm/loaders/HDRLoader.js', 'addons/loaders/HDRLoader.js'],
  ['examples/jsm/utils/BufferGeometryUtils.js', 'addons/utils/BufferGeometryUtils.js'],
  ['LICENSE', 'LICENSE'],
];
for (const [from, to] of files) {
  const out = path.join(dst, to);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(path.join(src, from), out);
  console.log('vendored', to);
}
