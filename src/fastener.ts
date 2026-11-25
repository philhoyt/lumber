/**
 * Fastener markers: screws, pocket holes, nails, bolts and dowels drawn on a part's face.
 * They are attributes of the part they sit on, in its local frame, and count as hardware
 * in the buy list. Marking them is bookkeeping: they do not change the part's shape.
 */
import type { AxisIndex, Part, Vec3 } from './model';

export type FastenerKind = 'screw' | 'pocket' | 'nail' | 'bolt' | 'dowel';
export type Face = 'top' | 'bottom' | 'front' | 'back' | 'endA' | 'endB';

export interface Fastener {
  kind: FastenerKind;
  /** The face the marker sits on, in the part's local frame. */
  face: Face;
  /**
   * Where on that face, from its low corner: on the top and bottom faces [from end A,
   * from the front edge]; on the front and back [from end A, from the bottom]; on the
   * ends [from the front edge, from the bottom].
   */
  at: [number, number];
  /** What to buy, e.g. `#8 × 1 1/4"`. Unset means the kind's usual size. */
  size?: string;
}

export const FASTENER_KINDS: { id: FastenerKind; label: string; size: string }[] = [
  { id: 'screw', label: 'Screw', size: '#8 × 1 1/4"' },
  { id: 'pocket', label: 'Pocket screw', size: '1 1/4" pocket screw' },
  { id: 'nail', label: 'Nail', size: '2" brad' },
  { id: 'bolt', label: 'Bolt', size: '3/8" × 3" carriage bolt' },
  { id: 'dowel', label: 'Dowel', size: '3/8" × 1 1/2" dowel' },
];
export const FACES: { id: Face; label: string }[] = [
  { id: 'top', label: 'Top face' },
  { id: 'bottom', label: 'Bottom face' },
  { id: 'front', label: 'Front edge' },
  { id: 'back', label: 'Back edge' },
  { id: 'endA', label: 'End A' },
  { id: 'endB', label: 'End B' },
];

export const kindInfo = (k: FastenerKind) => FASTENER_KINDS.find((x) => x.id === k)!;
export const fastenersOf = (p: Part): Fastener[] => p.fasteners ?? [];
/** The size to buy: the marker's own, or the kind's usual one. */
export const sizeOf = (f: Fastener): string => f.size?.trim() || kindInfo(f.kind).size;

export const isFastenerKind = (k: unknown): k is FastenerKind =>
  FASTENER_KINDS.some((x) => x.id === k);
export const isFace = (f: unknown): f is Face => FACES.some((x) => x.id === f);

/** The two face axes (local axis indices) and the axis of the face normal with its sign. */
export function faceFrame(face: Face): { u: AxisIndex; v: AxisIndex; n: AxisIndex; sign: 1 | -1 } {
  switch (face) {
    case 'top':
      return { u: 0, v: 1, n: 2, sign: 1 };
    case 'bottom':
      return { u: 0, v: 1, n: 2, sign: -1 };
    case 'front':
      return { u: 0, v: 2, n: 1, sign: -1 };
    case 'back':
      return { u: 0, v: 2, n: 1, sign: 1 };
    case 'endA':
      return { u: 1, v: 2, n: 0, sign: -1 };
    case 'endB':
      return { u: 1, v: 2, n: 0, sign: 1 };
  }
}

/** The marker's point on the part's surface and its outward normal, in the local frame. */
export function fastenerLocal(f: Fastener, dims: Vec3): { point: Vec3; normal: Vec3 } {
  const { u, v, n, sign } = faceFrame(f.face);
  const point: Vec3 = [0, 0, 0];
  const normal: Vec3 = [0, 0, 0];
  point[u] = -dims[u] / 2 + f.at[0];
  point[v] = -dims[v] / 2 + f.at[1];
  point[n] = (sign * dims[n]) / 2;
  normal[n] = sign;
  return { point, normal };
}

