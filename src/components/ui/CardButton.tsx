import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface CardButtonProps {
  title: string;
  subtitle?: string;
  active: boolean;
  onClick: () => void;
}

/** Selectable card used by the surface picker and the geometry-mode picker. */
export default function CardButton({ title, subtitle, active, onClick }: CardButtonProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ y: 0 }}
      className={cn(
        'rounded-md border px-2.5 py-2 text-left transition-colors duration-120',
        active
          ? 'border-accent/45 bg-accent/[0.09] text-ink shadow-raise'
          : 'border-line2 bg-field text-dim hover:border-white/20',
      )}
    >
      <div className="text-base2 font-medium">{title}</div>
      {subtitle ? <div className="mt-0.5 font-mono text-2xs text-mute2">{subtitle}</div> : null}
    </motion.button>
  );
}
