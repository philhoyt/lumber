import { describe, expect, it } from 'vitest';
import { arrayLayout } from './model';
import { parseDocument, Store } from './store';

describe('arrayLayout', () => {
  it('steps on centre or by gap', () => {
    expect(arrayLayout({ axis: 'x', count: 4, spacing: 16, mode: 'center' }, 1.5)).toEqual({
      step: 16,
      count: 4,
    });
    expect(arrayLayout({ axis: 'x', count: 3, spacing: 1.5, mode: 'gap' }, 3.5)).toEqual({
      step: 5,
      count: 3,
    });
  });
  it('fits as many as fill a length', () => {
    // eight flat 2x4 slats with 1 1/2" gaps fill 38 1/2" exactly
    expect(arrayLayout({ axis: 'x', fit: 38.5, spacing: 1.5, mode: 'gap' }, 3.5).count).toBe(8);
    // studs at 16" on centre across a 96" wall: 0, 16, ..., 80 fit; 96 would overhang
    expect(arrayLayout({ axis: 'x', fit: 96, spacing: 16, mode: 'center' }, 1.5).count).toBe(6);
    expect(arrayLayout({ axis: 'x', fit: 2, spacing: 16, mode: 'center' }, 1.5).count).toBe(1);
  });
  it('never produces a zero step', () => {
    expect(arrayLayout({ axis: 'x', count: 2, spacing: 0, mode: 'center' }, 1.5).step).toBe(1 / 16);
  });
});

const slat = () => {
  const s = new Store();
  s.addPart('2x4'); // flat, 3 1/2" across Y
  return s;
};

describe('array modifier', () => {
  it('turns the selection into an array group with live copies', () => {
    const s = slat();
    const g = s.setArray({ axis: 'y', count: 3, spacing: 1.5, mode: 'gap' })!;
    expect(g.array).toBeDefined();
    expect(s.parts).toHaveLength(3);
    expect(s.parts.map((p) => p.pos[1])).toEqual([0, 5, 10]);
    expect(s.parts.map((p) => p.arrayIndex)).toEqual([0, 1, 2]);
    expect(s.parts[1]!.name).toBe('2x4 1 2');
    expect(s.selected.size).toBe(3);
  });

  it('regenerates when the parameters or the source change', () => {
    const s = slat();
    const g = s.setArray({ axis: 'y', count: 3, spacing: 5, mode: 'center' })!;
    s.setArray({ axis: 'y', count: 5, spacing: 5, mode: 'center' });
    expect(s.parts).toHaveLength(5);
    const source = s.arraySource(g)[0]!;
    s.select([source.id]);
    s.mutate(() => (source.len = 40));
    expect(s.parts.every((p) => p.len === 40)).toBe(true);
    s.select([source.id]);
    s.nudge([0, 0, 10]);
    expect(s.parts.every((p) => p.pos[2] === source.pos[2])).toBe(true);
  });

  it('keeps the selection equal to the group across regenerations', () => {
    const s = slat();
    const g = s.setArray({ axis: 'y', count: 3, spacing: 5, mode: 'center' })!;
    s.setArray({ axis: 'y', count: 4, spacing: 5, mode: 'center' });
    expect(s.selected.size).toBe(4);
    expect(s.selectedGroup()).toBe(g);
    expect([...s.selected].every((id) => s.partById(id))).toBe(true);
  });

  it('fits to a length', () => {
    const s = slat();
    s.setArray({ axis: 'y', fit: 38.5, spacing: 1.5, mode: 'gap' });
    expect(s.parts).toHaveLength(8);
    expect(s.parts[7]!.pos[1]).toBe(35);
  });

  it('applies into ordinary parts and removes back to the source', () => {
    const s = slat();
    const g = s.setArray({ axis: 'y', count: 3, spacing: 5, mode: 'center' })!;
    s.applyArray(g.id);
    expect(g.array).toBeUndefined();
    expect(s.parts).toHaveLength(3);
    expect(s.parts.every((p) => p.arrayIndex === undefined)).toBe(true);
    const t = slat();
    const h = t.setArray({ axis: 'y', count: 3, spacing: 5, mode: 'center' })!;
    t.removeArray(h.id);
    expect(t.parts).toHaveLength(1);
    expect(h.array).toBeUndefined();
    expect(t.groups).toHaveLength(0); // a lone part needs no group
    expect(t.parts[0]!.group).toBeUndefined();
    expect(t.selected.size).toBe(1);
  });

  it('duplicates an array group as a new live array', () => {
    const s = slat();
    s.setArray({ axis: 'y', count: 3, spacing: 5, mode: 'center' });
    s.duplicateSelected([48, 0, 0]);
    expect(s.groups).toHaveLength(2);
    expect(s.groups[1]!.array).toBeDefined();
    expect(s.parts).toHaveLength(6);
    expect(s.parts.filter((p) => p.pos[0] === 48)).toHaveLength(3);
  });

  it('drops the modifier when the source is deleted, keeping the copies', () => {
    const s = slat();
    const g = s.setArray({ axis: 'y', count: 3, spacing: 5, mode: 'center' })!;
    s.select([s.arraySource(g)[0]!.id]);
    s.deleteSelected();
    expect(s.parts).toHaveLength(2);
    expect(g.array).toBeUndefined();
  });

  it('survives a save and load', () => {
    const s = slat();
    s.setArray({ axis: 'y', count: 3, spacing: 5, mode: 'center' });
    const doc = parseDocument(JSON.parse(JSON.stringify(s.toDocument())))!;
    const t = new Store();
    t.loadDocument(doc);
    expect(t.groups[0]!.array?.count).toBe(3);
    expect(t.parts).toHaveLength(3);
  });
});
