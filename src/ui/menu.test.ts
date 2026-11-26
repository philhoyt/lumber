import { describe, expect, it, vi } from 'vitest';
import { Store } from '../store';
import { buildListMenu, buildMenu, menuTitle, type MenuActions } from './menu';

const actions = (): MenuActions => ({
  beginArray: vi.fn(),
  beginGrab: vi.fn(),
  beginRotate: vi.fn(),
  beginSize: vi.fn(),
  duplicateAndGrab: vi.fn(),
  setView: vi.fn(),
  flipView: vi.fn(),
  toggleFasten: vi.fn(),
  toggleExplode: vi.fn(),
  toggleAssembly: vi.fn(),
});
const labels = (sections: ReturnType<typeof buildMenu>) =>
  sections.map((s) => s.map((i) => i.label));

describe('buildMenu', () => {
  it('offers stock, select all and views on empty space', () => {
    const store = new Store();
    const m = buildMenu({ x: 0, y: 0, partId: null, ground: [10, 5, 0] }, store, actions());
    expect(labels(m)).toEqual([
      ['Add stock', 'Select all', 'Fasteners'],
      ['View', 'Exploded view', 'Assembly steps', 'Fit all'],
    ]);
    const stock = m[0]![0]!.children!;
    expect(stock.map((s) => s.label)).toContain('2x4');
    stock.find((s) => s.label === '2x4')!.action!();
    expect(store.parts).toHaveLength(1);
    expect(store.parts[0]!.pos[0]).toBe(10);
  });

  it('offers the transforms and edits for a selection', () => {
    const store = new Store();
    store.addPart('2x4');
    const a = actions();
    const m = buildMenu({ x: 0, y: 0, partId: 1, ground: null }, store, a);
    expect(labels(m)).toEqual([
      ['Grab', 'Rotate', 'Set length', 'Fasteners'],
      ['Duplicate', 'Array by dragging', 'Drop', 'Mirror'],
      ['Hide', 'Delete'],
      ['Add stock', 'Select all', 'View', 'Exploded view', 'Assembly steps'],
    ]);
    m[0]![1]!.action!();
    expect(a.beginRotate).toHaveBeenCalled();
    expect(m[0]![0]!.key).toBe('G');
  });

  it('adds Align for several parts and Show hidden when something is hidden', () => {
    const store = new Store();
    store.addPart('2x4');
    store.addPart('2x4');
    store.selectAll();
    expect(
      labels(buildMenu({ x: 0, y: 0, partId: 1, ground: null }, store, actions()))[1],
    ).toContain('Align');
    store.select([1]);
    store.hideSelected();
    store.select([2]);
    const m = buildMenu({ x: 0, y: 0, partId: 2, ground: null }, store, actions());
    expect(labels(m)[2]).toEqual(['Hide', 'Show hidden', 'Delete']);
  });

  it('titles the menu by the selection', () => {
    const store = new Store();
    expect(menuTitle(store)).toBe('Scene');
    store.addPart('2x4');
    expect(menuTitle(store)).toBe('2x4 1');
    store.addPart('2x6');
    store.selectAll();
    expect(menuTitle(store)).toBe('2 parts');
  });
});

describe('buildListMenu', () => {
  const list = () => ({ rename: vi.fn() });
  it('leads with the row actions, then the selection actions, without the scene tail', () => {
    const store = new Store();
    store.addPart('2x4');
    store.addPart('2x4');
    store.select([1]);
    const l = list();
    const m = buildListMenu({ kind: 'part', id: 1 }, store, actions(), l);
    expect(labels(m)[0]).toEqual(['Rename', 'Frame in view', 'Hide others']);
    expect(labels(m).at(-1)).toEqual(['Hide', 'Delete']);
    expect(labels(m).flat()).not.toContain('Add stock');
    m[0]![0]!.action!();
    expect(l.rename).toHaveBeenCalled();
    m[0]![2]!.action!();
    expect(store.parts.map((p) => !!p.hidden)).toEqual([false, true]);
  });
  it('offers the group for a part inside one, and Ungroup for the group row', () => {
    const store = new Store();
    store.addPart('2x4');
    store.addPart('2x4');
    store.selectAll();
    const g = store.groupSelected()!;
    store.select([1]);
    const m = buildListMenu({ kind: 'part', id: 1 }, store, actions(), list());
    expect(labels(m)[0]).toContain('Select its group');
    m[0]!.find((i) => i.label === 'Select its group')!.action!();
    expect(store.selected.size).toBe(2);
    const gm = buildListMenu({ kind: 'group', id: g.id }, store, actions(), list());
    expect(labels(gm).flat()).toContain('Ungroup');
    expect(labels(gm)[0]).not.toContain('Select its group');
  });
  it('only renames or shows a hidden part', () => {
    const store = new Store();
    store.addPart('2x4');
    store.select([1]);
    store.hideSelected();
    const m = buildListMenu({ kind: 'part', id: 1 }, store, actions(), list());
    expect(labels(m)).toEqual([['Rename'], ['Show']]);
    m[1]![0]!.action!();
    expect(store.parts[0]!.hidden).toBeFalsy();
  });
});
