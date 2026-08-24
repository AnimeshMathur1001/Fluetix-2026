import { useAppStore } from '../../store/useAppStore';

const SERIES = [
  { key: 'ux', name: 'Ux', colour: '#e2603f' },
  { key: 'p', name: 'p', colour: '#5ec8c0' },
  { key: 'hHot', name: 'h.hot', colour: '#4aa8d8' },
  { key: 'hCold', name: 'h.cold', colour: '#7fb98b' },
  { key: 'hSolid', name: 'h.solid', colour: '#c9a24a' },
] as const;

const W = 300;
const H = 109;

function toPoints(values: number[]): string {
  if (values.length === 0) return '';
  const n = Math.max(values.length, 2);
  return values
    .map((v, i) => {
      const x = (i / (n - 1)) * W;
      const y = H - ((Math.log10(Math.max(v, 1e-8)) + 8) / 8) * H;
      return x.toFixed(1) + ',' + Math.max(0, Math.min(H, y)).toFixed(1);
    })
    .join(' ');
}

/** Live residual monitor, log10 scale, with the residual target drawn as a dashed line. */
export default function ResidualChart() {
  const residuals = useAppStore((s) => s.residuals);
  const solving = useAppStore((s) => s.solving);
  const iteration = useAppStore((s) => s.iteration);
  const converged = useAppStore((s) => s.converged);
  const target = Number.parseFloat(useAppStore((s) => s.residualTarget));

  const targetY = H - ((Math.log10(target) + 8) / 8) * H;

  const status = solving
    ? 'iter ' + iteration
    : converged === true
      ? 'converged · ' + iteration + ' it'
      : converged === false
        ? 'NOT CONVERGED'
        : 'idle';

  const statusColour = solving
    ? 'text-accent'
    : converged === true
      ? 'text-ok'
      : converged === false
        ? 'text-bad'
        : 'text-mute2';

  return (
    <div className="rounded-md border border-line bg-viewport p-2.5">
      <div className="mb-1.5 flex justify-between font-mono text-xxs text-mute2">
        <span>residuals · log₁₀</span>
        <span className={statusColour}>{status}</span>
      </div>

      <svg viewBox={'0 0 ' + W + ' ' + H} className="block h-[110px] w-full">
        {[0, 27.5, 55, 82.5].map((y) => (
          <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="rgba(255,255,255,.06)" />
        ))}
        <line x1="0" y1={H - 1} x2={W} y2={H - 1} stroke="rgba(255,255,255,.12)" />
        <line x1="0" y1={targetY} x2={W} y2={targetY} stroke="rgba(94,200,192,.45)" strokeDasharray="3 3" />
        {SERIES.map((s) => (
          <polyline
            key={s.key}
            points={toPoints(residuals[s.key])}
            fill="none"
            stroke={s.colour}
            strokeWidth={1.2}
          />
        ))}
      </svg>

      <div className="mt-1.5 flex flex-wrap gap-2.5">
        {SERIES.map((s) => {
          const arr = residuals[s.key];
          const last = arr.length ? arr[arr.length - 1].toExponential(1) : '–';
          return (
            <span key={s.key} className="flex items-center gap-1 font-mono text-2xs text-dim2">
              <span className="inline-block h-[2px] w-[7px]" style={{ background: s.colour }} />
              {s.name} {last}
            </span>
          );
        })}
      </div>
    </div>
  );
}
