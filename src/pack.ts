/**
 * The cut list and the buy list. Boards pack by first-fit decreasing into purchase
 * lengths; sheets pack by shelves (rows of parts across the sheet). Both are simple on
 * purpose: good enough to buy the right amount, and easy to check by hand.
 */
import {
  cutsKey,
  cutsOf,
  grainOf,
  miterOf,
  shortLength,
  type Cut,
  type Grain,
  type Part,
} from './model';
import { getStock, stockById, stockWidth, type Stock } from './stock';
import { r32 } from './units';

export interface BoardItem {
  len: number;
  name: string;
}
export interface BoardBin {
  items: BoardItem[];
  /** Length consumed including kerfs. */
  used: number;
  /** The single item is longer than the purchase length. */
  over?: boolean;
}

export function packBoards(
  items: readonly BoardItem[],
  stockLen: number,
  kerf: number,
): BoardBin[] {
  const bins: BoardBin[] = [];
  const sorted = [...items].sort((a, b) => b.len - a.len);
  for (const it of sorted) {
    if (it.len > stockLen + 1e-9) {
      bins.push({ items: [it], used: it.len, over: true });
      continue;
    }
    let bin = bins.find(
      (b) => !b.over && b.used + (b.items.length ? kerf : 0) + it.len <= stockLen + 1e-9,
    );
    if (!bin) {
      bin = { items: [], used: 0 };
      bins.push(bin);
    }
    bin.used += (bin.items.length ? kerf : 0) + it.len;
    bin.items.push(it);
  }
  return bins;
}

/**
 * Pack into each purchase length on offer and keep the one that buys the least total
 * length; on a tie, the fewer pieces. Returns the chosen length with its bins.
 */
export function packBoardsAuto(
  items: readonly BoardItem[],
  lengths: readonly number[],
  kerf: number,
): { length: number; bins: BoardBin[] } {
  let best: { length: number; bins: BoardBin[] } | null = null;
  for (const L of lengths) {
    const bins = packBoards(items, L, kerf);
    const over = bins.filter((b) => b.over).length;
    const bought = bins.length * L;
    if (
      !best ||
      over < best.bins.filter((b) => b.over).length ||
      (over === best.bins.filter((b) => b.over).length &&
        (bought < best.bins.length * best.length ||
          (bought === best.bins.length * best.length && bins.length < best.bins.length)))
    )
      best = { length: L, bins };
  }
  return best ?? { length: lengths[0] ?? 96, bins: [] };
}

