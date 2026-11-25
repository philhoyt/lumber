/**
 * The navigation gizmo in the corner of the view, as in Blender: six axis handles on a
 * ball that turns with the camera. Click a handle to look along that axis, click the
 * one you are looking from to see the other side, drag anywhere on it to orbit. This is
 * the layout and hit-testing; the view draws it.
 */
import type { Vec3 } from './model';

export type AxisView = 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left';

export interface Handle {
  axis: 0 | 1 | 2;
  sign: 1 | -1;
}

/** A handle placed on screen: `x` right and `y` down from the centre, `depth` 1 nearest the viewer. */
export interface HandleSpot extends Handle {
  x: number;
  y: number;
  depth: number;
}

export const HANDLES: readonly Handle[] = [
  { axis: 0, sign: 1 },
  { axis: 0, sign: -1 },
  { axis: 1, sign: 1 },
  { axis: 1, sign: -1 },
  { axis: 2, sign: 1 },
  { axis: 2, sign: -1 },
];

/** Blender's axis colours. */
export const AXIS_COLORS = ['#ff3352', '#8bdc00', '#2890ff'] as const;

/**
 * Where each handle sits, given the world axes in camera space (x right, y up, z toward
 * the viewer), farthest first so the nearest draws on top.
 */
export function layoutHandles(axes: readonly [Vec3, Vec3, Vec3], radius: number): HandleSpot[] {
  return HANDLES.map((h) => {
    const a = axes[h.axis];
    return {
      ...h,
      x: h.sign * a[0] * radius,
      y: -h.sign * a[1] * radius,
      depth: h.sign * a[2],
    };
  }).sort((p, q) => p.depth - q.depth);
}

/** The handle under a point, the nearest to the viewer winning when they overlap. */
export function handleAt(
  spots: readonly HandleSpot[],
  x: number,
  y: number,
  hit: number,
): HandleSpot | null {
  for (let i = spots.length - 1; i >= 0; i--) {
    const s = spots[i]!;
    if (Math.hypot(s.x - x, s.y - y) <= hit) return s;
  }
  return null;
}

const VIEW_OF: Record<string, AxisView> = {
  '0+': 'right',
  '0-': 'left',
  '1+': 'back',
  '1-': 'front',
  '2+': 'top',
  '2-': 'bottom',
};
const OPPOSITE: Record<AxisView, AxisView> = {
  top: 'bottom',
  bottom: 'top',
  front: 'back',
  back: 'front',
  right: 'left',
  left: 'right',
};

export const oppositeView = (v: AxisView): AxisView => OPPOSITE[v];

/**
 * The view a click on a handle asks for: looking from that side of the model, or, when
 * the camera already looks from there (`viewDir` is the unit vector from the model to
 * the camera), from the opposite side.
 */
export function handleView(h: Handle, viewDir: Vec3 | null): AxisView {
  const own = VIEW_OF[`${h.axis}${h.sign > 0 ? '+' : '-'}`]!;
  if (viewDir && h.sign * viewDir[h.axis] > 0.999) return OPPOSITE[own];
  return own;
}

/** Degrees to orbit for a drag across the gizmo: a drag of one radius turns a quarter. */
export function dragOrbit(dx: number, dy: number, radius: number): { az: number; el: number } {
  const k = 90 / radius;
  return { az: -dx * k, el: dy * k };
}
