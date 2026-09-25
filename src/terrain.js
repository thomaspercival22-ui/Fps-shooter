// Surface shaders for the map: the parallax-mapped desert ground (two scanned
// materials blended by a height-aware mask), dust and grime on walls, and the
// welded wire mesh over the HESCO barrier liners.
import * as THREE from 'three';
import { pbrMaterial } from './assets.js';
import * as TX from './textures.js';

export const GROUND_TILE = 2.48;       // real-world size of the gravelly sand scan (m)
const DRY_SCALE = GROUND_TILE / 4.0;   // the dry ground scan covers 4 m

/** Chains an onBeforeCompile hook onto a material (keeps earlier hooks). */
export function extendShader(mat, key, fn) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => { prev.call(mat, shader, renderer); fn(shader); };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + '|' + key;
}

// world position varying (works for instanced and plain meshes)
const WORLD_VARYING = `#include <worldpos_vertex>
  #ifdef USE_INSTANCING
    vSurfWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vSurfWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`;

/**
 * Desert ground: gravelly sand with patches of dry, rocky ground. Close to the
 * camera, parallax occlusion mapping ray-marches the scanned height maps so
 * stones and ruts have real depth. The patch mask blends by height (stones of
 * one material poke through the other) and a large-scale noise breaks up tiling.
 */
export function groundMaterial(assets) {
  const mat = pbrMaterial(assets, 'gravelly_sand', { color: 0xf2e2c8, normalScale: 1.25 });
  mat.aoMap = null; // the scanned AO is applied in the shader below (blended with the dry ground)
  mat.userData.noWet = true; // rain is handled in the shader (puddles)
  const dry = assets.textures.dry_ground_rocks;
  const macro = TX.macroNoiseTexture();
  const uniforms = {
    heightMap: { value: assets.groundHeight }, macroMap: { value: macro },
    dryMap: { value: dry.diff }, dryNor: { value: dry.nor }, dryArm: { value: dry.arm },
    pomDepth: { value: 0.028 }, dryTint: { value: new THREE.Color(0xe6cfb0) },
    wet: { value: 0 }, rainTime: { value: 0 },
  };
  mat.userData.groundUniforms = uniforms;
  extendShader(mat, 'ground', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vSurfWorld;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', WORLD_VARYING);
    shader.fragmentShader = `
      uniform sampler2D heightMap, macroMap, dryMap, dryNor, dryArm;
      uniform float pomDepth, wet, rainTime; uniform vec3 dryTint;
      varying vec3 vSurfWorld;
      #define DRY_SCALE ${DRY_SCALE.toFixed(4)}
      // texture gradients of the unshifted UVs: every fetch uses them, so the
      // parallax loop (non-uniform control flow) never picks the wrong mip level
      vec2 gdx, gdy;
      vec4 tg(sampler2D t, vec2 uv, float k) { return textureGrad(t, uv, gdx * k, gdy * k); }
      float patchMask(vec2 uv) {
        float a = texture2D(macroMap, uv * 0.013 + vec2(0.21, 0.63)).r;
        float b = texture2D(macroMap, uv * 0.05).g;
        return a * 0.8 + b * 0.35 - 0.12;
      }
      float blendK(float m, float hs, float hd) { return clamp((m - 0.5) * 5.0 + (hd - hs) * 2.2 + 0.5, 0.0, 1.0); }
      float groundH(vec2 uv, float m) {
        float hs = tg(heightMap, uv, 1.0).r, hd = tg(heightMap, uv * DRY_SCALE, DRY_SCALE).g;
        return mix(hs, hd, blendK(m, hs, hd));
      }
      ` + shader.fragmentShader
      .replace('#include <map_fragment>', `
        gdx = dFdx(vMapUv); gdy = dFdy(vMapUv);
        vec2 pomUv = vMapUv;
        float gm = patchMask(vMapUv);
        {
          vec3 toCam = cameraPosition - vSurfWorld;
          float dist = length(toCam);
          float fade = 1.0 - smoothstep(9.0, 26.0, dist);
          if (fade > 0.01) {
            // tangent frame of the ground: u = +x, v = -z, n = +y
            vec3 V = toCam / dist;
            vec3 Vt = vec3(V.x, -V.z, max(V.y, 0.08));
            const int STEPS = 28;
            float layer = 1.0 / float(STEPS);
            vec2 dUv = Vt.xy / Vt.z * pomDepth * fade * layer;
            vec2 uv = vMapUv;
            float depth = 0.0;
            float surf = 1.0 - groundH(uv, gm);
            for (int i = 0; i < STEPS; i++) {
              if (depth >= surf) break;
              uv -= dUv; depth += layer;
              surf = 1.0 - groundH(uv, gm);
            }
            vec2 prev = uv + dUv;
            float after = surf - depth;
            float before = (1.0 - groundH(prev, gm)) - (depth - layer);
            float w = after / (after - before + 1e-5);
            pomUv = mix(uv, prev, clamp(w, 0.0, 1.0));
          }
        }
        float hsS = tg(heightMap, pomUv, 1.0).r, hdS = tg(heightMap, pomUv * DRY_SCALE, DRY_SCALE).g;
        float gk = blendK(gm, hsS, hdS);
        vec2 mac = tg(macroMap, pomUv * 0.021, 0.021).rg;
        vec4 sandC = tg(map, pomUv, 1.0);
        vec4 sand2 = tg(map, pomUv * 0.29 + vec2(0.37, 0.11), 0.29);
        sandC.rgb = mix(sandC.rgb, sand2.rgb, smoothstep(0.35, 0.7, mac.g) * 0.45);
        vec3 dryC = tg(dryMap, pomUv * DRY_SCALE, DRY_SCALE).rgb * dryTint;
        vec3 alb = mix(sandC.rgb, dryC, gk);
        alb *= mix(0.84, 1.1, mac.r);
        // rain: soaked ground darkens, water pools in the low spots
        float puddle = 0.0;
        if (wet > 0.0) {
          float low = 1.0 - mix(hsS, hdS, gk);
          float pm = tg(macroMap, pomUv * 0.037 + 0.5, 0.037).r;
          puddle = smoothstep(0.56, 0.64, low * 0.5 + pm * 0.7) * wet;
          alb *= mix(1.0, 0.6, wet);
          alb = mix(alb, alb * 0.6, puddle);
        }
        diffuseColor.rgb *= alb;`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 nS = tg(normalMap, pomUv, 1.0).xyz * 2.0 - 1.0;
          vec3 nD = tg(dryNor, pomUv * DRY_SCALE, DRY_SCALE).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(mix(nS, nD, gk));
          mapN.xy *= normalScale;
          if (puddle > 0.0) {
            // standing water is flat, disturbed by expanding raindrop ripples
            mapN = normalize(mix(mapN, vec3(0.0, 0.0, 1.0), puddle * 0.94));
            vec2 rq = vSurfWorld.xz * 1.7, rc = floor(rq), rf = fract(rq);
            float hs = fract(sin(dot(rc, vec2(12.9898, 78.233))) * 43758.5453);
            vec2 ctr = vec2(fract(hs * 7.13), fract(hs * 3.71)) * 0.6 + 0.2;
            float t = fract(rainTime * 1.1 + hs);
            vec2 dv = rf - ctr; float dd = length(dv);
            float ring = exp(-pow((dd - t * 0.42) * 38.0, 2.0)) * (1.0 - t);
            mapN.xy += dv / (dd + 1e-4) * ring * 0.55 * puddle;
          }
          normal = normalize(tbn * mapN);
        }`)
      .replace('#include <roughnessmap_fragment>', `
        vec3 armS = tg(roughnessMap, pomUv, 1.0).rgb, armD = tg(dryArm, pomUv * DRY_SCALE, DRY_SCALE).rgb;
        vec3 arm = mix(armS, armD, gk);
        float roughnessFactor = roughness * arm.g;
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, wet);
        roughnessFactor = mix(roughnessFactor, 0.03, puddle);`)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * arm.b;')
      .replace('#include <aomap_fragment>', `
        {
          float ambientOcclusion = arm.r;
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_CLEARCOAT )
            clearcoatSpecularIndirect *= ambientOcclusion;
          #endif
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
          #endif
        }
        #include <aomap_fragment>`);
  });
  return mat;
}

