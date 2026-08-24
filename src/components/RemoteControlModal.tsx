import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { TriangleAlert, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { buildRemoteUrl, checkReachable, fetchRemoteInterfaces, type RemoteInterface } from '../lib/remoteControl';

type Reachability = 'checking' | 'ok' | 'unreachable';

/** QR pairing modal for the mobile remote-control feature — one QR code per
 *  active local network adapter, since a laptop can have a home/office
 *  Wi-Fi, a phone hotspot, and its own hotspot all live at once and only
 *  one of them is actually shared with the phone doing the scanning. */
export default function RemoteControlModal() {
  const open = useAppStore((s) => s.remoteControlModalOpen);
  const enabled = useAppStore((s) => s.remoteControlEnabled);
  const phoneConnected = useAppStore((s) => s.remotePhoneConnected);
  const set = useAppStore((s) => s.set);

  const [interfaces, setInterfaces] = useState<RemoteInterface[]>([]);
  const [port, setPort] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reachability, setReachability] = useState<Record<string, Reachability>>({});
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('8000');

  useEffect(() => {
    if (!open || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRemoteInterfaces()
      .then((res) => {
        if (cancelled) return;
        setInterfaces(res.interfaces);
        setPort(res.port);
        setManualPort((prev) => prev || String(res.port));
        setReachability(Object.fromEntries(res.interfaces.map((i) => [i.ip, 'checking' as const])));
        // Self-check from this same browser: if this PC can't reach its own
        // LAN address, no phone will be able to either — most commonly
        // because the backend is bound to loopback only (see
        // backend/README.md's --host 0.0.0.0 note). Doesn't prove a phone
        // specifically can connect (that also needs the OS firewall to allow
        // it and both devices to share an unisolated network), only that
        // this address isn't dead on arrival.
        res.interfaces.forEach((iface) => {
          checkReachable(iface.ip, res.port).then((ok) => {
            if (!cancelled) setReachability((prev) => ({ ...prev, [iface.ip]: ok ? 'ok' : 'unreachable' }));
          });
        });
      })
      .catch(() => {
        if (!cancelled) setError('Could not reach the server to discover this machine’s network address.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, enabled]);

  const anyUnreachable = Object.values(reachability).some((r) => r === 'unreachable');

  const close = () => set({ remoteControlModalOpen: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') set({ remoteControlModalOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, set]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          className="absolute inset-0 z-40 grid place-items-center bg-base/70 backdrop-blur-[2px]"
        >
          <motion.div
            initial={{ scale: 0.97, y: 6 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[420px] max-w-[92vw] rounded-lg border border-white/10 bg-card px-6 py-5 shadow-modal"
          >
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[15px] font-semibold">Mobile Remote Control</div>
              <button type="button" onClick={close} aria-label="Close" className="text-mute2 hover:text-ink">
                <X size={15} strokeWidth={1.8} />
              </button>
            </div>
            <div className="mb-3.5 flex items-center gap-1.5 font-mono text-tiny text-mute2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: phoneConnected ? '#5aa86a' : '#d9a03c' }}
              />
              {phoneConnected ? 'phone connected' : 'waiting for phone to scan'}
            </div>

            <p className="mb-3.5 text-med leading-relaxed text-dim">
              Scan the code for whichever network your phone shares with this computer (Wi-Fi, a
              hotspot either device is hosting). No internet connection is needed – everything
              stays on your local network.
            </p>

            {loading && <div className="py-6 text-center text-tiny text-mute2">Discovering local networks…</div>}
            {error && <div className="rounded border border-[#d9633f]/30 bg-[#d9633f]/10 px-3 py-2 text-tiny text-[#e2846a]">{error}</div>}
            {!loading && !error && interfaces.length === 0 && (
              <div className="py-6 text-center text-tiny text-mute2">
                No active local network adapter found. Connect to Wi-Fi or start a hotspot, then reopen this dialog.
              </div>
            )}

            {!loading && !error && interfaces.length > 0 && port !== null && (
              <div className="grid grid-cols-2 gap-3">
                {interfaces.map((iface) => (
                  <div
                    key={iface.ip}
                    className="flex flex-col items-center gap-2 rounded border border-line2 bg-field px-3 py-3"
                  >
                    <div className="rounded bg-white p-2">
                      <QRCodeSVG value={buildRemoteUrl(iface.ip, port)} size={128} />
                    </div>
                    <div className="text-center font-mono text-tiny text-mute2">
                      {iface.label}
                      <br />
                      {iface.ip}
                    </div>
                    <div className="flex items-center gap-1 font-mono text-2xs">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          background:
                            reachability[iface.ip] === 'ok'
                              ? '#5aa86a'
                              : reachability[iface.ip] === 'unreachable'
                                ? '#d9633f'
                                : '#7d8792',
                        }}
                      />
                      <span className={reachability[iface.ip] === 'unreachable' ? 'text-[#e2846a]' : 'text-mute3'}>
                        {reachability[iface.ip] === 'ok'
                          ? 'reachable'
                          : reachability[iface.ip] === 'unreachable'
                            ? 'not reachable'
                            : 'checking…'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {anyUnreachable && (
              <div className="mt-3.5 flex items-start gap-2 rounded border border-[#d9a03c]/30 bg-[#d9a03c]/10 px-3 py-2.5 text-tiny text-[#e0b878]">
                <TriangleAlert size={14} strokeWidth={1.8} className="mt-0.5 flex-shrink-0" />
                <div>
                  This computer can't reach that address itself, so a phone won't be able to
                  either. If a green "reachable" address is shown above, use that QR code
                  instead – otherwise this usually means either the server isn't bound to the
                  network (run it with <code>--host 0.0.0.0</code> or <code>python -m app.main</code>),
                  or it's running inside Docker Desktop, which on
                  Windows/Mac can't see this computer's real Wi-Fi/Ethernet address at all. Enter
                  your computer's own IP address below instead – find it via{' '}
                  <code>ipconfig</code> (Windows) or <code>ifconfig</code>/System Settings
                  (macOS/Linux).
                </div>
              </div>
            )}

            <div className="mt-3.5 border-t border-line2 pt-3">
              <div className="mb-2 text-tiny text-dim">Or enter this computer's network address manually</div>
              <div className="flex items-center gap-2">
                <input
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value.trim())}
                  placeholder="e.g. 192.168.1.8"
                  className="w-full rounded border border-line2 bg-field px-2 py-1.5 font-mono text-tiny text-ink outline-none transition-colors duration-120 hover:border-white/20 focus:border-accent/60"
                />
                <span className="text-mute3">:</span>
                <input
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value.trim())}
                  placeholder="8000"
                  className="w-[70px] rounded border border-line2 bg-field px-2 py-1.5 font-mono text-tiny text-ink outline-none transition-colors duration-120 hover:border-white/20 focus:border-accent/60"
                />
              </div>
              {manualIp && Number(manualPort) > 0 && (
                <div className="mt-3 flex flex-col items-center gap-2 rounded border border-line2 bg-field px-3 py-3">
                  <div className="rounded bg-white p-2">
                    <QRCodeSVG value={buildRemoteUrl(manualIp, Number(manualPort))} size={128} />
                  </div>
                  <div className="text-center font-mono text-tiny text-mute2">
                    {manualIp}:{manualPort}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-3.5 border-t border-line2 pt-3 text-tiny text-mute2">
              Trackpad mode moves a cursor over this app; 3D Navigation mode drives the viewport
              camera. Switch modes from the top of the phone page. Turning off "Remote" in the
              toolbar ends the session.
            </div>

            <div className="mt-2 text-2xs text-mute3">
              Phone can't load the page even with a green address? Check that your phone and this
              computer are on the same network (not a guest Wi-Fi or hotspot with client
              isolation), and that your firewall allows this app on private networks.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
