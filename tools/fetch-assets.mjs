// Downloads the CC0 (public domain) textures, models and sky used by the game
// from Poly Haven (https://polyhaven.com) and recompresses them so the whole
// game stays small enough to cache on a phone for offline play.
//
// The results are committed to assets/, so you only need to run this if you
// want to change which assets are used.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const API = 'https://api.polyhaven.com';
const OUT = 'assets';

const TEXTURES = {
  // id: max size (px) for each map
  gravelly_sand: 1024,
  damaged_plaster: 1024,
  concrete_wall_008: 1024,
  concrete_floor_worn_001: 1024,
  rusty_corrugated_iron: 1024,
  container_side: 1024,
  green_rough_planks: 1024,
};
const MODELS = {
  barrel_03: 512,
  ammo_box: 512,
  medical_box: 512,
  old_tyre: 512,
};
const HDRI = 'kloofendal_48d_partly_cloudy_puresky';

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function download(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
    }
  }
}
async function jpeg(buf, size, out, quality = 80) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(buf).resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true }).toFile(out);
}

async function textures() {
  for (const [id, size] of Object.entries(TEXTURES)) {
    if (fs.existsSync(`${OUT}/textures/${id}/diff.jpg`)) continue;
    const files = await json(`${API}/files/${id}`);
    const maps = { diff: files.Diffuse, nor: files.nor_gl, arm: files.arm };
    for (const [name, entry] of Object.entries(maps)) {
      const buf = await download(entry['1k'].jpg.url);
      await jpeg(buf, name === 'arm' ? size / 2 : size, `${OUT}/textures/${id}/${name}.jpg`, name === 'nor' ? 85 : 78);
    }
    console.log('texture', id);
  }
}

async function models() {
  for (const [id, size] of Object.entries(MODELS)) {
    if (fs.existsSync(`${OUT}/models/${id}/${id}.gltf`)) continue;
    const files = await json(`${API}/files/${id}`);
    const g = files.gltf['1k'].gltf;
    const dir = `${OUT}/models/${id}`;
    fs.mkdirSync(dir, { recursive: true });
    const gltf = JSON.parse((await download(g.url)).toString());
    for (const [rel, inc] of Object.entries(g.include)) {
      const buf = await download(inc.url);
      if (rel.endsWith('.jpg') || rel.endsWith('.png')) {
        await jpeg(buf, size, path.join(dir, rel.replace(/\.png$/, '.jpg')), rel.includes('nor') ? 85 : 78);
      } else {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), buf);
      }
    }
    for (const img of gltf.images || []) {
      img.uri = img.uri.replace(/\.png$/, '.jpg');
      img.mimeType = 'image/jpeg';
    }
    fs.writeFileSync(`${dir}/${id}.gltf`, JSON.stringify(gltf));
    console.log('model', id);
  }
}

async function sky() {
  if (fs.existsSync(`${OUT}/sky/sky.jpg`)) return;
  const files = await json(`${API}/files/${HDRI}`);
  fs.mkdirSync(`${OUT}/sky`, { recursive: true });
  // Small HDR for image-based lighting + a sharper tonemapped JPG for the visible sky.
  fs.writeFileSync(`${OUT}/sky/sky_1k.hdr`, await download(files.hdri['1k'].hdr.url));
  const tm = await download(files.tonemapped.url);
  await sharp(tm, { limitInputPixels: false }).resize(4096, 2048).jpeg({ quality: 82, mozjpeg: true })
    .toFile(`${OUT}/sky/sky.jpg`);
  console.log('sky', HDRI);
}

await textures();
await models();
await sky();
console.log('done');
