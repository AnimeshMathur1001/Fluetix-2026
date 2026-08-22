import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';

const CAPABILITIES = [
  'Geometry · implicit-surface lattice generation, in-browser',
  'Meshing · multi-region volume meshing, server-side',
  'Solver · steady conjugate heat transfer, server-side',
  'Post-processing · solved-field sampling and contouring',
  'Manufacturability · wall-thickness, escape-hole and overhang checks',
  'Design intelligence · solve-history estimates, tolerance bands, Pareto exploration',
];

export default function AboutDialog() {
  const open = useAppStore((s) => s.aboutOpen);
  const set = useAppStore((s) => s.set);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') set({ aboutOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, set]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => set({ aboutOpen: false })}
          className="absolute inset-0 z-40 grid place-items-center bg-base/70 backdrop-blur-[2px]"
        >
          <motion.div
            initial={{ scale: 0.97, y: 6 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => e.stopPropagation()}
            className="max-w-[520px] rounded-lg border border-white/10 bg-card px-6 py-5 shadow-modal"
          >
            <div className="text-[15px] font-semibold">Fluetix</div>
            <div className="mb-3.5 font-mono text-tiny text-mute2">
              build 0.7.0 · prototype UI · local execution
            </div>
            <p className="mb-3 text-med leading-relaxed text-dim">
              TPMS lattice design, two-fluid conjugate heat transfer setup, and scale-up for periodic
              unit cells. Geometry is generated in-browser; meshing and the CHT solve run on a
              connected server.
            </p>
            <div className="font-mono text-tiny leading-loose text-mute">
              {CAPABILITIES.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
            <div className="mt-3.5 border-t border-line2 pt-3 text-tiny text-mute2">
              Out of scope this build: .sldprt export, GPU solve, transient, two-phase, FEA. The
              periodicity/block-independence check on the Scale-up step is still an estimate, not a
              real cyclic-boundary solve. Fluid properties fall back to engineering correlations when
              the connected property database isn't reachable.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
