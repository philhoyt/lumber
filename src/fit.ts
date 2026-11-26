/**
 * Cut an end to meet what it points at. A tilted stud, a kicker or a brace runs into a
 * flat part or the floor; the end needs a miter, a bevel or both so its face lies flat on
 * that surface, and its long point should just touch. This finds the surface along the
 * part's length, works out the angles in the part's own frame, and says how much to
 * lengthen or trim so the long point lands on it.
 */
import { Quaternion, Vector3 } from 'three';
import { bevelOf, clampMiter, miterOf, partDims, MIN_LEN, type Part, type Vec3 } from './model';

export interface EndFit {
  /** What the end meets: a part's name, or "the floor". */
  target: string;
  /** Face angles for that end, degrees, in the model's sign convention. */
  miter: number;
  bevel: number;
  /** How much to lengthen (or trim, negative) so the long point touches, inches. */
  extend: number;
}

/** A surface the end could meet: a point on it and its outward normal. */
interface Surface {
  name: string;
  t: number;
  point: Vector3;
  normal: Vector3;
}

/** Where a ray enters an axis-aligned box, with the face it enters through. */
function enterBox(
  origin: Vector3,
  dir: Vector3,
  min: Vec3,
  max: Vec3,
): { t: number; axis: 0 | 1 | 2; side: 1 | -1 } | null {
  let tEnter = -Infinity;
  let tExit = Infinity;
  let axis: 0 | 1 | 2 = 0;
  let side: 1 | -1 = 1;
  for (const a of [0, 1, 2] as const) {
    const d = dir.getComponent(a);
    const o = origin.getComponent(a);
    if (Math.abs(d) < 1e-9) {
      if (o < min[a] || o > max[a]) return null;
      continue;
    }
    // Moving along +a we enter through the min face, whose outward normal is -a.
    const near = d > 0 ? min[a] : max[a];
    const far = d > 0 ? max[a] : min[a];
    const t0 = (near - o) / d;
    const t1 = (far - o) / d;
    if (t0 > tEnter) {
      tEnter = t0;
      axis = a;
      side = d > 0 ? -1 : 1;
    }
    if (t1 < tExit) tExit = t1;
  }
  if (tEnter > tExit) return null;
  return { t: tEnter, axis, side };
}

/** How far an end looks for something to meet, in inches. */
export const FIT_REACH = 24;

/**
 * The surface the given end (0 for A, 1 for B) points at, within `reach` inches: the
 * nearest square part's face or the floor, allowing the end to be a little inside already.
 */
export function endTarget(
  p: Part,
  end: 0 | 1,
  others: readonly Part[],
  reach = FIT_REACH,
): Surface | null {
  const q = new Quaternion().fromArray(p.q);
  const dir = new Vector3(end ? 1 : -1, 0, 0).applyQuaternion(q);
  const centre = new Vector3().fromArray(p.pos).addScaledVector(dir, p.len / 2);
  const slack = -Math.min(6, p.len / 4);
  let best: Surface | null = null;
  const consider = (s: Surface) => {
    if (s.t < slack || s.t > reach) return;
    if (!best || s.t < best.t) best = s;
  };
  if (dir.z < -1e-6) {
    const t = -centre.z / dir.z;
    consider({
      name: 'the floor',
      t,
      point: centre.clone().addScaledVector(dir, t),
      normal: new Vector3(0, 0, 1),
    });
  }
  for (const o of others) {
    if (o.hidden) continue;
    // Look at the other part in its own frame, where it is a plain box, so a leaning
    // panel's face is as good a target as a square part's.
    const oq = new Quaternion().fromArray(o.q);
    const inv = oq.clone().invert();
    const opos = new Vector3().fromArray(o.pos);
    const localOrigin = centre.clone().sub(opos).applyQuaternion(inv);
    const localDir = dir.clone().applyQuaternion(inv);
    const [L, W, T] = partDims(o);
    const hit = enterBox(localOrigin, localDir, [-L / 2, -W / 2, -T / 2], [L / 2, W / 2, T / 2]);
    if (!hit) continue;
    const normal = new Vector3();
    normal.setComponent(hit.axis, hit.side);
    normal.applyQuaternion(oq);
    consider({
      name: o.name,
      t: hit.t,
      point: centre.clone().addScaledVector(dir, hit.t),
      normal,
    });
  }
  return best;
}

/** The angles and length change that lay the end flat on what it points at, or null. */
export function fitEnd(
  p: Part,
  end: 0 | 1,
  others: readonly Part[],
  reach = FIT_REACH,
): EndFit | null {
  const s = endTarget(p, end, others, reach);
  if (!s) return null;
  const q = new Quaternion().fromArray(p.q);
  const inv = q.clone().invert();
  // The end face must point into the surface: its outward normal is the surface's, reversed.
  const n = s.normal.clone().negate().applyQuaternion(inv);
  const nx = Math.abs(n.x);
  if (nx < Math.cos((75 * Math.PI) / 180)) return null; // steeper than any saw cuts
  const miter = clampMiter((Math.atan(n.y / nx) * 180) / Math.PI);
  const bevel = clampMiter((Math.atan(n.z / nx) * 180) / Math.PI);
  // The long point of that end, in the part's frame, with the new angles.
  const [len, w, t] = partDims(p);
  const lp = new Vector3(
    (end ? 1 : -1) * (len / 2),
    miter ? (-Math.sign(miter) * w) / 2 : 0,
    bevel ? (-Math.sign(bevel) * t) / 2 : 0,
  )
    .applyQuaternion(q)
    .add(new Vector3().fromArray(p.pos));
  const dir = new Vector3(end ? 1 : -1, 0, 0).applyQuaternion(q);
  const denom = s.normal.dot(dir);
  const extend = Math.abs(denom) < 1e-9 ? 0 : s.normal.dot(s.point.clone().sub(lp)) / denom;
  return { target: s.name, miter, bevel, extend: Math.round(extend * 64) / 64 || 0 };
}

/** Apply a fit to the part: set that end's angles and move its long point onto the surface. */
export function applyFit(p: Part, end: 0 | 1, fit: EndFit): void {
  const m = miterOf(p);
  const b = bevelOf(p);
  m[end] = fit.miter;
  b[end] = fit.bevel;
  if (m[0] === 0 && m[1] === 0) delete p.miter;
  else p.miter = m;
  if (b[0] === 0 && b[1] === 0) delete p.bevel;
  else p.bevel = b;
  const extend = Math.max(MIN_LEN - p.len, fit.extend);
  if (!extend) return;
  const dir = new Vector3(end ? 1 : -1, 0, 0).applyQuaternion(new Quaternion().fromArray(p.q));
  p.len += extend;
  p.pos = [
    p.pos[0] + (dir.x * extend) / 2,
    p.pos[1] + (dir.y * extend) / 2,
    p.pos[2] + (dir.z * extend) / 2,
  ];
}
