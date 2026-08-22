import { useEffect } from 'react';
import { checkHealth } from '../lib/api';
import { useAppStore } from '../store/useAppStore';

const RETRY_MS = 15000;

/** Pings the optional FastAPI backend once at startup, then keeps retrying on
 *  an interval while it's unreachable so the app picks it up if it comes
 *  online mid-session — without ever blocking the (fully functional,
 *  in-browser) UI on the result. */
export function useBackendHealth() {
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const ping = async () => {
      useAppStore.getState().set({ backend: { ...useAppStore.getState().backend, checking: true } });
      const detail = await checkHealth();
      if (cancelled) return;
      useAppStore.getState().set({ backend: { available: detail?.ok ?? false, checking: false, detail } });
      if (!detail?.ok) timer = window.setTimeout(ping, RETRY_MS);
    };

    ping();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
}
