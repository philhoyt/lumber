/**
 * A part's own frame: its length along local X, width along Y, thickness along Z. Moving,
 * arraying and snapping along those axes is how a piece in a tilted panel slides up the
 * slope or lands flush with its neighbours. Pure geometry; the scene and store use it.
 */
import { Quaternion, Vector3 } from 'three';
import {
  bevelOf,
  endCutCorners,
  hasEndCut,
  isSquare,
  miterOf,
  partDims,
  type AABB,
  type AxisIndex,
  type Part,
  type Quat,
  type Vec3,
} from './model';
import { stockById } from './stock';

const _q = new Quaternion();
const _inv = new Quaternion();
const _v = new Vector3();

/** The world direction of a frame's local axis. */
export function localAxisDir(q: Quat, axis: AxisIndex): Vector3 {
  return new Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0).applyQuaternion(
    _q.fromArray(q),
  );
}

/** Whether two orientations share their axes (each axis of one lies along an axis of the other). */
export function isCoframed(a: Quat, b: Quat, eps = 1e-6): boolean {
  const rel = _inv.fromArray(a).invert().multiply(_q.fromArray(b));
  return isSquare(rel.toArray(), eps);
}

/** A part's corners in world space: the cut corners for a mitered or beveled board. */
function worldCorners(p: Part): Vector3[] {
  const d = partDims(p);
  const cut = hasEndCut(p) && !stockById(p.stock).sheet;
  const corners = cut ? endCutCorners(d, miterOf(p), bevelOf(p)) : null;
  const q = new Quaternion().fromArray(p.q);
  const out: Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    const v = corners
      ? new Vector3().fromArray(corners[i]!)
      : new Vector3(
          ((i & 1 ? 1 : -1) * d[0]) / 2,
          ((i & 2 ? 1 : -1) * d[1]) / 2,
          ((i & 4 ? 1 : -1) * d[2]) / 2,
        );
    out.push(v.applyQuaternion(q).add(_v.fromArray(p.pos)));
  }
  return out;
}

/** A part's bounding box in the coordinates of frame `q` (origin at the world origin). */
export function boxInFrame(p: Part, q: Quat): AABB {
  const inv = new Quaternion().fromArray(q).invert();
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of worldCorners(p)) {
    c.applyQuaternion(inv);
    for (const a of [0, 1, 2] as const) {
      min[a] = Math.min(min[a], c.getComponent(a));
      max[a] = Math.max(max[a], c.getComponent(a));
    }
  }
  return { min, max };
}

/** The union of parts' boxes in frame `q`. */
export function unionInFrame(parts: readonly Part[], q: Quat): AABB {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const b = boxInFrame(p, q);
    for (const a of [0, 1, 2] as const) {
      min[a] = Math.min(min[a], b.min[a]);
      max[a] = Math.max(max[a], b.max[a]);
    }
  }
  return { min, max };
}

/** How far parts extend along a world direction: the spread of their corners on it. */
export function extentAlong(parts: readonly Part[], dir: Vector3): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of parts)
    for (const c of worldCorners(p)) {
      const t = c.dot(dir);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  return parts.length ? hi - lo : 0;
}

/** Frame coordinates back to a world point. */
export function fromFrame(q: Quat, v: Vec3): Vec3 {
  return new Vector3().fromArray(v).applyQuaternion(_q.fromArray(q)).toArray();
}

/** The other parts that share a frame, as boxes in it, with their names: what a local move snaps to. */
export function coframedBoxes(
  others: readonly Part[],
  frame: Quat,
): { boxes: AABB[]; names: string[] } {
  const boxes: AABB[] = [];
  const names: string[] = [];
  for (const o of others)
    if (isCoframed(frame, o.q)) {
      boxes.push(boxInFrame(o, frame));
      names.push(o.name);
    }
  return { boxes, names };
}
