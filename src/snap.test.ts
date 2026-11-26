import { describe, expect, it } from 'vitest';
import type { AABB, Vec3 } from './model';
import { coplanarFaces, snapQuads, snapWithHits } from './snap';

/** The adjusted movement alone. */
const snapDelta = (...args: Parameters<typeof snapWithHits>): Vec3 => snapWithHits(...args).delta;

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
    const lifted = box([0, 0, 0.9], [10, 4, 2.9]);
    const d = snapDelta(lifted, [0, 0, 0], [2], [], opts);
    expect(d[2]).toBeCloseTo(-0.9);
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

describe('snapWithHits', () => {
  it('says which face of which box each axis snapped to', () => {
    const other = box([20.6, 0, 0], [30, 2, 4]);
    const { delta, hits } = snapWithHits(moving, [10, 0, 0], [0], [other], opts);
    expect(delta[0]).toBeCloseTo(10.6);
    expect(hits).toEqual([{ axis: 0, kind: 'face', other: 0, side: 'min', mine: 'max', at: 20.6 }]);
  });

  it('reports the floor and the grid', () => {
    const lifted = box([0, 0, 0.9], [10, 4, 2.9]);
    expect(snapWithHits(lifted, [0, 0, 0], [2], [], opts).hits).toEqual([
      { axis: 2, kind: 'floor', mine: 'min', at: 0 },
    ]);
    expect(snapWithHits(moving, [3.3, 0, 0], [0], [], opts).hits).toEqual([
      { axis: 0, kind: 'grid', mine: 'min', at: 3.5 },
    ]);
    expect(snapWithHits(moving, [3.3, 0, 0], [0], [], { grid: 0, snapParts: true }).hits).toEqual(
      [],
    );
  });

  it("draws the other box's whole face, the footprint on the floor, nothing for the grid", () => {
    const other = box([20.6, -1, 0], [30, 3, 6]);
    const { hits } = snapWithHits(moving, [10, 0, 0], [0], [other], opts);
    expect(snapQuads(hits[0]!, box([10.6, 0, 0], [20.6, 2, 4]), [other])).toEqual([
      { axis: 0, lo: [20.6, -1, 0], hi: [20.6, 3, 6] },
    ]);
    const lifted = box([0, 0, 0.9], [10, 4, 2.9]);
    const floor = snapWithHits(lifted, [0, 0, 0], [2], [], opts).hits[0]!;
    expect(snapQuads(floor, box([0, 0, 0], [10, 4, 2]), [])).toEqual([
      { axis: 2, lo: [0, 0, 0], hi: [10, 4, 0] },
    ]);
    const grid = snapWithHits(moving, [3.3, 0, 0], [0], [], opts).hits[0]!;
    expect(snapQuads(grid, moving, [])).toEqual([]);
  });

  it('lights every face that lies on the snapped plane, the hit face first', () => {
    const legA = box([20.6, 0, 0], [22, 2, 30]);
    const legB = box([20.6, 40, 0], [22, 42, 30]);
    const rail = box([0, 10, 0], [20.6, 12, 4]); // its max X face is on the same plane
    const other = box([50, 0, 0], [60, 2, 4]);
    const { hits } = snapWithHits(moving, [10, 0, 0], [0], [legB, rail, legA, other], opts);
    const faces = coplanarFaces(hits[0]!, [legB, rail, legA, other]);
    expect(faces[0]).toEqual({ other: hits[0]!.other, side: 'min' });
    expect(faces).toHaveLength(3);
    expect(faces.map((f) => f.other).sort()).toEqual([0, 1, 2]);
    expect(faces.find((f) => f.other === 1)!.side).toBe('max');
    expect(snapQuads(hits[0]!, moving, [legB, rail, legA, other])).toHaveLength(3);
    expect(coplanarFaces({ axis: 2, kind: 'floor', mine: 'min', at: 0 }, [legA])).toEqual([]);
  });
});
