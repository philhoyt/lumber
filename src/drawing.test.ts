import { describe, expect, it } from 'vitest';
import {
  dimH,
  dimV,
  drawingRows,
  hull,
  modelViewsSvg,
  partCorners,
  partOutline,
  partSheetSvg,
} from './drawing';
import { DEFAULT_Q, makeQ, type Part } from './model';
import { sampleWorkbench } from './sample';

const board = (over: Partial<Part> = {}): Part => ({
  id: 1,
  stock: '2x4',
  len: 96,
  pos: [0, 0, 0],
  q: [...DEFAULT_Q] as Part['q'],
  name: '2x4 1',
  ...over,
});

describe('hull', () => {
  it('keeps only the corners of a rectangle, counterclockwise', () => {
    const h = hull([
      [0, 0],
      [2, 0],
      [1, 0],
      [2, 1],
      [0, 1],
      [1, 0.5],
    ]);
    expect(h).toEqual([
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
    ]);
  });
});

describe('partCorners and partOutline', () => {
  it('projects a flat board to its length by width from the top and length by thickness from the front', () => {
    const p = board();
    expect(partCorners(p)).toHaveLength(8);
    expect(partOutline(p, 'top')).toEqual([
      [-48, -1.75],
      [48, -1.75],
      [48, 1.75],
      [-48, 1.75],
    ]);
    expect(partOutline(p, 'front')).toEqual([
      [-48, -0.75],
      [48, -0.75],
      [48, 0.75],
      [-48, 0.75],
    ]);
    expect(partOutline(p, 'right')).toEqual([
      [-1.75, -0.75],
      [1.75, -0.75],
      [1.75, 0.75],
      [-1.75, 0.75],
    ]);
  });

  it('shows a miter as a trapezoid from above and a rectangle from the front', () => {
    const p = board({ miter: [45, 0] });
    const top = partOutline(p, 'top');
    expect(top).toHaveLength(4);
    expect(new Set(top.map(([x]) => x)).size).toBe(3); // −48, −44.5 and 48
    expect(partOutline(p, 'front')).toHaveLength(4);
  });

  it('follows a stood-up board', () => {
    const p = board({ q: makeQ(['y']) }); // length runs up
    const front = partOutline(p, 'front');
    const xs = front.map(([x]) => x);
    const ys = front.map(([, y]) => y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(96);
  });
});

describe('drawingRows', () => {
  it('groups identical parts and splits on markers', () => {
    const a = board({ id: 1, name: 'A' });
    const b = board({ id: 2, name: 'B' });
    const c = board({ id: 3, name: 'C', fasteners: [{ kind: 'screw', face: 'top', at: [1, 1] }] });
    const rows = drawingRows([a, b, c]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.qty)).toEqual([2, 1]);
    expect(rows[0]!.names).toEqual(['A', 'B']);
    expect(rows[1]!.fasteners).toHaveLength(1);
    expect(rows[0]!.t).toBe(1.5);
  });
});

describe('dimension lines', () => {
  it('draw a line with ticks and centred text', () => {
    const h = dimH(10, 110, 50, '8"', 40);
    expect(h).toContain('class="dim"');
    expect(h).toContain('>8"</text>');
    expect(h).toContain('x="60"');
    expect((h.match(/<line/g) ?? []).length).toBe(5); // 2 extension, 1 dimension, 2 ticks
    const v = dimV(10, 110, 50, '3 1/2"');
    expect(v).toContain('rotate(-90');
    expect((v.match(/<line/g) ?? []).length).toBe(3);
  });
});

describe('SVG pages', () => {
  it('draws three views of the bench with its overall size', () => {
    const { svg, size } = modelViewsSvg(sampleWorkbench());
    expect(size).toEqual([48, 24, 34]);
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/class="view"/g) ?? []).length).toBe(3);
    expect(svg).toContain('>Front<');
    expect(svg).toContain('>Top<');
    expect(svg).toContain('>48"<');
    expect(svg).toContain('>34"<');
    expect(svg).not.toContain('NaN');
    expect((svg.match(/class="part"/g) ?? []).length).toBe(sampleWorkbench().length * 3);
  });

  it('skips hidden parts and copes with an empty model', () => {
    const p = board({ hidden: true });
    expect(modelViewsSvg([p]).svg).toBe('');
    expect(modelViewsSvg([]).size).toEqual([0, 0, 0]);
  });

  it('draws a part sheet with its dimensions, joinery and markers', () => {
    const p = board({
      miter: [45, 0],
      cuts: [{ kind: 'dado', face: 'top', at: 12, width: 0.75, depth: 0.375 }],
      fasteners: [{ kind: 'screw', face: 'bottom', at: [20, 1.75] }],
    });
    const row = drawingRows([p])[0]!;
    const { svg, notes } = partSheetSvg(row);
    expect(svg).toContain('96" long point');
    expect(svg).toContain('>3 1/2"<');
    expect(svg).toContain('>1 1/2"<');
    expect(svg).toContain('>12"<');
    expect(svg).toContain('45°');
    expect(svg).toContain('class="cut"');
    expect(svg).toContain('class="mark hidden"');
    expect(svg).not.toContain('NaN');
    expect(notes[0]).toMatch(/^dado/);
    expect(notes[1]).toMatch(/^screw/);
    expect(notes[2]).toMatch(/^Short point/);
  });
});
