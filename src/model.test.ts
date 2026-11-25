import { describe, expect, it } from 'vitest';
import {
  aabbSize,
  alignParts,
  clonePart,
  createPart,
  dropDistance,
  makeQ,
  migrateFromYUp,
  partAABB,
  rotateParts,
  unionAABB,
  withMinKept,
  DEFAULT_Q,
  type Part,
} from './model';

const board = (over: Partial<Part> = {}): Part => ({
  id: 1,
  stock: '2x4',
  len: 96,
  pos: [0, 0, 0],
  q: [...DEFAULT_Q] as Part['q'],
  name: '2x4 1',
  ...over,
});

describe('partAABB (Z-up)', () => {
  it('lays a default board flat: length along X, width along Y, thickness up', () => {
    const b = partAABB(board());
    expect(b.min).toEqual([-48, -1.75, -0.75]);
    expect(b.max).toEqual([48, 1.75, 0.75]);
  });

  it('stands a board up with a turn about Y', () => {
    const b = partAABB(board({ q: makeQ(['y']) }));
    expect(aabbSize(b)).toEqual([1.5, 3.5, 96]);
  });

  it('puts a board on edge with a turn about X', () => {
    const b = partAABB(board({ q: makeQ(['x']) }));
    expect(aabbSize(b)).toEqual([96, 1.5, 3.5]);
  });

  it('sizes a sheet part by its cut width', () => {
    const b = partAABB(board({ stock: 'ply34', len: 48, w: 24 }));
    expect(aabbSize(b)).toEqual([48, 24, 0.75]);
  });

  it('offsets by the position', () => {
    const b = partAABB(board({ pos: [10, 20, 30] }));
    expect(b.min).toEqual([-38, 18.25, 29.25]);
  });
});

describe('createPart', () => {
  it('rests a new board on the floor, centred on the drop point', () => {
    const p = createPart(7, '2x4', [10, -5, 0]);
    const b = partAABB(p);
    expect(b.min[2]).toBe(0);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(10);
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(-5);
    expect(p.len).toBe(96);
    expect(p.name).toBe('2x4 7');
  });

  it('creates a full sheet for sheet stock', () => {
    const p = createPart(1, 'ply34', [0, 0, 0]);
    expect(p.len).toBe(96);
    expect(p.w).toBe(48);
  });
});

describe('withMinKept', () => {
  it('keeps the min corner fixed when the length changes', () => {
    const p = board({ pos: [10, 0, 0] });
    const before = partAABB(p).min;
    withMinKept(p, (x) => (x.len = 48));
    expect(partAABB(p).min).toEqual(before);
    expect(aabbSize(partAABB(p))[0]).toBe(48);
  });
});

describe('rotateParts', () => {
  it('turns about the up axis and keeps the floor height', () => {
    const p = board({ pos: [0, 0, 5] });
    rotateParts([p], 'z');
    const b = partAABB(p);
    expect(aabbSize(b)).toEqual([3.5, 96, 1.5]);
    expect(b.min[2]).toBeCloseTo(5 - 0.75);
  });

  it('keeps a tipped board resting at its previous bottom', () => {
    const p = board();
    const bottom = partAABB(p).min[2];
    rotateParts([p], 'y');
    const b = partAABB(p);
    expect(aabbSize(b)[2]).toBe(96);
    expect(b.min[2]).toBeCloseTo(bottom);
  });

  it('turns the other way with negative turns', () => {
    const a = board();
    const b = board();
    rotateParts([a], 'z', 1);
    rotateParts([b], 'z', -1);
    expect(aabbSize(partAABB(a))).toEqual(aabbSize(partAABB(b)));
    rotateParts([b], 'z', 1);
    expect(aabbSize(partAABB(b))).toEqual([96, 3.5, 1.5]);
  });

  it('rotates a group as a unit about its shared centre', () => {
    const a = board({ id: 1, pos: [0, 0, 0] });
    const c = board({ id: 2, pos: [0, 20, 0] });
    rotateParts([a, c], 'z');
    const u = unionAABB([a, c]);
    expect(aabbSize(u)).toEqual([23.5, 96, 1.5]);
    expect(Math.abs(a.pos[0] - c.pos[0])).toBeCloseTo(20);
  });
});

