/** The Part panel: fields, scrubbing, Mixed values, its header, undo from a field, layout. */
import { expect, test } from '@playwright/test';
import { openBench, selectPart } from './helpers';

test('selecting a part shows its length, and the field takes arithmetic', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  const len = page.locator('#pLen');
  await expect(len).toHaveValue('33 1/4');
  await len.fill('33 1/4 - 3/4');
  await len.press('Enter');
  await expect(len).toHaveValue('32 1/2');
  await expect(page.locator('.out-row', { hasText: 'Leg LF' })).toContainText('32 1/2"');
  await page.locator('#bUndo').click();
  await expect(page.locator('#pLen')).toHaveValue('33 1/4');
});

test('dragging a field label scrubs its value as one undo step, and Escape reverts', async ({
  page,
}) => {
  await openBench(page);
  await selectPart(page, 'Apron back');
  const len = page.locator('#pLen');
  await expect(len).toHaveValue('45');
  const label = page.locator('label[for="pLen"], label:has(+ #pLen)').first();
  const b = (await label.boundingBox())!;
  await page.mouse.move(b.x + 8, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 48, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(len).toHaveValue('50');
  await page.locator('#bUndo').click();
  await expect(page.locator('#pLen')).toHaveValue('45');
  await expect(page.locator('#bUndo')).toBeDisabled();
  // Escape puts back what the field held and leaves it without applying.
  await page.locator('#pLen').fill('99');
  await page.locator('#pLen').press('Escape');
  await expect(page.locator('#pLen')).toHaveValue('45');
  await expect(page.locator('#pLen')).not.toBeFocused();
  await expect(page.locator('.out-row', { hasText: 'Apron back' })).toContainText('45"');
});

test('several parts show Mixed and a relative edit changes each of them', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Apron back');
  await page.locator('.out-row', { hasText: 'Leg LF' }).click({ modifiers: ['Control'] });
  await expect(page.locator('#stat')).toContainText('2 selected');
  const len = page.locator('#pLen');
  await expect(len).toHaveValue('');
  await expect(len).toHaveAttribute('placeholder', 'Mixed');
  await expect(page.locator('#pStock')).toHaveValue('2x4');
  await len.fill('+1/2');
  await len.press('Enter');
  await expect(page.locator('.out-row', { hasText: 'Apron back' })).toContainText('45 1/2"');
  await expect(page.locator('.out-row', { hasText: 'Leg LF' })).toContainText('33 3/4"');
  await page.locator('#pLen').fill('40');
  await page.locator('#pLen').press('Enter');
  await expect(page.locator('#pLen')).toHaveValue('40');
  await expect(page.locator('.out-row', { hasText: 'Leg LF' })).toContainText('40"');
  // A relative move shifts the selection's corner.
  const x = page.locator('#pX');
  const was = await x.inputValue();
  await x.fill('+2');
  await x.press('Enter');
  await expect(page.locator('#pX')).not.toHaveValue(was);
  await page.locator('#bUndo').click();
  await page.locator('#bUndo').click();
  await page.locator('#bUndo').click();
  await expect(page.locator('.out-row', { hasText: 'Leg LF' })).toContainText('33 1/4"');
});

test('the panel header names the selection and its actions work', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Apron back');
  const head = page.locator('.props-head');
  await expect(head).toContainText('Apron back');
  await expect(head).toContainText('2x4');
  await expect(head.locator('#bGroup')).toHaveCount(0);
  await head.locator('#bDup').click();
  await expect(page.locator('#stat')).toContainText('13 parts');
  await head.locator('#bDel').click();
  await expect(page.locator('#stat')).toContainText('12 parts');
  await page.locator('.out-row', { hasText: 'Apron back' }).click();
  await page.locator('.out-row', { hasText: 'Leg LF' }).click({ modifiers: ['Control'] });
  await expect(head).toContainText('2 parts');
  await expect(head.locator('#bGroup')).toBeVisible();
  await expect(page.locator('[data-align="0:min"]')).toBeVisible();
});

test('Ctrl+Z undoes an angle typed in the panel while the field still has focus', async ({
  page,
}) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  const rotX = page.locator('#rotX');
  await rotX.fill('30');
  await rotX.press('Enter');
  await expect(rotX).toHaveValue('30');
  await expect(rotX).toBeFocused();
  // Nothing new typed, so undo is the model's, not the field's.
  await rotX.press('Control+z');
  await expect(page.locator('#rotX')).toHaveValue('0');
  await page.locator('#rotX').press('Control+Shift+z');
  await expect(page.locator('#rotX')).toHaveValue('30');
  // With text typed but not applied, Ctrl+Z leaves the model alone.
  await page.locator('#rotX').fill('45');
  await page.locator('#rotX').press('Control+z');
  await page.locator('#rotX').press('Escape');
  await expect(page.locator('#rotX')).toHaveValue('30');
});

test('the panels resize by dragging the view edges and remember it', async ({ page }) => {
  await openBench(page);
  const side = page.locator('#side');
  const before = (await side.boundingBox())!.width;
  expect(Math.round(before)).toBe(340);
  const bar = page.locator('.splitter.right');
  const b = (await bar.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 120, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(460);
  await page.reload();
  await expect(page.locator('#stat')).toContainText('12 parts');
  expect(Math.round((await side.boundingBox())!.width)).toBe(460);
  await bar.dblclick();
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(340);
  // The palette's splitter goes away with the palette.
  await page.keyboard.press('t');
  await expect(page.locator('.splitter.left')).toBeHidden();
});

test('the properties panel never scrolls sideways, even at its narrowest', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Apron back');
  const bar = page.locator('.splitter.right');
  const b = (await bar.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 200, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await page.locator('#side').boundingBox())!.width))
    .toBe(260);
  await expect(page.locator('#bArr')).toBeVisible();
  const props = page.locator('#props');
  const over = await props.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(over).toBe(0);
  const inside = await page.locator('#bArr').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const p = el.closest('#props')!.getBoundingClientRect();
    return r.right <= p.right && r.left >= p.left;
  });
  expect(inside).toBe(true);
  await bar.dblclick();
});

test('Add cut adds a dado, and changing its kind to a chamfer reaches the cut list', async ({
  page,
}) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  await page.locator('#bAddCut').click();
  await expect(page.locator('#cut-0-kind')).toHaveValue('dado');
  await page.locator('#cut-0-kind').selectOption('chamfer');
  await expect(page.locator('#cut-0-edge')).toHaveValue('front');
  await page.locator('#cut-0-width').fill('1/2');
  await page.locator('#cut-0-width').press('Enter');
  await page.locator('[data-tab="cut"]').click();
  await expect(page.locator('#cutBody')).toContainText(
    'chamfer 1/2" across × 1/4" down off front edge, top',
  );
  await page.locator('[data-tab="parts"]').click();
  await page.locator('#bUndo').click();
  await page.locator('#bUndo').click();
  await page.locator('#bUndo').click();
  await expect(page.locator('#cut-0-kind')).toHaveCount(0);
});
