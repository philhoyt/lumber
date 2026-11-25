import { describe, expect, it } from 'vitest';
import { packSheets, type SheetBin, type SheetItem } from './pack';

const SW = 48;
const SL = 96;
const KERF = 0.125;
const item = (w: number, l: number, name: string, grain?: SheetItem['grain']): SheetItem => ({
  w,
  l,
  name,
  grain,
});

/** Every item inside the sheet, no two overlapping, and no cut through an item. */
function checkSheet(sh: SheetBin, kerf: number): void {
  for (const a of sh.items) {
    expect(a.x).toBeGreaterThanOrEqual(-1e-9);
    expect(a.y).toBeGreaterThanOrEqual(-1e-9);
    expect(a.x + a.a).toBeLessThanOrEqual(SL + 1e-9);
    expect(a.y + a.b).toBeLessThanOrEqual(SW + 1e-9);
    for (const b of sh.items) {
      if (a === b) continue;
      const apart =
        a.x + a.a + kerf <= b.x + 1e-9 ||
        b.x + b.a + kerf <= a.x + 1e-9 ||
        a.y + a.b + kerf <= b.y + 1e-9 ||
        b.y + b.b + kerf <= a.y + 1e-9;
      expect(apart).toBe(true);
    }
    for (const c of sh.cuts) {
      // A cut line must not pass through the interior of any item.
      const vertical = Math.abs(c.x1 - c.x2) < 1e-9;
      const through = vertical
        ? c.x1 > a.x + 1e-6 &&
          c.x1 < a.x + a.a - 1e-6 &&
          Math.max(c.y1, c.y2) > a.y + 1e-6 &&
          Math.min(c.y1, c.y2) < a.y + a.b - 1e-6
        : c.y1 > a.y + 1e-6 &&
          c.y1 < a.y + a.b - 1e-6 &&
          Math.max(c.x1, c.x2) > a.x + 1e-6 &&
          Math.min(c.x1, c.x2) < a.x + a.a - 1e-6;
      expect(through).toBe(false);
    }
  }
}

describe('guillotine nesting', () => {
  it('fills a sheet with four quarter sheets and three cuts', () => {
    const sheets = packSheets(
      [1, 2, 3, 4].map((i) => item(24, 48, `q${i}`)),
      SW,
      SL,
      0,
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.items).toHaveLength(4);
    expect(sheets[0]!.cuts).toHaveLength(3);
    checkSheet(sheets[0]!, 0);
  });

  it('does better than shelves: a cabinet side set fits one sheet', () => {
    // Two 24x60 sides and two 24x36 shelves: shelves alone would spill to a second sheet
    // because the 36" pieces cannot share the 60" row once it is used up.
    const parts = [
      item(24, 60, 'side 1'),
      item(24, 60, 'side 2'),
      item(24, 36, 'shelf 1'),
      item(24, 36, 'shelf 2'),
    ];
    const sheets = packSheets(parts, SW, SL, 0);
    expect(sheets).toHaveLength(1);
    checkSheet(sheets[0]!, 0);
  });

  it('respects the kerf between neighbours', () => {
    const sheets = packSheets([item(48, 47.9, 'a'), item(48, 47.9, 'b')], SW, SL, KERF);
    expect(sheets).toHaveLength(1);
    checkSheet(sheets[0]!, KERF);
    const sheets2 = packSheets([item(48, 48, 'a'), item(48, 48, 'b')], SW, SL, KERF);
    expect(sheets2).toHaveLength(2); // two exact halves do not leave room for the blade
  });

  it('keeps grain constraints and flags the impossible', () => {
    const sheets = packSheets([item(20, 60, 'a', 'width')], SW, SL, 0);
    expect(sheets[0]!.over?.name).toBe('a');
    const [ok] = packSheets([item(20, 60, 'b', 'length')], SW, SL, 0);
    expect(ok!.items[0]!.a).toBe(60);
  });

  it('produces valid layouts and cut sequences for a mixed job', () => {
    const parts = [
      item(12, 30, 'a'),
      item(20, 40, 'b'),
      item(8, 96, 'c'),
      item(47, 20, 'd'),
      item(15, 15, 'e'),
      item(30, 30, 'f'),
      item(11, 70, 'g', 'length'),
      item(22, 22, 'h'),
    ];
    const sheets = packSheets(parts, SW, SL, KERF);
    expect(sheets.every((s) => !s.over)).toBe(true);
    expect(sheets.flatMap((s) => s.items)).toHaveLength(parts.length);
    for (const sh of sheets) {
      checkSheet(sh, KERF);
      expect(sh.cuts.length).toBeGreaterThan(0);
    }
  });
});
