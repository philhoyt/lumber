import { describe, expect, it } from 'vitest';
import {
  clampFastener,
  describeFastener,
  faceOfNormal,
  fastenerAt,
  fastenerLocal,
  fastenersKey,
  hardwareRows,
  mirrorFastener,
  sizeOf,
  type Fastener,
} from './fastener';
import { DEFAULT_Q, makeQ, mirrorParts, type Part } from './model';
import { parseDocument } from './document';
import { Store } from './store';
import { fmt } from './units';

const dims: [number, number, number] = [96, 3.5, 1.5]; // a 2x4
const board = (over: Partial<Part> = {}): Part => ({
  id: 1,
  stock: '2x4',
  len: 96,
  pos: [0, 0, 0],
  q: [...DEFAULT_Q] as Part['q'],
  name: '2x4 1',
  ...over,
});

describe('fastener geometry', () => {
  it('places a marker on each face from its low corner', () => {
    const top = fastenerLocal({ kind: 'screw', face: 'top', at: [12, 1] }, dims);
    expect(top.point).toEqual([-36, -0.75, 0.75]);
    expect(top.normal).toEqual([0, 0, 1]);
    const front = fastenerLocal({ kind: 'nail', face: 'front', at: [10, 0.5] }, dims);
    expect(front.point).toEqual([-38, -1.75, -0.25]);
    expect(front.normal).toEqual([0, -1, 0]);
    const endA = fastenerLocal({ kind: 'dowel', face: 'endA', at: [1.75, 0.75] }, dims);
    expect(endA.point).toEqual([-48, 0, 0]);
    expect(endA.normal).toEqual([-1, 0, 0]);
  });

  it('reads the face off a surface normal', () => {
    expect(faceOfNormal([0, 0, 1])).toBe('top');
    expect(faceOfNormal([0, 0, -1])).toBe('bottom');
    expect(faceOfNormal([0, -1, 0])).toBe('front');
    expect(faceOfNormal([0.1, 0.9, 0.2])).toBe('back');
    expect(faceOfNormal([1, 0, 0])).toBe('endB');
    expect(faceOfNormal([-0.9, 0.3, 0])).toBe('endA');
  });

  it('round-trips a surface point through fastenerAt and snaps to the grid', () => {
    for (const face of ['top', 'bottom', 'front', 'back', 'endA', 'endB'] as const) {
      const f: Fastener = { kind: 'screw', face, at: [1, 0.5] };
      const { point, normal } = fastenerLocal(f, dims);
      expect(fastenerAt('screw', point, normal, dims)).toEqual(f);
    }
    const g = fastenerAt('pocket', [-36.1, 0.8, 0.75], [0, 0, 1], dims, 0.5, ' 1 1/4" ');
    expect(g).toEqual({ kind: 'pocket', face: 'top', at: [12, 2.5], size: '1 1/4"' });
  });

  it('clamps onto the face', () => {
    expect(clampFastener({ kind: 'bolt', face: 'top', at: [-3, 99] }, dims).at).toEqual([0, 3.5]);
    expect(clampFastener({ kind: 'bolt', face: 'endB', at: [5, NaN] }, dims).at).toEqual([3.5, 0]);
  });

  it('mirrors to the opposite end, edge or face', () => {
    const top: Fastener = { kind: 'screw', face: 'top', at: [12, 1] };
    expect(mirrorFastener(top, 0, dims)).toEqual({ ...top, at: [84, 1] });
    expect(mirrorFastener(top, 1, dims)).toEqual({ ...top, at: [12, 2.5] });
    expect(mirrorFastener(top, 2, dims)).toEqual({ ...top, face: 'bottom' });
    const endA: Fastener = { kind: 'dowel', face: 'endA', at: [1, 0.5] };
    expect(mirrorFastener(endA, 0, dims)).toEqual({ ...endA, face: 'endB' });
    expect(mirrorFastener(endA, 1, dims)).toEqual({ ...endA, at: [2.5, 0.5] });
    expect(mirrorFastener(endA, 2, dims)).toEqual({ ...endA, at: [1, 1] });
    const front: Fastener = { kind: 'nail', face: 'front', at: [10, 0.25] };
    expect(mirrorFastener(front, 1, dims)).toEqual({ ...front, face: 'back' });
    const p = board({ q: makeQ(['z']), fasteners: [top] }); // length along Y
    mirrorParts([p], 'y');
    expect(p.fasteners).toEqual([{ ...top, at: [84, 1] }]);
  });

  it('describes a marker and falls back to the usual size', () => {
    const f: Fastener = { kind: 'pocket', face: 'top', at: [12, 1.75] };
    expect(sizeOf(f)).toBe('1 1/4" pocket screw');
    expect(sizeOf({ ...f, size: '2 1/2" pocket screw' })).toBe('2 1/2" pocket screw');
    expect(describeFastener(f, fmt)).toBe(
      'pocket screw 1 1/4" pocket screw on the top face, 12" from A, 1 3/4" from front',
    );
    expect(describeFastener({ kind: 'nail', face: 'endB', at: [1, 0.5] }, fmt)).toBe(
      'nail 2" brad on the end B, 1" from front, 1/2" up',
    );
  });

  it('totals hardware by kind and size with the parts that carry it', () => {
    const screw: Fastener = { kind: 'screw', face: 'top', at: [1, 1] };
    const long: Fastener = { ...screw, size: '#8 × 2 1/2"' };
    const bolt: Fastener = { kind: 'bolt', face: 'front', at: [1, 1] };
    const rows = hardwareRows([
      board({ id: 1, name: 'Leg', fasteners: [screw, screw, bolt] }),
      board({ id: 2, name: 'Rail', fasteners: [screw, long] }),
      board({ id: 3, name: 'Loose' }),
    ]);
    expect(rows.map((r) => [r.kind, r.size, r.qty])).toEqual([
      ['screw', '#8 × 1 1/4"', 3],
      ['screw', '#8 × 2 1/2"', 1],
      ['bolt', '3/8" × 3" carriage bolt', 1],
    ]);
    expect(rows[0]!.names).toEqual(['Leg ×2', 'Rail']);
    expect(hardwareRows([])).toEqual([]);
  });

  it('keys change when a marker moves', () => {
    const a: Fastener = { kind: 'screw', face: 'top', at: [1, 1] };
    expect(fastenersKey([a])).not.toBe(fastenersKey([{ ...a, at: [2, 1] }]));
    expect(fastenersKey([a])).toBe(fastenersKey([{ ...a }]));
  });
});

