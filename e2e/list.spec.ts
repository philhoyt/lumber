/** The Parts list and the add menus: menus, drag and drop, selection, the between tools, stock. */
import { expect, test } from '@playwright/test';
import { parseLen } from '../src/units';
import { hoverView, openBench, selectPart } from './helpers';

test('right-clicking a Parts-list row opens its menu', async ({ page }) => {
  await openBench(page);
  await page.locator('.out-row', { hasText: 'Leg LF' }).click({ button: 'right' });
  const menu = page.locator('.cmenu');
  await expect(menu).toContainText('Leg LF');
  await expect(page.locator('#stat')).toContainText('1 selected');
  await menu.getByText('Hide others').click();
  await expect(page.locator('#outCount')).toContainText('11 hidden');
  await page.keyboard.press('Alt+h');
  // Two rows, then Group from the menu.
  await page.locator('.out-row', { hasText: 'Leg LF' }).click();
  await page.locator('.out-row', { hasText: 'Leg RF' }).click({ modifiers: ['Control'] });
  await page.locator('.out-row', { hasText: 'Leg RF' }).click({ button: 'right' });
  await expect(menu).toContainText('2 parts');
  await menu.getByText('Group', { exact: true }).click();
  await expect(page.locator('.out-row.group')).toContainText('2 parts');
  // Rename from the menu puts an input in the row.
  await page.locator('.out-row.group').click({ button: 'right' });
  await menu.getByText('Rename').click();
  await expect(page.locator('.out-row.group input')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#bUndo').click();
  await expect(page.locator('.out-row.group')).toHaveCount(0);
});

test('Alt + hover shows the distance from the selection to another part', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  // The outliner's hover reaches the view too, so Alt + hovering a row works as well.
  await page.keyboard.down('Alt');
  await page.locator('.out-row', { hasText: 'Leg RF' }).hover();
  const label = page.locator('.gap-label');
  await expect(label).toBeVisible();
  // The front legs stand 46 1/2" apart on centre and are 1 1/2" thick along X.
  await expect(label).toContainText('Gap X 45"');
  await expect(label).toContainText('46 1/2" o.c.');
  await page.keyboard.up('Alt');
  await expect(label).toBeHidden();
});

test('rows drag onto each other, into groups and back out', async ({ page }) => {
  await openBench(page);
  const row = (name: string) => page.locator('.out-row', { hasText: name }).first();
  // A loose part dropped on another loose part groups the two.
  await row('Leg LF').dragTo(row('Leg RF'));
  const group = page.locator('.out-row.group');
  await expect(group).toContainText('2 parts');
  // Another part dropped on the group joins it.
  await row('Leg LB').dragTo(group);
  await expect(group).toContainText('3 parts');
  // Dropped on a stock heading (the list background), a part leaves its group.
  await row('Leg LB').dragTo(page.locator('.out-group', { hasText: '2x4' }));
  await expect(group).toContainText('2 parts');
  // Stock from the palette dropped on the group is added into it.
  await page.locator('#boards .stock', { hasText: '2x6' }).first().dragTo(group);
  await expect(group).toContainText('3 parts');
  await expect(page.locator('#stat')).toContainText('13 parts');
});

test('in the list, Ctrl+click toggles a row and Shift+click selects the run between', async ({
  page,
}) => {
  await openBench(page);
  await selectPart(page, 'Apron back');
  await page.locator('.out-row', { hasText: 'Apron left' }).click({ modifiers: ['Control'] });
  await expect(page.locator('#stat')).toContainText('2 selected');
  await page.locator('.out-row', { hasText: 'Apron left' }).click({ modifiers: ['Control'] });
  await expect(page.locator('#stat')).toContainText('1 selected');
  // The run starts at the last plain click: Apron back .. Apron right are four rows.
  await selectPart(page, 'Apron back');
  await page.locator('.out-row', { hasText: 'Apron right' }).click({ modifiers: ['Shift'] });
  await expect(page.locator('#stat')).toContainText('4 selected');
});

test('C centres the selection between two parts picked from the list', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Stretcher front');
  // Shove it off centre, then centre it between the front legs.
  await page.locator('#pX').fill('5');
  await page.locator('#pX').press('Enter');
  await expect(page.locator('#pX')).toHaveValue('5');
  await page.locator('#pX').press('Escape');
  await page.keyboard.press('c');
  await expect(page.locator('.drag-label')).toContainText('click the first part');
  await page.locator('.out-row', { hasText: 'Leg LF' }).click();
  await expect(page.locator('.drag-label')).toContainText('second part');
  await page.locator('.out-row', { hasText: 'Leg RF' }).click();
  await expect(page.locator('#stat')).toContainText('1 selected');
  await expect(page.locator('#pX')).toHaveValue('-22 1/2');
  await expect(page.locator('.drag-label')).toBeHidden();
});

