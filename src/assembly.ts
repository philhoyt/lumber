/**
 * Assembly steps: the order the parts go together. A part's `step` is a 1-based number;
 * parts without one form a final, unnumbered step. Walking the steps shows the parts up
 * to the current one in place and the rest pulled away, like the exploded view
 * collapsing a step at a time. Pure: the scene draws it.
 */
import { explodeOffsets } from './explode';
import type { Part, Vec3 } from './model';

/** How far pending parts sit away while stepping, on the exploded view's 0..1 scale. */
export const PENDING_EXPLODE = 0.6;

/** The highest numbered step, 0 when no part has one. */
export function lastStep(parts: readonly Part[]): number {
  let n = 0;
  for (const p of parts) if (p.step !== undefined && p.step > n) n = p.step;
  return n;
}

/** How many steps there are: the numbered ones, plus one for any unnumbered parts. */
export function stepCount(parts: readonly Part[]): number {
  const last = lastStep(parts);
  return last + (parts.some((p) => p.step === undefined) ? 1 : 0);
}

/** The step a part belongs to: its own, or the one after the last numbered step. */
export function effectiveStep(p: Part, parts: readonly Part[]): number {
  return p.step ?? lastStep(parts) + 1;
}

/** Where every part stands at step `k`. */
export function stepState(
  parts: readonly Part[],
  k: number,
): { inPlace: Part[]; current: Part[]; pending: Part[] } {
  const last = lastStep(parts);
  const inPlace: Part[] = [];
  const current: Part[] = [];
  const pending: Part[] = [];
  for (const p of parts) {
    const s = p.step ?? last + 1;
    if (s < k) inPlace.push(p);
    else if (s === k) current.push(p);
    else pending.push(p);
  }
  return { inPlace, current, pending };
}

/**
 * Display offsets at step `k`: parts up to the step stay put, the rest sit where the
 * exploded view would put them. `rootOf` names a part's top-level group, as for explode.
 */
export function assemblyOffsets(
  parts: readonly Part[],
  rootOf: (p: Part) => number | undefined,
  k: number,
): Map<number, Vec3> {
  const out = explodeOffsets(parts, rootOf, PENDING_EXPLODE);
  const last = lastStep(parts);
  for (const p of parts) if ((p.step ?? last + 1) <= k) out.set(p.id, [0, 0, 0]);
  return out;
}

/** Keep a step number sensible: a whole number from 1 up, or none. */
export function normalizeStep(v: number | null | undefined): number | undefined {
  if (v === null || v === undefined || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  return n >= 1 ? n : undefined;
}

/** A one-line title for a step: its number, and what goes on in it. */
export function stepTitle(parts: readonly Part[], k: number): string {
  const n = stepCount(parts);
  const { current } = stepState(parts, k);
  const names = current.map((p) => p.name);
  const what =
    names.length === 0
      ? 'nothing to add'
      : names.length <= 4
        ? names.join(', ')
        : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  const unnumbered = k > lastStep(parts) && current.some((p) => p.step === undefined);
  return `Step ${k} of ${n}${unnumbered ? ' (unnumbered)' : ''}: ${what}`;
}
