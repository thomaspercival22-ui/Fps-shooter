// The loader for the real models (guns, arms, people, props, buildings).
// Textures inside a .glb reach three.js as blob: URLs, which GLTFLoader
// normally reads with fetch() + createImageBitmap. A page whose content
// security policy keeps fetch() to its own origin (the claude.ai artifact
// frame does) refuses those reads, and every model would lose its textures
// and draw plain grey; blob: images are still allowed there, so in that case
// the textures load through <img> elements instead.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshopt/meshopt_decoder.js';

let blobFetch = null;
function canFetchBlobs() {
  if (!blobFetch) {
    blobFetch = (async () => {
      const url = URL.createObjectURL(new Blob(['ok']));
      try { return (await (await fetch(url)).text()) === 'ok'; } catch (e) { return false; } finally { URL.revokeObjectURL(url); }
    })();
  }
  return blobFetch;
}

/** A GLTFLoader with the meshopt decoder that also loads embedded textures where blob: fetches are blocked. */
export async function modelLoader() {
  const [, fetchOk] = await Promise.all([MeshoptDecoder.ready, canFetchBlobs()]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  if (!fetchOk) {
    loader.register((parser) => {
      parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
      return { name: 'IMG_TEXTURES' };
    });
  }
  return loader;
}
