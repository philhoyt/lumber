import { describe, expect, it } from 'vitest';
import { parseDocument } from './document';
import {
  cutCorners,
  localCorners,
  makeQ,
  mirrorParts,
  partAABB,
  shortLength,
  shortWidth,
  type Part,
  type Vec3,
} from './model';
import { cutRows } from './pack';
import { partGeometry } from './view/partMesh';

const dims: Vec3 = [48, 3.5, 1.5];

const part = (over: Partial<Part> = {}): Part => ({
  id: 1,
  stock: '2x4',
  len: 48,
  pos: [0, 0, 0.75],
  q: makeQ([]),
  name: 'cleat',
  ...over,
});

describe('cutCorners with edge bevels', () => {
  it('a 45° back edge brings the top face in by the thickness, like a French cleat', () => {
    const c = cutCorners(dims, [0, 0], [0, 0], [0, 45]);
    expect(c[2]![1]).toBeCloseTo(1.75, 9); // bottom back corner keeps the long point
    expect(c[6]![1]).toBeCloseTo(1.75 - 1.5, 9); // top back corner comes in by the thickness
    expect(c[0]![1]).toBeCloseTo(-1.75, 9); // the front edge is untouched
    expect(c[4]![1]).toBeCloseTo(-1.75, 9);
    const neg = cutCorners(dims, [0, 0], [0, 0], [0, -45]);
    expect(neg[2]![1]).toBeCloseTo(0.25, 9);
    expect(neg[6]![1]).toBeCloseTo(1.75, 9);
  });
  it('a front edge bevel moves the −Y corners the same way', () => {
    const c = cutCorners(dims, [0, 0], [0, 0], [30, 0]);
    expect(c[0]![1]).toBeCloseTo(-1.75, 9);
    expect(c[4]![1]).toBeCloseTo(-1.75 + 1.5 * Math.tan(Math.PI / 6), 9);
  });
  it('keeps a mitered end on one plane when its edge is beveled too', () => {
    // End B mitered 45° with the short point on the back edge; that edge beveled 45° too.
    const c = cutCorners(dims, [0, 45], [0, 0], [0, 45]);
    // Every +X corner lies on the plane x + y = 22.25 (through the long point at the front edge).
    for (const i of [1, 3, 5, 7]) expect(c[i]![0] + c[i]![1]).toBeCloseTo(22.25, 9);
    expect(c[7]![1]).toBeCloseTo(0.25, 9); // and the top back corner followed the beveled edge in
  });
  it('shortWidth is the narrower face; shortLength ignores edges alone', () => {
    expect(shortWidth(dims, [0, 0])).toBe(3.5);
    expect(shortWidth(dims, [0, 45])).toBeCloseTo(2, 9);
    expect(shortWidth(dims, [45, 45])).toBeCloseTo(0.5, 9); // both short points on top
    expect(shortWidth(dims, [45, -45])).toBeCloseTo(2, 9); // one on each face
    expect(shortLength(dims, [0, 0], [0, 0], [0, 45])).toBe(48);
  });
});

describe('a part with an edge bevel', () => {
  it('has cut corners, and a sheet part takes the edge but not its end cuts', () => {
    expect(localCorners(part())).toBeNull();
    expect(localCorners(part({ edgeBevel: [0, 45] }))).toHaveLength(8);
    const ply = part({ stock: 'ply34', w: 4, miter: [45, 0], edgeBevel: [0, 45] });
    const c = localCorners(ply)!;
    expect(c[0]![0]).toBeCloseTo(-24, 9); // the miter is ignored on a sheet
    expect(c[6]![1]).toBeCloseTo(2 - 0.75, 9); // the edge bevel is not
  });
  it('bounds and draws the long-point box when the short point is on top', () => {
    const p = part({ edgeBevel: [0, 45] });
    const box = partAABB(p);
    expect(box.max[1]).toBeCloseTo(1.75, 9);
    expect(box.min[1]).toBeCloseTo(-1.75, 9);
    const geo = partGeometry(p, dims);
    expect(geo.getAttribute('position').count).toBe(36); // six flat faces, two triangles each
    geo.computeBoundingBox();
    expect(geo.boundingBox!.max.y).toBeCloseTo(1.75, 5);
  });
  it('mirrors: the edges swap across Y, the sign flips across Z, X leaves it alone', () => {
    const a = part({ edgeBevel: [10, -20] });
    mirrorParts([a], 'y');
    expect(a.edgeBevel).toEqual([-20, 10]);
    const b = part({ edgeBevel: [10, -20] });
    mirrorParts([b], 'z');
    expect(b.edgeBevel).toEqual([-10, 20]);
    const c = part({ edgeBevel: [10, -20] });
    mirrorParts([c], 'x');
    expect(c.edgeBevel).toEqual([10, -20]);
  });
  it('gets its own cut-list row with the short width', () => {
    const rows = cutRows([part(), part({ id: 2, name: 'b', edgeBevel: [0, 45] })]);
    expect(rows).toHaveLength(2);
    const edged = rows.find((r) => r.edge[1] === 45)!;
    expect(edged.shortW).toBeCloseTo(2, 9);
    expect(edged.short).toBe(48);
    expect(rows.find((r) => r.edge[1] === 0)!.shortW).toBe(3.5);
  });
  it('reads from a file only as a pair of angles in range', () => {
    const file = (edgeBevel: unknown) => ({
      version: 2,
      parts: [
        { id: 1, stock: '2x4', len: 48, pos: [0, 0, 0], q: [0, 0, 0, 1], name: 'a', edgeBevel },
      ],
    });
    expect(parseDocument(file([0, 45]))!.parts[0]!.edgeBevel).toEqual([0, 45]);
    expect(parseDocument(file([0, 0]))!.parts[0]!.edgeBevel).toBeUndefined();
    expect(parseDocument(file([0, 90]))!.parts[0]!.edgeBevel).toBeUndefined();
    expect(parseDocument(file('45'))!.parts[0]!.edgeBevel).toBeUndefined();
  });
});
