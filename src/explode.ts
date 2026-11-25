/**
 * The exploded view pulls parts apart so joints and hidden pieces can be seen. It is a
 * way of looking, not a change: every part is drawn displaced from the model's centre
 * along the line from that centre to its own, and the model underneath stays put.
 *
 * Assemblies hold together a little: a group moves as a unit away from the model's
 * centre, and its parts spread out from the group's centre at half the rate.
 */
import { aabbCenter, partAABB, unionAABB, type Part, type Vec3 } from './model';

/** The slider runs 0..1; at 1 a part moves this many times its distance from the centre. */
export const EXPLODE_MAX = 1.5;

/** How far parts inside a group spread, relative to how far groups move. */
const INNER = 0.5;

/**
 * The display offset of every part for an explode `amount` (0..1), keyed by part id.
 * `rootOf` names the top-level group a part belongs to, if any.
 */
export function explodeOffsets(
  parts: readonly Part[],
  rootOf: (p: Part) => number | undefined,
  amount: number,
): Map<number, Vec3> {
  const out = new Map<number, Vec3>();
  const k = Math.max(0, Math.min(1, amount)) * EXPLODE_MAX;
  if (!parts.length || k === 0) {
    for (const p of parts) out.set(p.id, [0, 0, 0]);
    return out;
  }
  const modelC = aabbCenter(unionAABB(parts));
  const byRoot = new Map<number, Part[]>();
  for (const p of parts) {
    const r = rootOf(p);
    if (r === undefined) continue;
    let list = byRoot.get(r);
    if (!list) byRoot.set(r, (list = []));
    list.push(p);
  }
  const rootC = new Map<number, Vec3>();
  for (const [r, list] of byRoot) rootC.set(r, aabbCenter(unionAABB(list)));
  for (const p of parts) {
    const c = aabbCenter(partAABB(p));
    const r = rootOf(p);
    const o: Vec3 = [0, 0, 0];
    for (const a of [0, 1, 2] as const) {
      if (r === undefined) o[a] = (c[a] - modelC[a]) * k;
      else {
        const gc = rootC.get(r)!;
        o[a] = (gc[a] - modelC[a]) * k + (c[a] - gc[a]) * k * INNER;
      }
      o[a] = Math.round(o[a] * 1e6) / 1e6 || 0;
    }
    out.set(p.id, o);
  }
  return out;
}

/** A part's bounds as drawn, shifted by its explode offset. */
export function offsetAABB(p: Part, o: Vec3): { min: Vec3; max: Vec3 } {
  const b = partAABB(p);
  return {
    min: [b.min[0] + o[0], b.min[1] + o[1], b.min[2] + o[2]],
    max: [b.max[0] + o[0], b.max[1] + o[1], b.max[2] + o[2]],
  };
}
