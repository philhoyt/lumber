/**
 * Snapping while dragging. Because every part is an axis-aligned box, snapping is a
 * per-axis comparison of box faces: a moving face within tolerance of another part's
 * face lands flush on it or butted against it. With no face in reach, the box's min
 * corner snaps to the grid.
 */
import type { AABB, Vec3 } from './model';

export interface SnapOptions {
  /** Grid step in inches; 0 disables the grid. */
  grid: number;
  /** Snap to other parts' faces and to the ground. */
  snapParts: boolean;
  /** How close a face must be to snap, inches. */
  tol?: number;
}

/**
 * Adjust a proposed movement so the moved box snaps along the given axes.
 * @param aabb   the moving box before the move
 * @param delta  the proposed movement (mutated and returned)
 * @param axes   axis indices to snap on (0 = x, 1 = y, 2 = z)
 * @param others boxes of the parts not being moved
 */
export function snapDelta(
  aabb: AABB,
  delta: Vec3,
  axes: readonly number[],
  others: readonly AABB[],
  opts: SnapOptions,
): Vec3 {
  const tol = opts.tol ?? 1.25;
  for (const a of axes) {
    const myMin = aabb.min[a]! + delta[a]!;
    const myMax = aabb.max[a]! + delta[a]!;
    let best: number | null = null;
    const consider = (off: number) => {
      if (Math.abs(off) < tol && (best === null || Math.abs(off) < Math.abs(best))) best = off;
    };
    if (opts.snapParts) {
      for (const ob of others)
        for (const mine of [myMin, myMax])
          for (const theirs of [ob.min[a]!, ob.max[a]!]) consider(theirs - mine);
      if (a === 1) consider(-myMin); // the floor
    }
    if (best !== null) delta[a]! += best;
    else if (opts.grid > 0) delta[a]! += Math.round(myMin / opts.grid) * opts.grid - myMin;
  }
  return delta;
}
