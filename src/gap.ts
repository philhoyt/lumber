/**
 * The distance between two parts: how far apart their boxes are on each axis, the
 * centre-to-centre spacing, and the closest pair of points. Alt + hover shows it for
 * the selection and the part under the pointer. Pure.
 */
import type { AABB, AxisIndex, Vec3 } from './model';

export interface Gap {
  /** Clear distance on each axis; 0 where the boxes overlap on that axis. */
  gaps: Vec3;
  /** Centre-to-centre distance on each axis, signed from a to b. */
  oc: Vec3;
  /** The axis the boxes are furthest apart on, or null when they touch or overlap. */
  axis: AxisIndex | null;
  /** The closest points of the two boxes. */
  from: Vec3;
  to: Vec3;
  /** Straight-line distance between those points. */
  distance: number;
}

export function boxGap(a: AABB, b: AABB): Gap {
  const gaps: Vec3 = [0, 0, 0];
  const oc: Vec3 = [0, 0, 0];
  const from: Vec3 = [0, 0, 0];
  const to: Vec3 = [0, 0, 0];
  let axis: AxisIndex | null = null;
  for (const i of [0, 1, 2] as const) {
    oc[i] = (b.min[i] + b.max[i]) / 2 - (a.min[i] + a.max[i]) / 2;
    if (b.min[i] >= a.max[i]) {
      gaps[i] = b.min[i] - a.max[i];
      from[i] = a.max[i];
      to[i] = b.min[i];
    } else if (a.min[i] >= b.max[i]) {
      gaps[i] = a.min[i] - b.max[i];
      from[i] = a.min[i];
      to[i] = b.max[i];
    } else {
      // Overlapping on this axis: meet in the middle of the overlap.
      const mid = (Math.max(a.min[i], b.min[i]) + Math.min(a.max[i], b.max[i])) / 2;
      from[i] = mid;
      to[i] = mid;
    }
    if (gaps[i] > 1e-9 && (axis === null || gaps[i] > gaps[axis])) axis = i;
  }
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  return { gaps, oc, axis, from, to, distance };
}

/** `Gap X 14 1/2"  ·  16" o.c.`, with the straight line when they are offset on other axes too. */
export function gapText(g: Gap, fmt: (n: number) => string): string {
  const names = ['X', 'Y', 'Z'];
  if (g.axis === null) {
    // Touching or overlapping: the spacing on the axis the centres differ most on.
    let best: AxisIndex = 0;
    for (const i of [1, 2] as const) if (Math.abs(g.oc[i]) > Math.abs(g.oc[best])) best = i;
    const oc = Math.abs(g.oc[best]);
    return oc > 1e-9 ? `Touching  ·  ${names[best]} ${fmt(oc)} o.c.` : 'Overlapping';
  }
  const parts = [
    `Gap ${names[g.axis]} ${fmt(g.gaps[g.axis])}`,
    `${fmt(Math.abs(g.oc[g.axis]))} o.c.`,
  ];
  if (g.distance - g.gaps[g.axis] > 1 / 64) parts.push(`${fmt(g.distance)} straight`);
  return parts.join('  ·  ');
}
