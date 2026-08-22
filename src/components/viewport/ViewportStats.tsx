import { useAppStore } from '../../store/useAppStore';
import { formatInt } from '../../lib/utils';

export default function ViewportStats() {
  const stats = useAppStore((s) => s.stats);
  const step = useAppStore((s) => s.step);
  const surface = useAppStore((s) => s.surface);
  const cellX = useAppStore((s) => s.cellX);
  const cellY = useAppStore((s) => s.cellY);
  const cellZ = useAppStore((s) => s.cellZ);
  const quality = useAppStore((s) => s.quality);
  const viewRegion = useAppStore((s) => s.viewRegion);
  const viewField = useAppStore((s) => s.viewField);

  const title =
    step === 4
      ? viewRegion + ' region · ' + viewField
      : surface + ' · ' + cellX + '×' + cellY + '×' + cellZ + ' mm';

  return (
    <div className="pointer-events-none absolute left-3.5 top-3 flex flex-col gap-1.5">
      <div className="font-mono text-xxs uppercase tracking-[0.05em] text-mute2">{title}</div>
      <div className="flex max-w-[min(520px,calc(100vw-620px))] flex-wrap gap-x-3.5 gap-y-1 font-mono text-xxs text-dim2">
        <span>
          tris <span className="text-ink2">{formatInt(stats.triangles)}</span>
        </span>
        <span>
          verts <span className="text-ink2">{formatInt(stats.vertices)}</span>
        </span>
        <span>
          φ<sub>solid</sub> <span className="text-ink2">{(stats.solidFraction * 100).toFixed(1)}%</span>
        </span>
        <span>
          a<sub>sp</sub> <span className="text-ink2">{stats.specificArea.toFixed(0)}</span> m²/m³
        </span>
        <span>
          {stats.ms} ms · {quality === 'full' ? 'full' : 'preview'}
        </span>
      </div>
    </div>
  );
}
