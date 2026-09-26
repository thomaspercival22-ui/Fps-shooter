// Loads textures, models and the sky, and builds PBR materials from them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { textureCap, propTextureCap, skyFaceSize, MOBILE, isCinematic } from './settings.js';

// Cinematic (gaming PC): the original, full-resolution scans straight from Poly Haven's CDN
const PH = 'https://dl.polyhaven.org/file/ph-assets';
const PH_HDRI = 'kloofendal_48d_partly_cloudy_puresky';
// surfaces that fill the screen get 4K colour and normal maps; everything else 2K
const CINE_4K_SETS = new Set(['gravelly_sand', 'dry_ground_rocks', 'damaged_plaster', 'concrete_wall_008', 'concrete_floor_worn_001']);
const CINE_4K_MODELS = new Set(['concrete_road_barrier_02', 'covered_car', 'wooden_military_crate', 'rock_09', 'quiver_tree_02', 'portable_generator']);
// scattered hundreds of times: keeps its light mesh even here
const CINE_LOCAL = new Set(['namaqualand_stones_01']);
const PH_MAP = { diff: 'diff', nor: 'nor_gl', arm: 'arm' };

/** A Poly Haven glTF from the CDN, with its buffer and texture paths pointed at where the CDN keeps them. */
async function remoteGltf(loader, id, res) {
  const base = `${PH}/Models/gltf/${res}/${id}/`;
  const r = await fetch(`${base}${id}_${res}.gltf`);
  if (!r.ok) throw new Error(`${id}: ${r.status}`);
  const json = await r.json();
  const local = (u) => u && !/^(data|https?|blob):/.test(u);
  // download every buffer and texture first: a scan that can't be fetched whole isn't used at all
  // (the loader would otherwise build the model without the textures that failed)
  const blobs = [];
  const grab = async (url) => {
    const f = await fetch(url);
    if (!f.ok) throw new Error(`${url}: ${f.status}`);
    const u = URL.createObjectURL(await f.blob());
    blobs.push(u);
    return u;
  };
  try {
    await Promise.all([
      ...(json.buffers || []).filter((b) => local(b.uri)).map(async (b) => { b.uri = await grab(base + b.uri); }),
      ...(json.images || []).filter((im) => local(im.uri)).map(async (im) => { im.uri = await grab(`${PH}/Models/jpg/${res}/${id}/${im.uri.split('/').pop()}`); }),
    ]);
    const g = await new Promise((res2, rej) => loader.parse(JSON.stringify(json), '', res2, rej));
    // textures decode asynchronously: wait until every one is ready before letting the blobs go
    const maps = [];
    g.scene.traverse((o) => { if (o.isMesh) for (const t of Object.values(o.material)) if (t && t.isTexture) maps.push(t); });
    if (maps.length < (json.textures || []).length) throw new Error(`${id}: textures missing`);
    return g;
  } finally {
    setTimeout(() => blobs.forEach((u) => URL.revokeObjectURL(u)), 30000);
  }
}

const TEXTURE_SETS = [
  'gravelly_sand', 'damaged_plaster', 'concrete_wall_008', 'concrete_floor_worn_001',
  'rusty_corrugated_iron', 'container_side', 'green_rough_planks', 'dry_ground_rocks', 'hessian_380', 'hessian_230',
];
// props that can fill the screen keep full-size textures on phones
const BIG_PROPS = new Set(['concrete_road_barrier_02', 'covered_car', 'wooden_military_crate', 'rollershutter_door', 'quiver_tree_02', 'rock_09']);
const MODEL_IDS = ['barrel_03', 'Barrel_02', 'ammo_box', 'medical_box', 'old_tyre', 'exterior_aircon_unit', 'utility_box_02', 'propane_tank',
  'trashbag', 'portable_generator', 'covered_car', 'metal_jerrycan', 'security_light', 'concrete_road_barrier_02',
  'wooden_military_crate', 'cement_bag', 'rollershutter_door', 'wild_rooibos_bush', 'dry_branches_medium_01',
  'namaqualand_stones_01', 'rock_09', 'quiver_tree_02'];

// daylight levels shared with the game (sun light intensity, image-based light intensity)
export const SUN_INTENSITY = 3.1, ENV_INTENSITY = 0.85;

/** Scales an oversized texture image down to the preset's cap (keeps weaker phones within GPU memory). */
function capImage(t, cap) {
  const img = t.image;
  if (!img || !img.width || Math.max(img.width, img.height) <= cap) return;
  const k = cap / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) img.close();
  t.image = c;
  t.needsUpdate = true;
}

/**
 * Drops the CPU-side copy of a texture's pixels once they are on the GPU.
 * Without this every texture is held twice (decoded image + GPU copy), which
 * alone was enough to crash phones while loading.
 */
