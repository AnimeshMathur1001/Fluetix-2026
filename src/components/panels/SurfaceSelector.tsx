import CardButton from '../ui/CardButton';
import { SURFACES } from '../../lib/presets';
import { useAppStore } from '../../store/useAppStore';

export default function SurfaceSelector() {
  const surface = useAppStore((s) => s.surface);
  const setLattice = useAppStore((s) => s.setLattice);

  return (
    <div className="mb-4 grid grid-cols-2 gap-1.5">
      {SURFACES.map((s) => (
        <CardButton
          key={s.key}
          title={s.label}
          subtitle={s.equation}
          active={surface === s.key}
          onClick={() => setLattice({ surface: s.key })}
        />
      ))}
    </div>
  );
}
