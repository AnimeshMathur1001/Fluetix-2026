import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { ContactShadows } from '@react-three/drei';
import { useLatticeGeometry } from '../../hooks/useLatticeGeometry';
import { usePhysics } from '../../hooks/usePhysics';
import { tpmsField, type LatticeParams } from '../../lib/tpms';
import { wallTemperature } from '../../lib/contours';
import { inletFlowAxis } from '../../lib/flow';
import { useAppStore } from '../../store/useAppStore';

const AXIS_INDEX: Record<'x' | 'y' | 'z', 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

interface LatticeMeshProps {
  onBox: (box: [number, number, number]) => void;
}

function clipPlaneFor(
  axis: 'x' | 'y' | 'z' | 'custom',
  customNormal: [number, number, number],
  clip: number,
  box: [number, number, number],
): { plane: THREE.Plane; handlePos: THREE.Vector3; handleNormal: THREE.Vector3 } {
  let axisUnit: THREE.Vector3;
  let extent: number;
  if (axis === 'x') {
    axisUnit = new THREE.Vector3(1, 0, 0);
    extent = box[0];
  } else if (axis === 'y') {
    axisUnit = new THREE.Vector3(0, 1, 0);
    extent = box[1];
  } else if (axis === 'z') {
    axisUnit = new THREE.Vector3(0, 0, 1);
    extent = box[2];
  } else {
    axisUnit = new THREE.Vector3(...customNormal).normalize();
    extent = Math.hypot(box[0], box[1], box[2]);
  }
  const constant = -extent / 2 + clip * extent + 0.001;
  const plane = new THREE.Plane(axisUnit.clone().negate(), constant);
  const handlePos = axisUnit.clone().multiplyScalar(-extent / 2 + clip * extent);
  return { plane, handlePos, handleNormal: axisUnit };
}

/** Small draggable marker on the clip plane — drag vertically to slide the plane. */
function ClipHandle({ box }: { box: [number, number, number] }) {
  const clipAxis = useAppStore((s) => s.clipAxis);
  const clipNormal = useAppStore((s) => s.clipNormal);
  const clip = useAppStore((s) => s.clip);
  const set = useAppStore((s) => s.set);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ y: 0, clip: 0 });

  const { handlePos } = useMemo(
    () => clipPlaneFor(clipAxis, clipNormal, clip, box),
    [clipAxis, clipNormal, clip, box],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const dy = startRef.current.y - e.clientY;
      const next = Math.max(0, Math.min(1, startRef.current.clip + dy / 220));
      set({ clip: next });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, set]);

  return (
    <mesh
      position={handlePos}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        startRef.current = { y: e.nativeEvent.clientY, clip };
        setDragging(true);
      }}
    >
      <sphereGeometry args={[Math.max(0.15, Math.min(box[0], box[1], box[2]) * 0.045), 14, 14]} />
      <meshBasicMaterial color={dragging ? '#ffd479' : '#f5c65b'} />
    </mesh>
  );
}

