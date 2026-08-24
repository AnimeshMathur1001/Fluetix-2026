import { Check, Maximize2 } from 'lucide-react';
import { WORKFLOW_STEPS } from '../lib/presets';
import { cn } from '../lib/utils';
import { useAppStore } from '../store/useAppStore';

/** Linear workflow stepper: Geometry → Regions → Case → Mesh & Solve → Results → Scale-up. */
export default function WorkflowStepper() {
  const step = useAppStore((s) => s.step);
  const setStep = useAppStore((s) => s.setStep);
  const panelOpen = useAppStore((s) => s.panelOpen);
  const set = useAppStore((s) => s.set);
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode);

  const watertight = useAppStore((s) => s.watertight);
  const meshed = useAppStore((s) => s.meshed);
  const converged = useAppStore((s) => s.converged);
  const stats = useAppStore((s) => s.stats);
  const explorerCandidates = useAppStore((s) => s.explorer.candidates.length);

  const complete = [
    stats.triangles > 0,
    Boolean(watertight?.ok),
    true,
    meshed && converged === true,
    converged === true,
    converged === true,
    explorerCandidates > 0,
  ];

  return (
    <nav className="flex items-stretch gap-0.5 border-b border-line bg-nav px-2.5">
      {WORKFLOW_STEPS.map((label, i) => {
        const active = step === i;
        const done = complete[i] && !active;
        return (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 text-base2 transition-colors duration-120',
              active
                ? 'border-accent bg-accent/[0.07] text-ink'
                : 'border-transparent text-mute2 hover:bg-white/[0.02] hover:text-dim',
            )}
          >
            <span
              className={cn(
                'grid h-[15px] w-[15px] place-items-center rounded-[3px] border font-mono text-2xs leading-none',
                active
                  ? 'border-accent bg-accent text-[#07100f]'
                  : done
                    ? 'border-ok/40 bg-ok/15 text-ok'
                    : 'border-white/15 text-mute2',
              )}
            >
              {done ? <Check size={9} strokeWidth={3} /> : i + 1}
            </span>
            {label}
          </button>
        );
      })}

      <div className="flex-1" />

      <button
        type="button"
        title="Maximize the viewport (Esc to exit)"
        onClick={toggleFocusMode}
        className="flex items-center gap-1.5 px-3 text-tiny text-mute2 transition-colors duration-120 hover:text-dim"
      >
        <Maximize2 size={10} strokeWidth={1.8} />
        focus
      </button>

      <button
        type="button"
        onClick={() => set({ panelOpen: !panelOpen })}
        className="px-3 text-tiny text-mute2 transition-colors duration-120 hover:text-dim"
      >
        {panelOpen ? 'collapse panel ›' : '‹ show panel'}
      </button>
    </nav>
  );
}
