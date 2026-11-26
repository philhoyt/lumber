import { describe, expect, it } from 'vitest';
import { parseDocument, Store } from './store';

const twoParts = () => {
  const s = new Store();
  const a = s.addPart('2x4');
  const b = s.addPart('2x4');
  s.select([a.id, b.id]);
  return { s, a, b };
};

describe('groups', () => {
  it('groups the selection and selects the whole assembly on click', () => {
    const { s, a, b } = twoParts();
    const c = s.addPart('2x6');
    s.select([a.id, b.id]);
    const g = s.groupSelected()!;
    expect(g.name).toBe('Group 1');
    expect(s.partById(a.id)!.group).toBe(g.id);
    expect(s.selectionForClick(a.id).sort()).toEqual([a.id, b.id]);
    expect(s.selectionForClick(c.id)).toEqual([c.id]);
    expect(s.selectedGroup()).toBe(g);
  });

  it('needs at least two parts', () => {
    const s = new Store();
    s.addPart('2x4');
    expect(s.groupSelected()).toBeUndefined();
    expect(s.groups).toHaveLength(0);
  });

  it('nests when all selected parts already share a group', () => {
    const { s, a, b } = twoParts();
    const outer = s.groupSelected()!;
    const c = s.addPart('2x4');
    s.select([a.id, b.id, c.id]);
    s.groupSelected(); // mixed loose + grouped parts: a new top-level group takes them all
    expect(s.groups).toHaveLength(1); // the old outer group lost its members and was pruned
    s.select([a.id, b.id]);
    const inner = s.groupSelected()!;
    expect(inner.parent).toBe(s.groups.find((g) => g.id !== inner.id)!.id);
    expect(s.rootGroupOf(a.id)!.id).not.toBe(inner.id);
    expect(s.selectionForClick(a.id)).toHaveLength(3);
    expect(outer.id).not.toBe(inner.id);
  });

  it('ungroups one level up and prunes empty groups', () => {
    const { s, a, b } = twoParts();
    const g = s.groupSelected()!;
    s.select([a.id]);
    s.ungroupSelected();
    expect(s.partById(a.id)!.group).toBeUndefined();
    expect(s.groupById(g.id)).toBeDefined(); // b is still in it
    s.select([b.id]);
    s.ungroupSelected();
    expect(s.groups).toHaveLength(0);
  });

  it('prunes a group when its parts are deleted, and survives undo', () => {
    const { s } = twoParts();
    s.groupSelected();
    s.selectAll();
    s.deleteSelected();
    expect(s.groups).toHaveLength(0);
    s.undo();
    expect(s.groups).toHaveLength(1);
    expect(s.parts.every((p) => p.group === s.groups[0]!.id)).toBe(true);
  });

  it('duplicates a whole group as a new group, and a partial selection into the same group', () => {
    const { s, a, b } = twoParts();
    const g = s.groupSelected()!;
    s.duplicateSelected([0, 20, 0]);
    expect(s.groups).toHaveLength(2);
    const copies = s.selectedParts();
    expect(copies).toHaveLength(2);
    expect(copies.every((p) => p.group === s.groups[1]!.id)).toBe(true);
    expect(s.groups[1]!.name).toBe(g.name);
    s.select([a.id]);
    s.duplicateSelected();
    expect(s.selectedParts()[0]!.group).toBe(g.id);
    expect(s.membersOf(g.id)).toHaveLength(3);
    expect(b.group).toBe(g.id);
  });

  it('arrays a group into separate groups', () => {
    const { s } = twoParts();
    s.groupSelected();
    s.arraySelected('y', 3, 16);
    expect(s.groups).toHaveLength(3);
    expect(s.parts).toHaveLength(6);
  });

  it('moves parts into and out of groups', () => {
    const { s, a, b } = twoParts();
    const g = s.groupSelected()!;
    const c = s.addPart('2x6');
    s.moveToGroup([c.id], g.id);
    expect(s.membersOf(g.id).map((p) => p.id)).toEqual([a.id, b.id, c.id]);
    s.moveToGroup([a.id], undefined);
    expect(s.membersOf(g.id).map((p) => p.id)).toEqual([b.id, c.id]);
    expect(s.partById(a.id)!.group).toBeUndefined();
    s.moveToGroup([b.id, c.id], undefined);
    expect(s.groups).toHaveLength(0); // emptied, so pruned
    s.undo();
    expect(s.groups).toHaveLength(1);
  });

  it('keeps an array whole when a copy is pulled out, and copies a part moved in', () => {
    const s = new Store();
    s.addPart('2x4');
    const g = s.setArray({ axis: 'x', count: 3, spacing: 16, mode: 'center' })!;
    const copy = s.parts.find((p) => p.arrayIndex === 2)!;
    s.moveToGroup([copy.id], undefined);
    expect(s.parts.filter((p) => p.group === g.id)).toHaveLength(3);
    expect(s.partById(copy.id)!.group).toBeUndefined();
    expect(s.partById(copy.id)!.arrayIndex).toBeUndefined();
    const extra = s.addPart('2x6');
    s.moveToGroup([extra.id], g.id);
    expect(s.parts.filter((p) => p.group === g.id)).toHaveLength(6);
  });

  it('nests groups by re-parenting, never inside themselves', () => {
    const { s } = twoParts();
    const inner = s.groupSelected()!;
    const c = s.addPart('2x4');
    const d = s.addPart('2x4');
    s.select([c.id, d.id]);
    const outer = s.groupSelected()!;
    s.reparentGroup(inner.id, outer.id);
    expect(s.groupById(inner.id)!.parent).toBe(outer.id);
    expect(s.membersOf(outer.id)).toHaveLength(4);
    s.reparentGroup(outer.id, inner.id); // a cycle: refused
    expect(s.groupById(outer.id)!.parent).toBeUndefined();
    s.reparentGroup(inner.id, undefined);
    expect(s.groupById(inner.id)!.parent).toBeUndefined();
  });

  it('renames groups and keeps them in the saved document', () => {
    const { s } = twoParts();
    const g = s.groupSelected()!;
    s.renameGroup(g.id, ' Wall A ');
    expect(g.name).toBe('Wall A');
    const doc = parseDocument(JSON.parse(JSON.stringify(s.toDocument())))!;
    expect(doc.groups).toHaveLength(1);
    const t = new Store();
    t.loadDocument(doc);
    expect(t.groups[0]!.name).toBe('Wall A');
    expect(t.selectionForClick(t.parts[0]!.id)).toHaveLength(2);
  });

  it('ignores malformed groups and dangling references in a file', () => {
    const doc = parseDocument({
      version: 2,
      parts: [
        { id: 1, stock: '2x4', len: 96, pos: [0, 0, 0], q: [0, 0, 0, 1], name: 'a', group: 9 },
      ],
      groups: [{ id: 'x' }, { id: 2, name: 'ok' }],
    })!;
    expect(doc.groups).toEqual([{ id: 2, name: 'ok' }]);
    const t = new Store();
    t.loadDocument(doc);
    expect(t.parts[0]!.group).toBeUndefined(); // group 9 never existed
    expect(t.groups).toHaveLength(0); // group 2 has no members
  });
});
