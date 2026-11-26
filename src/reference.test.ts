import { describe, expect, it } from 'vitest';
import { drawingRows, modelViewsSvg } from './drawing';
import {
  createPart,
  isCylinderPart,
  isReferencePart,
  partAABB,
  partDims,
  partSizeText,
} from './model';
import { fmt } from './units';
import { cutRows, partsByStock } from './pack';
import { parseDocument } from './document';
import { Store } from './store';
import {
  DEFAULT_STOCK,
  REFERENCE_CYLINDER,
  REFERENCE_STOCK,
  sanitizeStock,
  withReferenceStock,
} from './stock';
import { stockGroups } from './ui/menu';
import { partEdges, partGeometry } from './view/partMesh';

describe('reference boxes', () => {
  it('are stock with a free height per part', () => {
    const s = new Store();
    const box = s.addPart('ref');
    expect(isReferencePart(box)).toBe(true);
    expect(partDims(box)).toEqual([24, 12, 12]);
    s.mutate(() => (box.t = 30));
    expect(partDims(box)).toEqual([24, 12, 30]);
    expect(partAABB(box).max[2] - partAABB(box).min[2]).toBe(30);
    // A real part ignores a stray height.
    const stud = createPart(2, '2x4', [0, 0, 0]);
    stud.t = 30;
    expect(partDims(stud)[2]).toBe(1.5);
  });

  it('stay out of the cut list, the buy list and the drawings', () => {
    const s = new Store();
    s.addPart('2x4');
    const box = s.addPart('ref', [40, 0, 0]);
    expect(cutRows(s.parts)).toHaveLength(1);
    expect([...partsByStock(s.parts).keys()]).toEqual(['2x4']);
    expect(drawingRows(s.parts)).toHaveLength(1);
    const { size } = modelViewsSvg(s.parts);
    expect(size[0]).toBeCloseTo(96); // the stud alone, not the box 40" over
    expect(box.pos[0]).toBe(40);
  });

  it('keep their height in a file, and old files gain the reference stock', () => {
    const doc = parseDocument({
      version: 2,
      parts: [
        {
          id: 1,
          stock: 'ref',
          len: 24,
          w: 12,
          t: 18,
          pos: [0, 0, 9],
          q: [0, 0, 0, 1],
          name: 'Stereo',
        },
      ],
      stock: sanitizeStock(DEFAULT_STOCK.filter((x) => !x.reference)),
    })!;
    expect(doc.parts[0]!.t).toBe(18);
    const s = new Store();
    s.loadDocument(doc);
    expect(s.stock.some((x) => x.reference)).toBe(true);
    expect(partDims(s.parts[0]!)).toEqual([24, 12, 18]);
    // A nonsense height is dropped.
    const bad = parseDocument({
      version: 2,
      parts: [
        { id: 1, stock: 'ref', len: 24, w: 12, t: -1, pos: [0, 0, 0], q: [0, 0, 0, 1], name: 'x' },
      ],
    })!;
    expect(bad.parts[0]!.t).toBeUndefined();
  });

  it('survive the stock table round trip and list last in the menus', () => {
    const clean = sanitizeStock([REFERENCE_STOCK, REFERENCE_CYLINDER])!;
    expect(clean[0]!.reference).toBe(true);
    expect(clean[0]!.shape).toBeUndefined();
    expect(clean[1]!.shape).toBe('cylinder');
    // A shape means nothing on real stock.
    expect(sanitizeStock([{ ...DEFAULT_STOCK[0]!, shape: 'cylinder' }])![0]!.shape).toBeUndefined();
    expect(withReferenceStock([]).map((x) => x.id)).toEqual(['ref', 'refcyl']);
    // A file from before the cylinder gains it and keeps its box.
    expect(withReferenceStock([{ ...REFERENCE_STOCK }]).map((x) => x.id)).toEqual([
      'ref',
      'refcyl',
    ]);
    const g = stockGroups(DEFAULT_STOCK);
    expect(g.at(-1)!.label).toBe('Reference');
    expect(g.at(-1)!.items.map((x) => x.name)).toEqual(['Reference box', 'Reference cylinder']);
    expect(g.at(-2)!.label).toBe('Sheets');
  });
});

describe('reference cylinders', () => {
  it('are as wide as they are long: the length is the diameter', () => {
    const s = new Store();
    const can = s.addPart('refcyl');
    expect(isReferencePart(can)).toBe(true);
    expect(isCylinderPart(can)).toBe(true);
    expect(isCylinderPart(s.addPart('ref'))).toBe(false);
    expect(partDims(can)).toEqual([12, 12, 12]);
    s.mutate(() => {
      can.len = 8;
      can.t = 30;
    });
    expect(partDims(can)).toEqual([8, 8, 30]);
    const b = partAABB(can);
    expect(b.max[0] - b.min[0]).toBe(8);
    expect(b.max[1] - b.min[1]).toBe(8);
    expect(b.max[2] - b.min[2]).toBe(30);
    // Stays out of the cut list like a box.
    expect(cutRows(s.parts)).toHaveLength(0);
  });

  it('draw as a round solid standing on end, outlined only at the rims', () => {
    const can = createPart(1, 'refcyl', [0, 0, 0]);
    can.len = 8;
    can.t = 30;
    const geo = partGeometry(can, partDims(can));
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(8, 6);
    expect(bb.max.y - bb.min.y).toBeCloseTo(8, 6);
    expect(bb.max.z - bb.min.z).toBeCloseTo(30, 6);
    // Every outline point lies on a rim (top or bottom), none down the side.
    const pos = partEdges(can, geo).getAttribute('position');
    expect(pos.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getZ(i))).toBeCloseTo(15, 5);
    // A box keeps its twelve edges (24 endpoints).
    const box = createPart(2, 'ref', [0, 0, 0]);
    const bgeo = partGeometry(box, partDims(box));
    expect(partEdges(box, bgeo).getAttribute('position').count).toBe(24);
  });
});

describe('partSizeText', () => {
  it('says a size the way people do for each kind of part', () => {
    const s = new Store();
    expect(partSizeText(s.addPart('2x4'), fmt)).toBe('96"');
    expect(partSizeText(s.addPart('ply34'), fmt)).toBe('48" × 96"');
    const box = s.addPart('ref');
    s.mutate(() => (box.t = 30));
    expect(partSizeText(box, fmt)).toBe('24" × 12" × 30"');
    const can = s.addPart('refcyl');
    s.mutate(() => (can.len = 8));
    expect(partSizeText(can, fmt)).toBe('⌀8" × 12"');
  });
});
