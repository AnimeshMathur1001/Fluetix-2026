import type { RemoteMessage } from './remoteControl';

/**
 * Turns relayed phone gestures (see useRemoteControl.ts) into real input on
 * this screen. Nothing here is a browser-sandbox workaround for controlling
 * the OS pointer — trackpad mode only ever drives elements inside this page,
 * exactly like a real mouse would, by dispatching genuine PointerEvent/
 * MouseEvent/WheelEvent objects that React's own event delegation and the
 * browser's native scroll handling pick up unmodified.
 *
 * 3D Navigation mode instead drives the existing @react-three/drei
 * `OrbitControls` on the viewport canvas (see viewport/CameraRig.tsx) by
 * synthesizing the same pointer/wheel sequence a real mouse drag or scroll
 * would produce, so orbit/pan/zoom keep their existing damping and speed
 * tuning for free instead of duplicating that math here.
 */

const ORBIT_POINTER_ID = 9001;
const PAN_POINTER_ID = 9002;
const CLICK_POINTER_ID = 9003;

// OrbitControls calls releasePointerCapture(pointerId) on pointerup/cancel as
// routine cleanup. That pointerId was never a real hardware pointer (it's
// one we invented for a synthetic drag), so the browser never actually held
// a capture for it and this specific call throws — harmlessly, since our
// events are delivered by direct dispatchEvent() rather than real capture
// routing, but noisily enough to be worth silencing at the source.
window.addEventListener('error', (e) => {
  if (e.message && e.message.includes('releasePointerCapture')) e.preventDefault();
});
const ZOOM_WHEEL_SCALE = 4;

let orbitPos = { x: 0, y: 0 };
let panPos = { x: 0, y: 0 };

/** Plain mutable object (same pattern as lib/cameraSync.ts) so the overlay
 *  dot can be updated every frame without triggering React re-renders. */
export const remoteCursor = { x: window.innerWidth / 2, y: window.innerHeight / 2, visible: false };

function getCanvasEl(): HTMLCanvasElement | null {
  return document.querySelector('.cursor-crosshair canvas');
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function dispatchPointer(
  el: Element,
  type: string,
  x: number,
  y: number,
  opts: { button: number; buttons: number; pointerId: number },
): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: opts.button,
      buttons: opts.buttons,
      pointerId: opts.pointerId,
      pointerType: 'mouse',
      isPrimary: true,
    }),
  );
}

export function applyNavGesture(msg: Extract<RemoteMessage, { mode: 'nav' }>): void {
  const canvas = getCanvasEl();
  if (!canvas) return;
  remoteCursor.visible = false;
  const rect = canvas.getBoundingClientRect();
  const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

  switch (msg.type) {
    case 'orbit-start':
      orbitPos = { ...center };
      dispatchPointer(canvas, 'pointerdown', orbitPos.x, orbitPos.y, { button: 0, buttons: 1, pointerId: ORBIT_POINTER_ID });
      break;
    case 'orbit-move':
      orbitPos = { x: orbitPos.x + msg.dx, y: orbitPos.y + msg.dy };
      dispatchPointer(canvas, 'pointermove', orbitPos.x, orbitPos.y, { button: 0, buttons: 1, pointerId: ORBIT_POINTER_ID });
      break;
    case 'orbit-end':
      dispatchPointer(canvas, 'pointerup', orbitPos.x, orbitPos.y, { button: 0, buttons: 0, pointerId: ORBIT_POINTER_ID });
      break;
    case 'pan-start':
      panPos = { ...center };
      dispatchPointer(canvas, 'pointerdown', panPos.x, panPos.y, { button: 2, buttons: 2, pointerId: PAN_POINTER_ID });
      break;
    case 'pan-move':
      panPos = { x: panPos.x + msg.dx, y: panPos.y + msg.dy };
      dispatchPointer(canvas, 'pointermove', panPos.x, panPos.y, { button: 2, buttons: 2, pointerId: PAN_POINTER_ID });
      break;
    case 'pan-end':
      dispatchPointer(canvas, 'pointerup', panPos.x, panPos.y, { button: 2, buttons: 0, pointerId: PAN_POINTER_ID });
      break;
    case 'zoom':
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: center.x,
          clientY: center.y,
          // Pinching outward (fingers spreading, positive delta) zooms in,
          // matching a real trackpad/mouse-wheel pinch-to-zoom-in convention.
          deltaY: -msg.delta * ZOOM_WHEEL_SCALE,
          deltaMode: 0,
        }),
      );
      break;
  }
}

function simulateClickAt(x: number, y: number): void {
  const el = document.elementFromPoint(x, y);
  if (!el) return;
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1, pointerId: CLICK_POINTER_ID, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
  el.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0, pointerId: CLICK_POINTER_ID, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
}

function simulateRightClickAt(x: number, y: number): void {
  const el = document.elementFromPoint(x, y);
  if (!el) return;
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 2, buttons: 2 };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: CLICK_POINTER_ID, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousedown', base));
  el.dispatchEvent(new MouseEvent('contextmenu', base));
  el.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0, pointerId: CLICK_POINTER_ID, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
}

function simulateScrollAt(x: number, y: number, dx: number, dy: number): void {
  const el = document.elementFromPoint(x, y);
  if (!el) return;
  // Native `wheel` events bubble to whichever scrollable ancestor actually
  // owns scrolling at that point, so this needs no app-specific scroll code.
  el.dispatchEvent(
    new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, deltaX: -dx, deltaY: -dy, deltaMode: 0 }),
  );
}

export function applyTrackpadGesture(msg: Extract<RemoteMessage, { mode: 'trackpad' }>): void {
  switch (msg.type) {
    case 'move':
      remoteCursor.x = clamp(remoteCursor.x + msg.dx, 0, window.innerWidth);
      remoteCursor.y = clamp(remoteCursor.y + msg.dy, 0, window.innerHeight);
      remoteCursor.visible = true;
      break;
    case 'click':
      simulateClickAt(remoteCursor.x, remoteCursor.y);
      break;
    case 'rightclick':
      simulateRightClickAt(remoteCursor.x, remoteCursor.y);
      break;
    case 'scroll':
      simulateScrollAt(remoteCursor.x, remoteCursor.y, msg.dx, msg.dy);
      break;
  }
}
