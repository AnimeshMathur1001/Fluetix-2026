import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

/** Small corner progress HUD for marching cubes, voxelisation, booleans, meshing and solving — never obscures the model. */
export default function BusyOverlay() {
  const busy = useAppStore((s) => s.busy);

  return (
    <AnimatePresence>
      {busy && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-none absolute right-3 top-12 z-30 w-[210px] rounded-md border border-white/10 bg-[#14181d]/90 px-3 py-2.5 shadow-float backdrop-blur-md"
        >
          <div className="mb-2 flex items-center gap-2">
            <Loader2 size={11} className="shrink-0 animate-spin text-accent" strokeWidth={2.2} />
            <span className="truncate text-xxs text-med">{busy.label}</span>
          </div>
          <div className="h-[3px] overflow-hidden rounded-sm bg-white/10">
            <motion.div
              className="h-full bg-accent"
              animate={{ width: busy.percent + '%' }}
              transition={{ duration: 0.18 }}
            />
          </div>
          <div className="mt-1.5 truncate font-mono text-[9px] text-mute2">{busy.detail}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
