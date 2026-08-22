import { AnimatePresence, motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';

export default function Toast() {
  const toast = useAppStore((s) => s.toast);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.16 }}
          className="pointer-events-none absolute bottom-[44px] left-1/2 z-50 -translate-x-1/2 rounded-md border border-accent/35 bg-[#191d22] px-4 py-2 text-base2 text-ink shadow-float"
        >
          {toast}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
