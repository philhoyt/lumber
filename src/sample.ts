/** The sample model: a simple 2x4 workbench with a plywood top and a lower shelf. */
import { makeQ, type Axis, type Part, type Vec3 } from './model';

export function sampleWorkbench(): Part[] {
  const parts: Part[] = [];
  let id = 1;
  const add = (stock: string, len: number, seq: Axis[], pos: Vec3, name: string, w?: number) => {
    parts.push({ id: id++, stock, len, w, pos, q: makeQ(seq), name });
  };
  const height = 34;
  const legH = height - 0.75;
  add('ply34', 48, ['x'], [0, height - 0.375, 0], 'Top', 24);
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const)
    add(
      '2x4',
      legH,
      ['x', 'z'],
      [x * (24 - 0.75), legH / 2, z * (12 - 1.75)],
      `Leg ${x < 0 ? 'L' : 'R'}${z < 0 ? 'B' : 'F'}`,
    );
  for (const z of [-1, 1] as const)
    add(
      '2x4',
      45,
      ['x', 'x'],
      [0, legH - 1.75, z * (12 - 0.75)],
      `Apron ${z < 0 ? 'back' : 'front'}`,
    );
  for (const x of [-1, 1] as const)
    add(
      '2x4',
      17,
      ['x', 'x', 'y'],
      [x * (24 - 0.75), legH - 1.75, 0],
      `Apron ${x < 0 ? 'left' : 'right'}`,
    );
  for (const z of [-1, 1] as const)
    add(
      '2x4',
      45,
      ['x', 'x'],
      [0, 8 + 1.75, z * (12 - 0.75)],
      `Stretcher ${z < 0 ? 'back' : 'front'}`,
    );
  add('ply12', 45, ['x'], [0, 8 + 3.5 + 0.25, 0], 'Shelf', 21);
  return parts;
}
