/**
 * Parts that run into each other: two solids sharing space, not merely touching. The
 * test is exact for the solids the view draws (tilted boxes, angled ends and edges) by
 * the separating-axis theorem on their corners. A part sitting in another's dado,
 * groove, rabbet or notch is not an overlap. Reference stand-ins are left out: one placed
 * through the frame is a choice, not a mistake.
 * Pure; the store computes it once per change for the view, the status bar and the
 * Part panel.
 */
import { Quaternion, Vector3 } from 'three';
import { boxInFrame, worldCorners } from './frame';
import { cutBox, cutsOf, isReferencePart, partAABB, partDims, type AABB, type Part } from './model';

/** Two solids closer than this are touching, not overlapping: 1/32". */
export const OVERLAP_TOL = 1 / 32;

export interface OverlapPair {
  a: number;
  b: number;
  /** How deep one runs into the other, inches: the least move that would separate them. */
  depth: number;
}

export interface OverlapReport {
  pairs: OverlapPair[];
  /** Every part in a pair. */
  ids: Set<number>;
}

/** The faces of the eight-corner solid, corners indexed by bits 1 = +X, 2 = +Y, 4 = +Z. */
const FACES = [
  [0, 2, 6, 4],
  [1, 3, 7, 5],
  [0, 1, 5, 4],
  [2, 3, 7, 6],
  [0, 1, 3, 2],
  [4, 5, 7, 6],
];
/** The edges: corner pairs that differ in one bit. */
const EDGES: [number, number][] = [];
for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) EDGES.push([i, i | bit]);

const parallel = (a: Vector3, b: Vector3): boolean =>
  new Vector3().crossVectors(a, b).lengthSq() < 1e-9;

/** The directions the separating-axis test needs from one solid: its face normals and edge directions. */
function axesOf(c: Vector3[]): { normals: Vector3[]; edges: Vector3[] } {
  const normals: Vector3[] = [];
  for (const f of FACES) {
    // The quad's diagonals cross along its normal, however it is skewed by angled cuts.
    const n = new Vector3()
      .subVectors(c[f[2]!]!, c[f[0]!]!)
      .cross(new Vector3().subVectors(c[f[3]!]!, c[f[1]!]!));
    if (n.lengthSq() > 1e-12 && !normals.some((m) => parallel(m, n))) normals.push(n.normalize());
  }
  const edges: Vector3[] = [];
  for (const [i, j] of EDGES) {
    const e = new Vector3().subVectors(c[j]!, c[i]!);
    if (e.lengthSq() > 1e-12 && !edges.some((m) => parallel(m, e))) edges.push(e.normalize());
  }
  return { normals, edges };
}

/** The spread of corners along a direction. */
function span(c: Vector3[], axis: Vector3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of c) {
    const t = v.dot(axis);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return [lo, hi];
}

/**
 * How deep two convex eight-corner solids run into each other, or 0 when some plane
 * separates them (touching counts as separate within `tol`).
 */
export function penetration(a: Vector3[], b: Vector3[], tol = OVERLAP_TOL): number {
  const A = axesOf(a);
  const B = axesOf(b);
  const axes = [...A.normals, ...B.normals];
  for (const ea of A.edges)
    for (const eb of B.edges) {
      const x = new Vector3().crossVectors(ea, eb);
      if (x.lengthSq() > 1e-9) axes.push(x.normalize());
    }
  let depth = Infinity;
  for (const axis of axes) {
    const [a0, a1] = span(a, axis);
    const [b0, b1] = span(b, axis);
    const d = Math.min(a1 - b0, b1 - a0);
    if (d <= tol) return 0;
    depth = Math.min(depth, d);
  }
  return depth;
}

const _inv = new Quaternion();

/**
 * Whether `other` sits inside a pocket cut into `host`: the part of `other` within the
 * host's box lies in one of its dados, grooves, rabbets or notches. A chamfer is no
 * pocket. Judged on the other part's box in the host's frame.
 */
function inCut(host: Part, other: Part, tol: number): boolean {
  const cuts = cutsOf(host).filter((c) => c.kind !== 'chamfer');
  if (!cuts.length) return false;
  const d = partDims(host);
  const at = new Vector3().fromArray(host.pos).applyQuaternion(_inv.fromArray(host.q).invert());
  const o = boxInFrame(other, host.q);
  const min: number[] = [];
  const max: number[] = [];
  for (const i of [0, 1, 2] as const) {
    min[i] = Math.max(o.min[i] - at.getComponent(i), -d[i] / 2);
    max[i] = Math.min(o.max[i] - at.getComponent(i), d[i] / 2);
    if (max[i] - min[i] <= tol) return true; // only touching the host's box
  }
  const within = (box: AABB) =>
    ([0, 1, 2] as const).every((i) => min[i]! >= box.min[i] - tol && max[i]! <= box.max[i] + tol);
  return cuts.some((c) => {
    const box = cutBox(c, d);
    return box !== null && within(box);
  });
}

const boxesMeet = (a: AABB, b: AABB, tol: number): boolean =>
  ([0, 1, 2] as const).every(
    (i) => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]) > tol,
  );

/** Every pair of parts that run into each other, reference stand-ins aside. */
export function findOverlaps(parts: readonly Part[], tol = OVERLAP_TOL): OverlapReport {
  const pairs: OverlapPair[] = [];
  const ids = new Set<number>();
  const boxes = parts.map(partAABB);
  const corners = new Map<number, Vector3[]>();
  const cornersOf = (i: number) => {
    let c = corners.get(i);
    if (!c) corners.set(i, (c = worldCorners(parts[i]!)));
    return c;
  };
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i]!;
      const b = parts[j]!;
      if (isReferencePart(a) || isReferencePart(b)) continue;
      if (!boxesMeet(boxes[i]!, boxes[j]!, tol)) continue;
      const depth = penetration(cornersOf(i), cornersOf(j), tol);
      if (!depth || inCut(a, b, tol) || inCut(b, a, tol)) continue;
      pairs.push({ a: a.id, b: b.id, depth });
      ids.add(a.id);
      ids.add(b.id);
    }
  return { pairs, ids };
}

/** The ids of the parts one part runs into. */
export function overlapsOf(report: OverlapReport, id: number): number[] {
  const out: number[] = [];
  for (const p of report.pairs) {
    if (p.a === id) out.push(p.b);
    else if (p.b === id) out.push(p.a);
  }
  return out;
}
