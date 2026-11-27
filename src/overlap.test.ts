import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { makeQ, type Part, type Quat } from './model';
import { findOverlaps, OVERLAP_TOL, overlapsOf } from './overlap';

let nextId = 1;
const part = (over: Partial<Part> & { pos: Part['pos'] }): Part => ({
  id: nextId++,
  stock: '2x4',
  len: 48,
  q: makeQ([]),
  name: `p${nextId}`,
  ...over,
});
/** A stud standing on end: length along Z, 1 1/2" across X. */
const stud = (x: number, over: Partial<Part> = {}): Part =>
  part({ q: makeQ(['y']), len: 92.625, pos: [x, 0, 92.625 / 2], ...over });
const aboutY = (deg: number): Quat =>
  new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180).toArray();

describe('findOverlaps', () => {
  it('leaves studs at 16" on centre and parts that only touch alone', () => {
    expect(findOverlaps([stud(0), stud(16), stud(32)]).pairs).toEqual([]);
    expect(findOverlaps([stud(0), stud(1.5)]).pairs).toEqual([]);
    // Float noise and a hair of interference are still touching.
    expect(findOverlaps([stud(0), stud(1.5 - OVERLAP_TOL / 2)]).pairs).toEqual([]);
  });
  it('reports two parts that share space, with how deep', () => {
    const a = stud(0);
    const b = stud(1);
    const r = findOverlaps([a, b, stud(32)]);
    expect(r.pairs).toEqual([{ a: a.id, b: b.id, depth: 0.5 }]);
    expect([...r.ids]).toEqual([a.id, b.id]);
    expect(overlapsOf(r, a.id)).toEqual([b.id]);
    expect(overlapsOf(r, b.id)).toEqual([a.id]);
    expect(overlapsOf(r, 999)).toEqual([]);
  });
  it('judges a tilted board by its real solid, not its bounding box', () => {
    const upright = stud(0, { len: 48, pos: [0, 0, 24] });
    // Leaning 45° about Y: its box reaches over the stud, the board itself passes above it.
    const clear = part({ q: aboutY(45), pos: [16, 0, 40] });
    expect(findOverlaps([upright, clear]).pairs).toEqual([]);
    // Lower, and it runs through the stud.
    const hit = part({ q: aboutY(45), pos: [16, 0, 24] });
    expect(findOverlaps([upright, hit]).pairs).toHaveLength(1);
  });
  it('knows a mitered end is cut away', () => {
    // End A mitered 45°: the corner at the back edge is gone, so a block there is clear.
    const board = part({ pos: [0, 0, 0.75], miter: [45, 0] });
    const block = part({ stock: '2x2', len: 1.5, pos: [-23.25, 1.125, 0.75] });
    expect(findOverlaps([board, block]).pairs).toEqual([]);
    const square = part({ pos: [0, 0, 0.75] });
    expect(findOverlaps([square, block]).pairs).toHaveLength(1);
  });
  it('lets a part sit in a dado, but not beside it', () => {
    const host = part({
      pos: [0, 0, 0.75],
      cuts: [{ kind: 'dado', face: 'top', at: 12, width: 0.75, depth: 0.375 }],
    });
    // A 1x4 on end, its 3/4" thickness across X, standing in the dado's floor.
    const divider = part({ stock: '1x4', len: 10, q: makeQ(['y']), pos: [-11.625, 0, 6.125] });
    expect(findOverlaps([host, divider]).pairs).toEqual([]);
    divider.pos = [-11.5, 0, 6.125];
    expect(findOverlaps([host, divider]).pairs).toHaveLength(1);
    // A chamfer is no pocket.
    host.cuts = [{ kind: 'chamfer', face: 'top', edge: 'front', width: 1, depth: 1 }];
    const onEdge = part({ stock: '2x2', len: 1.5, pos: [0, -1.5, 1.25] });
    expect(findOverlaps([host, onEdge]).pairs).toHaveLength(1);
  });
  it('leaves reference stand-ins out: one placed through the frame is a choice', () => {
    const box = (x: number) => part({ stock: 'ref', len: 12, w: 12, t: 12, pos: [x, 0, 6] });
    expect(findOverlaps([box(0), box(6)]).pairs).toEqual([]);
    expect(findOverlaps([box(0), stud(0)]).pairs).toEqual([]);
  });
});
