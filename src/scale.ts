/**
 * Resizing a part's length with the mouse: S scales it by how far the pointer moves from
 * the selection's centre on screen, as Blender's scale does, and an end handle pulls one
 * end while the other stays put. Pure numbers; the scene applies them.
 */
import { MIN_LEN, type AABB, type AxisIndex, type Vec3 } from './model';
import { snapWithHits, type SnapHit, type SnapOptions } from './snap';

export { MIN_LEN };

/** How much to scale by: the pointer's distance from the pivot now, over its distance at the start. */
export function scaleFactor(
  pivot: readonly [number, number],
  start: readonly [number, number],
  now: readonly [number, number],
): number {
  const d0 = Math.max(8, Math.hypot(start[0] - pivot[0], start[1] - pivot[1]));
  const d1 = Math.hypot(now[0] - pivot[0], now[1] - pivot[1]);
  return d1 / d0;
}

/** A length rounded to the grid (a sixteenth when the grid is off), never below the minimum. */
export function snapLength(len: number, grid: number): number {
  const step = grid > 0 ? grid : 1 / 16;
  return Math.max(MIN_LEN, Math.round(len / step) * step);
}

/**
 * Pull one end of a part: the +X end (`end` 1) or the -X end (-1) moves by `delta` along
 * the part's length direction, the other end stays. Returns the new length and how far
 * the part's centre moves along that direction, with the move clipped so the part keeps
 * its minimum length.
 */
export function pullEnd(
  startLen: number,
  end: 1 | -1,
  delta: number,
): { len: number; shift: number } {
  const len = Math.max(MIN_LEN, startLen + end * delta);
  const used = (len - startLen) * end;
  return { len, shift: used / 2 };
}

/**
 * Snap a moving end face to the faces of other parts (or the grid) along a world axis.
 * `slab` is the part's box squashed to the face; `delta` the proposed move of that face.
 */
export function snapEnd(
  slab: AABB,
  axis: AxisIndex,
  delta: number,
  others: readonly AABB[],
  opts: SnapOptions,
): { delta: number; hits: SnapHit[]; moved: AABB } {
  const d: Vec3 = [0, 0, 0];
  d[axis] = delta;
  const res = snapWithHits(slab, d, [axis], others, opts);
  const moved: AABB = {
    min: [slab.min[0] + res.delta[0], slab.min[1] + res.delta[1], slab.min[2] + res.delta[2]],
    max: [slab.max[0] + res.delta[0], slab.max[1] + res.delta[1], slab.max[2] + res.delta[2]],
  };
  return { delta: res.delta[axis], hits: res.hits, moved };
}
