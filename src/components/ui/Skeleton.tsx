import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils';

/** Pulsing placeholder bar for a value that's still being computed —
 *  used instead of blank space or a static "—" while a real result is pending. */
export default function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn('animate-pulse rounded bg-white/[0.07]', className)} style={style} />;
}
