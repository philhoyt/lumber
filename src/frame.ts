/**
 * A part's own frame: its length along local X, width along Y, thickness along Z. Moving,
 * arraying and snapping along those axes is how a piece in a tilted panel slides up the
 * slope or lands flush with its neighbours. Pure geometry; the scene and store use it.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { boxGap } from './gap';
import {
  boxCorners,
  cleanQ,
  isSquare,
  localCorners,
  partDims,
  type AABB,
  type AxisIndex,
  type Part,
  type Quat,
  type Vec3,
  unionBoxes,
} from './model';

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

/** A part's corners in world space: the cut corners for a board with angled ends or edges. */
function worldCorners(p: Part): Vector3[] {
  const d = partDims(p);
  const q = new Quaternion().fromArray(p.q);
  return (localCorners(p, d) ?? boxCorners(d)).map((c) =>
    new Vector3().fromArray(c).applyQuaternion(q).add(_v.fromArray(p.pos)),
  );
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
  return unionBoxes(parts.map((p) => boxInFrame(p, q)));
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

/** Where a block between two parallel parts goes: its length, orientation and centre. */
export interface BlockFit {
  len: number;
  q: Quat;
  pos: Vec3;
}

/**
 * A piece of blocking between parts `a` and `b`, which must share a frame: `a`'s stock,
 * cut to the clear gap between them, its width along `a`'s width (so its faces are flush
 * with theirs) and its thickness along their length, at whichever end sits lower. Null
 * when the two are not parallel or have no gap.
 */
export function blockBetween(a: Part, b: Part): BlockFit | null {
  if (!isCoframed(a.q, b.q)) return null;
  const A = boxInFrame(a, a.q);
  const B = boxInFrame(b, a.q);
  const g = boxGap(A, B);
  if (g.axis === null) return null;
  const ga = g.axis;
  const [, w, t] = partDims(a);
  // The block's width runs along a's width unless the gap does; then along a's length.
  const widthAxis: AxisIndex = ga === 1 ? 0 : 1;
  const thickAxis = (3 - ga - widthAxis) as AxisIndex;
  const size: Vec3 = [0, 0, 0];
  size[ga] = Math.abs(g.to[ga] - g.from[ga]);
  size[widthAxis] = w;
  size[thickAxis] = t;
  // Block local X along the gap, local Y along its width, local Z a proper right-hand third.
  const unit = (k: AxisIndex) => new Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
  const ex = unit(ga);
  const ey = unit(widthAxis);
  const ez = ex.clone().cross(ey);
  const rel = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(ex, ey, ez));
  const q = cleanQ(new Quaternion().fromArray(a.q).multiply(rel));
  // Centre: mid-gap, centred on a's width, and at a's end along its length (unless the
  // gap runs that way), whichever end is lower in the world.
  const c: Vec3 = [0, 0, 0];
  c[ga] = (g.from[ga] + g.to[ga]) / 2;
  for (const k of [widthAxis, thickAxis]) c[k] = (A.min[k] + A.max[k]) / 2;
  if (ga !== 0) {
    const atMin: Vec3 = [...c];
    const atMax: Vec3 = [...c];
    atMin[0] = A.min[0] + size[0] / 2;
    atMax[0] = A.max[0] - size[0] / 2;
    const lower = fromFrame(a.q, atMin)[2] <= fromFrame(a.q, atMax)[2] ? atMin : atMax;
    c[0] = lower[0];
  }
  return { len: Math.round(size[ga] * 64) / 64, q, pos: fromFrame(a.q, c) };
}
