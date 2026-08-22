import { useEffect } from 'react';
import { fetchQueueStatus } from '../lib/api';
import { useAppStore } from '../store/useAppStore';

const POLL_MS = 6000;

/** Polls the shared backend's real job-queue load while it's reachable —
 *  drives the header's execution-status indicator and the Mesh & Solve
 *  step's backend-status panel with live data instead of the old decorative
 *  local/remote toggle. */
export function useQueueStatus() {
  const available = useAppStore((s) => s.backend.available);

  useEffect(() => {
    if (!available) {
      useAppStore.getState().set({ queueStatus: null });
      return;
    }
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      const status = await fetchQueueStatus();
      if (!cancelled && status) useAppStore.getState().set({ queueStatus: status });
      timer = window.setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [available]);
}
