// Buildings from real models (tools/build-buildings.mjs; credits in
// assets/buildings/CREDITS.md), loaded at boot and placed by the level
// builders. Each stands on y = 0 at its footprint centre; its collision boxes
// were generated from its own geometry, so doors, stairs, floors and windows
// work where they are drawn. Placement turns are quarter turns so the boxes
// stay axis-aligned. A building that fails to load is simply left out.
import { modelLoader } from './gltf.js';

const MODELS = {};
let META = null;

export async function loadBuildings(renderer, hq = false) {
  const loader = await modelLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  try { META = await (await fetch('assets/buildings/buildings.json')).json(); } catch (e) { console.warn('buildings unavailable', e); return; }
  await Promise.all(Object.keys(META).filter((k) => k !== 'classes').map(async (name) => {
    try {
      let g = hq ? await loader.loadAsync(`assets/buildings/${name}_hq.glb`).catch(() => null) : null;
      if (!g) g = await loader.loadAsync(`assets/buildings/${name}.glb`);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material;
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = aniso;
        // exported as blended but really opaque: draw as a cut-out so it sorts and writes depth
        if (m.transparent && m.opacity >= 0.99 && !/glass/i.test(m.name)) { m.transparent = false; m.depthWrite = true; m.alphaTest = 0.5; }
        o.castShadow = !m.transparent; o.receiveShadow = true;
      });
      MODELS[name] = g.scene;
    } catch (e) {
      console.warn(`building ${name} unavailable`, e);
    }
  }));
}

export function hasBuilding(name) { return !!MODELS[name]; }

/** Local (x, z) of a building turned `turn` quarter turns (as Object3D.rotation.y = turn * PI/2), moved to (x, z). */
function turnXZ(lx, lz, turn, x, z) {
  switch (((turn % 4) + 4) % 4) {
    case 1: return [x + lz, z - lx];
    case 2: return [x - lx, z - lz];
    case 3: return [x - lz, z + lx];
    default: return [x + lx, z + lz];
  }
}

/**
 * Places a building: the model (added to `parent`) and its collision boxes (added to `world`).
 * Returns { footprint: {x0, z0, x1, z1, h}, spots: [{x, y, z}] indoor places with standing room,
 * at: (lx, lz) => [x, z] (a point of the model in world space), walls: tall boxes near the ground }.
 */
export function placeBuilding(name, x, z, turn, { parent, world, heat = 0.31 }) {
  const model = MODELS[name];
  if (!model) return null;
  const info = META[name], classes = META.classes;
  const obj = model.clone();
  obj.position.set(x, 0, z);
  obj.rotation.y = turn * Math.PI / 2;
  obj.traverse((o) => { if (o.isMesh) { o.userData.heat = heat; o.userData.env = true; } });
  obj.updateMatrixWorld(true);
  parent.add(obj);
  const at = (lx, lz) => turnXZ(lx, lz, turn, x, z);
  const walls = [];
  const B = info.boxes;
  for (let i = 0; i < B.length; i += 7) {
    const [ax, az] = at(B[i], B[i + 2]), [bx, bz] = at(B[i + 3], B[i + 5]);
    const c = classes[B[i + 6]];
    const b = world.add(Math.min(ax, bx), B[i + 1], Math.min(az, bz), Math.max(ax, bx), B[i + 4], Math.max(az, bz),
      { mat: c.mat, pen: c.pen, blocksBullets: c.bullets ?? true, blocksSight: c.sight ?? true });
    if (b.y0 < 0.6 && b.y1 > 1.5 && Math.max(b.x1 - b.x0, b.z1 - b.z0) > 0.8 && b.blocksSight) walls.push(b);
  }
  const [ax, az] = at(info.min[0], info.min[2]), [bx, bz] = at(info.max[0], info.max[2]);
  const spots = [];
  for (let i = 0; i < info.spots.length; i += 3) { const [sx, sz] = at(info.spots[i], info.spots[i + 2]); spots.push({ x: sx, y: info.spots[i + 1], z: sz }); }
  return { obj, footprint: { x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz), h: info.max[1] }, spots, at, walls };
}
