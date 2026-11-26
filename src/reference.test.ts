import { describe, expect, it } from 'vitest';
import { drawingRows, modelViewsSvg } from './drawing';
import { createPart, isReferencePart, partAABB, partDims } from './model';
import { cutRows, partsByStock } from './pack';
import { parseDocument, Store } from './store';
import { DEFAULT_STOCK, REFERENCE_STOCK, sanitizeStock, withReferenceStock } from './stock';
import { stockGroups } from './ui/menu';

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
    const clean = sanitizeStock([REFERENCE_STOCK])!;
    expect(clean[0]!.reference).toBe(true);
    expect(withReferenceStock([]).map((x) => x.id)).toEqual(['ref']);
    const g = stockGroups(DEFAULT_STOCK);
    expect(g.at(-1)!.label).toBe('Reference');
    expect(g.at(-2)!.label).toBe('Sheets');
  });
});
