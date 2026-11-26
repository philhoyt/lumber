import { describe, expect, it } from 'vitest';
import {
  clampCut,
  cutBox,
  cutsKey,
  defaultCut,
  describeCut,
  mirrorCut,
  type Cut,
  type Part,
} from './model';
import { chamferWedge, partGeometry } from './view/partMesh';
import { cutRows } from './pack';
import { parseDocument } from './document';
import { fmt } from './units';

const dims: [number, number, number] = [96, 3.5, 1.5]; // a 2x4

describe('cutBox', () => {
  it('a dado spans the width on the top face', () => {
    const b = cutBox({ kind: 'dado', face: 'top', at: 12, width: 0.75, depth: 0.375 }, dims)!;
    expect(b.min[0]).toBeCloseTo(-48 + 12);
    expect(b.max[0]).toBeCloseTo(-48 + 12.75);
    expect(b.min[1]).toBeLessThan(-1.75);
    expect(b.max[1]).toBeGreaterThan(1.75);
    expect(b.min[2]).toBeCloseTo(0.75 - 0.375);
    expect(b.max[2]).toBeGreaterThan(0.75);
  });

  it('a bottom-face groove runs the length, placed from the front edge', () => {
    const b = cutBox({ kind: 'groove', face: 'bottom', at: 0.5, width: 0.25, depth: 0.4 }, dims)!;
    expect(b.min[0]).toBeLessThan(-48);
    expect(b.max[0]).toBeGreaterThan(48);
    expect(b.min[1]).toBeCloseTo(-1.75 + 0.5);
    expect(b.max[1]).toBeCloseTo(-1.75 + 0.75);
    expect(b.min[2]).toBeLessThan(-0.75);
    expect(b.max[2]).toBeCloseTo(-0.75 + 0.4);
  });

  it('rabbets hug their edge', () => {
    const endB = cutBox({ kind: 'rabbet', face: 'top', edge: 'endB', width: 1, depth: 0.5 }, dims)!;
    expect(endB.min[0]).toBeCloseTo(47);
    expect(endB.max[0]).toBeGreaterThan(48);
    const back = cutBox({ kind: 'rabbet', face: 'top', edge: 'back', width: 1, depth: 0.5 }, dims)!;
    expect(back.min[1]).toBeCloseTo(0.75);
    expect(back.max[1]).toBeGreaterThan(1.75);
  });

  it('a notch goes through the thickness into an edge', () => {
    const b = cutBox({ kind: 'notch', edge: 'front', at: 10, width: 1.5, depth: 1.5 }, dims)!;
    expect(b.min[2]).toBeLessThan(-0.75);
    expect(b.max[2]).toBeGreaterThan(0.75);
    expect(b.min[1]).toBeLessThan(-1.75);
    expect(b.max[1]).toBeCloseTo(-1.75 + 1.5);
    expect(b.min[0]).toBeCloseTo(-38);
    expect(b.max[0]).toBeCloseTo(-36.5);
  });

  it('removes nothing when a size is zero', () => {
    expect(cutBox({ kind: 'dado', face: 'top', at: 12, width: 0, depth: 0.375 }, dims)).toBeNull();
    expect(cutBox({ kind: 'notch', edge: 'back', at: 0, width: 2, depth: 0 }, dims)).toBeNull();
  });
});

describe('clampCut and defaults', () => {
  it('keeps numbers within the part', () => {
    const c = clampCut({ kind: 'dado', face: 'top', at: 500, width: -1, depth: 9 }, dims);
    expect(c).toEqual({ kind: 'dado', face: 'top', at: 96, width: 0, depth: 1.5 });
    const n = clampCut({ kind: 'notch', edge: 'back', at: 1, width: 2, depth: 10 }, dims);
    expect(n.depth).toBe(3.5);
  });
  it('has a default of every kind', () => {
    for (const k of ['dado', 'groove', 'rabbet', 'notch', 'chamfer'] as const)
      expect(defaultCut(k).kind).toBe(k);
  });
});

