import { describe, expect, it } from 'vitest';
import {
  DEFAULT_Q,
  eulerDeg,
  isSquare,
  localAxisAlong,
  makeQ,
  mirrorParts,
  partAABB,
  partSnapPoints,
  quatFromEuler,
  rotatePartsBy,
  squareUp,
  type Part,
} from './model';

const part = (over: Partial<Part> = {}): Part => ({
  id: 1,
  stock: '2x4',
  len: 48,
  pos: [0, 0, 1.75],
  q: makeQ([]),
  name: 'p',
  ...over,
});

describe('rotatePartsBy', () => {
  it('tilts a part by any angle and keeps it on the floor', () => {
    const p = part();
    rotatePartsBy([p], 'y', 15);
    const e = eulerDeg(p.q);
    expect(e[1]).toBeCloseTo(15, 2);
    expect(e[0]).toBe(0);
    expect(e[2]).toBe(0);
    const b = partAABB(p);
    expect(b.min[2]).toBeCloseTo(1, 6); // the line it stood on: 1.75 centre, 1.5 thick
    // A 48" board tilted 15° about Y spans less along X and more along Z than flat.
    expect(b.max[0] - b.min[0]).toBeLessThan(48);
    expect(b.max[2] - b.min[2]).toBeGreaterThan(3.5);
    expect(isSquare(p.q)).toBe(false);
  });
  it('composes with quarter turns', () => {
    const p = part();
    rotatePartsBy([p], 'z', 90);
    rotatePartsBy([p], 'z', 90);
    expect(isSquare(p.q)).toBe(true);
    expect(Math.abs(eulerDeg(p.q)[2])).toBeCloseTo(180, 6);
  });
});

describe('euler round trip', () => {
  it('reads back the angles it was given', () => {
    const q = quatFromEuler([10, -20, 30]);
    const e = eulerDeg(q);
    expect(e[0]).toBeCloseTo(10, 2);
    expect(e[1]).toBeCloseTo(-20, 2);
    expect(e[2]).toBeCloseTo(30, 2);
    expect(eulerDeg(DEFAULT_Q)).toEqual([0, 0, 0]);
  });
});

describe('squareUp', () => {
  it('snaps a slight tilt back to the quarter-turn orientation it came from', () => {
    const base = makeQ(['x', 'z']);
    const tilted = quatFromEuler(
      eulerDeg(base).map((d, i) => d + (i === 1 ? 7 : -4)) as [number, number, number],
    );
    expect(isSquare(tilted)).toBe(false);
    const sq = squareUp(tilted);
    expect(isSquare(sq)).toBe(true);
    const a = eulerDeg(sq);
    const b = eulerDeg(base);
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i]!, 4);
  });
  it('leaves a square orientation alone', () => {
    expect(squareUp(DEFAULT_Q)).toEqual(DEFAULT_Q);
  });
});

describe('localAxisAlong on a tilted part', () => {
  it('picks the local axis leaning closest to the world axis', () => {
    const q = quatFromEuler([0, 30, 0]); // length tilted 30° up from X
    expect(localAxisAlong(q, 0)).toBe(0);
    expect(localAxisAlong(q, 2)).toBe(2);
    expect(localAxisAlong(q, 1)).toBe(1);
  });
});

describe('mirrorParts on a tilted part', () => {
  it('leans the mirror image the other way', () => {
    const p = part({ q: quatFromEuler([0, 20, 0]) });
    mirrorParts([p], 'x');
    const e = eulerDeg(p.q);
    expect(e[1]).toBeCloseTo(-20, 2);
    expect(e[0]).toBeCloseTo(0, 2);
    expect(e[2]).toBeCloseTo(0, 2);
  });
  it('keeps a square part square, as before', () => {
    const p = part({ q: makeQ(['z']) });
    const before = [...p.q];
    mirrorParts([p], 'y');
    expect(p.q).toEqual(before);
  });
});

describe('partSnapPoints', () => {
  it('gives the 26 corners, edge midpoints and face centres, turned with the part', () => {
    const p = part({ q: quatFromEuler([0, 0, 90]) }); // length along Y
    const pts = partSnapPoints(p);
    expect(pts).toHaveLength(26);
    const far = pts.map((v) => Math.abs(v[1]));
    expect(Math.max(...far)).toBeCloseTo(24, 5);
    expect(Math.max(...pts.map((v) => Math.abs(v[0])))).toBeCloseTo(1.75, 5);
  });
});
