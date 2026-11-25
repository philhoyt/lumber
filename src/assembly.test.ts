import { describe, expect, it } from 'vitest';
import {
  assemblyOffsets,
  effectiveStep,
  lastStep,
  normalizeStep,
  stepCount,
  stepState,
  stepTitle,
} from './assembly';
import { makeQ, type Part } from './model';

const part = (id: number, x: number, step?: number): Part => ({
  id,
  stock: '2x4',
  len: 24,
  pos: [x, 0, 1.75],
  q: makeQ([]),
  name: `P${id}`,
  ...(step === undefined ? {} : { step }),
});

const parts = [part(1, -40, 1), part(2, 40, 1), part(3, 0, 2), part(4, 80)];

describe('steps', () => {
  it('counts the numbered steps plus one for the unnumbered parts', () => {
    expect(lastStep(parts)).toBe(2);
    expect(stepCount(parts)).toBe(3);
    expect(stepCount([part(1, 0), part(2, 10)])).toBe(1);
    expect(stepCount([part(1, 0, 3)])).toBe(3);
    expect(stepCount([])).toBe(0);
  });
  it('puts unnumbered parts in the step after the last numbered one', () => {
    expect(effectiveStep(parts[3]!, parts)).toBe(3);
    expect(effectiveStep(parts[2]!, parts)).toBe(2);
  });
  it('sorts the parts into in place, current and pending for a step', () => {
    const s = stepState(parts, 2);
    expect(s.inPlace.map((p) => p.id)).toEqual([1, 2]);
    expect(s.current.map((p) => p.id)).toEqual([3]);
    expect(s.pending.map((p) => p.id)).toEqual([4]);
  });
});

describe('assemblyOffsets', () => {
  it('leaves the parts up to the step in place and pulls the rest away', () => {
    const o = assemblyOffsets(parts, () => undefined, 1);
    expect(o.get(1)).toEqual([0, 0, 0]);
    expect(o.get(2)).toEqual([0, 0, 0]);
    expect(o.get(3)![0]).not.toBe(0);
    expect(o.get(4)![0]).toBeGreaterThan(0);
    const all = assemblyOffsets(parts, () => undefined, 3);
    expect([...all.values()].every((v) => v.every((x) => x === 0))).toBe(true);
  });
});

describe('normalizeStep and stepTitle', () => {
  it('keeps whole numbers from 1 up and drops the rest', () => {
    expect(normalizeStep(2.4)).toBe(2);
    expect(normalizeStep(0)).toBeUndefined();
    expect(normalizeStep(null)).toBeUndefined();
    expect(normalizeStep(NaN)).toBeUndefined();
  });
  it('names the parts of a step', () => {
    expect(stepTitle(parts, 1)).toBe('Step 1 of 3: P1, P2');
    expect(stepTitle(parts, 3)).toBe('Step 3 of 3 (unnumbered): P4');
    const many = [1, 2, 3, 4, 5, 6].map((i) => part(i, i * 10, 1));
    expect(stepTitle(many, 1)).toBe('Step 1 of 1: P1, P2, P3 and 3 more');
  });
});