export default function LatticeMesh({ onBox }: LatticeMeshProps) {
  const store = useAppStore();
  const { performance: perf } = usePhysics();
  const { geometry, box } = useLatticeGeometry();

  useEffect(() => {
    onBox(box);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box[0], box[1], box[2]]);

  const showContours = store.step === 4;
  const showRegionColor = store.step === 1;

  const { plane } = useMemo(
    () => clipPlaneFor(store.clipAxis, store.clipNormal, store.clip, box),
    [store.clipAxis, store.clipNormal, store.clip, box],
  );

  const boxEdges = useMemo(() => {
    const g = new THREE.BoxGeometry(box[0], box[1], box[2]);
    const edges = new THREE.EdgesGeometry(g);
    g.dispose();
    return edges;
  }, [box]);

  useEffect(() => () => boxEdges.dispose(), [boxEdges]);

  const params: LatticeParams = {
    surface: store.surface,
    cellX: store.cellX,
    cellY: store.cellY,
    cellZ: store.cellZ,
    thickness: store.thickness,
    grading: store.grading,
    gradAxis: store.gradAxis,
    nx: store.nx,
    ny: store.ny,
    nz: store.nz,
  };

  const handleProbe = (event: ThreeEvent<MouseEvent>) => {
    if (store.step !== 4) return;
    event.stopPropagation();
    // The probe only ever evaluates the analytic model (see wallTemperature
    // below) — in solved-field mode that would silently show fabricated
    // numbers next to a genuinely-solved contour, so it's disabled there
    // rather than mislead. Sampling the solved field at a single clicked
    // point is real follow-up work, not done here.
    if (store.contourSource === 'solved') {
      store.flash('Probe shows the analytical preview only – switch to "Analytical preview" to use it');
      return;
    }
    const p = event.point;
    const TAU = Math.PI * 2;
    const [lx, ly, lz] = box;
    const norm = [(p.x + lx / 2) / lx, (p.y + ly / 2) / ly, (p.z + lz / 2) / lz];

    const hotAxis = inletFlowAxis(store.faces, 'inletHot');
    const coldAxis = inletFlowAxis(store.faces, 'inletCold');
    const hotAxial = hotAxis.sign > 0 ? norm[AXIS_INDEX[hotAxis.axis]] : 1 - norm[AXIS_INDEX[hotAxis.axis]];
    const coldAxial = coldAxis.sign > 0 ? norm[AXIS_INDEX[coldAxis.axis]] : 1 - norm[AXIS_INDEX[coldAxis.axis]];

    const region = store.viewRegion;
    const viewAxial = region === 'cold' ? coldAxial : hotAxial;
    const sidePerf = region === 'cold' ? perf.cold : perf.hot;

    const f = tpmsField(store.surface, TAU * store.nx * norm[0], TAU * store.ny * norm[1], TAU * store.nz * norm[2]);
    store.set({
      probe: {
        x: p.x,
        y: p.y,
        z: p.z,
        T: wallTemperature(params, perf, store.flow, store.hot.Tin, store.cold.Tin, f, hotAxial, coldAxial),
        p: sidePerf.pressureDrop * (1 - viewAxial),
        u: sidePerf.velocity * 0.62,
      },
    });
  };

  const visible = !showRegionColor || store.regionVisibility.solid;
  const [solidHover, setSolidHover] = useState(false);

  return (
    <group>
      <mesh
        geometry={geometry}
        onClick={handleProbe}
        onPointerOver={
          showRegionColor
            ? (e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setSolidHover(true);
              }
            : undefined
        }
        onPointerOut={showRegionColor ? () => setSolidHover(false) : undefined}
        visible={visible}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          // key forces a fresh material (and shader recompile) when vertexColors toggles —
          // Three.js doesn't recompile an existing material's shader for that flag on its own,
          // it needs material.needsUpdate or (simpler here) a clean remount.
          key={showContours ? 'contours' : 'plain'}
          color={showContours ? '#ffffff' : showRegionColor ? store.regionColor.solid : '#c9ced4'}
          emissive={showRegionColor ? store.regionColor.solid : '#000000'}
          emissiveIntensity={showRegionColor && solidHover ? 0.3 : 0}
          vertexColors={showContours}
          transparent={showRegionColor}
          opacity={showRegionColor ? (solidHover ? Math.min(1, store.regionOpacity.solid + 0.25) : store.regionOpacity.solid) : 1}
          metalness={0.25}
          roughness={0.5}
          clearcoat={0.15}
          clearcoatRoughness={0.5}
          side={THREE.DoubleSide}
          clippingPlanes={[plane]}
          clipShadows
        />
      </mesh>

      <lineSegments geometry={boxEdges}>
        <lineBasicMaterial color="#3a4450" />
      </lineSegments>

      {showContours ? <ClipHandle box={box} /> : null}
      <ContactShadows position={[0, -box[1] / 2 - 0.02, 0]} opacity={0.45} scale={Math.max(box[0], box[2]) * 2.4} blur={2.4} far={box[1] * 1.5} />
    </group>
  );
}
