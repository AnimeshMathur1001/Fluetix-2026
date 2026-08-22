import { useEffect } from 'react';
import { fetchFluidList } from '../lib/api';
import { useAppStore } from '../store/useAppStore';

/** Fetches the full CoolProp fluid list once the backend is reachable — the searchable
 *  material picker falls back to the 5 built-in presets (lib/presets.ts) until then. */
export function useFluidCatalog() {
  const available = useAppStore((s) => s.backend.available);
  const hasCatalog = useAppStore((s) => s.fluidCatalog.length > 0);
  const setFluidCatalog = useAppStore((s) => s.setFluidCatalog);

  useEffect(() => {
    if (!available || hasCatalog) return;
    let cancelled = false;
    fetchFluidList()
      .then((list) => {
        if (!cancelled) setFluidCatalog(list);
      })
      .catch(() => {
        // backend has CoolProp but the request flaked — the 5 built-in presets still work
      });
    return () => {
      cancelled = true;
    };
  }, [available, hasCatalog, setFluidCatalog]);
}
