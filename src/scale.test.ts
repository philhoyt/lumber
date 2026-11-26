import { describe, expect, it } from 'vitest';
import type { AABB } from './model';
import { MIN_LEN, pullEnd, scaleFactor, snapEnd, snapLength } from './scale';

describe('scaleFactor', () => {
  it('grows with the distance from the pivot and shrinks toward it', () => {
    expect(scaleFactor([0, 0], [100, 0], [200, 0])).toBe(2);
    expect(scaleFactor([0, 0], [100, 0], [50, 0])).toBe(0.5);
    expect(scaleFactor([0, 0], [100, 0], [0, 100])).toBe(1);
  });
  it('does not blow up when the drag starts on the pivot', () => {
    expect(scaleFactor([0, 0], [1, 0], [16, 0])).toBe(2);
  });
});

describe('snapLength', () => {
  it('rounds to the grid, or a sixteenth without one, and keeps a minimum', () => {
    expect(snapLength(33.3, 0.5)).toBe(33.5);
    expect(snapLength(33.3, 0)).toBe(33.3125);
    expect(snapLength(0.01, 1)).toBe(MIN_LEN);
  });
});

describe('pullEnd', () => {
  it('lengthens from the +X end and moves the centre half as far', () => {
    expect(pullEnd(24, 1, 6)).toEqual({ len: 30, shift: 3 });
    expect(pullEnd(24, 1, -6)).toEqual({ len: 18, shift: -3 });
  });
  it('lengthens from the -X end when that end moves outward (negative delta)', () => {
    expect(pullEnd(24, -1, -6)).toEqual({ len: 30, shift: -3 });
    expect(pullEnd(24, -1, 6)).toEqual({ len: 18, shift: 3 });
  });
  it('clips the move at the minimum length', () => {
    const r = pullEnd(10, 1, -40);
    expect(r.len).toBe(MIN_LEN);
    expect(r.shift).toBeCloseTo((MIN_LEN - 10) / 2, 9);
  });
});

describe('snapEnd', () => {
  const box = (min: [number, number, number], max: [number, number, number]): AABB => ({
    min,
    max,
  });
  const opts = { grid: 1, snapParts: true };
  it('lands the moving face against another part within tolerance', () => {
    const slab = box([24, 0, 0], [24, 3.5, 1.5]);
    const other = box([30.4, -2, 0], [32, 6, 10]);
    const r = snapEnd(slab, 0, 6, [other], opts);
    expect(r.delta).toBeCloseTo(6.4, 9);
    expect(r.hits[0]).toMatchObject({ kind: 'face', axis: 0, other: 0, side: 'min' });
    expect(r.moved.min[0]).toBeCloseTo(30.4, 9);
    expect(r.moved.max[0]).toBeCloseTo(30.4, 9);
  });
  it('falls back to the grid with nothing in reach', () => {
    const slab = box([24, 0, 0], [24, 3.5, 1.5]);
    const r = snapEnd(slab, 0, 6.3, [], opts);
    expect(r.delta).toBeCloseTo(6, 9);
    expect(r.hits[0]).toMatchObject({ kind: 'grid' });
  });
});
