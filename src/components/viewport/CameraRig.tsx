import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useAppStore } from '../../store/useAppStore';
import { cameraSync } from '../../lib/cameraSync';

interface CameraRigProps {
  box: [number, number, number];
}

type Controls = { target: THREE.Vector3; update: () => void };

/** Auto-frames the block, applies toolbar/nav-cube view directions, and publishes the
 *  camera orientation for the corner navigation cube to mirror. */
export default function CameraRig({ box }: CameraRigProps) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const viewCommand = useAppStore((s) => s.viewCommand);
  const flyTarget = useRef<THREE.Vector3 | null>(null);

  const diagonal = Math.hypot(box[0], box[1], box[2]);

  /** animate=false snaps immediately (first mount, box resize); animate=true — a toolbar/nav-cube
   *  click — glides the camera there over a few frames instead of an instant jump-cut. */
  const place = (rawDir: THREE.Vector3, animate: boolean) => {
    const d = diagonal * 1.65;
    const dir = rawDir.clone();
    if (Math.abs(dir.x) < 0.02 && Math.abs(dir.z) < 0.02) dir.z = 0.02;
    dir.normalize();
    const dest = dir.multiplyScalar(d);
    if (animate) {
      flyTarget.current = dest;
      return;
    }
    flyTarget.current = null;
    camera.position.copy(dest);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
    camera.lookAt(0, 0, 0);
  };

  useEffect(() => {
    place(new THREE.Vector3(0.62, 0.5, 0.62), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagonal]);

  useEffect(() => {
    if (viewCommand) place(new THREE.Vector3(...viewCommand.dir), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewCommand]);

  useFrame(() => {
    if (flyTarget.current) {
      camera.position.lerp(flyTarget.current, 0.2);
      if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
      }
      camera.lookAt(0, 0, 0);
      if (camera.position.distanceTo(flyTarget.current) < diagonal * 0.003) {
        camera.position.copy(flyTarget.current);
        flyTarget.current = null;
      }
    }
    cameraSync.dir.copy(camera.position).normalize();
    cameraSync.up.copy(camera.up);
  });

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.85}
      zoomSpeed={0.9}
      panSpeed={0.8}
      minDistance={diagonal * 0.25}
      maxDistance={diagonal * 8}
    />
  );
}
