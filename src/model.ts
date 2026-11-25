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
  /** In an array group: 0 for the source cell, 1.. for generated copies. */
  arrayIndex?: number;
  /**
   * Miter angles in degrees at the −X and +X ends, cut across the width (like a picture
   * frame or a rafter's plumb cut). 0 is square. Positive puts the short point on the +Y
   * edge, negative on the −Y edge. `len` stays the long-point length.
   */
  miter?: [number, number];
  /**
   * Sheet parts: which way the part's length must run relative to the sheet's grain,
   * which runs along a plywood sheet's long side. Unset means either way is fine.
   */
  grain?: Grain;
}

/** 'length': the part's length runs with the grain; 'width': across it; 'any': either. */
export type Grain = 'any' | 'length' | 'width';
export const GRAINS: Grain[] = ['any', 'length', 'width'];
export const grainOf = (p: Part): Grain => p.grain ?? 'any';

export const MAX_MITER = 75;

/** A part's miter angles, square when unset. */
export const miterOf = (p: Part): [number, number] => p.miter ?? [0, 0];
export const hasMiter = (p: Part): boolean => miterOf(p).some((a) => a !== 0);

/** Clamp and tidy a typed angle: whole or half degrees, within the limits. */
export function clampMiter(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return Math.max(-MAX_MITER, Math.min(MAX_MITER, Math.round(deg * 2) / 2)) || 0;
}

/** How much a miter takes off the short edge at one end, inches. */
export const miterSetback = (deg: number, width: number): number =>
  width * Math.tan((Math.abs(deg) * Math.PI) / 180);

/**
 * The outline of a mitered board's face in its local frame, counterclockwise from the
 * −X −Y corner: [x, y] pairs. A square end is two points at the same x.
 */
export function miterOutline(
  len: number,
  width: number,
  miter: [number, number],
): [number, number][] {
  const [a, b] = miter;
  const sa = miterSetback(a, width);
  const sb = miterSetback(b, width);
  const x0 = -len / 2;
  const x1 = len / 2;
  const y0 = -width / 2;
  const y1 = width / 2;
  return [
    [x0 + (a < 0 ? sa : 0), y0],
    [x1 - (b < 0 ? sb : 0), y0],
    [x1 - (b > 0 ? sb : 0), y1],
    [x0 + (a > 0 ? sa : 0), y1],
  ];
}

/**
 * The short-point length: the shorter of the two edges. With both short points on
 * the same edge that edge is shorter by both setbacks; on opposite edges (a
 * parallelogram) both edges lose one setback.
 */
export function shortLength(len: number, width: number, miter: [number, number]): number {
  const o = miterOutline(len, width, miter);
  const bottom = o[1]![0] - o[0]![0];
  const top = o[2]![0] - o[3]![0];
  return Math.min(bottom, top);
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

/**
 * An array modifier on a group: the group's source cell (its parts with `arrayIndex` 0)
 * is repeated along an axis. Copies are real parts, regenerated whenever the source or
 * these parameters change.
 */
export interface ArrayParams {
  axis: Axis;
  /** Either a fixed number of copies, or as many as fit in `fit` inches. */
  count?: number;
  fit?: number;
  /** Centre-to-centre distance, or the clear gap between copies. */
  spacing: number;
  mode: 'center' | 'gap';
}

/** An assembly of parts (and of other groups). A part belongs to at most one group. */
export interface Group {
  id: number;
  name: string;
  /** The enclosing group, for nested assemblies. */
  parent?: number;
  array?: ArrayParams;
}

/** The centre-to-centre step and the number of pieces an array produces. */
export function arrayLayout(a: ArrayParams, cellExtent: number): { step: number; count: number } {
  const step = Math.max(1 / 16, a.mode === 'gap' ? a.spacing + cellExtent : a.spacing);
  let count = a.count ?? 2;
  if (a.fit !== undefined) count = Math.floor((a.fit - cellExtent) / step + 1e-9) + 1;
  return { step, count: Math.max(1, Math.min(500, Math.floor(count))) };
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
