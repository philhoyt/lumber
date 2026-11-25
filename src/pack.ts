/**
 * The cut list and the buy list. Boards pack by first-fit decreasing into purchase
 * lengths; sheets pack by shelves (rows of parts across the sheet). Both are simple on
 * purpose: good enough to buy the right amount, and easy to check by hand.
 */
import { miterOf, shortLength, type Part } from './model';
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

export interface SheetItem {
  w: number;
  l: number;
  name: string;
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
export interface Shelf {
  y: number;
  h: number;
  /** Next free x. */
  x: number;
  items: PlacedItem[];
}
export interface SheetBin {
  shelves: Shelf[];
  /** An item that does not fit on a sheet at all. */
  over?: SheetItem;
}

/** Shelf packing. Shelves run along the sheet length (SL) and stack across its width (SW). */
export function packSheets(
  items: readonly SheetItem[],
  SW: number,
  SL: number,
  kerf: number,
): SheetBin[] {
  const sheets: SheetBin[] = [];
  const sorted = [...items].sort((a, b) => Math.min(b.w, b.l) - Math.min(a.w, a.l));
  /** Orientation [along length, across width] that fits a shelf of height h (or a new shelf). */
  const orient = (it: SheetItem, h: number | null): [number, number] | null => {
    const o1: [number, number] = [Math.max(it.w, it.l), Math.min(it.w, it.l)];
    const o2: [number, number] = [o1[1], o1[0]];
    for (const o of [o1, o2]) if (o[0] <= SL + 1e-9 && o[1] <= (h ?? SW) + 1e-9) return o;
    return null;
  };
  for (const it of sorted) {
    let placed = false;
    for (const sh of sheets) {
      for (const shelf of sh.shelves) {
        const o = orient(it, shelf.h);
        const gap = shelf.items.length ? kerf : 0;
        if (o && shelf.x + gap + o[0] <= SL + 1e-9) {
          shelf.x += gap;
          shelf.items.push({ ...it, x: shelf.x, y: shelf.y, a: o[0], b: o[1] });
          shelf.x += o[0];
          placed = true;
          break;
        }
      }
      if (placed) break;
      const o = orient(it, null);
      if (!o) break;
      const last = sh.shelves[sh.shelves.length - 1];
      const y = last ? last.y + last.h + kerf : 0;
      if (y + o[1] <= SW + 1e-9) {
        sh.shelves.push({ y, h: o[1], x: o[0], items: [{ ...it, x: 0, y, a: o[0], b: o[1] }] });
        placed = true;
        break;
      }
    }
    if (placed) continue;
    const o = orient(it, null);
    if (!o) {
      sheets.push({ shelves: [], over: it });
      continue;
    }
    sheets.push({
      shelves: [{ y: 0, h: o[1], x: o[0], items: [{ ...it, x: 0, y: 0, a: o[0], b: o[1] }] }],
    });
  }
  return sheets;
}

export interface CutRow {
  stock: Stock;
  /** Long-point length. */
  len: number;
  w: number;
  /** Miter angles at each end, 0/0 for square. */
  miter: [number, number];
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
    const key = `${p.stock}|${len}|${w}|${miter.join('/')}`;
    let r = map.get(key);
    if (!r) {
      r = { stock: s, len, w, miter, short: r32(shortLength(len, w, miter)), qty: 0, names: [] };
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
