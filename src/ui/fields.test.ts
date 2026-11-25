import { describe, expect, it } from 'vitest';
import { arrowStep, stepValue } from './fields';

const keys = (over: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

describe('arrowStep', () => {
  it('uses the grid step by default and a sixteenth when the grid is off', () => {
    expect(arrowStep(keys(), 0.5)).toBe(0.5);
    expect(arrowStep(keys(), 0)).toBe(1 / 16);
  });
  it('steps an inch with Shift and a sixteenth with Ctrl', () => {
    expect(arrowStep(keys({ shiftKey: true }), 0.5)).toBe(1);
    expect(arrowStep(keys({ ctrlKey: true }), 0.5)).toBe(1 / 16);
    expect(arrowStep(keys({ ctrlKey: true, shiftKey: true }), 0.5)).toBe(1 / 16);
  });
});

describe('stepValue', () => {
  it('moves up and down by the step', () => {
    expect(stepValue(33.25, 0.5, true, -Infinity)).toBe(33.75);
    expect(stepValue(33.25, 0.5, false, -Infinity)).toBe(32.75);
  });
  it('never goes below the minimum', () => {
    expect(stepValue(0.5, 1, false, 1 / 16)).toBe(1 / 16);
  });
  it('rounds away float noise', () => {
    expect(stepValue(0.1 + 0.2, 1 / 16, true, 0)).toBe(0.359375);
  });
});
