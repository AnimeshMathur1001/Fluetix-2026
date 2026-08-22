import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { inletFlowDirection } from '../../lib/flow';
import { useAppStore } from '../../store/useAppStore';
import { usePhysics } from '../../hooks/usePhysics';

const N_LINES = 18;
const ARROWS_PER_LINE = 3;

function perpBasis(dir: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3().crossVectors(dir, up).normalize();
  const b = new THREE.Vector3().crossVectors(dir, a).normalize();
  return [a, b];
}

function buildCurves(dir: THREE.Vector3, box: [number, number, number], seed: number): THREE.CatmullRomCurve3[] {
  const [a, b] = perpBasis(dir);
  const length = Math.hypot(box[0], box[1], box[2]) * 0.55;
  const lateral = Math.min(box[0], box[1], box[2]) * 0.32;
  const curves: THREE.CatmullRomCurve3[] = [];
  const grid = Math.ceil(Math.sqrt(N_LINES));
  for (let i = 0; i < N_LINES; i++) {
    const gx = (i % grid) / Math.max(1, grid - 1) - 0.5;
    const gy = Math.floor(i / grid) / Math.max(1, grid - 1) - 0.5;
    const offA = gx * lateral * 1.6;
    const offB = gy * lateral * 1.6;
    const phase = seed + i * 1.7;
    const pts: THREE.Vector3[] = [];
    const steps = 10;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps - 0.5;
      const wiggle = Math.sin(t * Math.PI * 3 + phase) * lateral * 0.22;
      const wiggle2 = Math.cos(t * Math.PI * 3 + phase) * lateral * 0.22;
      pts.push(
        new THREE.Vector3()
          .addScaledVector(dir, t * length)
          .addScaledVector(a, offA + wiggle)
          .addScaledVector(b, offB + wiggle2),
      );
    }
    curves.push(new THREE.CatmullRomCurve3(pts));
  }
  return curves;
}

function StreamSet({ dir, box, color, speed, seed }: { dir: THREE.Vector3; box: [number, number, number]; color: string; speed: number; seed: number }) {
  const curves = useMemo(() => buildCurves(dir, box, seed), [dir, box, seed]);
  const arrowRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(({ clock }) => {
    let idx = 0;
    for (const curve of curves) {
      for (let k = 0; k < ARROWS_PER_LINE; k++) {
        const mesh = arrowRefs.current[idx];
        if (mesh) {
          const t = (clock.elapsedTime * speed + k / ARROWS_PER_LINE) % 1;
          const p = curve.getPointAt(t);
          const ahead = curve.getPointAt(Math.min(0.999, t + 0.02));
          mesh.position.copy(p);
          mesh.lookAt(ahead);
          mesh.rotateX(Math.PI / 2);
        }
        idx++;
      }
    }
  });

  return (
    <group>
      {curves.map((curve, i) => (
        <Line key={i} points={curve.getPoints(32)} color={color} lineWidth={1} transparent opacity={0.4} />
      ))}
      {curves.flatMap((_, i) =>
        Array.from({ length: ARROWS_PER_LINE }).map((_unused, k) => (
          <mesh key={i + '-' + k} ref={(m) => (arrowRefs.current[i * ARROWS_PER_LINE + k] = m)}>
            <coneGeometry args={[Math.max(box[0], box[1], box[2]) * 0.018, Math.max(box[0], box[1], box[2]) * 0.07, 8]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Results step only: animated hot (red) / cold (blue) streamlines through the lattice,
 *  with directional arrows moving at a speed scaled to the correlation-model velocity.
 *  Illustrative flow paths through the tortuous channel, not a solved velocity field. */
export default function Streamlines({ box }: { box: [number, number, number] }) {
  const store = useAppStore();
  const { performance: perf } = usePhysics();
  const active = store.step === 4 && store.viewField === 'velocity';

  const hotDir = useMemo(() => new THREE.Vector3(...inletFlowDirection(store.faces, 'inletHot')), [store.faces]);
  const coldDir = useMemo(() => new THREE.Vector3(...inletFlowDirection(store.faces, 'inletCold')), [store.faces]);

  if (!active) return null;

  const hotSpeed = 0.05 + Math.min(0.35, perf.hot.velocity * 0.25);
  const coldSpeed = 0.05 + Math.min(0.35, perf.cold.velocity * 0.25);

  return (
    <group>
      {store.regionVisibility.hot ? (
        <StreamSet dir={hotDir} box={box} color={store.regionColor.hot} speed={hotSpeed} seed={0} />
      ) : null}
      {store.regionVisibility.cold ? (
        <StreamSet dir={coldDir} box={box} color={store.regionColor.cold} speed={coldSpeed} seed={2.4} />
      ) : null}
    </group>
  );
}
