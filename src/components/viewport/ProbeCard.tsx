import { motion } from 'framer-motion';
import { useAppStore } from '../../store/useAppStore';

export default function ProbeCard() {
  const probe = useAppStore((s) => s.probe);
  if (!probe) return null;

  const rows: [string, string][] = [
    ['x y z', probe.x.toFixed(2) + '  ' + probe.y.toFixed(2) + '  ' + probe.z.toFixed(2) + ' mm'],
    ['T', probe.T.toFixed(2) + ' °C'],
    ['p', probe.p.toFixed(1) + ' Pa'],
    ['|U|', probe.u.toFixed(3) + ' m/s'],
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14 }}
      className="absolute bottom-4 left-4 min-w-[212px] rounded-md border border-accent/30 bg-[#0e1115]/88 px-3 py-2.5 shadow-float backdrop-blur-md"
    >
      <div className="mb-1.5 font-mono text-xxs tracking-[0.05em] text-accent">POINT PROBE</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 font-mono text-tiny leading-7">
          <span className="whitespace-nowrap text-mute">{k}</span>
          <span className="whitespace-nowrap text-ink">{v}</span>
        </div>
      ))}
    </motion.div>
  );
}
