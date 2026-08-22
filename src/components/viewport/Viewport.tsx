import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import CameraRig from './CameraRig';
import LatticeMesh from './LatticeMesh';
import RegionsOverlay from './RegionsOverlay';
import Streamlines from './Streamlines';
import NavCube from './NavCube';
import ViewportToolbar from './ViewportToolbar';
import ViewportStats from './ViewportStats';
import ContourLegend from './ContourLegend';
import ProbeCard from './ProbeCard';
import BusyOverlay from './BusyOverlay';

/** Persistent 3D workspace: the centrepiece of every phase. */
export default function Viewport() {
  const [box, setBox] = useState<[number, number, number]>([8, 8, 8]);

  return (
    <div className="relative min-w-0 overflow-hidden bg-viewport">
      <Canvas
        shadows
        dpr={[1, 3]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 38, near: 0.1, far: 5000, position: [14, 11, 14] }}
        onCreated={({ gl, scene }) => {
          gl.localClippingEnabled = true;
          scene.background = null;
        }}
        className="cursor-crosshair"
      >
        <hemisphereLight args={['#dfe8f2', '#1a1f26', 0.85]} />
        <directionalLight
          position={[60, 90, 70]}
          intensity={0.9}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-near={1}
          shadow-camera-far={400}
        />
        <directionalLight position={[-70, -40, -60]} intensity={0.35} color="#9fb6d0" />
        <Suspense fallback={null}>
          <LatticeMesh onBox={setBox} />
          <RegionsOverlay />
          <Streamlines box={box} />
        </Suspense>
        <CameraRig box={box} />
      </Canvas>

      <ViewportStats />
      <ViewportToolbar />
      <NavCube />
      <ContourLegend />
      <ProbeCard />
      <BusyOverlay />
    </div>
  );
}
