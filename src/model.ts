/**
 * The model: a list of parts, each a piece of stock cut to size and placed in the
 * world. A part's local frame has its length along X, its width along Y and its
 * thickness along Z. Rotations are always multiples of 90° about world axes, so an
 * axis-aligned bounding box describes a part exactly.
 */
import { Quaternion, Vector3 } from 'three';
import { stockById, stockWidth } from './stock';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Axis = 'x' | 'y' | 'z';
export const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

export interface Part {
  id: number;
  /** Stock id, see stock.ts. */
  stock: string;
  /** Cut length, inches (along local X). */
  len: number;
  /** Cut width, inches. Sheet parts only. */
  w?: number;
  /** Centre of the part in world space. */
  pos: Vec3;
  /** Orientation as a quaternion [x, y, z, w]. */
  q: Quat;
  name: string;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

const AX: Record<Axis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};

/** A quarter turn about a world axis. */
export function rot90(axis: Axis): Quaternion {
  return new Quaternion().setFromAxisAngle(AX[axis], Math.PI / 2);
}

/** Compose quarter turns in order, each about a world axis. */
export function makeQ(seq: Axis[]): Quat {
  let q = new Quaternion();
  for (const a of seq) q = rot90(a).multiply(q);
  return q.toArray() as Quat;
}

/** Lying flat: length along X, width along Z, thickness up. */
export const DEFAULT_Q: Quat = makeQ(['x']);

/** Size of the part in its local frame: [length, width, thickness]. */
export function partDims(p: Part): Vec3 {
  const s = stockById(p.stock);
  return [p.len, stockWidth(s, p.w), s.t];
}

const _v = new Vector3();
const _q = new Quaternion();

export function partAABB(p: Part): AABB {
  const d = partDims(p);
  _q.fromArray(p.q);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    _v.set(
      ((i & 1 ? 1 : -1) * d[0]) / 2,
      ((i & 2 ? 1 : -1) * d[1]) / 2,
      ((i & 4 ? 1 : -1) * d[2]) / 2,
    ).applyQuaternion(_q);
    const c = [_v.x + p.pos[0], _v.y + p.pos[1], _v.z + p.pos[2]] as Vec3;
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, c[a]!);
      max[a] = Math.max(max[a]!, c[a]!);
    }
  }
  // Quarter turns are exact in principle; strip the float noise they leave behind.
  for (let a = 0; a < 3; a++) {
    min[a] = Math.round(min[a]! * 1e6) / 1e6 || 0; // `|| 0` turns -0 into 0
    max[a] = Math.round(max[a]! * 1e6) / 1e6 || 0;
  }
  return { min, max };
}

export function unionAABB(list: readonly Part[]): AABB {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of list) {
    const b = partAABB(p);
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, b.min[a]!);
      max[a] = Math.max(max[a]!, b.max[a]!);
    }
  }
  return { min, max };
}

export const aabbSize = (b: AABB): Vec3 => [
  b.max[0] - b.min[0],
  b.max[1] - b.min[1],
  b.max[2] - b.min[2],
];

export const partName = (stockId: string, id: number): string => `${stockById(stockId).name} ${id}`;

/** A new full-length piece of stock lying flat on the ground, centred on `at` (x, z). */
export function createPart(id: number, stockId: string, at: Vec3): Part {
  const s = stockById(stockId);
  const p: Part = {
    id,
    stock: stockId,
    len: s.sheet ? s.sheet[1] : (s.lengths?.[0] ?? 96),
    w: s.sheet ? s.sheet[0] : undefined,
    pos: [0, 0, 0],
    q: [...DEFAULT_Q] as Quat,
    name: partName(stockId, id),
  };
  const b = partAABB(p);
  p.pos = [at[0] - (b.min[0] + b.max[0]) / 2, -b.min[1], at[2] - (b.min[2] + b.max[2]) / 2];
  return p;
}

/** Apply a change to a part while keeping its bounding box's min corner where it was. */
export function withMinKept(p: Part, change: (p: Part) => void): void {
  const b0 = partAABB(p);
  change(p);
  const b1 = partAABB(p);
  for (let a = 0; a < 3; a++) p.pos[a]! += b0.min[a]! - b1.min[a]!;
}

/** Rotate parts together a quarter turn about their shared centre, keeping them at the same floor height. */
export function rotateParts(list: Part[], axis: Axis): void {
  if (!list.length) return;
  const u = unionAABB(list);
  const c = new Vector3(
    (u.min[0] + u.max[0]) / 2,
    (u.min[1] + u.max[1]) / 2,
    (u.min[2] + u.max[2]) / 2,
  );
  const R = rot90(axis);
  for (const p of list) {
    const v = new Vector3().fromArray(p.pos).sub(c).applyQuaternion(R).add(c);
    p.pos = v.toArray() as Vec3;
    p.q = R.clone().multiply(new Quaternion().fromArray(p.q)).toArray() as Quat;
  }
  const u2 = unionAABB(list);
  const dy = u.min[1] - u2.min[1];
  for (const p of list) p.pos[1] += dy;
}

export function clonePart(p: Part, id: number, offset: Vec3): Part {
  return {
    ...p,
    id,
    name: partName(p.stock, id),
    pos: [p.pos[0] + offset[0], p.pos[1] + offset[1], p.pos[2] + offset[2]],
    q: [...p.q] as Quat,
  };
}

export function translateParts(list: Part[], d: Vec3): void {
  for (const p of list) {
    p.pos[0] += d[0];
    p.pos[1] += d[1];
    p.pos[2] += d[2];
  }
}
