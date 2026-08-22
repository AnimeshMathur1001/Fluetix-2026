import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { remoteCursor } from '../lib/remoteInput';

/** Visual dot for the phone's trackpad-mode virtual cursor (see
 *  lib/remoteInput.ts) — a plain DOM node moved imperatively every frame
 *  instead of through React state, same reasoning as lib/cameraSync.ts:
 *  this updates far more often than a React re-render should ever run. */
export default function RemoteCursorOverlay() {
  const enabled = useAppStore((s) => s.remoteControlEnabled);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    let raf: number;
    const tick = () => {
      const el = ref.current;
      if (el) {
        // -8px centres the 16px (h-4 w-4) dot on the cursor point without
        // relying on a percentage transform (which JS-set transform below
        // would otherwise clobber on every frame).
        el.style.transform = 'translate(' + (remoteCursor.x - 8) + 'px,' + (remoteCursor.y - 8) + 'px)';
        el.style.opacity = remoteCursor.visible ? '1' : '0';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-[70] h-4 w-4 rounded-full border-2 border-accent bg-accent/25 opacity-0 shadow-[0_0_0_1px_rgba(0,0,0,0.4)] transition-opacity duration-150"
    />
  );
}
