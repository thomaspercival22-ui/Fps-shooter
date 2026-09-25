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

// id: { size: colour + normal map size, arm: AO/roughness/metal map size, disp: height map size }
const TEXTURES = {
  gravelly_sand: { size: 4096, arm: 2048, disp: 2048 },
  dry_ground_rocks: { size: 2048, arm: 1024, disp: 2048 },
  damaged_plaster: { size: 2048, arm: 1024 },
  concrete_wall_008: { size: 2048, arm: 1024 },
  concrete_floor_worn_001: { size: 2048, arm: 1024 },
  rusty_corrugated_iron: { size: 2048, arm: 1024 },
  container_side: { size: 2048, arm: 1024 },
  green_rough_planks: { size: 1024, arm: 512 },
  hessian_380: { size: 2048, arm: 1024 },
  hessian_230: { size: 1024, arm: 512 },
};
// Both ground height maps share one texture (R = gravelly sand, G = dry ground).
const GROUND_HEIGHT = ['gravelly_sand', 'dry_ground_rocks'];
// id: texture size. Heavy scans are decimated afterwards by tools/simplify-models.mjs.
const MODELS = {
  barrel_03: 1024,
  Barrel_02: 1024,
  ammo_box: 1024,
  medical_box: 1024,
  old_tyre: 1024,
  exterior_aircon_unit: 1024,
  utility_box_02: 1024,
  propane_tank: 1024,
  trashbag: 1024,
  portable_generator: 1024,
  covered_car: 2048,
  metal_jerrycan: 1024,
  security_light: 1024,
  concrete_road_barrier_02: 2048,
  wooden_military_crate: 2048,
  cement_bag: 1024,
  rollershutter_door: 1024,
  wild_rooibos_bush: 1024,
  dry_branches_medium_01: 1024,
  namaqualand_stones_01: 1024,
  rock_09: 2048,
  quiver_tree_02: 1024,
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

const pick = (entry, size) => entry[['1k', '2k', '4k', '8k'].find((k) => parseInt(k, 10) * 1024 >= size && entry[k]) || '8k'];
async function width(file) {
  return fs.existsSync(file) ? (await sharp(file).metadata()).width : 0;
}

async function textures() {
  for (const [id, cfg] of Object.entries(TEXTURES)) {
    const dir = `${OUT}/textures/${id}`;
    if (await width(`${dir}/diff.jpg`) === cfg.size && await width(`${dir}/arm.jpg`) === cfg.arm) continue;
    const files = await json(`${API}/files/${id}`);
    const maps = { diff: [files.Diffuse, cfg.size, 80], nor: [files.nor_gl, cfg.size, 86], arm: [files.arm, cfg.arm, 80] };
    for (const [name, [entry, size, q]] of Object.entries(maps)) {
      await jpeg(await download(pick(entry, size).jpg.url), size, `${dir}/${name}.jpg`, q);
    }
    console.log('texture', id, cfg.size);
  }
  // packed ground height map for parallax occlusion mapping
  const out = `${OUT}/textures/ground_height.jpg`;
  const size = TEXTURES[GROUND_HEIGHT[0]].disp;
  if (await width(out) !== size) {
    const chans = [];
    for (const id of GROUND_HEIGHT) {
      const files = await json(`${API}/files/${id}`);
      const buf = await download(pick(files.Displacement, size).jpg.url);
      chans.push(await sharp(buf).resize(size, size).greyscale().normalise().raw().toBuffer());
    }
    const rgb = Buffer.alloc(size * size * 3);
    for (let i = 0; i < size * size; i++) { rgb[i * 3] = chans[0][i]; rgb[i * 3 + 1] = chans[1][i]; rgb[i * 3 + 2] = 128; }
    await sharp(rgb, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 90, mozjpeg: true }).toFile(out);
    console.log('ground height', size);
  }
}

async function models() {
  for (const [id, size] of Object.entries(MODELS)) {
    const stamp = `${OUT}/models/${id}/.size`;
    if (fs.existsSync(`${OUT}/models/${id}/${id}.gltf`) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === String(size)) continue;
    fs.rmSync(`${OUT}/models/${id}`, { recursive: true, force: true });
    const files = await json(`${API}/files/${id}`);
    const g = files.gltf[size > 1024 ? '2k' : '1k'].gltf;
    const dir = `${OUT}/models/${id}`;
    fs.mkdirSync(dir, { recursive: true });
    const gltf = JSON.parse((await download(g.url)).toString());
    for (const [rel, inc] of Object.entries(g.include)) {
      const buf = await download(inc.url);
      if (rel.endsWith('.jpg') || rel.endsWith('.png')) {
        await jpeg(buf, rel.includes('_arm') ? Math.max(512, size / 2) : size, path.join(dir, rel.replace(/\.png$/, '.jpg')), rel.includes('nor') ? 86 : 80);
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
    fs.writeFileSync(stamp, String(size));
    console.log('model', id, size);
  }
}

async function sky() {
  if (await width(`${OUT}/sky/sky.jpg`) === 8192) return;
  const files = await json(`${API}/files/${HDRI}`);
  fs.mkdirSync(`${OUT}/sky`, { recursive: true });
  // Small HDR for image-based lighting + a sharper tonemapped JPG for the visible sky.
  fs.writeFileSync(`${OUT}/sky/sky_1k.hdr`, await download(files.hdri['1k'].hdr.url));
  const tm = await download(files.tonemapped.url);
  await sharp(tm, { limitInputPixels: false }).resize(8192, 4096).jpeg({ quality: 84, mozjpeg: true })
    .toFile(`${OUT}/sky/sky.jpg`);
  console.log('sky', HDRI);
}

await textures();
await models();
await sky();
console.log('done');
