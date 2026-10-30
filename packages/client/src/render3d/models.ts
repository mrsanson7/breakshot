import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODELS } from '../config';

/** `?models=off` shows the code-built graphics only, for comparison. */
const modelsEnabled = (): boolean => MODELS.enabled && new URLSearchParams(location.search).get('models') !== 'off';

/**
 * Load a Blender-made .glb from public/models, or null when models are off or the file can't be
 * loaded (the code-built graphics then stay as they are). Only the cue casts shadows.
 */
export async function loadModel(file: string, shadows: { cast: boolean; receive: boolean }): Promise<THREE.Group | null> {
  if (!modelsEnabled()) return null;
  try {
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}${MODELS.dir}${file}`);
    gltf.scene.traverse((o) => {
      o.castShadow = shadows.cast;
      o.receiveShadow = shadows.receive;
    });
    // glTF is Y-up, the game world is Z-up. This is the only place that converts between them.
    const root = new THREE.Group();
    root.rotation.x = Math.PI / 2;
    root.add(gltf.scene);
    return root;
  } catch (e) {
    console.warn(`Model ${file} not loaded, keeping the built-in graphics`, e);
    return null;
  }
}
