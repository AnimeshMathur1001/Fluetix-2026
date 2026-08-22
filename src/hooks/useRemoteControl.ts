import { useEffect } from 'react';
import { openRemoteSocket, type RemoteMessage } from '../lib/remoteControl';
import { applyNavGesture, applyTrackpadGesture } from '../lib/remoteInput';
import { useAppStore } from '../store/useAppStore';

const RECONNECT_MS = 2000;

/** Owns the desktop side of the mobile remote-control WebSocket while the
 *  feature is enabled (see Header.tsx's toggle) — reconnects on drop so a
 *  backend restart or a flaky Wi-Fi hiccup doesn't permanently strand the
 *  phone's session, and stays connected even after the pairing/QR modal is
 *  closed since the phone keeps sending gestures either way. */
export function useRemoteControl() {
  const enabled = useAppStore((s) => s.remoteControlEnabled);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (cancelled) return;
      ws = openRemoteSocket();
      ws.onmessage = (ev) => {
        let msg: RemoteMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'status') {
          useAppStore.getState().set({ remotePhoneConnected: msg.phoneConnected });
        } else if ('mode' in msg && msg.mode === 'trackpad') {
          applyTrackpadGesture(msg);
        } else if ('mode' in msg && msg.mode === 'nav') {
          applyNavGesture(msg);
        }
      };
      ws.onclose = () => {
        useAppStore.getState().set({ remotePhoneConnected: false });
        if (!cancelled) reconnectTimer = window.setTimeout(connect, RECONNECT_MS);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      useAppStore.getState().set({ remotePhoneConnected: false });
      ws?.close();
    };
  }, [enabled]);
}
