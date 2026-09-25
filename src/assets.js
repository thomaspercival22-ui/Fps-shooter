// Loads textures, models and the sky, and builds PBR materials from them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { textureCap } from './settings.js';

const TEXTURE_SETS = [
  'gravelly_sand', 'damaged_plaster', 'concrete_wall_008', 'concrete_floor_worn_001',
  'rusty_corrugated_iron', 'container_side', 'green_rough_planks', 'dry_ground_rocks', 'hessian_380', 'hessian_230',
];
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
  t.image = c;
  t.needsUpdate = true;
}

export async function loadAssets(renderer, onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
  const texLoader = new THREE.TextureLoader(manager);
  const gltfLoader = new GLTFLoader(manager);
  const hdrLoader = new HDRLoader(manager).setDataType(THREE.FloatType);
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const cap = textureCap();

  const loadTex = (url, srgb, maxSize = cap) => new Promise((res, rej) => texLoader.load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    capImage(t, maxSize);
    res(t);
  }, undefined, rej));

  const textures = {};
  const jobs = [];
  for (const id of TEXTURE_SETS) {
    textures[id] = {};
    for (const [key, srgb] of [['diff', true], ['nor', false], ['arm', false]]) {
      jobs.push(loadTex(`assets/textures/${id}/${key}.jpg`, srgb).then((t) => { textures[id][key] = t; }));
    }
  }
  const models = {};
  for (const id of MODEL_IDS) {
    jobs.push(new Promise((res, rej) => gltfLoader.load(`assets/models/${id}/${id}.gltf`, (g) => { models[id] = g.scene; res(); }, undefined, rej)));
  }
  let groundHeight = null;
  jobs.push(loadTex('assets/textures/ground_height.jpg', false).then((t) => { groundHeight = t; }));
  let hdr = null, skyTex = null;
  jobs.push(new Promise((res, rej) => hdrLoader.load('assets/sky/sky_1k.hdr', (t) => { hdr = t; res(); }, undefined, rej)));
  jobs.push(loadTex('assets/sky/sky.jpg', true, Math.min(8192, cap * 2)).then((t) => { skyTex = t; }));
  await Promise.all(jobs);

  // Replace the mirrored lower hemisphere of the sky HDR with warm ground
  // bounce light, and find the sun direction (brightest pixel).
  const sunDir = prepareHdr(hdr);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  skyTex.wrapS = THREE.RepeatWrapping;
  skyTex.wrapT = THREE.ClampToEdgeWrapping;
  skyTex.generateMipmaps = false;
  skyTex.minFilter = THREE.LinearFilter;

  // model textures: filtering + the same size cap
  for (const root of Object.values(models)) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']) {
        const t = o.material[k];
        if (t && !t.userData.capped) { t.userData.capped = true; t.anisotropy = aniso; capImage(t, cap); }
      }
    });
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromEquirectangular(hdr).texture;
  pmrem.dispose();
  hdr.dispose();

  return { textures, models, envMap, skyTex, sunDir, groundHeight, horizon: sunDir.horizon };
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
