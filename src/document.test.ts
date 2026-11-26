import { describe, expect, it } from 'vitest';
import { parseDocument } from './document';
import { aabbSize, makeQ, partAABB } from './model';

describe('parseDocument', () => {
  it('rejects things that are not a model', () => {
    expect(parseDocument(null)).toBeNull();
    expect(parseDocument({})).toBeNull();
    expect(parseDocument({ parts: [{ id: 1 }] })).toBeNull();
  });

  it('migrates a version 1 (Y-up) file to Z-up', () => {
    const v1 = {
      version: 1,
      parts: [{ id: 1, stock: '2x4', len: 96, pos: [0, 5, 0], q: makeQ(['x']), name: 'a' }],
    };
    const doc = parseDocument(v1)!;
    expect(doc.version).toBe(2);
    expect(doc.parts[0]!.pos).toEqual([0, 0, 5]);
    expect(aabbSize(partAABB(doc.parts[0]!))).toEqual([96, 3.5, 1.5]);
  });

  it('leaves a version 2 file alone', () => {
    const v2 = {
      version: 2,
      parts: [{ id: 1, stock: '2x4', len: 96, pos: [1, 2, 3], q: [0, 0, 0, 1], name: 'a' }],
    };
    expect(parseDocument(v2)!.parts[0]!.pos).toEqual([1, 2, 3]);
  });
});
