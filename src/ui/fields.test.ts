import { describe, expect, it } from 'vitest';
import { arrowStep, numberStep, scrubValue, SCRUB_PX, stepValue } from './fields';

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

describe('numberStep', () => {
  it('steps 1, Shift 5, Ctrl the field step when finer', () => {
    expect(numberStep(keys(), 0.5)).toBe(1);
    expect(numberStep(keys({ shiftKey: true }), 0.5)).toBe(5);
    expect(numberStep(keys({ ctrlKey: true }), 0.5)).toBe(0.5);
    expect(numberStep(keys({ ctrlKey: true }), 1)).toBe(1);
    expect(numberStep(keys({ ctrlKey: true }), NaN)).toBe(1);
  });
});

describe('stepValue with a maximum', () => {
  it('never goes above it', () => {
    expect(stepValue(74, 5, true, -75, 75)).toBe(75);
  });
});

describe('scrubValue', () => {
  it('moves one step per few pixels, either way, and not at all in the dead zone', () => {
    expect(scrubValue(10, SCRUB_PX - 1, 0.5, 0)).toBe(10);
    expect(scrubValue(10, SCRUB_PX, 0.5, 0)).toBe(10.5);
    expect(scrubValue(10, 10 * SCRUB_PX, 0.5, 0)).toBe(15);
    expect(scrubValue(10, -3 * SCRUB_PX, 0.5, 0)).toBe(8.5);
  });
  it('respects the limits', () => {
    expect(scrubValue(1, -100 * SCRUB_PX, 1, 0.0625)).toBe(0.0625);
    expect(scrubValue(70, 100 * SCRUB_PX, 1, -75, 75)).toBe(75);
  });
});
