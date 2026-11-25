import { describe, expect, it } from 'vitest';
import type { Part } from './model';
import { cutRows, packSheets } from './pack';
import { parseDocument } from './store';

describe('packSheets with grain', () => {
  // A 4x8 sheet is 48 wide (SW) by 96 long (SL); grain runs the long way.
  it('turns a part either way when grain is free', () => {
    const [sheet] = packSheets([{ w: 40, l: 20, name: 'a', grain: 'any' }], 48, 96, 0);
    const it = sheet!.shelves[0]!.items[0]!;
    expect([it.a, it.b]).toEqual([40, 20]); // the long side runs along the sheet
  });

  it('keeps the length with the grain when asked', () => {
    const [sheet] = packSheets([{ w: 40, l: 20, name: 'a', grain: 'length' }], 48, 96, 0);
    const it = sheet!.shelves[0]!.items[0]!;
    expect([it.a, it.b]).toEqual([20, 40]); // the 20" length runs along the sheet
  });

  it('keeps the length across the grain when asked', () => {
    const [sheet] = packSheets([{ w: 20, l: 40, name: 'a', grain: 'width' }], 48, 96, 0);
    const it = sheet!.shelves[0]!.items[0]!;
    expect([it.a, it.b]).toEqual([20, 40]);
  });

  it('flags a part that cannot fit the way its grain requires', () => {
    // 60" long across the 48" width is impossible; turning it is not allowed.
    const [sheet] = packSheets([{ w: 20, l: 60, name: 'a', grain: 'width' }], 48, 96, 0);
    expect(sheet!.over?.name).toBe('a');
    const [ok] = packSheets([{ w: 20, l: 60, name: 'a', grain: 'any' }], 48, 96, 0);
    expect(ok!.over).toBeUndefined();
  });

  it('needs more sheets when grain forbids the compact turn', () => {
    const items = [1, 2, 3].map((i) => ({ w: 30, l: 90, name: `${i}` }));
    const free = packSheets(
      items.map((x) => ({ ...x, grain: 'any' as const })),
      48,
      96,
      0,
    );
    const strict = packSheets(
      items.map((x) => ({ ...x, grain: 'width' as const })),
      48,
      96,
      0,
    );
    expect(free).toHaveLength(3);
    expect(strict.every((s) => s.over)).toBe(true); // 90" cannot run across a 48" sheet
  });
});

const sheetPart = (over: Partial<Part>): Part => ({
  id: 1,
  stock: 'ply34',
  len: 48,
  w: 24,
  pos: [0, 0, 0],
  q: [0, 0, 0, 1],
  name: 'p',
  ...over,
});

describe('cut list with grain', () => {
  it('separates cuts by grain and ignores grain on grainless stock', () => {
    const rows = cutRows([
      sheetPart({ id: 1 }),
      sheetPart({ id: 2, grain: 'length' }),
      sheetPart({ id: 3, stock: 'mdf34', grain: 'length' }),
      sheetPart({ id: 4, stock: 'mdf34' }),
    ]);
    expect(rows.map((r) => `${r.stock.id}:${r.grain}:${r.qty}`)).toEqual([
      'ply34:any:1',
      'ply34:length:1',
      'mdf34:any:2',
    ]);
  });
});

describe('grain in files', () => {
  const file = (grain: unknown) => ({
    version: 2,
    parts: [
      { id: 1, stock: 'ply34', len: 48, w: 24, pos: [0, 0, 0], q: [0, 0, 0, 1], name: 'a', grain },
    ],
  });
  it('keeps a valid value and drops the rest', () => {
    expect(parseDocument(file('length'))!.parts[0]!.grain).toBe('length');
    expect(parseDocument(file('any'))!.parts[0]!.grain).toBeUndefined();
    expect(parseDocument(file('sideways'))!.parts[0]!.grain).toBeUndefined();
  });
});
