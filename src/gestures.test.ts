import { describe, expect, it } from 'vitest';
import { dragGesture, orbitDegrees, wheelGesture, wheelPixels, zoomScale } from './gestures';

const mods = (
  over: Partial<{ altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {},
) => ({
  altKey: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

describe('dragGesture', () => {
  it('orbits on Alt, pans on Shift+Alt, zooms on Ctrl+Alt, and ignores the rest', () => {
    expect(dragGesture({ button: 0, ...mods({ altKey: true }) })).toBe('orbit');
    expect(dragGesture({ button: 0, ...mods({ altKey: true, shiftKey: true }) })).toBe('pan');
    expect(dragGesture({ button: 0, ...mods({ altKey: true, ctrlKey: true }) })).toBe('zoom');
    expect(dragGesture({ button: 0, ...mods({ altKey: true, metaKey: true }) })).toBe('zoom');
    expect(dragGesture({ button: 0, ...mods() })).toBeNull();
    expect(dragGesture({ button: 0, ...mods({ shiftKey: true }) })).toBeNull();
    expect(dragGesture({ button: 1, ...mods({ altKey: true }) })).toBeNull();
  });
});

describe('wheelGesture', () => {
  it('reads a pinch as zoom, Shift as pan, and a plain scroll as orbit', () => {
    expect(wheelGesture(mods({ ctrlKey: true }))).toBe('zoom');
    expect(wheelGesture(mods({ metaKey: true }))).toBe('zoom');
    expect(wheelGesture(mods({ shiftKey: true }))).toBe('pan');
    expect(wheelGesture(mods())).toBe('orbit');
  });
});

describe('amounts', () => {
  it('normalises line and page wheel units to pixels', () => {
    expect(wheelPixels(2, 3, 0)).toEqual([2, 3]);
    expect(wheelPixels(1, -1, 1)).toEqual([16, -16]);
    expect(wheelPixels(0, 1, 2)).toEqual([0, 400]);
  });

  it('turns a scroll to the right into a turn to the right, and up into a look from higher', () => {
    const { az, el } = orbitDegrees(100, 0);
    expect(az).toBeCloseTo(-30);
    expect(el).toBe(-0);
    expect(orbitDegrees(0, -50).el).toBeCloseTo(15);
  });

  it('zooms in on fingers apart and clamps either way', () => {
    expect(zoomScale(-50)).toBeLessThan(1);
    expect(zoomScale(50)).toBeGreaterThan(1);
    expect(zoomScale(0)).toBe(1);
    expect(zoomScale(10000)).toBe(4);
    expect(zoomScale(-10000)).toBe(0.25);
  });
});
