import { describe, expect, it } from 'vitest';
import { packBoardsAuto } from './pack';
import { boardFeet, nominalOf, parseNominal, sanitizeStock, stockById, type Stock } from './stock';

describe('nominal sizes and board feet', () => {
  it('reads the nominal size from a dimensional lumber name', () => {
    expect(nominalOf(stockById('2x4'))).toEqual([2, 4]);
    expect(nominalOf(stockById('1x6'))).toEqual([1, 6]);
    expect(nominalOf(stockById('2x12'))).toEqual([2, 12]);
  });

  it('prefers a set nominal size and falls back to actual dimensions', () => {
    const oak: Stock = { id: 'oak', name: 'White oak 4/4', t: 1, w: 6, price: 8, color: 0 };
    expect(nominalOf(oak)).toEqual([1, 6]);
    expect(nominalOf({ ...oak, nominal: [1, 5.5] })).toEqual([1, 5.5]);
  });

  it('computes board feet by the trade formula', () => {
    expect(boardFeet(stockById('2x4'), 96)).toBeCloseTo(5.333, 3); // 2 × 4 × 96 ÷ 144
    expect(boardFeet(stockById('1x6'), 120)).toBeCloseTo(5);
    expect(boardFeet(stockById('2x12'), 192)).toBeCloseTo(32);
  });

  it('parses nominal text', () => {
    expect(parseNominal('2x4')).toEqual([2, 4]);
    expect(parseNominal(' 1 × 6 ')).toEqual([1, 6]);
    expect(parseNominal('1.5x3.5')).toEqual([1.5, 3.5]);
    expect(parseNominal('oak')).toBeNull();
    expect(parseNominal('0x4')).toBeNull();
  });

  it('keeps nominal and price unit through the file sanitizer', () => {
    const [s] = sanitizeStock([
      { id: 'a', name: 'A', t: 1, w: 6, nominal: [1, 6], priceUnit: 'bf', price: 8 },
    ])!;
    expect(s!.nominal).toEqual([1, 6]);
    expect(s!.priceUnit).toBe('bf');
    const [bad] = sanitizeStock([
      { id: 'b', name: 'B', t: 1, w: 6, nominal: [0, 6], priceUnit: 'x' },
    ])!;
    expect(bad!.nominal).toBeUndefined();
    expect(bad!.priceUnit).toBeUndefined();
  });
});

describe('packBoardsAuto', () => {
  const items = (...lens: number[]) => lens.map((len, i) => ({ len, name: `p${i}` }));

  it('buys the least total length', () => {
    // Four 45" pieces: two 8 ft boards (192") beat one 16 ft board? Both 192"; fewer pieces wins.
    const r = packBoardsAuto(items(45, 45, 45, 45), [96, 120, 144, 192], 0.125);
    expect(r.bins.length * r.length).toBe(192);
    expect(r.length).toBe(192);
    // Three 38" pieces fit one 10 ft board (120") but need two 8 ft (192").
    const r2 = packBoardsAuto(items(38, 38, 38), [96, 120], 0.125);
    expect(r2.length).toBe(120);
    expect(r2.bins).toHaveLength(1);
  });

  it('prefers a length that fits every piece', () => {
    const r = packBoardsAuto(items(100), [96, 120], 0);
    expect(r.length).toBe(120);
    expect(r.bins[0]!.over).toBeUndefined();
  });

  it('copes with no items', () => {
    expect(packBoardsAuto([], [96], 0)).toEqual({ length: 96, bins: [] });
  });
});
