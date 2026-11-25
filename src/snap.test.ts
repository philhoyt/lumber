import { describe, expect, it } from 'vitest';
import type { AABB, Vec3 } from './model';
import { snapDelta } from './snap';

const box = (min: Vec3, max: Vec3): AABB => ({ min, max });
const moving = box([0, 0, 0], [10, 2, 4]);
const opts = { grid: 0.5, snapParts: true };

describe('snapDelta', () => {
  it('butts a moving box against a neighbour within tolerance', () => {
    const other = box([20.6, 0, 0], [30, 2, 4]);
    // moving right by 10 would put my max at 20, 0.6" short of the other's min
    const d = snapDelta(moving, [10, 0, 0], [0], [other], opts);
    expect(d[0]).toBeCloseTo(10.6);
  });

  it('aligns flush with a neighbour face', () => {
    const other = box([-0.8, 0, 0], [5, 2, 4]);
    const d = snapDelta(moving, [0, 0, 0], [0], [other], opts);
    expect(d[0]).toBeCloseTo(-0.8);
  });

  it('prefers the nearest face', () => {
    const near = box([10.3, 0, 0], [12, 2, 4]);
    const far = box([11, 0, 0], [12, 2, 4]);
    const d = snapDelta(moving, [0, 0, 0], [0], [far, near], opts);
    expect(d[0]).toBeCloseTo(0.3);
  });

  it('snaps to the floor on the vertical axis', () => {
    const lifted = box([0, 0.9, 0], [10, 2.9, 4]);
    const d = snapDelta(lifted, [0, 0, 0], [1], [], opts);
    expect(d[1]).toBeCloseTo(-0.9);
  });

  it('falls back to the grid when no face is in reach', () => {
    const d = snapDelta(moving, [3.3, 0, 7.8], [0, 2], [], opts);
    expect(d[0]).toBeCloseTo(3.5);
    expect(d[2]).toBeCloseTo(8);
  });

  it('ignores parts when snapParts is off', () => {
    const other = box([10.3, 0, 0], [12, 2, 4]);
    const d = snapDelta(moving, [0, 0, 0], [0], [other], { grid: 0, snapParts: false });
    expect(d[0]).toBe(0);
  });

  it('leaves the delta alone with grid off and nothing nearby', () => {
    const d = snapDelta(moving, [3.3, 0, 0], [0], [], { grid: 0, snapParts: true });
    expect(d[0]).toBe(3.3);
  });

  it('only touches the requested axes', () => {
    const d = snapDelta(moving, [3.3, 4.4, 5.5], [0], [], opts);
    expect(d).toEqual([3.5, 4.4, 5.5]);
  });
});
