import { useMemo, useRef } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { cameraSync } from '../../lib/cameraSync';
import { useAppStore } from '../../store/useAppStore';

const FACE_LABELS = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK'];

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1b2027';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  ctx.fillStyle = '#c9ced4';
  ctx.font = '600 20px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Reads camera direction from `e.point` — falls back to iso if the hit is dead-centre. */
function directionFromHit(point: THREE.Vector3): THREE.Vector3 {
  const thr = 0.62;
  const dir = new THREE.Vector3(
    Math.abs(point.x) > thr ? Math.sign(point.x) : 0,
    Math.abs(point.y) > thr ? Math.sign(point.y) : 0,
    Math.abs(point.z) > thr ? Math.sign(point.z) : 0,
  );
  if (dir.lengthSq() === 0) dir.set(0.62, 0.5, 0.62);
  return dir;
}

function CubeRig() {
  const requestViewDir = useAppStore((s) => s.requestViewDir);
  const hoverRef = useRef(false);

  const materials = useMemo(
    () => FACE_LABELS.map((label) => new THREE.MeshBasicMaterial({ map: makeLabelTexture(label) })),
    [],
  );

  useFrame(({ camera }) => {
    camera.position.copy(cameraSync.dir).multiplyScalar(4.2);
    camera.up.copy(cameraSync.up);
    camera.lookAt(0, 0, 0);
  });

  const handleClick = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const dir = directionFromHit(e.point);
    requestViewDir([dir.x, dir.y, dir.z]);
  };

  return (
    <>
      <mesh
        material={materials}
        onPointerDown={handleClick}
        onPointerOver={() => {
          hoverRef.current = true;
        }}
        onPointerOut={() => {
          hoverRef.current = false;
        }}
      >
        <boxGeometry args={[2, 2, 2]} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(2, 2, 2)]} />
        <lineBasicMaterial color="#0b0e12" />
      </lineSegments>
    </>
  );
}

/** SolidWorks-style corner navigation cube: click a face for that view, an edge or corner
 *  for the corresponding two/three-axis isometric view. Mirrors the main viewport camera. */
export default function NavCube() {
  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 h-24 w-24 rounded-md border border-white/10 bg-[#0e1115]/70 backdrop-blur-md">
      <Canvas orthographic camera={{ zoom: 34, position: [2.5, 2, 2.5], near: 0.1, far: 20 }} dpr={[1, 2]}>
        <ambientLight intensity={1.4} />
        <CubeRig />
      </Canvas>
    </div>
  );
}
