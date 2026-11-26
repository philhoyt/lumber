/** The modal transforms in the view: G, R, S, Shift+R, the pivot, box select, end cuts. */
import { expect, test } from '@playwright/test';
import { parseLen } from '../src/units';
import { hoverView, openBench, selectPart } from './helpers';

test('Shift+R arrays a part by dragging, or by a typed count', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  const { x, y } = await hoverView(page);
  await page.keyboard.press('Shift+R');
  // Dragging pulls copies out live; the readout names the axis and count.
  await page.mouse.move(x + 320, y, { steps: 12 });
  await expect
    .poll(async () => parseInt((await page.locator('#stat').textContent()) ?? '0', 10))
    .toBeGreaterThan(12);
  await expect(page.locator('.drag-label')).toContainText(/Array [+−][XY]: \d+ @ 16" o\.c\./);
  await page.keyboard.press('Escape');
  await expect(page.locator('#stat')).toContainText('12 parts');
  // A typed count along a locked axis.
  await page.keyboard.press('Shift+R');
  await page.keyboard.press('x');
  await page.keyboard.press('4');
  await page.keyboard.press('Enter');
  await expect(page.locator('#stat')).toContainText('15 parts');
  await expect(page.locator('#arrN')).toHaveValue('4');
  await expect(page.locator('#arrAxis')).toHaveValue('x');
  await expect(page.locator('.out-row', { hasText: 'Leg LF 4' })).toBeVisible();
  await page.locator('#bUndo').click();
  await expect(page.locator('#stat')).toContainText('12 parts');
});

test('P while rotating turns about a bottom corner instead of the centre', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  const read = async (id: string) => parseLen(await page.locator(id).inputValue())!;
  const x0 = await read('#pX');
  const y0 = await read('#pY');
  await hoverView(page);
  await page.keyboard.press('r');
  await page.keyboard.press('p');
  await expect(page.locator('.drag-label')).toContainText('bottom front-left corner');
  await page.keyboard.press('x');
  await page.keyboard.press('Enter');
  // Hinged on its front-left bottom corner, the leg lies down behind it along −Y, on the floor.
  expect(await read('#pX')).toBeCloseTo(x0, 3);
  expect(await read('#pZ')).toBeCloseTo(0, 3);
  expect(await read('#pY')).toBeLessThan(y0 - 30);
  await page.locator('#bUndo').click();
  await expect.poll(() => read('#pY')).toBeCloseTo(y0, 3);
});

test('a project switch during a rotation drops it instead of carrying the old parts', async ({
  page,
}) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  const view = await hoverView(page);
  await page.keyboard.press('r');
  await page.keyboard.press('x');
  await expect(page.locator('.drag-label')).toContainText('X 90°');
  // A new project arrives while the rotate is still live.
  await page.locator('#bNew').click();
  await expect(page.locator('#stat')).toContainText('0 parts');
  // The next click in the view used to commit the bench's snapshot as this project's
  // undo point; now the rotate is gone and the history is empty.
  await page.mouse.click(view.x + view.w / 2, view.y + view.h / 2);
  await expect(page.locator('.drag-label')).toBeHidden();
  await expect(page.locator('#bUndo')).toBeDisabled();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#stat')).toContainText('0 parts');
});

test('R then Enter with no turn, and a click that only selects, leave undo alone', async ({
  page,
}) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  await expect(page.locator('#bUndo')).toBeDisabled();
  const view = await hoverView(page);
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  await expect(page.locator('#bUndo')).toBeDisabled();
  // Clicking a part in the view (the bench top) starts a grab that goes nowhere.
  await page.mouse.click(view.x + view.w * 0.48, view.y + view.h * 0.37);
  await expect(page.locator('#stat')).toContainText('selected');
  await expect(page.locator('#bUndo')).toBeDisabled();
});

test('G moves by a typed distance along the constrained axis', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  await expect(page.locator('#pX')).toHaveValue('-24');
  await hoverView(page);
  await page.keyboard.press('g');
  await page.keyboard.press('x');
  await page.keyboard.type('12 - 1/2');
  await page.keyboard.press('Enter');
  await expect(page.locator('#pX')).toHaveValue('-12 1/2');
  await expect(page.locator('#pY')).toHaveValue('-12');
});

