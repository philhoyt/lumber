import { describe, expect, it } from 'vitest';
import { boxGap, centerBetween, gapText, spaceBetween } from './gap';
import type { AABB } from './model';
import { fmt } from './units';

const box = (min: [number, number, number], max: [number, number, number]): AABB => ({
  min,
  max,
});
// Two studs on edge, 1 1/2" thick, at 16" on centre along X.
const studA = box([0, 0, 0], [1.5, 3.5, 92.625]);
const studB = box([16, 0, 0], [17.5, 3.5, 92.625]);

describe('boxGap', () => {
  it('finds the clear distance, the spacing and the closest points', () => {
    const g = boxGap(studA, studB);
    expect(g.axis).toBe(0);
    expect(g.gaps).toEqual([14.5, 0, 0]);
    expect(g.oc[0]).toBe(16);
    expect(g.from).toEqual([1.5, 1.75, 92.625 / 2]);
    expect(g.to).toEqual([16, 1.75, 92.625 / 2]);
    expect(g.distance).toBe(14.5);
  });
  it('is the same the other way round, with the sign of the spacing flipped', () => {
    const g = boxGap(studB, studA);
    expect(g.gaps).toEqual([14.5, 0, 0]);
    expect(g.oc[0]).toBe(-16);
    expect(g.from[0]).toBe(16);
    expect(g.to[0]).toBe(1.5);
  });
  it('picks the axis of the widest gap and measures corner to corner', () => {
    const g = boxGap(box([0, 0, 0], [1, 1, 1]), box([4, 5, 0], [5, 6, 1]));
    expect(g.axis).toBe(1);
    expect(g.gaps).toEqual([3, 4, 0]);
    expect(g.distance).toBe(5);
  });
  it('reports touching and overlapping boxes with no gap', () => {
    expect(boxGap(studA, box([1.5, 0, 0], [3, 3.5, 92.625])).axis).toBeNull();
    const o = boxGap(studA, box([1, 1, 1], [2, 2, 2]));
    expect(o.axis).toBeNull();
    expect(o.gaps).toEqual([0, 0, 0]);
    expect(o.distance).toBe(0);
  });
});

describe('gapText', () => {
  it('reads out the gap and the spacing', () => {
    expect(gapText(boxGap(studA, studB), fmt)).toBe('Gap X 14 1/2"  ·  16" o.c.');
  });
  it('adds the straight line when the boxes are offset on other axes too', () => {
    const g = boxGap(box([0, 0, 0], [1, 1, 1]), box([4, 5, 0], [5, 6, 1]));
    expect(gapText(g, fmt)).toBe('Gap Y 4"  ·  5" o.c.  ·  5" straight');
  });
  it('says touching with the spacing, or overlapping', () => {
    expect(gapText(boxGap(studA, box([1.5, 0, 0], [3, 3.5, 92.625])), fmt)).toBe(
      'Touching  ·  X 1 1/2" o.c.',
    );
    expect(gapText(boxGap(studA, studA), fmt)).toBe('Overlapping');
  });
});

describe('centerBetween', () => {
  it('moves the selection to the middle of the gap, on the gap axis only', () => {
    // Inner joists hanging left of centre between studA (0..1 1/2) and a joist at 46 1/2..48.
    const outer = box([46.5, 0, 0], [48, 3.5, 92.625]);
    const inner = box([5, 0, 0], [35, 3.5, 92.625]);
    expect(centerBetween(inner, studA, outer)).toEqual({ axis: 0, delta: 4 });
    expect(centerBetween(inner, outer, studA)).toEqual({ axis: 0, delta: 4 });
  });
  it('uses the centres when the two overlap, and gives up when they coincide', () => {
    const low = box([0, 0, 0], [10, 10, 1]);
    const high = box([0, 0, 0.5], [10, 10, 1.5]);
    const sel = box([0, 0, 5], [1, 1, 6]);
    expect(centerBetween(sel, low, high)).toEqual({ axis: 2, delta: -4.75 });
    expect(centerBetween(sel, low, low)).toBeNull();
  });
});

describe('spaceBetween', () => {
  it('spreads the units with equal clear gaps, keeping their order', () => {
    // Two 1 1/2" joists between studA (0..1 1/2) and a joist at 46 1/2..48: 45" clear.
    const outer = box([46.5, 0, 0], [48, 3.5, 92.625]);
    const j1 = { id: 'near', box: box([3, 0, 0], [4.5, 3.5, 92.625]) };
    const j2 = { id: 'far', box: box([40, 0, 0], [41.5, 3.5, 92.625]) };
    const r = spaceBetween([j2, j1], studA, outer)!;
    expect(r.axis).toBe(0);
    expect(r.gap).toBe(14); // (45 - 3) / 3
    expect(r.moves).toEqual([
      { id: 'near', delta: 12.5 }, // to 15.5
      { id: 'far', delta: -9 }, // to 31
    ]);
  });
  it('works whichever reference comes first, and on other axes', () => {
    const low = box([0, 0, 0], [10, 10, 1]);
    const high = box([0, 0, 13], [10, 10, 14]);
    const u = { id: 1, box: box([0, 0, 2], [10, 10, 3]) };
    expect(spaceBetween([u], high, low)!.moves).toEqual([{ id: 1, delta: 4.5 }]);
    expect(spaceBetween([u], low, high)!.axis).toBe(2);
  });
  it('gives up when the references coincide or nothing is selected', () => {
    const b = box([0, 0, 0], [1, 1, 1]);
    expect(spaceBetween([{ id: 1, box: b }], b, b)).toBeNull();
    expect(spaceBetween([], b, box([5, 0, 0], [6, 1, 1]))).toBeNull();
  });
});
