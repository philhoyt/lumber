import { describe, expect, it } from 'vitest';
import {
  arrayCount,
  arrayFromDrag,
  arrayFromTyped,
  arrayText,
  dominantAxis,
  dragCount,
  sameArray,
} from './arrayDrag';
import type { ArrayParams } from './model';

const base: ArrayParams = { axis: 'x', mode: 'center', spacing: 16 };

describe('dragCount', () => {
  it('adds a copy for every full step of drag, never fewer than the source', () => {
    expect(dragCount(16, 0)).toBe(1);
    expect(dragCount(16, 15.9)).toBe(1);
    expect(dragCount(16, 16)).toBe(2);
    expect(dragCount(16, -48)).toBe(4);
    expect(dragCount(16, 95)).toBe(6);
  });
});

describe('arrayFromDrag', () => {
  it('counts copies while dragging and records the span when done', () => {
    expect(arrayFromDrag(base, 'y', 1.5, 40, false)).toEqual({
      axis: 'y',
      mode: 'center',
      spacing: 16,
      count: 3,
    });
    const done = arrayFromDrag(base, 'y', 1.5, 40, true);
    expect(done).toEqual({ axis: 'y', mode: 'center', spacing: 16, fit: 41.5 });
    // the span form makes the same number of copies the drag showed
    expect(arrayCount(done, 1.5)).toBe(3);
  });
  it('runs backwards when the drag went the negative way', () => {
    expect(arrayFromDrag(base, 'x', 1.5, -33, false)).toEqual({
      axis: 'x',
      mode: 'center',
      spacing: 16,
      reverse: true,
      count: 3,
    });
  });
  it('spaces by the gap when the base says so', () => {
    const gap: ArrayParams = { axis: 'x', mode: 'gap', spacing: 1.5 };
    // flat 2x4s, 3 1/2 wide with 1 1/2 gaps: 5 apart
    expect(arrayFromDrag(gap, 'x', 3.5, 20, false).count).toBe(5);
  });
});

describe('arrayFromTyped', () => {
  it('reads a whole number as a count and a length as a span', () => {
    expect(arrayFromTyped(base, 'x', '7', false)).toEqual({ ...base, count: 7 });
    expect(arrayFromTyped(base, 'x', "8'", true)).toEqual({ ...base, reverse: true, fit: 96 });
    expect(arrayFromTyped(base, 'x', '48 - 3/4', false)).toEqual({ ...base, fit: 47.25 });
  });
  it('rejects nonsense', () => {
    expect(arrayFromTyped(base, 'x', '0', false)).toBeNull();
    expect(arrayFromTyped(base, 'x', 'abc', false)).toBeNull();
    expect(arrayFromTyped(base, 'x', '', false)).toBeNull();
  });
});

describe('dominantAxis', () => {
  it('picks the axis the pointer moved along most', () => {
    expect(dominantAxis([3, -10, 0], [0, 1])).toBe(1);
    expect(dominantAxis([3, -10, 20], [0, 1])).toBe(1);
    expect(dominantAxis([0, 0, 0], [0, 1])).toBe(0);
  });
});

describe('arrayText and sameArray', () => {
  it('reads out copies, spacing and span', () => {
    expect(arrayText({ ...base, count: 7 }, 1.5)).toBe('7 @ 16" o.c. · spans 97 1/2"');
    expect(arrayText({ axis: 'x', mode: 'gap', spacing: 1.5, count: 2 }, 3.5)).toBe(
      '2 @ 1 1/2" gaps · spans 8 1/2"',
    );
  });
  it('compares parameters by value', () => {
    expect(sameArray({ ...base, count: 2 }, { ...base, count: 2 })).toBe(true);
    expect(sameArray({ ...base, count: 2 }, { ...base, count: 3 })).toBe(false);
    expect(sameArray(null, { ...base })).toBe(false);
  });
});
