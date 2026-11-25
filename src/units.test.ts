import { describe, expect, it } from 'vitest';
import { fmt, fmtFt, fmtSheet, parseLen, r32 } from './units';

describe('parseLen', () => {
  it.each([
    ['36', 36],
    ['36"', 36],
    ['36 in', 36],
    ['3/4', 0.75],
    ['1 1/2', 1.5],
    ['1-1/2', 1.5],
    ['33 1/4"', 33.25],
    ["2'", 24],
    ['2 ft', 24],
    ["2'6", 30],
    ["2'6 1/2", 30.5],
    ['8ft 3', 99],
    ['1.5', 1.5],
    ['38mm', 38 / 25.4],
    ['2.54 cm', 1],
    ['  12  ', 12],
  ])('parses %s', (text, inches) => {
    expect(parseLen(text)).toBeCloseTo(inches, 9);
  });

  it.each(['', '   ', 'abc', '1/0x', null, undefined])('rejects %s', (text) => {
    const v = parseLen(text);
    expect(v === null || !Number.isFinite(v)).toBe(true);
  });
});

describe('fmt', () => {
  it.each([
    [0, '0"'],
    [36, '36"'],
    [0.75, '3/4"'],
    [1.5, '1 1/2"'],
    [33.25, '33 1/4"'],
    [0.0625, '1/16"'],
    [0.125, '1/8"'],
    [23.9999, '24"'],
    [-1.5, '-1 1/2"'],
  ])('formats %s as %s', (inches, text) => {
    expect(fmt(inches)).toBe(text);
  });

  it('rounds to the nearest sixteenth', () => {
    expect(fmt(0.7)).toBe('11/16"');
    expect(fmt(1 / 3)).toBe('5/16"');
  });
});

describe('fmtFt', () => {
  it('reads whole feet as feet and everything else as inches', () => {
    expect(fmtFt(96)).toBe('8 ft');
    expect(fmtFt(100)).toBe('100"');
  });
});

describe('fmtSheet', () => {
  it('uses feet for whole-foot sheets and inches otherwise', () => {
    expect(fmtSheet(48, 96)).toBe('4×8 ft');
    expect(fmtSheet(49, 97)).toBe('49" × 97"');
  });
});

describe('r32', () => {
  it('rounds to a 32nd', () => {
    expect(r32(33.26)).toBe(33.25);
    expect(r32(33.27)).toBe(33.28125);
  });
});
