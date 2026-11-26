import { describe, expect, it } from 'vitest';
import { applyFit, endTarget, fitEnd } from './fit';
import {
  endCutCorners,
  makeQ,
  mirrorParts,
  quatFromEuler,
  sawBevel,
  shortLength,
  type Part,
  type Vec3,
} from './model';
import { Quaternion, Vector3 } from 'three';

const part = (over: Partial<Part> = {}): Part => ({
  id: 1,
  stock: '2x4',
  len: 48,
  pos: [0, 0, 0.75],
  q: makeQ([]),
  name: 'brace',
  ...over,
});

/** A part's corners in world space. */
const worldCorners = (p: Part, dims: Vec3): Vec3[] => {
  const q = new Quaternion().fromArray(p.q);
  return endCutCorners(dims, p.miter ?? [0, 0], p.bevel ?? [0, 0]).map((c) => {
    const v = new Vector3().fromArray(c).applyQuaternion(q);
    return [v.x + p.pos[0], v.y + p.pos[1], v.z + p.pos[2]];
  });
};

describe('endCutCorners and shortLength', () => {
  const dims: Vec3 = [48, 3.5, 1.5];
  it('is a plain box when square', () => {
    const c = endCutCorners(dims, [0, 0], [0, 0]);
    expect(c[0]).toEqual([-24, -1.75, -0.75]);
    expect(c[7]).toEqual([24, 1.75, 0.75]);
    expect(shortLength(dims, [0, 0])).toBe(48);
  });
  it('a bevel shortens the face the short point is on', () => {
    const c = endCutCorners(dims, [0, 0], [0, 45]); // end B, short point on top
    expect(c[1]![0]).toBeCloseTo(24, 9); // bottom corner keeps the long point
    expect(c[5]![0]).toBeCloseTo(24 - 1.5, 9); // top corner comes back by the thickness
    expect(shortLength(dims, [0, 0], [0, 45])).toBeCloseTo(46.5, 9);
    const neg = endCutCorners(dims, [0, 0], [0, -45]);
    expect(neg[1]![0]).toBeCloseTo(22.5, 9);
    expect(neg[5]![0]).toBeCloseTo(24, 9);
  });
  it('a compound end takes both setbacks off one corner', () => {
    expect(shortLength(dims, [45, 0], [45, 0])).toBeCloseTo(48 - 3.5 - 1.5, 9);
    // Short points on opposite edges: no single edge loses both.
    expect(shortLength(dims, [45, -45], [0, 0])).toBeCloseTo(48 - 3.5, 9);
  });
  it('gives the saw bevel for a compound cut', () => {
    expect(sawBevel(0, 30)).toBe(30);
    expect(sawBevel(45, 45)).toBe(35.5); // tan β = tan 45° · cos 45° → 35.26°, to a half degree
  });
});

describe('mirrorParts with bevels', () => {
  it('swaps the ends across X and flips the sign across Z', () => {
    const p = part({ bevel: [10, 0], miter: [5, 0] });
    mirrorParts([p], 'x');
    expect(p.bevel).toEqual([0, 10]);
    expect(p.miter).toEqual([0, 5]);
    const q = part({ bevel: [10, -20], q: makeQ(['x']) }); // thickness along Y: Z mirror leaves it
    mirrorParts([q], 'z');
    expect(q.bevel).toEqual([10, -20]);
    const r = part({ bevel: [10, -20] }); // flat: thickness along Z
    mirrorParts([r], 'z');
    expect(r.bevel).toEqual([-10, 20]);
  });
});

