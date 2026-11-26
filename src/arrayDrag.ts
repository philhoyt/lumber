/**
 * Array by dragging: pull copies out of a part toward the pointer. The drag distance
 * along an axis says how many copies fit at the spacing; a typed number is a count, a
 * typed length is a span to fill. Pure: the scene drives it.
 */
import { arrayLayout, type ArrayParams, type Axis, type AxisIndex, type Vec3 } from './model';
import { fmt, parseLen } from './units';

/** How many copies (the source included) a drag of `distance` makes at `step` apart. */
export function dragCount(step: number, distance: number): number {
  return Math.max(1, Math.floor(Math.abs(distance) / step + 1e-9) + 1);
}

/** The copies an array makes, source included. */
export function arrayCount(params: ArrayParams, extent: number): number {
  return arrayLayout(params, extent).count;
}

/**
 * The array a drag means: the spacing and mode of `base` along `axis`, as many copies as
 * fit in the distance, running the way the drag went. While dragging the count form keeps
 * the model stable between steps; the final form records the span filled, so the copies
 * follow a later change of spacing.
 */
export function arrayFromDrag(
  base: ArrayParams,
  axis: Axis,
  extent: number,
  distance: number,
  final: boolean,
): ArrayParams {
  const p: ArrayParams = { axis, mode: base.mode, spacing: base.spacing };
  if (base.local) p.local = true;
  if (distance < 0) p.reverse = true;
  if (final) p.fit = Math.round((Math.abs(distance) + extent) * 64) / 64;
  else p.count = dragCount(arrayLayout(p, extent).step, distance);
  return p;
}

/** A typed value during the drag: a whole number is a count, anything else a span. */
export function arrayFromTyped(
  base: ArrayParams,
  axis: Axis,
  text: string,
  reverse: boolean,
): ArrayParams | null {
  const p: ArrayParams = { axis, mode: base.mode, spacing: base.spacing };
  if (base.local) p.local = true;
  if (reverse) p.reverse = true;
  const t = text.trim();
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (n < 1) return null;
    p.count = n;
    return p;
  }
  const v = parseLen(t);
  if (v === null || v <= 0) return null;
  p.fit = v;
  return p;
}

/** The axis a free drag mostly moved along, among those it may use. */
export function dominantAxis(delta: Vec3, axes: readonly AxisIndex[]): AxisIndex {
  let best = axes[0] ?? 0;
  for (const a of axes) if (Math.abs(delta[a]) > Math.abs(delta[best])) best = a;
  return best;
}

/** The readout for an array: copies, spacing and the span they cover. */
export function arrayText(params: ArrayParams, extent: number): string {
  const { step, count } = arrayLayout(params, extent);
  const spacing =
    params.mode === 'gap' ? `${fmt(params.spacing)} gaps` : `${fmt(params.spacing)} o.c.`;
  return `${count} @ ${spacing} · spans ${fmt((count - 1) * step + extent)}`;
}

/** Whether two sets of parameters make the same array. */
export function sameArray(a: ArrayParams | null, b: ArrayParams | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
