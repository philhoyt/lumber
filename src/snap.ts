/**
 * Snapping while dragging. Because every part is an axis-aligned box, snapping is a
 * per-axis comparison of box faces: a moving face within tolerance of another part's
 * face lands flush on it or butted against it. With no face in reach, the box's min
 * corner snaps to the grid. The result says what snapped to what, so the view can
 * show it.
 */
import { UP, type AABB, type AxisIndex, type Vec3 } from './model';

export interface SnapOptions {
  /** Grid step in inches; 0 disables the grid. */
  grid: number;
  /** Snap to other parts' faces and to the floor. */
  snapParts: boolean;
  /** How close a face must be to snap, inches. */
  tol?: number;
}

/** What one axis snapped to. */
export interface SnapHit {
  axis: AxisIndex;
  kind: 'face' | 'floor' | 'grid';
  /** Index into `others` for a face snap. */
  other?: number;
  /** Which face of the other box. */
  side?: 'min' | 'max';
  /** Which face of the moving box. */
  mine: 'min' | 'max';
  /** The world coordinate of the plane snapped to. */
  at: number;
}

export interface SnapResult {
  delta: Vec3;
  hits: SnapHit[];
}

/**
 * Adjust a proposed movement so the moved box snaps along the given axes, and say what
 * each axis snapped to.
 * @param aabb   the moving box before the move
 * @param delta  the proposed movement (mutated and returned)
 * @param axes   axis indices to snap on
 * @param others boxes of the parts not being moved
 */
export function snapWithHits(
  aabb: AABB,
  delta: Vec3,
  axes: readonly AxisIndex[],
  others: readonly AABB[],
  opts: SnapOptions,
): SnapResult {
  const tol = opts.tol ?? 1.25;
  const hits: SnapHit[] = [];
  for (const a of axes) {
    const myMin = aabb.min[a] + delta[a];
    const myMax = aabb.max[a] + delta[a];
    let best: SnapHit | null = null;
    let bestDelta = 0;
    let bestOff = tol;
    const consider = (off: number, hit: Omit<SnapHit, 'axis'>) => {
      if (Math.abs(off) < bestOff) {
        bestOff = Math.abs(off);
        best = { axis: a, ...hit };
        bestDelta = off;
      }
    };
    if (opts.snapParts) {
      others.forEach((ob, i) => {
        for (const mine of ['min', 'max'] as const)
          for (const side of ['min', 'max'] as const) {
            const theirs = ob[side][a];
            const me = mine === 'min' ? myMin : myMax;
            consider(theirs - me, { kind: 'face', other: i, side, mine, at: theirs });
          }
      });
      if (a === UP) consider(-myMin, { kind: 'floor', mine: 'min', at: 0 });
    }
    if (best) {
      delta[a] += bestDelta;
      hits.push(best);
    } else if (opts.grid > 0) {
      const at = Math.round(myMin / opts.grid) * opts.grid;
      delta[a] += at - myMin;
      hits.push({ axis: a, kind: 'grid', mine: 'min', at });
    }
  }
  return { delta, hits };
}

/** As `snapWithHits`, returning only the adjusted movement. */
export function snapDelta(
  aabb: AABB,
  delta: Vec3,
  axes: readonly AxisIndex[],
  others: readonly AABB[],
  opts: SnapOptions,
): Vec3 {
  return snapWithHits(aabb, delta, axes, others, opts).delta;
}

/** A face of another box lying on the plane a hit snapped to. */
export interface CoplanarFace {
  other: number;
  side: 'min' | 'max';
}

/**
 * Every face of every other box on the plane a face hit snapped to, the hit's own face
 * first. When a part lands in line with several pieces, all of them are in line.
 */
export function coplanarFaces(hit: SnapHit, others: readonly AABB[], eps = 1e-6): CoplanarFace[] {
  if (hit.kind !== 'face') return [];
  const out: CoplanarFace[] = [];
  others.forEach((ob, other) => {
    for (const side of ['min', 'max'] as const)
      if (Math.abs(ob[side][hit.axis] - hit.at) <= eps) out.push({ other, side });
  });
  return out.sort(
    (a, b) =>
      Number(b.other === hit.other && b.side === hit.side) -
      Number(a.other === hit.other && a.side === hit.side),
  );
}

/** A rectangle in the snapped plane: `lo` and `hi` corners, equal along the snap axis. */
export interface SnapQuad {
  axis: AxisIndex;
  lo: Vec3;
  hi: Vec3;
}

/**
 * Where to draw the feedback for a hit: every face on the snapped plane for a face snap,
 * the moved box's footprint on the floor for a floor snap, nothing for the grid.
 */
export function snapQuads(hit: SnapHit, moved: AABB, others: readonly AABB[]): SnapQuad[] {
  if (hit.kind === 'grid') return [];
  const quad = (src: AABB): SnapQuad => {
    const lo: Vec3 = [...src.min];
    const hi: Vec3 = [...src.max];
    lo[hit.axis] = hit.at;
    hi[hit.axis] = hit.at;
    return { axis: hit.axis, lo, hi };
  };
  if (hit.kind === 'floor') return [quad(moved)];
  return coplanarFaces(hit, others).map((f) => quad(others[f.other]!));
}
