/**
 * Measuring between points. Every part is a box, so the points worth snapping to are
 * its corners, edge midpoints and face centres: 26 per part.
 */
import type { AABB, Vec3 } from './model';

/** The 8 corners, 12 edge midpoints and 6 face centres of a box. */
export function snapPoints(b: AABB): Vec3[] {
  const xs = [b.min[0], (b.min[0] + b.max[0]) / 2, b.max[0]];
  const ys = [b.min[1], (b.min[1] + b.max[1]) / 2, b.max[1]];
  const zs = [b.min[2], (b.min[2] + b.max[2]) / 2, b.max[2]];
  const out: Vec3[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) {
        const mids = (i === 1 ? 1 : 0) + (j === 1 ? 1 : 0) + (k === 1 ? 1 : 0);
        if (mids === 3) continue; // the centre of the box is not a snap target
        out.push([xs[i]!, ys[j]!, zs[k]!]);
      }
  return out;
}

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The candidate within `tol` of `target` that is nearest to it, or null. */
export function nearestSnap(candidates: readonly Vec3[], target: Vec3, tol: number): Vec3 | null {
  let best: Vec3 | null = null;
  let bestD = tol;
  for (const c of candidates) {
    const d = dist(c, target);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export interface Measurement {
  length: number;
  delta: Vec3;
}

export function measureBetween(a: Vec3, b: Vec3): Measurement {
  const delta: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  return { length: dist(a, b), delta };
}

/** `48 1/2"  ΔX 48"  ΔZ 3 1/2"` — only the axes that differ are listed. */
export function measureText(m: Measurement, fmt: (n: number) => string): string {
  const parts = [fmt(m.length)];
  const names = ['ΔX', 'ΔY', 'ΔZ'];
  const nonZero = m.delta.map((d, i) => [Math.abs(d), i] as const).filter(([d]) => d > 1e-6);
  // A measurement along one axis needs no breakdown.
  if (nonZero.length > 1) for (const [d, i] of nonZero) parts.push(`${names[i]} ${fmt(d)}`);
  return parts.join('  ');
}
