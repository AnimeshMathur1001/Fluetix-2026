import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export default function SectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-2 font-mono text-tiny uppercase tracking-[0.08em] text-mute2', className)}>
      {children}
    </div>
  );
}
