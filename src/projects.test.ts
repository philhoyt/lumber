import { describe, expect, it } from 'vitest';
import { ProjectStore, timeAgo, uniqueName, type StorageLike } from './projects';
import type { Document } from './document';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const doc = (n = 1): Document => ({
  version: 2,
  parts: Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    stock: '2x4',
    len: 96,
    pos: [0, 0, 0],
    q: [0, 0, 0, 1],
    name: `p${i + 1}`,
  })),
});

const make = () => {
  let t = 1000;
  const storage = new FakeStorage();
  return { storage, ps: new ProjectStore(storage, () => (t += 1000)) };
};

describe('ProjectStore', () => {
  it('creates, lists newest first, loads and saves', () => {
    const { ps } = make();
    const a = ps.create('Bench', doc(2));
    const b = ps.create('Shed', doc(5));
    expect(ps.list().map((p) => p.name)).toEqual(['Shed', 'Bench']);
    expect(ps.load(a.id)!.parts).toHaveLength(2);
    ps.save(a.id, doc(7));
    expect(ps.list()[0]!.id).toBe(a.id);
    expect(ps.get(a.id)!.parts).toBe(7);
    expect(ps.get(b.id)!.parts).toBe(5);
  });

  it('keeps names unique and renames safely', () => {
    const { ps } = make();
    ps.create('Bench', doc());
    const b = ps.create('bench', doc());
    expect(b.name).toBe('bench 2');
    ps.rename(b.id, 'Bench');
    expect(ps.get(b.id)!.name).toBe('Bench 2');
    ps.rename(b.id, '   ');
    expect(ps.get(b.id)!.name).toBe('Bench 2');
    expect(uniqueName('X', [])).toBe('X');
  });

  it('duplicates and removes, clearing the current pointer', () => {
    const { ps } = make();
    const a = ps.create('Bench', doc(3));
    ps.setCurrent(a.id);
    const copy = ps.duplicate(a.id)!;
    expect(copy.name).toBe('Bench copy');
    expect(ps.load(copy.id)!.parts).toHaveLength(3);
    ps.remove(a.id);
    expect(ps.list()).toHaveLength(1);
    expect(ps.load(a.id)).toBeNull();
    expect(ps.current()).toBeNull();
    expect(ps.duplicate('nope')).toBeNull();
  });

  it('adopts the old single autosave as the first project', () => {
    const { storage, ps } = make();
    storage.setItem('lumber.autosave.v2', JSON.stringify({ parts: doc(4).parts, nextId: 5 }));
    const first = ps.ensureFirst();
    expect(first.name).toBe('My project');
    expect(ps.load(first.id)!.parts).toHaveLength(4);
    expect(storage.getItem('lumber.autosave.v2')).toBeNull();
  });

  it('starts with the sample when there is nothing', () => {
    const { ps } = make();
    const first = ps.ensureFirst();
    expect(first.name).toContain('sample');
    expect(ps.load(first.id)!.parts.length).toBeGreaterThan(5);
    expect(ps.ensureFirst().id).toBe(first.id);
  });

  it('survives a corrupt index', () => {
    const { storage, ps } = make();
    storage.setItem('lumber.projects', '{not json');
    expect(ps.list()).toEqual([]);
  });
});

describe('timeAgo', () => {
  it('reads naturally', () => {
    const now = 1_000_000_000_000;
    expect(timeAgo(now - 10_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(timeAgo(now - 5 * 86_400_000, now)).toBe('5 days ago');
  });
});
