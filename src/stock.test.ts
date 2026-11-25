import { afterEach, describe, expect, it } from 'vitest';
import { partDims } from './model';
import { DEFAULT_STOCK, getStock, sanitizeStock, setStock, stockById } from './stock';
import { parseDocument, Store } from './store';

afterEach(() => setStock(DEFAULT_STOCK));

describe('stock registry', () => {
  it('falls back to a stand-in for an unknown id instead of throwing', () => {
    const s = stockById('nope');
    expect(s.name).toContain('missing');
    expect(s.w).toBe(3.5);
  });

  it('sanitizes a file table, dropping malformed rows', () => {
    const list = sanitizeStock([
      { id: 'a', name: 'A', t: 1, w: 2 },
      { id: 'b', name: 'B', t: 0.5, sheet: [48, 96], price: 10 },
      { id: 'c', name: 'C', t: 1 }, // neither width nor sheet
      { id: 7, name: 'D', t: 1, w: 1 },
      null,
    ]);
    expect(list!.map((s) => s.id)).toEqual(['a', 'b']);
    expect(list![0]!.lengths).toEqual([96]);
    expect(list![0]!.price).toBe(0);
    expect(sanitizeStock('x')).toBeNull();
  });
});

describe('Store stock editing', () => {
  it('updates a stock and the parts follow', () => {
    const s = new Store();
    s.addPart('2x4');
    s.updateStock('2x4', { w: 4 });
    expect(stockById('2x4').w).toBe(4);
    expect(partDims(s.parts[0]!)[1]).toBe(4);
    s.undo();
    expect(stockById('2x4').w).toBe(3.5);
    s.redo();
    expect(stockById('2x4').w).toBe(4);
  });

  it('adds boards and sheets with fresh ids and deletes only unused ones', () => {
    const s = new Store();
    const b = s.addStock('board');
    const sh = s.addStock('sheet');
    expect(b.id).toBe('custom1');
    expect(sh.id).toBe('custom2');
    expect(sh.sheet).toEqual([48, 96]);
    s.addPart(b.id);
    expect(s.deleteStock(b.id)).toBe(false);
    expect(s.deleteStock(sh.id)).toBe(true);
    expect(getStock().some((x) => x.id === sh.id)).toBe(false);
    expect(s.deleteStock('nope')).toBe(false);
  });

  it('resets to the defaults', () => {
    const s = new Store();
    s.addStock('board');
    s.updateStock('2x4', { price: 99 });
    s.resetStock();
    expect(getStock()).toHaveLength(DEFAULT_STOCK.length);
    expect(stockById('2x4').price).toBe(4);
  });

  it('saves the table with the model and folds old price overrides in', () => {
    const s = new Store();
    s.updateStock('2x6', { price: 9 });
    s.addStock('sheet');
    const doc = parseDocument(JSON.parse(JSON.stringify(s.toDocument())))!;
    expect(doc.stock).toHaveLength(DEFAULT_STOCK.length + 1);
    const t = new Store();
    t.loadDocument(doc);
    expect(stockById('2x6').price).toBe(9);
    expect(getStock().some((x) => x.id === 'custom1')).toBe(true);

    const old = parseDocument({ version: 2, parts: [], prices: { '2x4': 7 } })!;
    expect(old.stock).toBeUndefined();
    t.loadDocument(old);
    expect(stockById('2x4').price).toBe(7);
    expect(getStock()).toHaveLength(DEFAULT_STOCK.length);
  });
});