describe('chamfer', () => {
  const front: Cut = { kind: 'chamfer', face: 'top', edge: 'front', width: 0.25, depth: 0.5 };
  it('boxes like a rabbet on the same edge and clamps the same way', () => {
    const b = cutBox(front, dims)!;
    expect(b.max[1]).toBeCloseTo(-1.75 + 0.25);
    expect(b.min[2]).toBeCloseTo(0.75 - 0.5);
    expect(clampCut({ ...front, width: 9, depth: 9 }, dims)).toMatchObject({
      width: 3.5,
      depth: 1.5,
    });
  });
  it('is a wedge: its sloped face runs from the width mark on the face to the depth mark on the edge', () => {
    const geo = chamferWedge(front, dims);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    expect(bb.min.y).toBeLessThan(-1.75); // pokes out past the front edge
    expect(bb.max.z).toBeGreaterThan(0.75); // and above the top face
    expect(bb.max.y).toBeCloseTo(-1.5 + 0.02 * 0.5, 6); // the chamfer line, extended past the face
    expect(bb.min.z).toBeCloseTo(0.25 - 0.02 * 2, 6); // and past the edge
    expect(bb.min.x).toBeLessThan(-48);
    expect(bb.max.x).toBeGreaterThan(48);
    expect(geo.getAttribute('position').count).toBe(24); // two triangles and three quads
  });
  it('takes a corner off the part without changing its bounds', () => {
    const p: Part = {
      id: 1,
      stock: '2x4',
      len: 96,
      pos: [0, 0, 0],
      q: [0, 0, 0, 1],
      name: 'a',
      cuts: [front],
    };
    const geo = partGeometry(p, dims);
    geo.computeBoundingBox();
    expect(geo.boundingBox!.max.z).toBeCloseTo(0.75, 5);
    expect(geo.boundingBox!.min.y).toBeCloseTo(-1.75, 5);
    expect(geo.getAttribute('position').count).toBeGreaterThan(36); // seven faces now
    // The corner itself is gone: no vertex sits at the front-top edge.
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++)
      expect(pos.getY(i) < -1.74 && pos.getZ(i) > 0.74).toBe(false);
  });
  it('subtracts from a mitered board too, which has no uv to carry', () => {
    const p: Part = {
      id: 1,
      stock: '2x4',
      len: 96,
      pos: [0, 0, 0],
      q: [0, 0, 0, 1],
      name: 'a',
      miter: [0, 45],
      cuts: [{ kind: 'dado', face: 'top', at: 12, width: 0.75, depth: 0.375 }],
    };
    expect(partGeometry(p, dims).getAttribute('position').count).toBeGreaterThan(36);
  });
  it('reads like a shop note and mirrors like a rabbet', () => {
    expect(describeCut({ ...front, depth: 0.25 }, fmt)).toBe(
      'chamfer 1/4" at 45° off front edge, top',
    );
    expect(describeCut(front, fmt)).toBe('chamfer 1/4" across × 1/2" down off front edge, top');
    expect(mirrorCut(front, 1, dims)).toMatchObject({ edge: 'back' });
    expect(mirrorCut(front, 2, dims)).toMatchObject({ face: 'bottom' });
    expect(mirrorCut(front, 0, dims)).toEqual(front);
    expect(mirrorCut({ ...front, edge: 'endA' }, 0, dims)).toMatchObject({ edge: 'endB' });
  });
  it('is kept from a file only with an edge, a face and sizes', () => {
    const file = (cuts: unknown) => ({
      version: 2,
      parts: [{ id: 1, stock: '2x4', len: 96, pos: [0, 0, 0], q: [0, 0, 0, 1], name: 'a', cuts }],
    });
    expect(parseDocument(file([front]))!.parts[0]!.cuts).toEqual([front]);
    expect(parseDocument(file([{ ...front, edge: 'side' }]))!.parts[0]!.cuts).toBeUndefined();
  });
});

describe('describeCut and cutsKey', () => {
  it('reads like a shop note', () => {
    expect(describeCut({ kind: 'dado', face: 'top', at: 12, width: 0.75, depth: 0.375 }, fmt)).toBe(
      'dado 3/4" wide × 3/8" deep, 12" from A, top',
    );
    expect(
      describeCut({ kind: 'rabbet', face: 'bottom', edge: 'endB', width: 1, depth: 0.5 }, fmt),
    ).toBe('rabbet 1" × 1/2" deep on end B, bottom');
  });
  it('ignores order and key order', () => {
    const a: Cut[] = [
      { kind: 'dado', face: 'top', at: 1, width: 1, depth: 1 },
      { kind: 'notch', edge: 'front', at: 2, width: 1, depth: 1 },
    ];
    const b: Cut[] = [
      { kind: 'notch', depth: 1, width: 1, at: 2, edge: 'front' },
      { kind: 'dado', depth: 1, width: 1, at: 1, face: 'top' },
    ];
    expect(cutsKey(a)).toBe(cutsKey(b));
  });
});

const part = (over: Partial<Part>): Part => ({
  id: 1,
  stock: '2x4',
  len: 45,
  pos: [0, 0, 0],
  q: [0, 0, 0, 1],
  name: 'p',
  ...over,
});

describe('cut list with cuts', () => {
  it('separates parts with joinery from plain ones and groups identical joinery', () => {
    const dado: Cut = { kind: 'dado', face: 'top', at: 12, width: 0.75, depth: 0.375 };
    const rows = cutRows([
      part({ id: 1 }),
      part({ id: 2, cuts: [dado] }),
      part({ id: 3, cuts: [{ ...dado }] }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.cuts.length)!.qty).toBe(2);
  });
});

describe('cuts in files', () => {
  const file = (cuts: unknown) => ({
    version: 2,
    parts: [{ id: 1, stock: '2x4', len: 96, pos: [0, 0, 0], q: [0, 0, 0, 1], name: 'a', cuts }],
  });
  it('keeps valid cuts and drops the rest', () => {
    const good = { kind: 'dado', face: 'top', at: 12, width: 0.75, depth: 0.375 };
    const kept = parseDocument(
      file([good, { kind: 'dado', face: 'side', at: 1, width: 1, depth: 1 }, { kind: 'what' }, 7]),
    )!;
    expect(kept.parts[0]!.cuts).toEqual([good]);
    expect(parseDocument(file([]))!.parts[0]!.cuts).toBeUndefined();
    expect(parseDocument(file('dado'))!.parts[0]!.cuts).toBeUndefined();
    expect(
      parseDocument(file([{ kind: 'notch', edge: 'front', at: 1, width: 1, depth: -1 }]))!.parts[0]!
        .cuts,
    ).toBeUndefined();
  });
});