describe('alignParts', () => {
  const two = () => [board({ id: 1, pos: [0, 0, 0] }), board({ id: 2, len: 48, pos: [30, 10, 5] })];

  it('makes left faces flush at the selection minimum', () => {
    const list = two();
    alignParts(list, 0, 'min');
    expect(partAABB(list[0]!).min[0]).toBe(-48);
    expect(partAABB(list[1]!).min[0]).toBe(-48);
  });

  it('centres on an axis', () => {
    const list = two();
    alignParts(list, 1, 'center');
    const c = (p: Part) => (partAABB(p).min[1] + partAABB(p).max[1]) / 2;
    expect(c(list[0]!)).toBeCloseTo(c(list[1]!));
  });

  it('makes top faces flush at the selection maximum', () => {
    const list = two();
    alignParts(list, 2, 'max');
    expect(partAABB(list[0]!).max[2]).toBe(5.75);
    expect(partAABB(list[1]!).max[2]).toBe(5.75);
  });

  it('does nothing for a single part', () => {
    const p = board({ pos: [5, 5, 5] });
    alignParts([p], 0, 'min');
    expect(p.pos).toEqual([5, 5, 5]);
  });
});

describe('dropDistance', () => {
  it('drops to the floor when nothing is beneath', () => {
    const p = board({ pos: [0, 0, 20] });
    expect(dropDistance([p], [])).toBeCloseTo(-(20 - 0.75));
  });

  it('rests on the top of a part under its footprint', () => {
    const lower = board({ id: 1, pos: [0, 0, 0.75] }); // top at 1.5
    const upper = board({ id: 2, pos: [0, 0, 20] });
    expect(dropDistance([upper], [lower])).toBeCloseTo(1.5 - (20 - 0.75));
  });

  it('ignores parts that do not overlap in plan', () => {
    const aside = board({ id: 1, pos: [0, 50, 0.75] });
    const upper = board({ id: 2, pos: [0, 0, 20] });
    expect(dropDistance([upper], [aside])).toBeCloseTo(-(20 - 0.75));
  });

  it('ignores parts that are above the selection', () => {
    const above = board({ id: 1, pos: [0, 0, 40] });
    const p = board({ id: 2, pos: [0, 0, 20] });
    expect(dropDistance([p], [above])).toBeCloseTo(-(20 - 0.75));
  });

  it('is zero when already resting', () => {
    expect(dropDistance([board({ pos: [0, 0, 0.75] })], [])).toBe(0);
  });
});

describe('migrateFromYUp', () => {
  it('turns a Y-up flat board into a Z-up flat board at the same height', () => {
    // In the Y-up format a flat board was a quarter turn about X, 5" up the Y axis.
    const old = board({ pos: [0, 5, 0], q: makeQ(['x']) });
    const [p] = migrateFromYUp([old]);
    expect(p!.pos).toEqual([0, 0, 5]);
    expect(aabbSize(partAABB(p!))).toEqual([96, 3.5, 1.5]);
  });

  it('maps the old depth axis to the front-back axis', () => {
    const old = board({ pos: [0, 0, 12], q: makeQ(['x']) });
    const [p] = migrateFromYUp([old]);
    expect(p!.pos).toEqual([0, -12, 0]);
  });
});

describe('clonePart', () => {
  it('copies with a new id, name and offset without sharing arrays', () => {
    const p = board();
    const c = clonePart(p, 9, [16, 0, 0]);
    expect(c.id).toBe(9);
    expect(c.name).toBe('2x4 9');
    expect(c.pos).toEqual([16, 0, 0]);
    c.q[0] = 123;
    expect(p.q[0]).not.toBe(123);
  });
});
