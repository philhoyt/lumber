import { describe, expect, it } from 'vitest';
import {
  boxInFrame,
  coframedBoxes,
  extentAlong,
  isCoframed,
  localAxisDir,
  unionInFrame,
} from './frame';
import { createPart, makeQ, quatFromEuler, type Part } from './model';

const part = (q: Part['q'], pos: [number, number, number] = [0, 0, 0], len = 96): Part => {
  const p = createPart(1, '2x4', pos);
  p.len = len;
  p.q = q;
  return p;
};

describe('localAxisDir', () => {
  it('turns a local axis into its world direction', () => {
    const d = localAxisDir(makeQ(['y']), 0); // standing: length along world Z
    expect(Math.abs(d.z)).toBeCloseTo(1);
    const t = localAxisDir(quatFromEuler([-40, 0, 0]), 1); // width tilted about X
    expect(t.y).toBeCloseTo(Math.cos((40 * Math.PI) / 180));
    expect(t.z).toBeCloseTo(-Math.sin((40 * Math.PI) / 180));
  });
});

describe('isCoframed', () => {
  it('is true for parts whose axes line up, whatever the quarter turns', () => {
    expect(isCoframed(makeQ([]), makeQ(['y']))).toBe(true);
    const tilt = quatFromEuler([-40, 0, 0]);
    expect(isCoframed(tilt, tilt)).toBe(true);
    expect(isCoframed(makeQ([]), tilt)).toBe(false);
  });
});

describe('boxInFrame and extentAlong', () => {
  it('sees a tilted part as a plain box in its own frame', () => {
    const q = quatFromEuler([-40, 0, 0]);
    const p = part(q, [10, 20, 30], 60);
    const b = boxInFrame(p, q);
    expect(b.max[0] - b.min[0]).toBeCloseTo(60);
    expect(b.max[1] - b.min[1]).toBeCloseTo(3.5);
    expect(b.max[2] - b.min[2]).toBeCloseTo(1.5);
    expect(extentAlong([p], localAxisDir(q, 0))).toBeCloseTo(60);
    expect(extentAlong([p], localAxisDir(q, 2))).toBeCloseTo(1.5);
    // In the world frame the tilted box is fatter.
    const w = boxInFrame(p, makeQ([]));
    expect(w.max[2] - w.min[2]).toBeGreaterThan(1.5);
  });
  it('unions boxes', () => {
    const q = makeQ([]);
    const u = unionInFrame([part(q, [0, 0, 0], 10), part(q, [20, 0, 0], 10)], q);
    expect(u.min[0]).toBe(-5);
    expect(u.max[0]).toBe(25);
  });
});

describe('coframedBoxes', () => {
  it('keeps only the parts whose axes line up with the frame', () => {
    const tilt = quatFromEuler([-40, 0, 0]);
    const joist = part(tilt, [0, 0, 0], 60);
    const rail = part(tilt, [0, 10, 0], 60);
    rail.name = 'Rail';
    const flat = part(makeQ([]), [0, 30, 0], 60);
    flat.name = 'Flat';
    const r = coframedBoxes([rail, flat], joist.q);
    expect(r.names).toEqual(['Rail']);
    expect(r.boxes[0]!.max[0] - r.boxes[0]!.min[0]).toBeCloseTo(60);
  });
});
