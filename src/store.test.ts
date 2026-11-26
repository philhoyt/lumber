import { describe, expect, it } from 'vitest';
import { aabbSize, makeQ, partAABB } from './model';
import { parseDocument, Store } from './store';

describe('Store', () => {
  it('adds a part, selects it and can undo and redo', () => {
    const s = new Store();
    const p = s.addPart('2x4');
    expect(s.parts).toHaveLength(1);
    expect(s.selected.has(p.id)).toBe(true);
    s.undo();
    expect(s.parts).toHaveLength(0);
    expect(s.selected.size).toBe(0);
    s.redo();
    expect(s.parts).toHaveLength(1);
  });

  it('duplicates and arrays the selection with fresh ids', () => {
    const s = new Store();
    s.addPart('2x4');
    s.duplicateSelected([16, 0, 0]);
    expect(s.parts.map((p) => p.id)).toEqual([1, 2]);
    expect(s.parts[1]!.pos[0]).toBe(16);
    s.select([1]);
    s.arraySelected('y', 3, 16);
    expect(s.parts).toHaveLength(4);
    expect(s.parts[3]!.pos[1]).toBe(32);
  });

  it('arrays by gap: slats 1 1/2" apart are 5" on center for a flat 2x4', () => {
    const s = new Store();
    s.addPart('2x4'); // flat: 3 1/2" across Y
    s.arraySelected('y', 3, 1.5, 'gap');
    expect(s.parts.map((p) => p.pos[1])).toEqual([0, 5, 10]);
    const sheet = new Store();
    sheet.addPart('ply34'); // 48" across Y
    sheet.arraySelected('y', 2, 2, 'gap');
    expect(sheet.parts[1]!.pos[1]).toBe(50);
  });

  it('nudges and rotates only the selection', () => {
    const s = new Store();
    const a = s.addPart('2x4');
    const b = s.addPart('2x4');
    s.select([b.id]);
    s.nudge([0, 0, 1]);
    expect(partAABB(s.partById(a.id)!).min[2]).toBe(0);
    expect(partAABB(s.partById(b.id)!).min[2]).toBe(1);
  });

  it('hides parts, drops them from the selection, and shows them again', () => {
    const s = new Store();
    const a = s.addPart('2x4');
    s.addPart('2x4');
    s.select([a.id]);
    s.hideSelected();
    expect(s.partById(a.id)!.hidden).toBe(true);
    expect(s.selected.size).toBe(0);
    expect(s.visibleParts()).toHaveLength(1);
    s.select([a.id]); // hidden parts cannot be selected
    expect(s.selected.size).toBe(0);
    s.unhideAll();
    expect(s.partById(a.id)!.hidden).toBeUndefined();
    expect(s.selected.has(a.id)).toBe(true);
  });

  it('hides and shows single parts and renames them', () => {
    const s = new Store();
    const a = s.addPart('2x4');
    const b = s.addPart('2x4');
    s.selectAll();
    s.setHidden([a.id], true);
    expect(s.partById(a.id)!.hidden).toBe(true);
    expect([...s.selected]).toEqual([b.id]);
    s.setHidden([a.id], true); // no change, no new undo step
    const before = s.canUndo;
    s.setHidden([a.id], false);
    expect(before).toBe(true);
    expect(s.partById(a.id)!.hidden).toBeUndefined();
    s.renamePart(b.id, '  Stud 1 ');
    expect(s.partById(b.id)!.name).toBe('Stud 1');
    s.renamePart(b.id, '   ');
    expect(s.partById(b.id)!.name).toBe('Stud 1');
  });

  it('notifies subscribers with the kind of change', () => {
    const s = new Store();
    const kinds: string[] = [];
    s.subscribe((k) => kinds.push(k));
    s.addPart('2x4');
    s.setSetting('grid', 1);
    expect(kinds).toEqual(['model', 'selection', 'settings']);
  });

  it('round-trips a document', () => {
    const s = new Store();
    s.addPart('ply34');
    s.updateStock('ply34', { price: 60 });
    const doc = parseDocument(JSON.parse(JSON.stringify(s.toDocument())));
    expect(doc).not.toBeNull();
    const t = new Store();
    t.loadDocument(doc!);
    expect(t.parts).toHaveLength(1);
    expect(t.stock.find((x) => x.id === 'ply34')!.price).toBe(60);
    expect(t.nextId).toBe(2);
  });
});

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

describe('assembly steps', () => {
  it('sets and clears a step on the given parts, undoably', () => {
    const store = new Store();
    store.addPart('2x4');
    store.addPart('2x4');
    const ids = store.parts.map((p) => p.id);
    store.setStep(ids, 2.6);
    expect(store.parts.map((p) => p.step)).toEqual([3, 3]);
    store.setStep([ids[0]!], null);
    expect(store.parts[0]!.step).toBeUndefined();
    store.undo();
    expect(store.parts[0]!.step).toBe(3);
  });
  it('keeps only sensible steps when loading a document', () => {
    const doc = parseDocument({
      version: 2,
      parts: [
        { id: 1, stock: '2x4', len: 10, pos: [0, 0, 0], q: [0, 0, 0, 1], name: 'a', step: 2 },
        { id: 2, stock: '2x4', len: 10, pos: [0, 0, 0], q: [0, 0, 0, 1], name: 'b', step: 0 },
      ],
    });
    expect(doc?.parts.map((p) => p.step)).toEqual([2, undefined]);
  });
});

describe('centerSelectedBetween', () => {
  it('centres the selection in the gap between two parts', () => {
    const s = new Store();
    const left = s.addPart('2x4', [0, 0, 0]); // flat: 3 1/2 across Y, centred on y = 0
    const right = s.addPart('2x4', [0, 20, 0]);
    const mid = s.addPart('2x4', [0, 4, 0]);
    s.select([mid.id]);
    expect(s.centerSelectedBetween(left.id, right.id)).toBe(1);
    expect(s.partById(mid.id)!.pos[1]).toBe(10);
    expect(s.partById(left.id)!.pos[1]).toBe(0);
    s.undo();
    expect(s.partById(mid.id)!.pos[1]).toBe(4);
  });
  it('ignores a missing part, the same part twice, or an empty selection', () => {
    const s = new Store();
    const a = s.addPart('2x4');
    const b = s.addPart('2x4', [0, 20, 0]);
    s.select([]);
    expect(s.centerSelectedBetween(a.id, b.id)).toBeNull();
    s.select([a.id]);
    expect(s.centerSelectedBetween(a.id, b.id)).toBeNull(); // only a and b: nothing else to move
    expect(s.centerSelectedBetween(a.id, 99)).toBeNull();
  });
});
