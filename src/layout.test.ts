import { describe, expect, it } from 'vitest';
import { clampWidth, DEFAULT_LAYOUT, draggedWidth, parseLayout } from './layout';

describe('clampWidth', () => {
  it('keeps each panel within its limits and rounds', () => {
    expect(clampWidth('palette', 100)).toBe(150);
    expect(clampWidth('palette', 1000)).toBe(480);
    expect(clampWidth('side', 300.6)).toBe(301);
    expect(clampWidth('side', 50)).toBe(260);
  });
});

describe('draggedWidth', () => {
  it('grows the palette when its splitter moves right, and shrinks the side panel', () => {
    expect(draggedWidth('palette', 230, 40)).toBe(270);
    expect(draggedWidth('side', 340, 40)).toBe(300);
    expect(draggedWidth('side', 340, -40)).toBe(380);
  });
});

describe('parseLayout', () => {
  it('falls back to the defaults for nothing, junk or odd values', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('not json')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"palette":"wide","side":9999}')).toEqual({ palette: 230, side: 680 });
    expect(parseLayout('{"palette":300}')).toEqual({ palette: 300, side: 340 });
  });
});
