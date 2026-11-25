import { describe, expect, it } from 'vitest';
import { dragOrbit, handleAt, handleView, layoutHandles, oppositeView } from './navGizmo';
import type { Vec3 } from './model';

// Camera looking from the front (-Y) with Z up: world X is screen right, Z is up, Y is away.
const FRONT: [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 0, -1],
  [0, 1, 0],
];

describe('layoutHandles', () => {
  it('puts +X on the right, +Z up, and -Y toward the viewer', () => {
    const spots = layoutHandles(FRONT, 30);
    const at = (axis: number, sign: number) =>
      spots.find((s) => s.axis === axis && s.sign === sign)!;
    expect([at(0, 1).x, at(0, 1).y]).toEqual([30, -0]);
    expect([at(2, 1).x, at(2, 1).y]).toEqual([0, -30]);
    expect(at(1, -1).depth).toBe(1);
    expect(at(1, 1).depth).toBe(-1);
  });
  it('orders farthest first so the nearest draws last', () => {
    const spots = layoutHandles(FRONT, 30);
    expect(spots[0]!.depth).toBeLessThanOrEqual(spots[5]!.depth);
    expect(spots[5]).toMatchObject({ axis: 1, sign: -1 });
  });
});

describe('handleAt', () => {
  it('finds the handle under the point and prefers the nearest', () => {
    const spots = layoutHandles(FRONT, 30);
    expect(handleAt(spots, 28, 2, 8)).toMatchObject({ axis: 0, sign: 1 });
    // +Y and -Y both sit at the centre: the near one (-Y) wins.
    expect(handleAt(spots, 0, 0, 8)).toMatchObject({ axis: 1, sign: -1 });
    expect(handleAt(spots, 15, 15, 8)).toBeNull();
  });
});

describe('handleView', () => {
  it('looks from the side of the handle', () => {
    expect(handleView({ axis: 0, sign: 1 }, null)).toBe('right');
    expect(handleView({ axis: 1, sign: -1 }, null)).toBe('front');
    expect(handleView({ axis: 2, sign: 1 }, null)).toBe('top');
  });
  it('flips to the other side when already looking from there', () => {
    expect(handleView({ axis: 1, sign: -1 }, [0, -1, 0])).toBe('back');
    expect(handleView({ axis: 1, sign: -1 }, [0, 1, 0])).toBe('front');
    expect(handleView({ axis: 2, sign: 1 }, [0.7, -0.7, 0.1])).toBe('top');
  });
  it('knows each view’s opposite', () => {
    expect(oppositeView('front')).toBe('back');
    expect(oppositeView('left')).toBe('right');
    expect(oppositeView('bottom')).toBe('top');
  });
});

describe('dragOrbit', () => {
  it('turns a quarter per radius dragged, the ball following the pointer', () => {
    expect(dragOrbit(30, 0, 30)).toEqual({ az: -90, el: 0 });
    expect(dragOrbit(0, 15, 30)).toEqual({ az: -0, el: 45 });
  });
});
