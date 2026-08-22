import { useMemo, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { buildLattice } from '../../lib/tpms';
import { useAppStore } from '../../store/useAppStore';

/** Regions phase only: renders the hot and cold channel shells alongside the solid wall,
 *  each independently toggle-able, coloured and made translucent from the Regions panel. */
export default function RegionsOverlay() {
  const store = useAppStore();
  const params = store.activeParams;
  const voxels = store.activeVoxels;
  const vis = store.regionVisibility;
  const opacity = store.regionOpacity;
  const color = store.regionColor;

  const active = store.step === 1;

  const hot = useMemo(() => (active ? buildLattice(params, 'hot', voxels) : null), [active, params, voxels]);
  const cold = useMemo(() => (active ? buildLattice(params, 'cold', voxels) : null), [active, params, voxels]);

  const hotGeom = useMemo(() => {
    if (!hot) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(hot.positions, 3));
    g.setIndex(hot.indices);
    g.computeVertexNormals();
    return g;
  }, [hot]);

  const coldGeom = useMemo(() => {
    if (!cold) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(cold.positions, 3));
    g.setIndex(cold.indices);
    g.computeVertexNormals();
    return g;
  }, [cold]);

  const [hotHover, setHotHover] = useState(false);
  const [coldHover, setColdHover] = useState(false);

  if (!active) return null;
  const [lx, ly, lz] = params ? [params.cellX * params.nx, params.cellY * params.ny, params.cellZ * params.nz] : [0, 0, 0];

  const overHandlers = (setHover: (v: boolean) => void) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover(true);
    },
    onPointerOut: () => setHover(false),
  });

  return (
    <group>
      {hotGeom && vis.hot ? (
        <mesh geometry={hotGeom} {...overHandlers(setHotHover)}>
          <meshPhysicalMaterial
            color={color.hot}
            emissive={color.hot}
            emissiveIntensity={hotHover ? 0.4 : 0}
            transparent
            opacity={hotHover ? Math.min(1, opacity.hot + 0.3) : opacity.hot}
            roughness={0.4}
            metalness={0.05}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {coldGeom && vis.cold ? (
        <mesh geometry={coldGeom} {...overHandlers(setColdHover)}>
          <meshPhysicalMaterial
            color={color.cold}
            emissive={color.cold}
            emissiveIntensity={coldHover ? 0.4 : 0}
            transparent
            opacity={coldHover ? Math.min(1, opacity.cold + 0.3) : opacity.cold}
            roughness={0.4}
            metalness={0.05}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ) : null}

      {vis.hot ? (
        <Html position={[-lx / 2 - 1.5, 0, 0]} center distanceFactor={12}>
          <div className="whitespace-nowrap rounded border border-white/10 bg-[#14181d]/85 px-1.5 py-0.5 font-mono text-[9px] text-[#e2603f]">
            HOT
          </div>
        </Html>
      ) : null}
      {vis.cold ? (
        <Html position={[lx / 2 + 1.5, 0, 0]} center distanceFactor={12}>
          <div className="whitespace-nowrap rounded border border-white/10 bg-[#14181d]/85 px-1.5 py-0.5 font-mono text-[9px] text-[#4aa8d8]">
            COLD
          </div>
        </Html>
      ) : null}
      {vis.solid ? (
        <Html position={[0, ly / 2 + 1.5, 0]} center distanceFactor={12}>
          <div className="whitespace-nowrap rounded border border-white/10 bg-[#14181d]/85 px-1.5 py-0.5 font-mono text-[9px] text-[#c9ced4]">
            SOLID WALL
          </div>
        </Html>
      ) : null}
    </group>
  );
}
