import { useAppStore } from '../store/useAppStore';
import { formatInt } from '../lib/utils';

export default function StatusBar() {
  const busy = useAppStore((s) => s.busy);
  const solving = useAppStore((s) => s.solving);
  const iteration = useAppStore((s) => s.iteration);
  const mode = useAppStore((s) => s.mode);
  const stats = useAppStore((s) => s.stats);
  const watertight = useAppStore((s) => s.watertight);
  const mesh = useAppStore((s) => s.mesh);
  const backend = useAppStore((s) => s.backend);

  const status = busy
    ? busy.label
    : solving
      ? 'solving · iteration ' + iteration
      : 'ready';

  return (
    <footer className="flex items-center gap-3.5 border-t border-line bg-nav px-3.5 font-mono text-xxs text-mute2">
      <span className={busy || solving ? 'text-accent' : 'text-mute2'}>{status}</span>
      <div className="flex-1" />
      <span title={backend.detail ? JSON.stringify(backend.detail) : 'no response from the server'}>
        {backend.available ? 'connected' : backend.checking ? 'checking…' : 'offline (in-browser mode)'}
      </span>
      <span>{mode === 'unitcell' ? 'unit-cell · cyclic' : 'full assembly'}</span>
      <span>
        {formatInt(stats.triangles)} tris · {watertight?.ok ? 'watertight' : 'unvalidated'}
      </span>
      <span>{mesh ? formatInt(mesh.cells) + 'k cells' : 'no mesh'}</span>
    </footer>
  );
}
