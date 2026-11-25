import { describe, expect, it } from 'vitest';
import {
  aabbSize,
  clonePart,
  createPart,
  makeQ,
  partAABB,
  rotateParts,
  unionAABB,
  withMinKept,
  type Part,
} from './model';

const board = (over: Partial<Part> = {}): Part => ({
  id: 1,
  stock: '2x4',
  len: 96,
  pos: [0, 0, 0],
  q: makeQ(['x']),
  name: '2x4 1',
  ...over,
});

describe('partAABB', () => {
  it('lays a default board flat: length along X, width along Z, thickness up', () => {
    const b = partAABB(board());
    expect(b.min).toEqual([-48, -0.75, -1.75]);
    expect(b.max).toEqual([48, 0.75, 1.75]);
  });

  it('stands a board up with the x,z rotation sequence', () => {
    const b = partAABB(board({ q: makeQ(['x', 'z']) }));
    expect(aabbSize(b)).toEqual([1.5, 96, 3.5]);
  });

  it('puts a board on edge with x,x', () => {
    const b = partAABB(board({ q: makeQ(['x', 'x']) }));
    expect(aabbSize(b)).toEqual([96, 3.5, 1.5]);
  });

  it('sizes a sheet part by its cut width', () => {
    const b = partAABB(board({ stock: 'ply34', len: 48, w: 24 }));
    expect(aabbSize(b)).toEqual([48, 0.75, 24]);
  });

  it('offsets by the position', () => {
    const b = partAABB(board({ pos: [10, 20, 30] }));
    expect(b.min).toEqual([-38, 19.25, 28.25]);
  });
});

describe('createPart', () => {
  it('rests a new board on the ground, centred on the drop point', () => {
    const p = createPart(7, '2x4', [10, 0, -5]);
    const b = partAABB(p);
    expect(b.min[1]).toBe(0);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(10);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(-5);
    expect(p.len).toBe(96);
    expect(p.name).toBe('2x4 7');
  });

  it('creates a full sheet for sheet stock', () => {
    const p = createPart(1, 'ply34', [0, 0, 0]);
    expect(p.len).toBe(96);
    expect(p.w).toBe(48);
  });
});

describe('withMinKept', () => {
  it('keeps the min corner fixed when the length changes', () => {
    const p = board({ pos: [10, 0, 0] });
    const before = partAABB(p).min;
    withMinKept(p, (x) => (x.len = 48));
    expect(partAABB(p).min).toEqual(before);
    expect(aabbSize(partAABB(p))[0]).toBe(48);
  });
});

describe('rotateParts', () => {
  it('rotates about the vertical axis and keeps the floor height', () => {
    const p = board({ pos: [0, 5, 0] });
    rotateParts([p], 'y');
    const b = partAABB(p);
    expect(aabbSize(b)).toEqual([3.5, 1.5, 96]);
    expect(b.min[1]).toBeCloseTo(5 - 0.75);
  });

  it('keeps a tipped board resting at its previous bottom', () => {
    const p = board();
    const bottom = partAABB(p).min[1];
    rotateParts([p], 'z');
    const b = partAABB(p);
    expect(aabbSize(b)[1]).toBe(96);
    expect(b.min[1]).toBeCloseTo(bottom);
  });

  it('rotates a group as a unit about its shared centre', () => {
    const a = board({ id: 1, pos: [0, 0, 0] });
    const c = board({ id: 2, pos: [0, 0, 20] });
    rotateParts([a, c], 'y');
    const u = unionAABB([a, c]);
    expect(aabbSize(u)).toEqual([23.5, 1.5, 96]);
    expect(a.pos[0]).toBeCloseTo(-c.pos[0] + 2 * 0, 6);
    expect(Math.abs(a.pos[0] - c.pos[0])).toBeCloseTo(20);
  });
});

describe('clonePart', () => {
  it('copies with a new id, name and offset without sharing arrays', () => {
    const p = board();
    const c = clonePart(p, 9, [16, 0, 0]);
    expect(c.id).toBe(9);
    expect(c.name).toBe('2x4 9');
    expect(c.pos).toEqual([16, 0, 0]);
    c.q[0] = 123;
    expect(p.q[0]).not.toBe(123);
  });
});
