// Loads the real first-person gun models (tools/build-realguns.mjs) at boot.
// A gun that fails to load keeps its sculpted version.
import { modelLoader } from './gltf.js';
import { setRealGun, setRealArms } from './gunmodels.js';
import { setEnemyGun } from './soldier.js';

/**
 * Several source models were authored for a studio renderer: pure-black base colours (nothing real is
 * below ~3 % albedo, so they render as silhouettes) and "metallic" on coatings that are really paint,
 * anodising or polymer. Measured-looking values instead, by material name.
 */
const FINISHES = [
  // [name test, albedo (linear), metalness, roughness]
  [/Rubber/i, 0.03, 0, 0.82],
  [/Paint_Textured|Hard_Rough_Plastic|base_color_14|scope[12]|uv6__1__1__1__[12]/i, 0.042, 0, 0.62],   // polymer, textured paint, optic housings
  [/Paint_Matte/i, 0.035, 0, 0.75],
  [/Anodized/i, 0.04, 0.25, 0.42],                                             // black hard-anodised aluminium
  [/^BASE_COLOR$/, 0.05, 0.35, 0.48],                                          // nitrided slide
  [/^metal$/, 0.38, 1, 0.34],                                                  // bare steel (barrel)
  [/Aluminum_Polished/i, 0.55, 1, 0.3],
];
function tuneMaterial(m) {
  if (m.map) return; // textured materials keep their authored values
  const f = FINISHES.find(([re]) => re.test(m.name));
  const c = m.color, lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (f) {
    const [, albedo, metal, rough] = f;
    if (lum < albedo) { if (lum > 0.004) c.multiplyScalar(albedo / lum); else c.setRGB(albedo, albedo, albedo); }
    m.metalness = metal; m.roughness = rough;
  } else if (lum < 0.03) {
    // anything else that is darker than real black: lift it, keeping its tint (the MK18's earth-brown parts)
    if (lum > 0.004) c.multiplyScalar(Math.min(4, 0.06 / lum)); else c.setRGB(0.035, 0.035, 0.035);
    if (m.metalness > 0.5) m.metalness = 0.35;
    m.roughness = Math.max(m.roughness, 0.35);
  }
}

/** Guns with a real model (the rest are still the sculpted ones). */
export const REAL_GUNS = ['m4', 'glock', 'm1014', 'sniper'];
const ENEMY_GUNS = ['m4', 'm1014', 'sniper'];

export async function loadRealGuns(renderer, hq = false) {
  const loader = await modelLoader();
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const arms = loader.loadAsync('assets/arms/arms.glb').then((gltf) => {
    gltf.scene.traverse((o) => { if (o.isMesh) for (const k of ['map', 'normalMap', 'roughnessMap']) if (o.material[k]) o.material[k].anisotropy = aniso; });
    setRealArms(gltf);
  }).catch((e) => console.warn('first-person arms unavailable, using the sculpted ones', e));
  await Promise.all(REAL_GUNS.map(async (key) => {
    try {
      const meta = await (await fetch(`assets/guns/${key}.json`)).json();
      let gltf = hq ? await loader.loadAsync(`assets/guns/${key}_hq.glb`).catch(() => null) : null;
      if (!gltf) gltf = await loader.loadAsync(`assets/guns/${key}.glb`);
      const tuned = new Set();
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (!tuned.has(o.material)) { tuned.add(o.material); tuneMaterial(o.material); }
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (o.material[k]) o.material[k].anisotropy = aniso;
      });
      setRealGun(key, gltf, meta);
      if (ENEMY_GUNS.includes(key)) {
        // the enemies' copy of the same gun
        const far = await loader.loadAsync(`assets/guns/${key}_far.glb`);
        const done = new Set();
        far.scene.traverse((o) => { if (o.isMesh && !done.has(o.material)) { done.add(o.material); tuneMaterial(o.material); } });
        setEnemyGun(key, far, meta);
      }
    } catch (e) {
      console.warn(`${key}: real model unavailable, using the sculpted one`, e);
    }
  }));
  await arms;
}
