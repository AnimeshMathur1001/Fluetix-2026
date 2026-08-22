import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Info, Save, Search, Smartphone } from 'lucide-react';
import ActionButton from './ui/ActionButton';
import { useAppStore } from '../store/useAppStore';

export default function Header() {
  const caseName = useAppStore((s) => s.caseName);
  const backendAvailable = useAppStore((s) => s.backend.available);
  const queueStatus = useAppStore((s) => s.queueStatus);
  const remoteControlEnabled = useAppStore((s) => s.remoteControlEnabled);
  const remotePhoneConnected = useAppStore((s) => s.remotePhoneConnected);
  const set = useAppStore((s) => s.set);
  const exportProjectFile = useAppStore((s) => s.exportProjectFile);
  const importProjectFile = useAppStore((s) => s.importProjectFile);
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(navigator.platform.toLowerCase().includes('mac')), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = Boolean(queueStatus && (queueStatus.running > 0 || queueStatus.waiting > 0));
  const statusLabel = !backendAvailable
    ? 'in-browser mode'
    : queueStatus && busy
      ? queueStatus.running + ' running' + (queueStatus.waiting > 0 ? ' · ' + queueStatus.waiting + ' waiting' : '')
      : 'connected';

  return (
    <header className="flex items-center gap-[18px] border-b border-line bg-chrome px-4 shadow-chrome">
      <div className="flex items-baseline gap-[7px]">
        <span className="-translate-y-px inline-block h-[9px] w-[9px] rounded-[2px] bg-accent" />
        <span className="text-[14px] font-semibold tracking-[-0.2px]">Fluetix</span>
      </div>

      <div className="flex items-center gap-2 border-l border-line2 pl-[18px]">
        <span className="text-tiny text-mute">case</span>
        <input
          value={caseName}
          onChange={(e) => set({ caseName: e.target.value })}
          className="w-[210px] rounded border border-line2 bg-field px-2 py-1 font-mono text-[11.5px] text-ink outline-none transition-colors duration-120 hover:border-white/20 focus:border-accent/60"
        />
      </div>

      <div className="flex items-center gap-1.5 border-l border-line2 pl-[18px]">
        <ActionButton size="sm" title="Save case to disk (.hxproj.json)" onClick={exportProjectFile}>
          <Save size={12} strokeWidth={1.8} />
          Save
        </ActionButton>
        <ActionButton size="sm" title="Load a saved case from disk" onClick={() => fileInputRef.current?.click()}>
          <FolderOpen size={12} strokeWidth={1.8} />
          Load
        </ActionButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importProjectFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 text-tiny text-dim2" title={backendAvailable ? 'Live connection reachable' : 'No connection — running fully in-browser'}>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: !backendAvailable ? '#7d8792' : busy ? '#d9a03c' : '#5aa86a' }}
          />
          {statusLabel}
        </div>
        <ActionButton size="sm" title="Command palette" onClick={() => set({ commandPaletteOpen: true })}>
          <Search size={12} strokeWidth={1.8} />
          <span className="font-mono text-2xs text-mute3">{mac ? '⌘K' : 'Ctrl+K'}</span>
        </ActionButton>
        <ActionButton
          size="sm"
          variant={remoteControlEnabled ? 'outline' : 'secondary'}
          disabled={!backendAvailable}
          title={
            !backendAvailable
              ? 'Requires a live connection'
              : remoteControlEnabled
                ? remotePhoneConnected
                  ? 'Phone connected — click to view pairing / disable'
                  : 'Waiting for phone — click to view pairing QR code'
                : 'Control this app from your phone over the local network'
          }
          onClick={() =>
            set(
              remoteControlEnabled
                ? { remoteControlEnabled: false, remoteControlModalOpen: false }
                : { remoteControlEnabled: true, remoteControlModalOpen: true },
            )
          }
        >
          <Smartphone size={12} strokeWidth={1.8} />
          {remoteControlEnabled ? (remotePhoneConnected ? 'Remote: connected' : 'Remote: waiting…') : 'Remote'}
        </ActionButton>
        <ActionButton size="sm" onClick={() => set({ aboutOpen: true })}>
          <Info size={12} strokeWidth={1.8} />
          About
        </ActionButton>
      </div>
    </header>
  );
}
