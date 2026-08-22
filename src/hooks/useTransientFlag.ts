import { useEffect, useRef, useState } from 'react';

/** True for `duration` ms right after `trigger` flips false -> true, then false again —
 *  drives spinner-to-checkmark button states without each call site hand-rolling a timer. */
export function useTransientFlag(trigger: boolean, duration = 1400): boolean {
  const prev = useRef(trigger);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const justTurnedOn = trigger && !prev.current;
    prev.current = trigger;
    if (!justTurnedOn) return;
    setActive(true);
    const t = window.setTimeout(() => setActive(false), duration);
    return () => window.clearTimeout(t);
  }, [trigger, duration]);

  return active;
}
