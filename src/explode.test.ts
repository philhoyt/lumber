import { describe, expect, it } from 'vitest';
import { EXPLODE_MAX, explodeOffsets, offsetAABB } from './explode';
import { DEFAULT_Q, type Part } from './model';

const board = (over: Partial<Part> = {}): Part => ({
  id: 1,
  stock: '2x4',
  len: 96,
  pos: [0, 0, 0],
  q: [...DEFAULT_Q] as Part['q'],
  name: '2x4 1',
  ...over,
});
const loose = () => undefined;

describe('explodeOffsets', () => {
  it('moves nothing at zero, and nothing for a single part', () => {
    const a = board({ id: 1, pos: [0, 0, 0] });
    const b = board({ id: 2, pos: [0, 20, 0] });
    for (const o of explodeOffsets([a, b], loose, 0).values()) expect(o).toEqual([0, 0, 0]);
    expect(explodeOffsets([a], loose, 1).get(1)).toEqual([0, 0, 0]);
    expect(explodeOffsets([], loose, 1).size).toBe(0);
  });

  it('pushes parts apart along the line from the model centre, in proportion', () => {
    const a = board({ id: 1, pos: [0, 0, 0] });
    const b = board({ id: 2, pos: [0, 20, 0] });
    const c = board({ id: 3, pos: [0, 10, 30] });
    const o = explodeOffsets([a, b, c], loose, 1);
    // Centre of the union is (0, 10, 15).
    expect(o.get(1)).toEqual([0, -10 * EXPLODE_MAX, -15 * EXPLODE_MAX]);
    expect(o.get(2)).toEqual([0, 10 * EXPLODE_MAX, -15 * EXPLODE_MAX]);
    expect(o.get(3)).toEqual([0, 0, 15 * EXPLODE_MAX]);
    const half = explodeOffsets([a, b, c], loose, 0.5);
    expect(half.get(2)).toEqual([0, 5 * EXPLODE_MAX, -7.5 * EXPLODE_MAX]);
  });

  it('clamps the amount to 0..1', () => {
    const a = board({ id: 1, pos: [0, 0, 0] });
    const b = board({ id: 2, pos: [0, 20, 0] });
    expect(explodeOffsets([a, b], loose, 7).get(2)).toEqual(
      explodeOffsets([a, b], loose, 1).get(2),
    );
    expect(explodeOffsets([a, b], loose, -1).get(2)).toEqual([0, 0, 0]);
  });

  it('moves a group as a unit and spreads its parts at half the rate', () => {
    const a = board({ id: 1, pos: [0, 0, 0], group: 9 });
    const b = board({ id: 2, pos: [0, 20, 0], group: 9 });
    const c = board({ id: 3, pos: [0, 60, 0] });
    const root = (p: Part) => p.group;
    const o = explodeOffsets([a, b, c], root, 1);
    // Model centre y = 30; group centre y = 10; c is at 60.
    const k = EXPLODE_MAX;
    expect(o.get(1)).toEqual([0, (10 - 30) * k + (0 - 10) * k * 0.5, 0]);
    expect(o.get(2)).toEqual([0, (10 - 30) * k + (20 - 10) * k * 0.5, 0]);
    expect(o.get(3)).toEqual([0, 30 * k, 0]);
    // The two group members stay closer to each other than to the loose part.
    expect(Math.abs(o.get(1)![1] - o.get(2)![1])).toBeLessThan(
      Math.abs(o.get(2)![1] - o.get(3)![1]),
    );
  });

  it('shifts a bounding box by an offset', () => {
    const a = board();
    expect(offsetAABB(a, [1, 2, 3])).toEqual({ min: [-47, 0.25, 2.25], max: [49, 3.75, 3.75] });
  });
});
