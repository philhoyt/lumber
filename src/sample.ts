/** The sample model: a simple 2x4 workbench with a plywood top and a lower shelf. Z is up. */
import { makeQ, type Axis, type Part, type Vec3 } from './model';

export function sampleWorkbench(): Part[] {
  const parts: Part[] = [];
  let id = 1;
  const add = (stock: string, len: number, seq: Axis[], pos: Vec3, name: string, w?: number) => {
    parts.push({ id: id++, stock, len, w, pos, q: makeQ(seq), name });
  };
  const height = 34;
  const legH = height - 0.75;
  // Flat: no rotation. On edge along X: ['x']. On edge along Y: ['x', 'z']. Standing: ['y'].
  add('ply34', 48, [], [0, 0, height - 0.375], 'Top', 24);
  for (const [x, y] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const)
    add(
      '2x4',
      legH,
      ['y'],
      [x * (24 - 0.75), y * (12 - 1.75), legH / 2],
      `Leg ${x < 0 ? 'L' : 'R'}${y < 0 ? 'F' : 'B'}`,
    );
  for (const y of [-1, 1] as const)
    add('2x4', 45, ['x'], [0, y * (12 - 0.75), legH - 1.75], `Apron ${y < 0 ? 'front' : 'back'}`);
  for (const x of [-1, 1] as const)
    add(
      '2x4',
      17,
      ['x', 'z'],
      [x * (24 - 0.75), 0, legH - 1.75],
      `Apron ${x < 0 ? 'left' : 'right'}`,
    );
  for (const y of [-1, 1] as const)
    add('2x4', 45, ['x'], [0, y * (12 - 0.75), 8 + 1.75], `Stretcher ${y < 0 ? 'front' : 'back'}`);
  add('ply12', 45, [], [0, 0, 8 + 3.5 + 0.25], 'Shelf', 21);
  return parts;
}
