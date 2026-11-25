/**
 * The stock library: what you can buy, with actual (not nominal) dimensions in inches.
 * Every part in a model is one of these cut to length (and, for sheets, to width).
 *
 * The library is editable and saved with the model, so it lives in a registry here that
 * the store swaps on load, undo and edit. Prices are placeholders until edited.
 */
export interface Stock {
  id: string;
  name: string;
  /** Thickness, inches. */
  t: number;
  /** Width, inches. Boards only; a sheet's width is cut per part. */
  w?: number;
  /** Purchase lengths offered, inches. Boards only. */
  lengths?: number[];
  /** Full sheet size [width, length], inches. Sheets only. */
  sheet?: [number, number];
  /** Price per piece. */
  price: number;
  /** Display colour, 0xRRGGBB. */
  color: number;
}

const BOARD = 0xcfa872;
const ONE_BY = 0xd8b88a;
const PLY = 0xe3cfa3;

export const DEFAULT_STOCK: readonly Stock[] = [
  { id: '1x2', name: '1x2', t: 0.75, w: 1.5, lengths: [96], price: 2.5, color: ONE_BY },
  { id: '1x3', name: '1x3', t: 0.75, w: 2.5, lengths: [96], price: 3.5, color: ONE_BY },
  { id: '1x4', name: '1x4', t: 0.75, w: 3.5, lengths: [96, 120, 144], price: 5, color: ONE_BY },
  { id: '1x6', name: '1x6', t: 0.75, w: 5.5, lengths: [96, 120, 144], price: 8, color: ONE_BY },
  { id: '1x8', name: '1x8', t: 0.75, w: 7.25, lengths: [96, 120, 144], price: 11, color: ONE_BY },
  { id: '2x2', name: '2x2', t: 1.5, w: 1.5, lengths: [96], price: 3.5, color: BOARD },
  { id: '2x4', name: '2x4', t: 1.5, w: 3.5, lengths: [96, 120, 144, 192], price: 4, color: BOARD },
  { id: '2x6', name: '2x6', t: 1.5, w: 5.5, lengths: [96, 120, 144, 192], price: 7, color: BOARD },
  {
    id: '2x8',
    name: '2x8',
    t: 1.5,
    w: 7.25,
    lengths: [96, 120, 144, 192],
    price: 10,
    color: BOARD,
  },
  {
    id: '2x10',
    name: '2x10',
    t: 1.5,
    w: 9.25,
    lengths: [96, 120, 144, 192],
    price: 14,
    color: BOARD,
  },
  {
    id: '2x12',
    name: '2x12',
    t: 1.5,
    w: 11.25,
    lengths: [96, 120, 144, 192],
    price: 19,
    color: BOARD,
  },
  { id: '4x4', name: '4x4', t: 3.5, w: 3.5, lengths: [96, 120, 144], price: 12, color: 0xb8925f },
  { id: 'ply34', name: '3/4" plywood', t: 0.75, sheet: [48, 96], price: 55, color: PLY },
  { id: 'ply12', name: '1/2" plywood', t: 0.5, sheet: [48, 96], price: 40, color: PLY },
  { id: 'ply14', name: '1/4" plywood', t: 0.25, sheet: [48, 96], price: 25, color: PLY },
  { id: 'osb', name: '7/16" OSB', t: 0.4375, sheet: [48, 96], price: 18, color: 0xc9a978 },
  { id: 'mdf34', name: '3/4" MDF', t: 0.75, sheet: [49, 97], price: 45, color: 0xb9a27f },
];

/** @deprecated The defaults; the live library is `getStock()`. */
export const STOCK = DEFAULT_STOCK;

export const cloneStock = (list: readonly Stock[]): Stock[] =>
  list.map((s) => ({
    ...s,
    lengths: s.lengths ? [...s.lengths] : undefined,
    sheet: s.sheet ? [...s.sheet] : undefined,
  }));

let current: Stock[] = cloneStock(DEFAULT_STOCK);
let version = 0;

/** The library in use. */
export function getStock(): readonly Stock[] {
  return current;
}
/** Replace the library (the store does this on load, undo and edit). */
export function setStock(list: readonly Stock[]): void {
  current = cloneStock(list);
  version++;
}
/** Changes each time the library is replaced; panels use it to know when to rebuild. */
export function stockVersion(): number {
  return version;
}

/** A stand-in for a stock id the library no longer has, so old files still open. */
function missingStock(id: string): Stock {
  return { id, name: `${id} (missing)`, t: 1.5, w: 3.5, lengths: [96], price: 0, color: 0x8a8a8a };
}

export function stockById(id: string): Stock {
  return current.find((x) => x.id === id) ?? missingStock(id);
}

export const isSheet = (s: Stock): boolean => s.sheet !== undefined;

/** Width of a board's cross-section, or of a sheet part cut to `w`. */
export function stockWidth(s: Stock, w: number | undefined): number {
  if (s.sheet) return w ?? s.sheet[0];
  return s.w ?? 0;
}

/** Keep only well-formed entries from a file. */
export function sanitizeStock(list: unknown): Stock[] | null {
  if (!Array.isArray(list)) return null;
  const out: Stock[] = [];
  for (const x of list as Partial<Stock>[]) {
    if (!x || typeof x !== 'object') continue;
    if (typeof x.id !== 'string' || typeof x.name !== 'string' || typeof x.t !== 'number') continue;
    const sheet =
      Array.isArray(x.sheet) && x.sheet.length === 2 && x.sheet.every((n) => typeof n === 'number')
        ? ([x.sheet[0], x.sheet[1]] as [number, number])
        : undefined;
    if (!sheet && typeof x.w !== 'number') continue;
    const lengths = Array.isArray(x.lengths)
      ? x.lengths.filter((n): n is number => typeof n === 'number' && n > 0)
      : undefined;
    const s: Stock = {
      id: x.id,
      name: x.name,
      t: x.t,
      price: typeof x.price === 'number' ? x.price : 0,
      color: typeof x.color === 'number' ? x.color : 0xcfa872,
    };
    if (sheet) s.sheet = sheet;
    else {
      s.w = x.w;
      s.lengths = lengths && lengths.length ? lengths : [96];
    }
    out.push(s);
  }
  return out;
}
