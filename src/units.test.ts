import { describe, expect, it } from 'vitest';
import { fmt, fmtFt, fmtSheet, parseLen, parseLenEdit, r32 } from './units';

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
    ['-3', -3],
    ['.5', 0.5],
  ])('parses %s', (text, inches) => {
    expect(parseLen(text)).toBeCloseTo(inches, 9);
  });

  it.each([
    ['48 - 3/4', 47.25],
    ['48-3/4', 48.75],
    ['(96 - 2 * 1.5) / 3', 31],
    ['2 ft + 3 1/2', 27.5],
    ['3 * 15 1/2', 46.5],
    ['36 x 2', 72],
    ['36" × 2', 72],
    ['48/3', 16],
    ['48 / 3 1/2', 48 / 3.5],
    ['24 / 2 / 3', 4],
    ['10 - 2 - 3', 5],
    ['2-1/2', 2.5],
    ['2 - 1/2', 1.5],
    ['38mm + 1', 38 / 25.4 + 1],
    ['-(3/4)', -0.75],
    ["2'6 * 2", 60],
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
  ])('evaluates %s', (text, inches) => {
    expect(parseLen(text)).toBeCloseTo(inches, 9);
  });

  it.each(['', '   ', 'abc', '1/0x', '1/0', '1 +', '(1', '2 3', '* 4', '1 ft ft', null, undefined])(
    'rejects %s',
    (text) => {
      expect(parseLen(text)).toBeNull();
    },
  );
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

describe('parseLenEdit', () => {
  const at = (text: string, current: number, minusRel = true): number | null => {
    const e = parseLenEdit(text, minusRel);
    if (!e) return null;
    return e.relative ? e.apply(current) : e.value;
  };
  it('reads a plain length as a new value', () => {
    expect(at('48 3/4', 10)).toBe(48.75);
    expect(parseLenEdit('48', true)).toEqual({ relative: false, value: 48 });
  });
  it('applies a leading operator to what the field holds', () => {
    expect(at('+1/2', 45)).toBe(45.5);
    expect(at('*2', 45)).toBe(90);
    expect(at('/3', 45)).toBe(15);
    expect(at('+ 1 ft', 45)).toBe(57);
  });
  it('treats a leading minus as relative only where the field cannot go negative', () => {
    expect(at('-1/2', 45, true)).toBe(44.5);
    expect(at('-3', 45, false)).toBe(-3);
  });
  it('skips a leading Mixed', () => {
    expect(at('Mixed+1/2', 33.25)).toBe(33.75);
    expect(at('mixed', 33.25)).toBeNull();
  });
  it('rejects junk', () => {
    expect(parseLenEdit('+abc', true)).toBeNull();
    expect(parseLenEdit('', true)).toBeNull();
    expect(parseLenEdit(null, true)).toBeNull();
  });
});