function releaseImage(t) {
  const img = t.source.data;
  if (!img || img.released) return;
  const w = img.width, h = img.height;
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) img.close();
  else if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) { img.width = 0; img.height = 0; }
  t.source.data = { width: w, height: h, released: true };
  t.onUpdate = null;
}
/** Uploads a texture now and frees its decoded image right after. */
function uploadAndRelease(renderer, t) {
  if (t.userData.keepImage) return;
  t.onUpdate = releaseImage;
  renderer.initTexture(t);
}

export async function loadAssets(renderer, onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
  const texLoader = new THREE.TextureLoader(manager);
  const gltfLoader = new GLTFLoader(manager);
  const hdrLoader = new HDRLoader(manager).setDataType(THREE.FloatType);
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const cap = textureCap();
  const cine = isCinematic();
  const stats = { remote: 0, local: 0 };

  // each texture goes to the GPU as soon as it arrives and its decoded copy is
  // dropped, so loading never holds every image in memory at once
  const loadTex = (url, srgb, maxSize = cap, opts = {}) => new Promise((res, rej) => texLoader.load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    capImage(t, maxSize);
    if (opts.keep) t.userData.keepImage = true;
    if (opts.upload !== false) uploadAndRelease(renderer, t);
    res(t);
  }, undefined, rej));

  const textures = {};
  const jobs = [];
  for (const id of TEXTURE_SETS) {
    textures[id] = {};
    // the ground fills half the screen: phones keep it one step sharper
    const setCap = id === 'gravelly_sand' && MOBILE ? Math.min(2048, cap * 2) : cap;
    for (const [key, srgb] of [['diff', true], ['nor', false], ['arm', false]]) {
      // the container colour map is re-tinted on the CPU when the level is built
      const keep = id === 'container_side' && key === 'diff';
      const local = () => loadTex(`assets/textures/${id}/${key}.jpg`, srgb, setCap, { keep });
      let job = local;
      if (cine) {
        const res = CINE_4K_SETS.has(id) && key !== 'arm' ? '4k' : '2k';
        job = () => loadTex(`${PH}/Textures/jpg/${res}/${id}/${id}_${PH_MAP[key]}_${res}.jpg`, srgb, 8192, { keep }).then((t) => { stats.remote++; return t; }).catch(() => { stats.local++; return local(); });
      }
      jobs.push(job().then((t) => { textures[id][key] = t; }));
    }
  }
  const models = {};
  for (const id of MODEL_IDS) {
    const mcap = BIG_PROPS.has(id) ? cap : propTextureCap();
    const localModel = () => new Promise((res, rej) => gltfLoader.load(`assets/models/${id}/${id}.gltf`, res, undefined, rej));
    const source = cine && !CINE_LOCAL.has(id)
      ? remoteGltf(gltfLoader, id, CINE_4K_MODELS.has(id) ? '4k' : '2k').then((g) => { stats.remote++; return g; }).catch((e) => { stats.local++; console.warn(`cinematic: ${id} fell back (${e.message})`); return localModel(); })
      : localModel();
    jobs.push(source.then((g) => new Promise((res) => {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        for (const [k, t] of Object.entries(o.material)) {
          if (!t || !t.isTexture || t.userData.capped) continue;
          t.userData.capped = true;
          t.anisotropy = aniso;
          capImage(t, mcap);
          if (id === 'barrel_03' && k === 'map') t.userData.keepImage = true; // recoloured into the red fuel drum
          uploadAndRelease(renderer, t);
        }
      });
      models[id] = g.scene; res();
    })));
  }
  let groundHeight = null;
  jobs.push(loadTex('assets/textures/ground_height.jpg', false).then((t) => { groundHeight = t; }));
  let hdr = null, skyCube = null;
  // Cinematic lights the scene from the 2K HDR (sharper reflections, a crisper sun)
  const hdrLocal = () => new Promise((res, rej) => hdrLoader.load('assets/sky/sky_1k.hdr', (t) => { hdr = t; res(); }, undefined, rej));
  jobs.push(cine ? new Promise((res, rej) => hdrLoader.load(`${PH}/HDRIs/hdr/2k/${PH_HDRI}_2k.hdr`, (t) => { hdr = t; stats.remote++; res(); }, undefined, rej)).catch(hdrLocal) : hdrLocal());
  // sky backdrop: the photo is turned into a cube map of a size the device can
  // afford (the renderer's automatic conversion would make 4096px faces, 400 MB)
  const face = skyFaceSize();
  jobs.push(loadTex(face > 1024 ? 'assets/sky/sky.jpg' : 'assets/sky/sky_4k.jpg', true, face * 4, { upload: false }).then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    const rt = new THREE.WebGLCubeRenderTarget(face, { generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    rt.fromEquirectangularTexture(renderer, t);
    t.dispose();
    releaseImage(t);
    skyCube = rt.texture;
  }));
  await Promise.all(jobs);

  // Replace the mirrored lower hemisphere of the sky HDR with warm ground
  // bounce light, and find the sun direction (brightest pixel).
  const sunDir = prepareHdr(hdr);
  hdr.mapping = THREE.EquirectangularReflectionMapping;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromEquirectangular(hdr).texture;
  pmrem.dispose();
  hdr.dispose();
  hdr.image = null;

  if (cine) console.info(`cinematic assets: ${stats.remote} from Poly Haven, ${stats.local} fell back to the bundled copies`);
  return { textures, models, envMap, skyTex: skyCube, sunDir, groundHeight, horizon: sunDir.horizon, cinematic: cine ? stats : null };
}