test('Shift+C spaces the selection evenly between two parts', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Stretcher front');
  await page.locator('.out-row', { hasText: 'Stretcher back' }).click({ modifiers: ['Control'] });
  await expect(page.locator('#stat')).toContainText('2 selected');
  // Between the left legs (inner faces at y = ±8 1/2, 17" clear) two 1 1/2" stretchers
  // get 4 2/3" gaps: the selection's front edge lands at -3 13/16 (to the sixteenth).
  await page.keyboard.press('Shift+C');
  await expect(page.locator('.drag-label')).toContainText('Space evenly between');
  await page.locator('.out-row', { hasText: 'Leg LF' }).click();
  await page.locator('.out-row', { hasText: 'Leg LB' }).click();
  await expect(page.locator('#stat')).toContainText('2 selected');
  await expect(page.locator('#pY')).toHaveValue('-3 13/16');
  await page.locator('#bUndo').click();
  await expect(page.locator('#pY')).toHaveValue('-12');
});

test("tapping an axis key twice moves along the part's own axis", async ({ page }) => {
  await openBench(page);
  // Apron right runs along Y: its own X axis is the world Y.
  await selectPart(page, 'Apron right');
  const read = async (id: string) => parseLen(await page.locator(id).inputValue())!;
  const x0 = await read('#pX');
  const y0 = await read('#pY');
  await hoverView(page);
  await page.keyboard.press('g');
  await page.keyboard.press('x');
  await page.keyboard.press('x');
  await expect(page.locator('.drag-label')).toContainText('Local X');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await expect.poll(() => read('#pY')).toBeCloseTo(y0 + 10, 3);
  expect(await read('#pX')).toBeCloseTo(x0, 3);
  // A third tap goes back to the free floor plane.
  await page.keyboard.press('g');
  await page.keyboard.press('y');
  await page.keyboard.press('y');
  await page.keyboard.press('y');
  await expect(page.locator('.drag-label')).not.toContainText('Local');
  await page.keyboard.press('Escape');
});

test('B adds a block between two parallel parts', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  await page.locator('.out-row', { hasText: 'Leg RF' }).click({ modifiers: ['Control'] });
  await expect(page.locator('#stat')).toContainText('2 selected');
  await hoverView(page);
  await page.keyboard.press('b');
  await expect(page.locator('#stat')).toContainText('13 parts');
  await expect(page.locator('.out-row', { hasText: 'Block' })).toContainText('45"');
  await expect(page.locator('#pLen')).toHaveValue('45');
  await page.locator('#bUndo').click();
  await expect(page.locator('#stat')).toContainText('12 parts');
});

test('Shift+A offers stock in groups, with the recent ones first', async ({ page }) => {
  await openBench(page);
  await hoverView(page);
  await page.keyboard.press('Shift+A');
  const menu = page.locator('.cmenu').first();
  await expect(menu).toContainText('2x lumber');
  await menu.getByText('2x lumber').hover();
  await page.locator('.cmenu.sub').getByText('2x6', { exact: true }).click();
  await expect(page.locator('#stat')).toContainText('13 parts');
  // Next time the 2x6 is a top-level item, and the palette shows it under Recent.
  await hoverView(page);
  await page.keyboard.press('Shift+A');
  const first = page.locator('.cmenu').first().locator('.item').first();
  await expect(first).toHaveText(/2x6/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#recent .stock')).toHaveCount(1);
});

test('a reference box is a part to design around, not to cut', async ({ page }) => {
  await openBench(page);
  await hoverView(page);
  await page.keyboard.press('Shift+A');
  await page.locator('.cmenu').first().getByText('Reference').hover();
  await page.locator('.cmenu.sub').getByText('Reference box').click();
  await expect(page.locator('#stat')).toContainText('12 parts · 1 reference · 1 selected');
  await page.locator('#pH').fill('30');
  await page.locator('#pH').press('Enter');
  await expect(page.locator('#pH')).toHaveValue('30');
  // The overall size and the cut list stay the bench's.
  await expect(page.locator('#overall')).toContainText('48" W × 24" D × 34" H');
  await page.locator('[data-tab="cut"]').click();
  await expect(page.locator('#cutBody')).toContainText('2x4');
  await expect(page.locator('#cutBody')).not.toContainText('Reference box');
  await page.locator('[data-tab="parts"]').click();
  await page.locator('#bUndo').click();
  await page.locator('#bUndo').click();
  await expect(page.locator('#stat')).toContainText('12 parts');
  await expect(page.locator('#stat')).not.toContainText('reference');
});

test('a reference cylinder takes a diameter and a height, no width', async ({ page }) => {
  await openBench(page);
  await hoverView(page);
  await page.keyboard.press('Shift+A');
  await page.locator('.cmenu').first().getByText('Reference').hover();
  await page.locator('.cmenu.sub').getByText('Reference cylinder').click();
  await expect(page.locator('#stat')).toContainText('12 parts · 1 reference · 1 selected');
  await expect(page.locator('#pW')).toHaveCount(0);
  await expect(page.locator('label[for="pLen"]')).toHaveText('D');
  await page.locator('#pLen').fill('8');
  await page.locator('#pLen').press('Enter');
  await page.locator('#pH').fill('30');
  await page.locator('#pH').press('Enter');
  await expect(page.locator('#pLen')).toHaveValue('8');
  await expect(page.locator('#pH')).toHaveValue('30');
  await expect(page.locator('#overall')).toContainText('48" W × 24" D × 34" H');
  await page.locator('[data-tab="cut"]').click();
  await expect(page.locator('#cutBody')).not.toContainText('Reference cylinder');
  await page.locator('[data-tab="parts"]').click();
});
