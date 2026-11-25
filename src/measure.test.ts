import { describe, expect, it } from 'vitest';
import { measureBetween, measureText, nearestSnap, snapPoints } from './measure';
import { fmt } from './units';

const box = {
  min: [0, 0, 0] as [number, number, number],
  max: [10, 4, 2] as [number, number, number],
};

describe('snapPoints', () => {
  it('gives corners, edge midpoints and face centres', () => {
    const pts = snapPoints(box);
    expect(pts).toHaveLength(26);
    expect(pts).toContainEqual([0, 0, 0]);
    expect(pts).toContainEqual([10, 4, 2]);
    expect(pts).toContainEqual([5, 0, 0]); // edge midpoint
    expect(pts).toContainEqual([5, 2, 2]); // top face centre
    expect(pts).not.toContainEqual([5, 2, 1]); // the box centre
  });
});

describe('nearestSnap', () => {
  it('picks the closest candidate within tolerance', () => {
    const pts = snapPoints(box);
    expect(nearestSnap(pts, [9.8, 0.1, 1.9], 0.5)).toEqual([10, 0, 2]);
    expect(nearestSnap(pts, [5.2, 1.9, 2], 0.5)).toEqual([5, 2, 2]);
    expect(nearestSnap(pts, [3, 3, 1], 0.5)).toBeNull();
  });
});

describe('measureBetween and measureText', () => {
  it('gives the length and the axis deltas', () => {
    const m = measureBetween([0, 0, 0], [3, 4, 0]);
    expect(m.length).toBe(5);
    expect(m.delta).toEqual([3, 4, 0]);
    expect(measureText(m, fmt)).toBe('5"  ΔX 3"  ΔY 4"');
  });
  it('skips the breakdown for a measurement along one axis', () => {
    expect(measureText(measureBetween([0, 0, 0], [48.5, 0, 0]), fmt)).toBe('48 1/2"');
  });
});
