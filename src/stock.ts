/**
 * The stock library: what you can buy, with actual (not nominal) dimensions in inches.
 * Every part in a model is one of these cut to length (and, for sheets, to width).
 * Prices are placeholders the user can override per model.
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
  /** Placeholder price per piece. */
  price: number;
  /** Display colour, 0xRRGGBB. */
  color: number;
}

const BOARD = 0xcfa872;
const ONE_BY = 0xd8b88a;
const PLY = 0xe3cfa3;

export const STOCK: readonly Stock[] = [
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

export function stockById(id: string): Stock {
  const s = STOCK.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown stock "${id}"`);
  return s;
}

export const isSheet = (s: Stock): boolean => s.sheet !== undefined;

/** Width of a board's cross-section, or of a sheet part cut to `w`. */
export function stockWidth(s: Stock, w: number | undefined): number {
  if (s.sheet) return w ?? s.sheet[0];
  return s.w ?? 0;
}