describe('fitEnd', () => {
  it('finds the floor under a tilted board and bevels the end to sit flat', () => {
    // A 2x4 tilted 30° about Y: its +X end points down toward the floor.
    const p = part({ q: quatFromEuler([0, 30, 0]), pos: [0, 0, 20] });
    const target = endTarget(p, 1, []);
    expect(target?.name).toBe('the floor');
    const fit = fitEnd(p, 1, [])!;
    expect(fit.miter).toBe(0);
    expect(Math.abs(fit.bevel)).toBe(60);
    applyFit(p, 1, fit);
    // Every corner of end B now lies on the floor.
    const c = worldCorners(p, [p.len, 3.5, 1.5]);
    for (const i of [1, 3, 5, 7]) expect(Math.abs(c[i]![2])).toBeLessThan(0.02); // angles to 1/2°, length to 1/64"
  });
  it('miters an in-plane brace to meet a flat face and lengthens it to touch', () => {
    // A brace turned 45° about Z, pointing at a wall whose face is the plane x = 40.
    const wall = part({ id: 2, name: 'wall', len: 60, pos: [40.75, 40, 30], q: makeQ(['y']) });
    const p = part({ q: quatFromEuler([0, 0, 45]), pos: [10, 10, 0.75] });
    const fit = fitEnd(p, 1, [wall])!;
    expect(fit.target).toBe('wall');
    expect(Math.abs(fit.miter)).toBe(45);
    expect(fit.bevel).toBe(0);
    applyFit(p, 1, fit);
    const c = worldCorners(p, [p.len, 3.5, 1.5]);
    for (const i of [1, 3, 5, 7]) expect(Math.abs(c[i]![0] - 40)).toBeLessThan(0.02);
  });
  it('leaves a square end square and just closes the gap', () => {
    const leg = part({ id: 2, name: 'leg', len: 30, pos: [30.75, 0, 15], q: makeQ(['y']) });
    const p = part({ pos: [0, 0, 10] }); // flat, pointing +X at the leg's face at x = 30
    const fit = fitEnd(p, 1, [leg])!;
    expect(fit).toMatchObject({ target: 'leg', miter: 0, bevel: 0 });
    expect(fit.extend).toBeCloseTo(6, 9);
    applyFit(p, 1, fit);
    expect(p.len).toBeCloseTo(54, 9);
    expect(p.pos[0]).toBeCloseTo(3, 9); // the −X end stayed at −24
  });
  it('gives up when nothing is in reach or the surface is too oblique', () => {
    const p = part({ pos: [0, 0, 10] });
    expect(fitEnd(p, 1, [])).toBeNull();
    const far = part({ id: 2, name: 'far', pos: [80, 0, 10] });
    expect(fitEnd(p, 1, [far])).toBeNull();
  });
});

describe('fitEnd against a leaning part', () => {
  it('cuts a kicker to lie flat on the back of a panel leaning 20 degrees', () => {
    // A 4x8 sheet standing up and leaning back, like a climbing wall panel.
    const panel: Part = {
      id: 2,
      stock: 'ply34',
      len: 96,
      w: 48,
      pos: [0, 10, 48],
      q: quatFromEuler([-70, 0, 0]),
      name: 'panel',
    };
    const pq = new Quaternion().fromArray(panel.q);
    const n = new Vector3(0, 0, 1).applyQuaternion(pq); // one broad face's outward normal
    const facePoint = new Vector3().fromArray(panel.pos).addScaledVector(n, 0.375);
    // A 2x4 kicker whose end A points at that face from an angle 10" away.
    const d = n
      .clone()
      .negate()
      .add(new Vector3(0, 0, -0.8))
      .normalize();
    const kq = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), d.clone().negate());
    const kpos = facePoint.clone().addScaledVector(d, -(24 + 10));
    const kicker = part({ pos: [kpos.x, kpos.y, kpos.z], q: [kq.x, kq.y, kq.z, kq.w] });
    const fit = fitEnd(kicker, 0, [panel], 60);
    expect(fit?.target).toBe('panel');
    expect(fit!.extend).toBeGreaterThan(5);
    applyFit(kicker, 0, fit!);
    // The cut end's four corners all lie on the panel's face plane.
    const c = worldCorners(kicker, [kicker.len, 3.5, 1.5]);
    for (const i of [0, 2, 4, 6]) {
      const off = n.dot(new Vector3().fromArray(c[i]!).sub(facePoint));
      expect(Math.abs(off)).toBeLessThan(0.03);
    }
  });
});
