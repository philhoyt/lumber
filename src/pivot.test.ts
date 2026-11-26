import { describe, expect, it } from 'vitest';
import { createPart, partAABB, pivotLabel, pivotPoint, rotatePartsBy, unionAABB } from './model';

/** A flat 2x4, 48" long, lying on the floor with its centre at the origin. */
const slab = () => {
  const p = createPart(1, '2x4', [0, 0, 0]);
  p.len = 48;
  p.pos = [0, 0, 0.75];
  return p;
};

describe('pivotPoint', () => {
  it('names the centre and the four bottom corners', () => {
    const u = unionAABB([slab()]);
    expect(pivotPoint(u, 'center')).toEqual([0, 0, 0.75]);
    expect(pivotPoint(u, 'front-left')).toEqual([-24, -1.75, 0]);
    expect(pivotPoint(u, 'front-right')).toEqual([24, -1.75, 0]);
    expect(pivotPoint(u, 'back-right')).toEqual([24, 1.75, 0]);
    expect(pivotPoint(u, 'back-left')).toEqual([-24, 1.75, 0]);
    expect(pivotLabel('front-left')).toBe('bottom front-left corner');
    expect(pivotLabel('center')).toBe('centre');
  });
});

describe('rotatePartsBy about a pivot', () => {
  it('stands a flat board up on its front edge, which stays put', () => {
    const p = slab();
    const u = unionAABB([p]);
    rotatePartsBy([p], 'x', 90, pivotPoint(u, 'front-left'));
    const b = partAABB(p);
    // The front bottom edge (y = -1 3/4, z = 0) is the hinge: a positive turn about X
    // tips the board up in front of it, standing on that edge, 3 1/2 tall and 1 1/2 deep.
    expect(b.max[1]).toBeCloseTo(-1.75, 6);
    expect(b.min[1]).toBeCloseTo(-3.25, 6);
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect(b.max[2]).toBeCloseTo(3.5, 6);
    expect(b.min[0]).toBeCloseTo(-24, 6);
  });
  it('turns about the corner even when that lifts the part, unlike the centre pivot', () => {
    const p = slab();
    rotatePartsBy([p], 'x', -90, pivotPoint(unionAABB([p]), 'front-left'));
    expect(partAABB(p).max[2]).toBeCloseTo(0, 6); // swung down below the floor: the user chose it
    const q = slab();
    rotatePartsBy([q], 'x', -90);
    expect(partAABB(q).min[2]).toBeCloseTo(0, 6); // about the centre it is set back on the floor
  });
});