describe('fasteners in the store and the file', () => {
  it('adds, updates and removes markers as undoable steps', () => {
    const s = new Store();
    const p = s.addPart('2x4');
    s.addFastener(p.id, { kind: 'screw', face: 'top', at: [12, 1] });
    s.addFastener(p.id, { kind: 'nail', face: 'front', at: [200, -1] });
    expect(s.partById(p.id)!.fasteners).toEqual([
      { kind: 'screw', face: 'top', at: [12, 1] },
      { kind: 'nail', face: 'front', at: [96, 0] },
    ]);
    s.setFasteners(p.id, [{ kind: 'bolt', face: 'endA', at: [1, 1] }]);
    expect(s.partById(p.id)!.fasteners).toHaveLength(1);
    s.removeFastener(p.id, 0);
    expect(s.partById(p.id)!.fasteners).toBeUndefined();
    s.undo();
    expect(s.partById(p.id)!.fasteners).toHaveLength(1);
    s.undo();
    expect(s.partById(p.id)!.fasteners).toHaveLength(2);
  });

  it('keeps valid markers in a file and drops junk', () => {
    const doc = parseDocument({
      version: 2,
      parts: [
        {
          id: 1,
          stock: '2x4',
          len: 96,
          pos: [0, 0, 0],
          q: [0, 0, 0, 1],
          name: 'a',
          fasteners: [
            { kind: 'screw', face: 'top', at: [1, 1], size: '#10' },
            { kind: 'rivet', face: 'top', at: [1, 1] },
            { kind: 'screw', face: 'side', at: [1, 1] },
            { kind: 'screw', face: 'top', at: [1] },
            { kind: 'screw', face: 'top', at: [1, 1], size: 7 },
          ],
        },
        { id: 2, stock: '2x4', len: 96, pos: [0, 0, 0], q: [0, 0, 0, 1], name: 'b', fasteners: [] },
      ],
    })!;
    expect(doc.parts[0]!.fasteners).toEqual([
      { kind: 'screw', face: 'top', at: [1, 1], size: '#10' },
      { kind: 'screw', face: 'top', at: [1, 1] },
    ]);
    expect(doc.parts[1]!.fasteners).toBeUndefined();
  });

  it('copies markers with a duplicated part', () => {
    const s = new Store();
    const p = s.addPart('2x4');
    s.addFastener(p.id, { kind: 'screw', face: 'top', at: [12, 1] });
    s.select([p.id]);
    s.duplicateSelected();
    const copy = s.selectedParts()[0]!;
    expect(copy.id).not.toBe(p.id);
    expect(copy.fasteners).toEqual([{ kind: 'screw', face: 'top', at: [12, 1] }]);
    s.removeFastener(copy.id, 0);
    expect(s.partById(p.id)!.fasteners).toHaveLength(1);
  });
});