/** The face a local surface normal points out of (its dominant axis). */
export function faceOfNormal(normal: Vec3): Face {
  const [x, y, z] = normal.map(Math.abs) as Vec3;
  if (z >= x && z >= y) return normal[2] >= 0 ? 'top' : 'bottom';
  if (y >= x) return normal[1] >= 0 ? 'back' : 'front';
  return normal[0] >= 0 ? 'endB' : 'endA';
}

/** A marker at a local surface point, snapped to `grid` along the face when given. */
export function fastenerAt(
  kind: FastenerKind,
  point: Vec3,
  normal: Vec3,
  dims: Vec3,
  grid = 0,
  size?: string,
): Fastener {
  const face = faceOfNormal(normal);
  const { u, v } = faceFrame(face);
  const snap = (x: number) => (grid > 0 ? Math.round(x / grid) * grid : x);
  const f: Fastener = {
    kind,
    face,
    at: [snap(point[u] + dims[u] / 2), snap(point[v] + dims[v] / 2)],
  };
  if (size?.trim()) f.size = size.trim();
  return clampFastener(f, dims);
}

/** Keep the marker on its face. */
export function clampFastener(f: Fastener, dims: Vec3): Fastener {
  const { u, v } = faceFrame(f.face);
  const c = (x: number, max: number) => Math.min(max, Math.max(0, Number.isFinite(x) ? x : 0));
  return { ...f, at: [c(f.at[0], dims[u]), c(f.at[1], dims[v])] };
}

/** A marker flipped end for end (local X), front for back (Y) or top for bottom (Z). */
export function mirrorFastener(f: Fastener, local: AxisIndex, dims: Vec3): Fastener {
  const swap: Record<AxisIndex, [Face, Face]> = {
    0: ['endA', 'endB'],
    1: ['front', 'back'],
    2: ['top', 'bottom'],
  };
  const [a, b] = swap[local];
  const face: Face = f.face === a ? b : f.face === b ? a : f.face;
  const { u, v } = faceFrame(face);
  const at: [number, number] = [...f.at];
  if (u === local) at[0] = dims[u] - at[0];
  if (v === local) at[1] = dims[v] - at[1];
  return { ...f, face, at };
}

export const faceLabel = (face: Face): string => FACES.find((x) => x.id === face)!.label;

/** `screw #8 × 1 1/4" on the top face, 12 from A, 1 3/4 from front` */
export function describeFastener(f: Fastener, fmt: (n: number) => string): string {
  const { u, v } = faceFrame(f.face);
  const from = (axis: AxisIndex) => (axis === 0 ? 'from A' : axis === 1 ? 'from front' : 'up');
  const where = faceLabel(f.face).replace(/^(\w)/, (c) => c.toLowerCase());
  return `${kindInfo(f.kind).label.toLowerCase()} ${sizeOf(f)} on the ${where}, ${fmt(f.at[0])} ${from(u)}, ${fmt(f.at[1])} ${from(v)}`;
}

export interface HardwareRow {
  kind: FastenerKind;
  size: string;
  qty: number;
  /** Which parts carry them, with counts: `Leg LF ×4`. */
  names: string[];
}

/** Hardware totals for the buy list, grouped by kind and size. */
export function hardwareRows(parts: readonly Part[]): HardwareRow[] {
  const rows = new Map<string, HardwareRow & { per: Map<string, number> }>();
  for (const p of parts)
    for (const f of fastenersOf(p)) {
      const size = sizeOf(f);
      const key = `${f.kind}|${size}`;
      let r = rows.get(key);
      if (!r) {
        r = { kind: f.kind, size, qty: 0, names: [], per: new Map() };
        rows.set(key, r);
      }
      r.qty++;
      r.per.set(p.name, (r.per.get(p.name) ?? 0) + 1);
    }
  const order = FASTENER_KINDS.map((k) => k.id);
  return [...rows.values()]
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.size.localeCompare(b.size))
    .map(({ per, ...r }) => ({
      ...r,
      names: [...per].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)),
    }));
}

/** A stable key so the scene knows when a part's markers changed. */
export const fastenersKey = (list: readonly Fastener[]): string =>
  list.map((f) => `${f.kind}:${f.face}:${f.at[0]},${f.at[1]}:${f.size ?? ''}`).join(';');