function prepareHdr(tex) {
  const { data, width, height } = tex.image;
  const ch = data.length / (width * height);
  let best = -1, bestI = 0, bestJ = 0;
  // average horizon brightness for the ground fill
  let hr = 0, hg = 0, hb = 0, hn = 0;
  for (let j = 0; j < height; j++) {
    // flipY: row 0 is the top of the image
    const v = 1 - (j + 0.5) / height;
    const lat = (v - 0.5) * Math.PI;
    for (let i = 0; i < width; i++) {
      const k = (j * width + i) * ch;
      const lum = data[k] * 0.2126 + data[k + 1] * 0.7152 + data[k + 2] * 0.0722;
      if (lat > 0.05 && lum > best) { best = lum; bestI = i; bestJ = j; }
      if (lat > 0 && lat < 0.5) { hr += data[k]; hg += data[k + 1]; hb += data[k + 2]; hn++; }
    }
  }
  hr /= hn; hg /= hn; hb /= hn;
  const avg = (hr + hg + hb) / 3;
  // the environment is filtered in half-float targets: a sun pixel above 65504 turns into Infinity there and
  // the blur spreads it into NaN lighting everywhere (the 2K scan's sun peaks at ~73000)
  for (let k = 0; k < data.length; k++) if (data[k] > 6e4) data[k] = 6e4;
  // Ground bounce: sunlit sand reflects a lot of light back up into shadows.
  // Radiance = albedo x (sun irradiance + sky irradiance), divided by the scene's
  // environment intensity so the lit result matches the direct light.
  const su = (bestI + 0.5) / width, sv = 1 - (bestJ + 0.5) / height;
  const sunY = Math.max(0.35, Math.sin((sv - 0.5) * Math.PI));
  const E = (SUN_INTENSITY * sunY + avg * 1.5) / ENV_INTENSITY;
  const gr = 0.46 * E, gg = 0.37 * E, gb = 0.27 * E;
  void su;
  for (let j = 0; j < height; j++) {
    const v = 1 - (j + 0.5) / height;
    const lat = (v - 0.5) * Math.PI;
    if (lat >= 0.02) continue;
    const blend = Math.min(1, (0.02 - lat) / 0.12); // soft transition at the horizon
    for (let i = 0; i < width; i++) {
      const k = (j * width + i) * ch;
      data[k] = data[k] * (1 - blend) + gr * blend;
      data[k + 1] = data[k + 1] * (1 - blend) + gg * blend;
      data[k + 2] = data[k + 2] * (1 - blend) + gb * blend;
    }
  }
  tex.needsUpdate = true;
  const u = (bestI + 0.5) / width, v = 1 - (bestJ + 0.5) / height;
  const phi = (u - 0.5) * Math.PI * 2, lat = (v - 0.5) * Math.PI;
  const dir = new THREE.Vector3(Math.cos(lat) * Math.cos(phi), Math.sin(lat), Math.cos(lat) * Math.sin(phi)).normalize();
  dir.horizon = new THREE.Color(hr, hg, hb); // average sky colour near the horizon (linear)
  return dir;
}

/** PBR material from a Poly Haven texture set (diff / nor / arm). */
export function pbrMaterial(assets, id, opts = {}) {
  const t = assets.textures[id];
  const m = new THREE.MeshStandardMaterial({
    map: t.diff,
    normalMap: t.nor,
    aoMap: t.arm,
    roughnessMap: t.arm,
    metalnessMap: t.arm,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 1,
    color: opts.color ?? 0xffffff,
    aoMapIntensity: opts.ao ?? 1,
  });
  if (opts.normalScale) m.normalScale.set(opts.normalScale, opts.normalScale);
  return m;
}
