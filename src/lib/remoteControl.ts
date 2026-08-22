/**
 * Client for the mobile remote-control pairing/relay (see backend/app/routers/remote.py).
 * Same optional-backend contract as lib/api.ts: this feature is simply
 * unavailable (the toolbar button is disabled) when no backend is reachable,
 * since the phone needs somewhere on the LAN to actually connect to.
 */
import { API_BASE } from './api';
import { getSessionId } from './session';

const WS_BASE = API_BASE.replace(/^http/, 'ws');

export interface RemoteInterface {
  ip: string;
  label: string;
}

/** One entry per active local network adapter (Wi-Fi, Ethernet, a phone
 *  hotspot this PC joined, this PC's own hotspot) plus the port the phone
 *  should use — see routers/remote.py's docstring. Throws on failure like
 *  every other lib/api.ts call; callers show "backend unavailable" instead. */
export async function fetchRemoteInterfaces(): Promise<{ interfaces: RemoteInterface[]; port: number }> {
  const res = await fetch(API_BASE + '/remote/interfaces', { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error('/remote/interfaces -> HTTP ' + res.status);
  return res.json();
}

/** Self-check from the desktop's own browser: if this PC can't reach its
 *  own LAN address, no phone will be able to either — most commonly because
 *  the backend was started bound to loopback only (see backend/README.md),
 *  which happens silently since the QR code's IP is discovered correctly
 *  either way. A phone failing to load the page despite this passing points
 *  at Windows Firewall or the phone/PC being on different, isolated networks
 *  (e.g. a hotspot with client isolation) instead. */
export async function checkReachable(ip: string, port: number): Promise<boolean> {
  try {
    const res = await fetch('http://' + ip + ':' + port + '/health', { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Builds the exact URL the phone should scan/open for a given LAN IP —
 *  the standalone controller page (routers/remote.py's GET /remote),
 *  carrying this browser's session id so it pairs with this desktop tab. */
export function buildRemoteUrl(ip: string, port: number): string {
  return 'http://' + ip + ':' + port + '/remote/?session=' + encodeURIComponent(getSessionId());
}

/** Raw WebSocket to WS /remote/ws as the desktop side of a pairing — the
 *  phone page opens the same URL shape with role=phone instead. */
export function openRemoteSocket(): WebSocket {
  return new WebSocket(WS_BASE + '/remote/ws?session=' + encodeURIComponent(getSessionId()) + '&role=desktop');
}

export type RemoteMessage =
  | { type: 'connected' }
  | { type: 'status'; phoneConnected: boolean }
  | { mode: 'trackpad'; type: 'move'; dx: number; dy: number }
  | { mode: 'trackpad'; type: 'click' }
  | { mode: 'trackpad'; type: 'rightclick' }
  | { mode: 'trackpad'; type: 'scroll'; dx: number; dy: number }
  | { mode: 'nav'; type: 'orbit-start' | 'orbit-end' }
  | { mode: 'nav'; type: 'orbit-move'; dx: number; dy: number }
  | { mode: 'nav'; type: 'pan-start' | 'pan-end' }
  | { mode: 'nav'; type: 'pan-move'; dx: number; dy: number }
  | { mode: 'nav'; type: 'zoom'; delta: number };
