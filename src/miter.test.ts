import { describe, expect, it } from 'vitest';
import { clampMiter, miterOutline, miterSetback, shortLength, type Part } from './model';
import { cutRows } from './pack';
import { parseDocument } from './store';

describe('miter math', () => {
  it('a 45° miter sets back by the width', () => {
    expect(miterSetback(45, 3.5)).toBeCloseTo(3.5);
    expect(miterSetback(-45, 3.5)).toBeCloseTo(3.5);
    expect(miterSetback(0, 3.5)).toBe(0);
  });

  it('draws the outline with the short point on the signed edge', () => {
    // 96" long, 3 1/2" wide, 45° both ends, short points on the +Y (back) edge
    const o = miterOutline(96, 3.5, [45, 45]);
    expect(o[0]).toEqual([-48, -1.75]); // long point, front edge
    expect(o[1]).toEqual([48, -1.75]);
    expect(o[2]![0]).toBeCloseTo(48 - 3.5); // short point, back edge
    expect(o[3]![0]).toBeCloseTo(-48 + 3.5);
    const opposite = miterOutline(96, 3.5, [45, -45]);
    expect(opposite[0]![0]).toBeCloseTo(-48);
    expect(opposite[1]![0]).toBeCloseTo(48 - 3.5);
    expect(opposite[2]![0]).toBeCloseTo(48);
    expect(opposite[3]![0]).toBeCloseTo(-48 + 3.5);
  });

  it('short-point length counts both setbacks on one edge, one each on a parallelogram', () => {
    expect(shortLength([96, 3.5, 1.5], [45, 45])).toBeCloseTo(89);
    expect(shortLength([96, 3.5, 1.5], [45, -45])).toBeCloseTo(92.5);
    expect(shortLength([96, 3.5, 1.5], [0, 0])).toBe(96);
  });

  it('clamps typed angles to half degrees within range', () => {
    expect(clampMiter(45.26)).toBe(45.5);
    expect(clampMiter(90)).toBe(75);
    expect(clampMiter(-100)).toBe(-75);
    expect(clampMiter(NaN)).toBe(0);
    expect(clampMiter(-0.1)).toBe(0);
  });
});

const part = (over: Partial<Part>): Part => ({
  id: 1,
  stock: '2x4',
  len: 45,
  pos: [0, 0, 0],
  q: [0, 0, 0, 1],
  name: 'p',
  ...over,
});

describe('cut list with miters', () => {
  it('keeps mitered cuts apart from square ones of the same length', () => {
    const rows = cutRows([
      part({ id: 1, name: 'a' }),
      part({ id: 2, name: 'b', miter: [45, 45] }),
      part({ id: 3, name: 'c', miter: [45, 45] }),
    ]);
    expect(rows).toHaveLength(2);
    const mitered = rows.find((r) => r.miter[0] === 45)!;
    expect(mitered.qty).toBe(2);
    expect(mitered.short).toBeCloseTo(38);
    expect(rows.find((r) => r.miter[0] === 0)!.short).toBe(45);
  });
});

describe('miters in files', () => {
  const file = (miter: unknown) => ({
    version: 2,
    parts: [{ id: 1, stock: '2x4', len: 96, pos: [0, 0, 0], q: [0, 0, 0, 1], name: 'a', miter }],
  });
  it('keeps a valid pair and drops anything else', () => {
    expect(parseDocument(file([30, -30]))!.parts[0]!.miter).toEqual([30, -30]);
    expect(parseDocument(file([0, 0]))!.parts[0]!.miter).toBeUndefined();
    expect(parseDocument(file([200, 0]))!.parts[0]!.miter).toBeUndefined();
    expect(parseDocument(file('45'))!.parts[0]!.miter).toBeUndefined();
  });
});
