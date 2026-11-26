import { describe, expect, it } from 'vitest';
import { boxGap, gapText } from './gap';
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