/**
 * Dust and grime on buildings: sand-coloured dirt splashed up the base of
 * every wall, broken up by noise, and a faint darker band of ground damp.
 */
export function addWallGrime(mat, key) {
  const macro = TX.macroNoiseTexture();
  extendShader(mat, 'grime-' + key, (shader) => {
    shader.uniforms.grimeNoise = { value: macro };
    shader.vertexShader = 'varying vec3 vSurfWorld;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', WORLD_VARYING);
    shader.fragmentShader = 'uniform sampler2D grimeNoise; varying vec3 vSurfWorld;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec2 q = vSurfWorld.xz + vSurfWorld.y * 0.3;
        float n = texture2D(grimeNoise, vec2(q.x + q.y, vSurfWorld.y * 0.6) * 0.09).r;
        float n2 = texture2D(grimeNoise, vec2(q.x - q.y, vSurfWorld.y) * 0.35).g;
        float h = vSurfWorld.y;
        float splash = 1.0 - smoothstep(0.05, 0.55 + n * 0.9, h);
        float streak = (1.0 - smoothstep(0.0, 2.6, h)) * smoothstep(0.55, 0.8, n2) * 0.35;
        vec3 dust = vec3(0.74, 0.6, 0.44);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * dust * 1.25, clamp(splash * 0.75 + streak, 0.0, 1.0));
        diffuseColor.rgb *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.12, h));
      }`);
  });
}

/**
 * HESCO liner: hessian geotextile with the welded wire mesh (7.6 cm squares,
 * 4 mm wire) and the spring-coil joints between cells drawn procedurally so
 * they stay sharp and anti-aliased at any distance.
 */
export function addWireMesh(mat) {
  extendShader(mat, 'hesco-mesh', (shader) => {
    shader.vertexShader = 'varying vec3 vSurfWorld; varying vec3 vSurfN;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', WORLD_VARYING + `
      vSurfN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = 'varying vec3 vSurfWorld; varying vec3 vSurfN;\n' + shader.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 an = abs(vSurfN);
        vec2 fp = an.x > an.z ? vSurfWorld.zy : vSurfWorld.xy;
        if (an.y > 0.7) fp = vec2(1000.0);
        vec2 g = fp / 0.076;
        vec2 fw = max(fwidth(g), vec2(1e-4));
        vec2 dg = abs(fract(g - 0.5) - 0.5) / fw;
        float wire = 1.0 - clamp(min(dg.x, dg.y) - 0.026 / 0.076 / max(fw.x, fw.y) * 0.5, 0.0, 1.0);
        float cellX = fp.x / 1.06;
        float cfw = max(fwidth(cellX), 1e-4);
        float coil = 1.0 - clamp(abs(fract(cellX - 0.5) - 0.5) / cfw - 0.018 / 1.06 / cfw, 0.0, 1.0);
        float meshK = clamp(max(wire * 0.85, coil), 0.0, 1.0) * (an.y > 0.7 ? 0.0 : 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.34, 0.32), meshK);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.85, meshK);
        roughnessFactor = mix(roughnessFactor, 0.45, meshK);`);
  });
}