export interface SheetItem {
  w: number;
  l: number;
  name: string;
  /** How the part's length may run relative to the sheet's length. */
  grain?: Grain;
}
export interface PlacedItem extends SheetItem {
  /** Position along the sheet's length. */
  x: number;
  /** Position across the sheet's width. */
  y: number;
  /** Extent along the length (after any rotation). */
  a: number;
  /** Extent across the width. */
  b: number;
}
/** One saw cut on a sheet, in sheet coordinates (x along the length, y across the width). */
export interface SheetCut {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface SheetBin {
  items: PlacedItem[];
  /** The guillotine cuts in order: each runs edge to edge across the piece it splits. */
  cuts: SheetCut[];
  /** An item that does not fit on a sheet at all. */
  over?: SheetItem;
}

interface Free {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Working {
  free: Free[];
  items: PlacedItem[];
  cuts: SheetCut[];
  over?: SheetItem;
}

const EPS = 1e-9;

/** Orientations the grain allows, as [along the sheet length, across its width]. */
function orientations(it: SheetItem): [number, number][] {
  const along: [number, number] = [it.l, it.w]; // the part's length runs the sheet's long way
  const across: [number, number] = [it.w, it.l];
  const g = it.grain ?? 'any';
  if (g === 'length') return [along];
  if (g === 'width') return [across];
  return [along, across];
}

/**
 * Put one item on a sheet: the free rectangle and orientation with the least leftover on
 * the short side (best short side fit), then split the rectangle edge to edge the way
 * that keeps the larger remainder. Returns false when nothing fits.
 */
function place(sh: Working, it: SheetItem, kerf: number): boolean {
  let best: { i: number; a: number; b: number; score: [number, number] } | null = null;
  for (const [i, r] of sh.free.entries()) {
    for (const [a, b] of orientations(it)) {
      if (a > r.w + EPS || b > r.h + EPS) continue;
      const score: [number, number] = [Math.min(r.w - a, r.h - b), Math.max(r.w - a, r.h - b)];
      if (
        !best ||
        score[0] < best.score[0] ||
        (score[0] === best.score[0] && score[1] < best.score[1])
      )
        best = { i, a, b, score };
    }
  }
  if (!best) return false;
  const { i, a, b } = best;
  const r = sh.free[i]!;
  sh.free.splice(i, 1);
  sh.items.push({ ...it, x: r.x, y: r.y, a, b });
  const right = r.w - a - kerf; // room left along the length
  const top = r.h - b - kerf; // room left across the width
  // Split the whole rectangle either across its width (keeping a full-width strip above)
  // or along its length (keeping a full-height strip beside); keep the larger remainder.
  const splitAcross = top * r.w >= right * r.h;
  const pushFree = (f: Free) => {
    if (f.w > EPS && f.h > EPS) sh.free.push(f);
  };
  const cut = (x1: number, y1: number, x2: number, y2: number) => {
    if (Math.abs(x2 - x1) > EPS || Math.abs(y2 - y1) > EPS) sh.cuts.push({ x1, y1, x2, y2 });
  };
  if (splitAcross) {
    // First cut: across the piece at the top of the item (if anything is above it).
    if (top > EPS) cut(r.x, r.y + b + kerf / 2, r.x + r.w, r.y + b + kerf / 2);
    // Second: separate the item from what is beside it in its strip.
    if (right > EPS) cut(r.x + a + kerf / 2, r.y, r.x + a + kerf / 2, r.y + b);
    pushFree({ x: r.x + a + kerf, y: r.y, w: right, h: b });
    pushFree({ x: r.x, y: r.y + b + kerf, w: r.w, h: top });
  } else {
    if (right > EPS) cut(r.x + a + kerf / 2, r.y, r.x + a + kerf / 2, r.y + r.h);
    if (top > EPS) cut(r.x, r.y + b + kerf / 2, r.x + a, r.y + b + kerf / 2);
    pushFree({ x: r.x + a + kerf, y: r.y, w: right, h: r.h });
    pushFree({ x: r.x, y: r.y + b + kerf, w: a, h: top });
  }
  return true;
}

function packOnce(items: readonly SheetItem[], SW: number, SL: number, kerf: number): Working[] {
  const sheets: Working[] = [];
  for (const it of items) {
    if (!orientations(it).some(([a, b]) => a <= SL + EPS && b <= SW + EPS)) {
      sheets.push({ free: [], items: [], cuts: [], over: it });
      continue;
    }
    if (sheets.some((sh) => !sh.over && place(sh, it, kerf))) continue;
    const sh: Working = { free: [{ x: 0, y: 0, w: SL, h: SW }], items: [], cuts: [] };
    place(sh, it, kerf);
    sheets.push(sh);
  }
  return sheets;
}

const ORDERS: ((a: SheetItem, b: SheetItem) => number)[] = [
  (a, b) => b.w * b.l - a.w * a.l, // biggest first
  (a, b) => Math.max(b.w, b.l) - Math.max(a.w, a.l), // longest side first
  (a, b) => Math.min(b.w, b.l) - Math.min(a.w, a.l), // widest first
];

/**
 * Guillotine nesting: every cut runs edge to edge across the piece it splits, as on a
 * table saw or track saw. Three part orders are tried and the best kept: fewest sheets,
 * then the most free area left on the last sheet.
 */
export function packSheets(
  items: readonly SheetItem[],
  SW: number,
  SL: number,
  kerf: number,
): SheetBin[] {
  let best: Working[] | null = null;
  let bestKey: [number, number] | null = null;
  for (const order of ORDERS) {
    const result = packOnce([...items].sort(order), SW, SL, kerf);
    const last = [...result].reverse().find((sh) => !sh.over);
    const leftover = last ? last.free.reduce((sum, f) => sum + f.w * f.h, 0) : 0;
    const key: [number, number] = [result.length, -leftover];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = result;
      bestKey = key;
    }
  }
  return (best ?? []).map(({ items: its, cuts, over }) =>
    over ? { items: [], cuts: [], over } : { items: its, cuts },
  );
}

export interface CutRow {
  stock: Stock;
  /** Long-point length. */
  len: number;
  w: number;
  /** Miter angles at each end, 0/0 for square. */
  miter: [number, number];
  /** Sheet parts: how the length runs relative to the grain. */
  grain: Grain;
  /** Joinery on the part. */
  cuts: Cut[];
  /** Short-point length when mitered, else the length. */
  short: number;
  qty: number;
  names: string[];
}

const order = (s: Stock): number => {
  const i = getStock().indexOf(s);
  return i < 0 ? 1e9 : i;
};

/** Identical cuts grouped, ordered by stock then size, largest first. */
export function cutRows(parts: readonly Part[]): CutRow[] {
  const map = new Map<string, CutRow>();
  for (const p of parts) {
    const s = stockById(p.stock);
    const len = r32(p.len);
    const w = r32(stockWidth(s, p.w));
    const miter = miterOf(p);
    const grain: Grain = s.sheet && s.grain !== false ? grainOf(p) : 'any';
    const cuts = cutsOf(p);
    const key = `${p.stock}|${len}|${w}|${miter.join('/')}|${grain}|${cutsKey(cuts)}`;
    let r = map.get(key);
    if (!r) {
      r = {
        stock: s,
        len,
        w,
        miter,
        grain,
        cuts,
        short: r32(shortLength(len, w, miter)),
        qty: 0,
        names: [],
      };
      map.set(key, r);
    }
    r.qty++;
    r.names.push(p.name);
  }
  return [...map.values()].sort(
    (a, b) => order(a.stock) - order(b.stock) || b.len - a.len || b.w - a.w,
  );
}

/** Parts grouped by stock id, in stock library order. */
export function partsByStock(parts: readonly Part[]): Map<string, Part[]> {
  const by = new Map<string, Part[]>();
  for (const s of getStock()) {
    const list = parts.filter((p) => p.stock === s.id);
    if (list.length) by.set(s.id, list);
  }
  return by;
}
