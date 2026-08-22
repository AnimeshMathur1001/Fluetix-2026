import { useAppStore } from '../store/useAppStore';

/** Exposes the existing Save/Load/New actions on `window` so the desktop
 *  shell's native File menu (backend/app/webview_window.py) can call into
 *  them via evaluate_js, instead of the app needing its own separate
 *  native-menu-aware save/load logic. No-op when not running inside the
 *  desktop shell — nothing else references this. */
declare global {
  interface Window {
    __fluetixDesktop?: {
      newCase: () => void;
      save: () => void;
      open: (projectJson: string) => Promise<void>;
    };
  }
}

window.__fluetixDesktop = {
  newCase: () => useAppStore.getState().startNewCase(),
  save: () => useAppStore.getState().exportProjectFile(),
  open: (projectJson: string) => {
    const file = new File([projectJson], 'project.hxproj.json', { type: 'application/json' });
    return useAppStore.getState().importProjectFile(file);
  },
};
