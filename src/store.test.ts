import { describe, expect, it } from 'vitest';
import { partAABB } from './model';
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
    s.arraySelected('z', 3, 16);
    expect(s.parts).toHaveLength(4);
    expect(s.parts[3]!.pos[2]).toBe(32);
  });

  it('nudges and rotates only the selection', () => {
    const s = new Store();
    const a = s.addPart('2x4');
    const b = s.addPart('2x4');
    s.select([b.id]);
    s.nudge([0, 1, 0]);
    expect(partAABB(s.partById(a.id)!).min[1]).toBe(0);
    expect(partAABB(s.partById(b.id)!).min[1]).toBe(1);
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
    s.setSetting('prices', { ply34: 60 });
    const doc = parseDocument(JSON.parse(JSON.stringify(s.toDocument())));
    expect(doc).not.toBeNull();
    const t = new Store();
    t.loadDocument(doc!);
    expect(t.parts).toHaveLength(1);
    expect(t.settings.prices.ply34).toBe(60);
    expect(t.nextId).toBe(2);
  });
});

describe('parseDocument', () => {
  it('rejects things that are not a model', () => {
    expect(parseDocument(null)).toBeNull();
    expect(parseDocument({})).toBeNull();
    expect(parseDocument({ parts: [{ id: 1 }] })).toBeNull();
  });
});
