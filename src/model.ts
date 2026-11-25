/**
 * The model: a list of parts, each a piece of stock cut to size and placed in the
 * world. The world is Z-up, like Blender: X runs left-right, Y runs front-back (−Y is
 * the front), Z is up. A part's local frame has its length along X, its width along Y
 * and its thickness along Z, so a part with no rotation lies flat on the floor.
 * Rotations are always multiples of 90° about world axes, so an axis-aligned bounding
 * box describes a part exactly.
 */
import { Quaternion, Vector3 } from 'three';
import { stockById, stockWidth } from './stock';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Axis = 'x' | 'y' | 'z';
export type AxisIndex = 0 | 1 | 2;
export const AXIS_INDEX: Record<Axis, AxisIndex> = { x: 0, y: 1, z: 2 };
/** The up axis index. */
export const UP: AxisIndex = 2;

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
  /** Hidden parts are not drawn or picked but stay in the cut list. */
  hidden?: boolean;
  /** The group this part belongs to, if any. */
  group?: number;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

/** An assembly of parts (and of other groups). A part belongs to at most one group. */
export interface Group {
  id: number;
  name: string;
  /** The enclosing group, for nested assemblies. */
  parent?: number;
}

const AX: Record<Axis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};
export const AXIS_NAMES: Axis[] = ['x', 'y', 'z'];

/** A quarter turn about a world axis. */
export function rot90(axis: Axis, turns = 1): Quaternion {
  return new Quaternion().setFromAxisAngle(AX[axis], (turns * Math.PI) / 2);
}

/** Compose quarter turns in order, each about a world axis. */
export function makeQ(seq: Axis[]): Quat {
  let q = new Quaternion();
  for (const a of seq) q = rot90(a).multiply(q);
  return q.toArray() as Quat;
}

/** Lying flat: length along X, width along Y, thickness up. */
export const DEFAULT_Q: Quat = [0, 0, 0, 1];

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
    const c: Vec3 = [_v.x + p.pos[0], _v.y + p.pos[1], _v.z + p.pos[2]];
    for (const a of [0, 1, 2] as const) {
      min[a] = Math.min(min[a], c[a]);
      max[a] = Math.max(max[a], c[a]);
    }
  }
  // Quarter turns are exact in principle; strip the float noise they leave behind.
  for (const a of [0, 1, 2] as const) {
    min[a] = Math.round(min[a] * 1e6) / 1e6 || 0; // `|| 0` turns -0 into 0
    max[a] = Math.round(max[a] * 1e6) / 1e6 || 0;
  }
  return { min, max };
}

export function unionAABB(list: readonly Part[]): AABB {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of list) {
    const b = partAABB(p);
    for (const a of [0, 1, 2] as const) {
      min[a] = Math.min(min[a], b.min[a]);
      max[a] = Math.max(max[a], b.max[a]);
    }
  }
  return { min, max };
}

export const aabbSize = (b: AABB): Vec3 => [
  b.max[0] - b.min[0],
  b.max[1] - b.min[1],
  b.max[2] - b.min[2],
];
export const aabbCenter = (b: AABB): Vec3 => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2,
];

export const partName = (stockId: string, id: number): string => `${stockById(stockId).name} ${id}`;

/** A new full-length piece of stock lying flat on the floor, centred on `at` (x, y). */
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
  p.pos = [at[0] - (b.min[0] + b.max[0]) / 2, at[1] - (b.min[1] + b.max[1]) / 2, -b.min[UP]];
  return p;
}

/** Apply a change to a part while keeping its bounding box's min corner where it was. */
export function withMinKept(p: Part, change: (p: Part) => void): void {
  const b0 = partAABB(p);
  change(p);
  const b1 = partAABB(p);
  for (const a of [0, 1, 2] as const) p.pos[a] += b0.min[a] - b1.min[a];
}

/** Rotate parts together a quarter turn about their shared centre, keeping them at the same floor height. */
export function rotateParts(list: Part[], axis: Axis, turns = 1): void {
  if (!list.length) return;
  const u = unionAABB(list);
  const c = new Vector3().fromArray(aabbCenter(u));
  const R = rot90(axis, turns);
  for (const p of list) {
    const v = new Vector3().fromArray(p.pos).sub(c).applyQuaternion(R).add(c);
    p.pos = v.toArray() as Vec3;
    p.q = R.clone().multiply(new Quaternion().fromArray(p.q)).toArray() as Quat;
  }
  const u2 = unionAABB(list);
  const dz = u.min[UP] - u2.min[UP];
  for (const p of list) p.pos[UP] += dz;
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

export type AlignMode = 'min' | 'center' | 'max';

/** Line the parts up on one axis against the selection's own bounds: flush low, centred, or flush high. */
export function alignParts(list: Part[], axis: AxisIndex, mode: AlignMode): void {
  if (list.length < 2) return;
  const u = unionAABB(list);
  for (const p of list) {
    const b = partAABB(p);
    let d: number;
    if (mode === 'min') d = u.min[axis] - b.min[axis];
    else if (mode === 'max') d = u.max[axis] - b.max[axis];
    else d = (u.min[axis] + u.max[axis]) / 2 - (b.min[axis] + b.max[axis]) / 2;
    p.pos[axis] += d;
  }
}

const overlapsInPlan = (a: AABB, b: AABB): boolean =>
  a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[1] < b.max[1] && a.max[1] > b.min[1];

/**
 * How far down the parts must move to rest on whatever is under them: the highest top
 * face among `others` that lies beneath their footprint, or the floor. Zero when they
 * already rest on something; never positive.
 */
export function dropDistance(list: readonly Part[], others: readonly Part[]): number {
  if (!list.length) return 0;
  const u = unionAABB(list);
  let floor = 0;
  for (const o of others) {
    const b = partAABB(o);
    if (b.max[UP] <= u.min[UP] + 1e-6 && overlapsInPlan(u, b)) floor = Math.max(floor, b.max[UP]);
  }
  return Math.min(0, floor - u.min[UP]);
}

/**
 * Convert parts saved by the Y-up versions of Lumber (file version 1) to Z-up: the
 * whole model turns a quarter turn about X, so the old up (Y) becomes Z.
 */
export function migrateFromYUp(parts: Part[]): Part[] {
  const R = rot90('x');
  return parts.map((p) => ({
    ...p,
    pos: [p.pos[0], -p.pos[2] || 0, p.pos[1]],
    q: R.clone().multiply(new Quaternion().fromArray(p.q)).toArray() as Quat,
  }));
}
