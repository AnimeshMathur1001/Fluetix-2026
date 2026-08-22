import * as THREE from 'three';

/**
 * Shares the main viewport camera's orientation with the corner navigation cube, which
 * lives in its own small `<Canvas>`. Updated every frame by CameraRig, read every frame by
 * NavCube — a plain mutable object so neither side re-renders on every tick.
 */
export const cameraSync = {
  dir: new THREE.Vector3(0.62, 0.5, 0.62).normalize(),
  up: new THREE.Vector3(0, 1, 0),
};
