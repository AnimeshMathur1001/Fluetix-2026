import { useEffect } from 'react';
import { Minimize2 } from 'lucide-react';
import Header from './components/Header';
import WorkflowStepper from './components/WorkflowStepper';
import Viewport from './components/viewport/Viewport';
import ParameterPanel from './components/panels/ParameterPanel';
import StatusBar from './components/StatusBar';
import AboutDialog from './components/AboutDialog';
import CommandPalette from './components/CommandPalette';
import RemoteControlModal from './components/RemoteControlModal';
import RemoteCursorOverlay from './components/RemoteCursorOverlay';
import Toast from './components/Toast';
import { useAppStore } from './store/useAppStore';
import { useBackendHealth } from './hooks/useBackendHealth';
import { useBackendResultsSync } from './hooks/useBackendResultsSync';
import { useFluidCatalog } from './hooks/useFluidCatalog';
import { useQueueStatus } from './hooks/useQueueStatus';
import { useRemoteControl } from './hooks/useRemoteControl';

export default function App() {
  const panelOpen = useAppStore((s) => s.panelOpen);
  const panelWidth = useAppStore((s) => s.panelWidth);
  const focusMode = useAppStore((s) => s.focusMode);
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode);
  useBackendHealth();
  useBackendResultsSync();
  useFluidCatalog();
  useQueueStatus();
  useRemoteControl();

  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleFocusMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusMode, toggleFocusMode]);

  return (
    <div
      className="relative grid h-full w-full overflow-hidden bg-base text-ink"
      style={{ gridTemplateRows: focusMode ? '1fr' : '46px 42px 1fr 26px' }}
    >
      {!focusMode && <Header />}
      {!focusMode && <WorkflowStepper />}

      <main
        className="relative grid min-h-0 min-w-0"
        style={{ gridTemplateColumns: panelOpen && !focusMode ? '1fr ' + panelWidth + 'px' : '1fr 0px' }}
      >
        <Viewport />
        {panelOpen && !focusMode ? <ParameterPanel /> : <div />}
        {focusMode && (
          <button
            type="button"
            title="Exit focus mode (Esc)"
            onClick={toggleFocusMode}
            className="absolute right-3 top-3 z-40 flex items-center gap-1.5 rounded border border-white/10 bg-[#14181d]/80 px-2.5 py-1.5 font-mono text-xxs text-dim backdrop-blur-md transition-colors duration-120 hover:border-white/20 hover:text-ink"
          >
            <Minimize2 size={10} strokeWidth={1.8} />
            exit focus
          </button>
        )}
      </main>

      {!focusMode && <StatusBar />}
      <AboutDialog />
      <CommandPalette />
      <RemoteControlModal />
      <RemoteCursorOverlay />
      <Toast />
    </div>
  );
}