test('S sets the length and R turns a quarter', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  await hoverView(page);
  await page.keyboard.press('s');
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await expect(page.locator('#pLen')).toHaveValue('20');
  const before = await page.locator('#overall').textContent();
  await page.keyboard.press('r');
  await page.keyboard.press('x');
  await page.keyboard.press('Enter');
  await expect(page.locator('#overall')).not.toHaveText(before ?? '');
});

test('a box drag on empty space selects what it covers', async ({ page }) => {
  await openBench(page);
  const v = await hoverView(page);
  await page.mouse.move(v.x + 20, v.y + v.h - 20);
  await page.mouse.down();
  await page.mouse.move(v.x + v.w - 160, v.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#stat')).toContainText('12 selected');
  await page.keyboard.press('Escape');
  await expect(page.locator('#stat')).not.toContainText('selected');
});

test('R with a typed angle tilts a part, and Square up brings it back', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  await expect(page.locator('#rotX')).toHaveValue('0');
  await expect(page.locator('#bSquare')).toBeDisabled();
  await hoverView(page);
  await page.keyboard.press('r');
  await page.keyboard.press('x');
  await expect(page.locator('.drag-label')).toContainText('X 90°');
  await page.keyboard.type('15');
  await expect(page.locator('.drag-label')).toContainText('Rotate X 15');
  await page.keyboard.press('Enter');
  await expect(page.locator('#rotX')).toHaveValue('15');
  await expect(page.locator('#pZ')).toHaveValue('0'); // still standing on the floor
  await expect(page.locator('#bSquare')).toBeEnabled();
  await page.locator('#bSquare').click();
  await expect(page.locator('#rotX')).toHaveValue('0');
  await expect(page.locator('#bSquare')).toBeDisabled();
  await page.locator('#bUndo').click();
  await expect(page.locator('#rotX')).toHaveValue('15');
});

test('S scales the length with the mouse and keeps the part in place', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Apron front');
  await expect(page.locator('#pLen')).toHaveValue('45');
  const x0 = await page.locator('#pX').inputValue();
  const v = await hoverView(page);
  await page.mouse.move(v.x + v.w * 0.5, v.y + v.h * 0.62);
  await page.keyboard.press('s');
  await page.mouse.move(v.x + v.w * 0.5, v.y + v.h * 0.85, { steps: 4 });
  await expect(page.locator('.drag-label')).toContainText('Length');
  await page.keyboard.press('Enter');
  const len = await page.locator('#pLen').inputValue();
  expect(len).not.toBe('45');
  await expect(page.locator('#pX')).toHaveValue(x0); // the min corner stays put
  await page.locator('#bUndo').click();
  await expect(page.locator('#pLen')).toHaveValue('45');
  // Escape cancels a scale in progress.
  await hoverView(page);
  await page.keyboard.press('s');
  await page.mouse.move(v.x + v.w * 0.5, v.y + v.h * 0.9, { steps: 4 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#pLen')).toHaveValue('45');
  await expect(page.locator('#bUndo')).toBeDisabled();
});

test('bevels reach the cut list, and Fit end cuts a tilted leg to sit on the floor', async ({
  page,
}) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  await page.locator('#pBevelB').fill('20');
  await page.locator('#pBevelB').press('Enter');
  await page.locator('#pBevelB').press('Escape');
  await expect(page.locator('.part-label')).toContainText('bevel 0°/20°');
  await page.locator('[data-tab="cut"]').click();
  await expect(page.locator('#cutBody')).toContainText('bevel');
  await expect(page.locator('#cutBody')).toContainText('20°');
  await page.locator('[data-tab="parts"]').click();
  await page.locator('#bUndo').click();
  await expect(page.locator('#pBevelB')).toHaveValue('0');
  // Tilt the leg 15° about X; its lower end (B) now meets the floor at an angle.
  await hoverView(page);
  await page.keyboard.press('r');
  await page.keyboard.press('x');
  await page.keyboard.type('15');
  await page.keyboard.press('Enter');
  await expect(page.locator('#rotX')).toHaveValue('15');
  await page.locator('#bFitB').click();
  const toast = page.locator('.toast');
  await expect(toast).toContainText('End B cut to meet the floor');
  await expect(toast).toContainText('bevel');
  // The leg's width faces the tilt, so the cut is a miter; the cut end now sits on the floor.
  await expect(page.locator('#pMiterB')).toHaveValue('-15');
  await expect(page.locator('#pZ')).toHaveValue('0');
});
