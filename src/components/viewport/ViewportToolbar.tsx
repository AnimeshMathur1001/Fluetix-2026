import { Maximize2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

const PRESETS: { dir: [number, number, number]; label: string; title: string }[] = [
  { dir: [0.62, 0.5, 0.62], label: 'fit', title: 'Fit view' },
  { dir: [0, 1, 0.001], label: 'XZ', title: 'Top' },
  { dir: [0, 0.001, 1], label: 'XY', title: 'Front' },
  { dir: [1, 0.001, 0], label: 'ZY', title: 'Side' },
  { dir: [0.62, 0.5, 0.62], label: 'ISO', title: 'Isometric' },
];

export default function ViewportToolbar() {
  const requestViewDir = useAppStore((s) => s.requestViewDir);

  return (
    <div className="absolute right-3 top-2.5 flex gap-1.5">
      {PRESETS.map((p) => (
        <button
          key={p.label}
          type="button"
          title={p.title}
          onClick={() => requestViewDir(p.dir)}
          className="flex items-center gap-1 rounded border border-white/10 bg-[#14181d]/75 px-2.5 py-1.5 font-mono text-xxs text-dim backdrop-blur-md transition-colors duration-120 hover:border-white/20 hover:text-ink"
        >
          {p.label === 'fit' ? <Maximize2 size={10} strokeWidth={1.8} /> : null}
          {p.label}
        </button>
      ))}
    </div>
  );
}
