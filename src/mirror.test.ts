import { describe, expect, it } from 'vitest';
import {
  DEFAULT_Q,
  localAxisAlong,
  makeQ,
  mirrorCut,
  mirrorParts,
  partAABB,
  unionAABB,
  type Cut,
  type Part,
} from './model';
import { Store } from './store';

const board = (over: Partial<Part> = {}): Part => ({
  id: 1,
  stock: '2x4',
  len: 96,
  pos: [0, 0, 0],
  q: [...DEFAULT_Q] as Part['q'],
  name: '2x4 1',
  ...over,
});
const dims: [number, number, number] = [96, 3.5, 1.5];

describe('localAxisAlong', () => {
  it('finds which local axis lies along a world axis', () => {
    expect(localAxisAlong(DEFAULT_Q, 0)).toBe(0);
    expect(localAxisAlong(DEFAULT_Q, 1)).toBe(1);
    expect(localAxisAlong(DEFAULT_Q, 2)).toBe(2);
    const stood = makeQ(['y']); // length now runs up
    expect(localAxisAlong(stood, 2)).toBe(0);
    expect(localAxisAlong(stood, 0)).toBe(2);
    const turned = makeQ(['z']); // length along Y
    expect(localAxisAlong(turned, 1)).toBe(0);
    expect(localAxisAlong(turned, 0)).toBe(1);
  });
});

describe('mirrorParts', () => {
  it('reflects positions through the selection centre and keeps every box', () => {
    const a = board({ id: 1, pos: [0, 0, 0] });
    const b = board({ id: 2, len: 48, pos: [30, 10, 5] });
    const before = unionAABB([a, b]);
    mirrorParts([a, b], 'x');
    expect(unionAABB([a, b])).toEqual(before);
    // union −48..54, centre 3: a (centre 0) lands at 6, b (centre 30) at −24
    expect(a.pos[0]).toBeCloseTo(6);
    expect(b.pos[0]).toBeCloseTo(-24);
    expect(b.pos[1]).toBe(10);
    expect(a.q).toEqual(DEFAULT_Q);
  });

  it('leaves a single plain board where it was', () => {
    const p = board({ pos: [12, -3, 7] });
    const before = partAABB(p);
    mirrorParts([p], 'y');
    expect(partAABB(p)).toEqual(before);
    expect(p.pos).toEqual([12, -3, 7]);
  });

  it('swaps miter ends when mirrored along the length', () => {
    const p = board({ miter: [45, -30] });
    mirrorParts([p], 'x');
    expect(p.miter).toEqual([-30, 45]);
  });

  it('flips miter sides when mirrored across the width', () => {
    const p = board({ miter: [45, 0] });
    mirrorParts([p], 'y');
    expect(p.miter).toEqual([-45, 0]);
    mirrorParts([p], 'z');
    expect(p.miter).toEqual([-45, 0]);
  });

  it('follows the local axis of a turned board', () => {
    const p = board({ q: makeQ(['z']), miter: [45, -30] }); // length along Y
    mirrorParts([p], 'y');
    expect(p.miter).toEqual([-30, 45]);
    mirrorParts([p], 'x');
    expect(p.miter).toEqual([30, -45]);
  });

  it('moves cuts to the opposite end, edge or face', () => {
    const dado: Cut = { kind: 'dado', face: 'top', at: 12, width: 0.75, depth: 0.375 };
    const groove: Cut = { kind: 'groove', face: 'bottom', at: 0.5, width: 0.25, depth: 0.375 };
    const rabbet: Cut = { kind: 'rabbet', face: 'top', edge: 'endA', width: 0.75, depth: 0.375 };
    const notch: Cut = { kind: 'notch', edge: 'front', at: 12, width: 1.5, depth: 1.5 };
    expect(mirrorCut(dado, 0, dims)).toEqual({ ...dado, at: 96 - 12.75 });
    expect(mirrorCut(rabbet, 0, dims)).toEqual({ ...rabbet, edge: 'endB' });
    expect(mirrorCut(notch, 0, dims)).toEqual({ ...notch, at: 96 - 13.5 });
    expect(mirrorCut(groove, 0, dims)).toEqual(groove);
    expect(mirrorCut(groove, 1, dims)).toEqual({ ...groove, at: 3.5 - 0.75 });
    expect(mirrorCut(notch, 1, dims)).toEqual({ ...notch, edge: 'back' });
    expect(mirrorCut(rabbet, 1, dims)).toEqual(rabbet);
    expect(mirrorCut(dado, 2, dims)).toEqual({ ...dado, face: 'bottom' });
    expect(mirrorCut(groove, 2, dims)).toEqual({ ...groove, face: 'top' });
    expect(mirrorCut(notch, 2, dims)).toEqual(notch);
    const p = board({ cuts: [dado, rabbet] });
    mirrorParts([p], 'x');
    expect(p.cuts).toEqual([
      { ...dado, at: 96 - 12.75 },
      { ...rabbet, edge: 'endB' },
    ]);
    mirrorParts([p], 'x');
    expect(p.cuts).toEqual([dado, rabbet]);
  });

  it('is its own inverse', () => {
    const a = board({ id: 1, pos: [3, 4, 5], q: makeQ(['x', 'z']), miter: [20, 35] });
    const b = board({
      id: 2,
      len: 20,
      pos: [-10, 8, 0],
      cuts: [{ kind: 'notch', edge: 'back', at: 2, width: 1, depth: 1 }],
    });
    const snap = JSON.stringify([a, b]);
    for (const axis of ['x', 'y', 'z'] as const) {
      mirrorParts([a, b], axis);
      mirrorParts([a, b], axis);
      expect(JSON.parse(JSON.stringify([a, b]))).toEqual(JSON.parse(snap));
    }
  });
});

describe('Store.mirrorSelected', () => {
  it('mirrors the selection in one undo step', () => {
    const s = new Store();
    const a = s.addPart('2x4');
    const b = s.addPart('2x4');
    s.mutate(() => {
      b.pos[0] += 40;
      b.miter = [45, 0];
    });
    const ax = a.pos[0];
    s.select([a.id, b.id]);
    s.mirrorSelected('x');
    expect(s.partById(b.id)!.pos[0]).toBeCloseTo(ax);
    expect(s.partById(a.id)!.pos[0]).toBeCloseTo(ax + 40);
    expect(s.partById(b.id)!.miter).toEqual([0, 45]);
    s.undo();
    expect(s.partById(b.id)!.miter).toEqual([45, 0]);
  });
});
