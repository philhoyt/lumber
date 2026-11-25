/**
 * Camera gestures for people without a middle mouse button: Alt+drag orbits like
 * Blender's "emulate 3 button mouse", and in trackpad mode two-finger scrolling orbits,
 * pinching zooms and Shift+two-finger pans. Pure decisions and amounts; the scene moves
 * the camera.
 */

export type Gesture = 'orbit' | 'pan' | 'zoom';

interface Modifiers {
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey?: boolean;
}

/** What a left-button press with modifiers means: Alt orbits, Shift+Alt pans, Ctrl+Alt zooms. */
export function dragGesture(e: Modifiers & { button: number }): Gesture | null {
  if (e.button !== 0 || !e.altKey) return null;
  if (e.shiftKey) return 'pan';
  if (e.ctrlKey || e.metaKey) return 'zoom';
  return 'orbit';
}

/**
 * What a wheel event means in trackpad mode. Browsers report a pinch as a wheel with
 * Ctrl held, so Ctrl zooms; Shift pans; a plain two-finger scroll orbits.
 */
export function wheelGesture(e: Modifiers): Gesture {
  if (e.ctrlKey || e.metaKey) return 'zoom';
  if (e.shiftKey) return 'pan';
  return 'orbit';
}

/** Wheel deltas in pixels, whatever unit the browser reported. */
export function wheelPixels(deltaX: number, deltaY: number, deltaMode: number): [number, number] {
  const k = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
  return [deltaX * k, deltaY * k];
}

/** Degrees of azimuth and elevation for a two-finger scroll: fingers right turn the model right. */
export function orbitDegrees(dx: number, dy: number): { az: number; el: number } {
  const k = 0.3;
  return { az: -dx * k, el: -dy * k };
}

/** The distance multiplier for a pinch: fingers apart (negative delta) brings the model closer. */
export function zoomScale(dy: number): number {
  return Math.min(4, Math.max(0.25, Math.exp(dy * 0.01)));
}
