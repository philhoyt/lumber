import { describe, expect, it } from 'vitest';
import { makeQ, type Part } from './model';
import { cutRows, packBoards, packSheets, partsByStock } from './pack';

const KERF = 0.125;

describe('packBoards', () => {
  it('fits two 45" cuts on an 8 ft board with kerf, needing two boards for four', () => {
    const bins = packBoards(
      [1, 2, 3, 4].map((i) => ({ len: 45, name: `a${i}` })),
      96,
      KERF,
    );
    expect(bins).toHaveLength(2);
    expect(bins[0]!.used).toBeCloseTo(90.125);
  });

  it('packs largest first and fills gaps with short pieces', () => {
    const bins = packBoards(
      [
        { len: 60, name: 'long' },
        { len: 30, name: 'mid' },
        { len: 30, name: 'mid2' },
        { len: 35, name: 'odd' },
      ],
      96,
      KERF,
    );
    expect(bins).toHaveLength(2);
    expect(bins[0]!.items.map((i) => i.name)).toEqual(['long', 'odd']);
    expect(bins[1]!.items.map((i) => i.name)).toEqual(['mid', 'mid2']);
  });

  it('flags a cut longer than the stock', () => {
    const bins = packBoards([{ len: 100, name: 'x' }], 96, KERF);
    expect(bins[0]!.over).toBe(true);
  });

  it('counts the kerf: three 32" pieces do not fit on 96"', () => {
    const bins = packBoards(
      [1, 2, 3].map((i) => ({ len: 32, name: `${i}` })),
      96,
      KERF,
    );
    expect(bins).toHaveLength(2);
  });

  it('returns nothing for no items', () => {
    expect(packBoards([], 96, KERF)).toEqual([]);
  });
});

describe('packSheets', () => {
  it('fits two 24x48 halves on one 4x8 sheet', () => {
    const sheets = packSheets(
      [
        { w: 24, l: 48, name: 'a' },
        { w: 24, l: 48, name: 'b' },
      ],
      48,
      96,
      0,
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.shelves[0]!.items).toHaveLength(2);
  });

  it('places a full-width part by rotating it to run along the length', () => {
    const sheets = packSheets([{ w: 96, l: 48, name: 'a' }], 48, 96, KERF);
    expect(sheets).toHaveLength(1);
    const it = sheets[0]!.shelves[0]!.items[0]!;
    expect(it.a).toBe(96);
    expect(it.b).toBe(48);
  });

  it('needs a second sheet when the width is used up', () => {
    const sheets = packSheets(
      [1, 2, 3].map((i) => ({ w: 20, l: 90, name: `${i}` })),
      48,
      96,
      KERF,
    );
    expect(sheets).toHaveLength(2);
  });

  it('keeps items inside the sheet', () => {
    const items = [
      { w: 12, l: 30 },
      { w: 20, l: 40 },
      { w: 8, l: 96 },
      { w: 47, l: 20 },
      { w: 15, l: 15 },
    ].map((r, i) => ({ ...r, name: `${i}` }));
    for (const sh of packSheets(items, 48, 96, KERF))
      for (const shelf of sh.shelves)
        for (const it of shelf.items) {
          expect(it.x + it.a).toBeLessThanOrEqual(96 + 1e-9);
          expect(it.y + it.b).toBeLessThanOrEqual(48 + 1e-9);
        }
  });

  it('flags a part larger than the sheet', () => {
    const sheets = packSheets([{ w: 50, l: 100, name: 'big' }], 48, 96, KERF);
    expect(sheets[0]!.over?.name).toBe('big');
  });
});

const part = (over: Partial<Part>): Part => ({
  id: 1,
  stock: '2x4',
  len: 45,
  pos: [0, 0, 0],
  q: makeQ(['x']),
  name: 'p',
  ...over,
});

describe('cutRows', () => {
  it('groups identical cuts and keeps the names', () => {
    const rows = cutRows([
      part({ id: 1, name: 'a' }),
      part({ id: 2, name: 'b' }),
      part({ id: 3, len: 17, name: 'c' }),
    ]);
    expect(rows.map((r) => [r.len, r.qty])).toEqual([
      [45, 2],
      [17, 1],
    ]);
    expect(rows[0]!.names).toEqual(['a', 'b']);
  });

  it('treats float noise as the same cut', () => {
    const rows = cutRows([part({ id: 1, len: 45 }), part({ id: 2, len: 45.0000001 })]);
    expect(rows).toHaveLength(1);
  });

  it('separates sheet cuts by width', () => {
    const rows = cutRows([
      part({ id: 1, stock: 'ply34', len: 48, w: 24 }),
      part({ id: 2, stock: 'ply34', len: 48, w: 12 }),
    ]);
    expect(rows.map((r) => r.w)).toEqual([24, 12]);
  });
});

describe('partsByStock', () => {
  it('groups in stock library order', () => {
    const by = partsByStock([
      part({ id: 1, stock: 'ply34' }),
      part({ id: 2, stock: '2x4' }),
      part({ id: 3, stock: '2x4' }),
    ]);
    expect([...by.keys()]).toEqual(['2x4', 'ply34']);
    expect(by.get('2x4')).toHaveLength(2);
  });
});
