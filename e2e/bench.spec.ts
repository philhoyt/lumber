/**
 * End-to-end checks over the sample workbench: the things a unit test cannot reach,
 * because they live in the scene, the panels and the keyboard wiring together.
 */
import { expect, test, type Page } from '@playwright/test';
import { parseLen } from '../src/units';

/** Open a fresh app (no saved projects) showing the sample bench. */
async function openBench(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#stat')).toContainText('12 parts');
}

/** Click a part's row in the Parts list. */
async function selectPart(page: Page, name: string): Promise<void> {
  await page.locator('.out-row', { hasText: name }).first().click();
  await expect(page.locator('#stat')).toContainText('1 selected');
}

/** Put the pointer over the middle of the 3D view, where the modal keys apply. */
async function hoverView(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await page.locator('#viewport canvas').boundingBox();
  if (!box) throw new Error('no viewport');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/** Where the corner gizmo draws each handle: a fingerprint of the camera's orientation. */
async function gizmoLayout(page: Page): Promise<string> {
  return page
    .locator('.nav-handles')
    .evaluate((g) =>
      [...g.querySelectorAll('circle')]
        .map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`)
        .join(' '),
    );
}

test('loads the sample workbench', async ({ page }) => {
  await openBench(page);
  await expect(page).toHaveTitle(/Lumber/);
  await expect(page.locator('#projName')).toHaveText('Workbench (sample)');
  await expect(page.locator('#overall')).toContainText('48" W × 24" D × 34" H');
});

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

test('the cut list groups the stock and prices the buy list', async ({ page }) => {
  await openBench(page);
  await page.locator('[data-tab="cut"]').click();
  const cut = page.locator('#cutBody');
  await expect(cut).toContainText('2x4');
  await expect(cut).toContainText('Buy list');
  await expect(cut).toContainText('bf of parts');
});

test('a share link opens a copy of the project', async ({ browser }) => {
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();
  await openBench(page);
  await page.locator('#bShare').click();
  await expect(page.locator('.toast')).toContainText('Link copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('#m=1.');
  const other = await context.newPage();
  await other.goto(link);
  await expect(other.locator('.toast')).toContainText('from the link');
  await expect(other.locator('#stat')).toContainText('12 parts');
  // The copy keeps the name, numbered because this browser already holds the original.
  await expect(other.locator('#projName')).toHaveText(/^Workbench \(sample\)/);
  await context.close();
});

test('Alt+drag orbits for mice without a middle button', async ({ page }) => {
  await openBench(page);
  const before = await gizmoLayout(page);
  const v = await hoverView(page);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(v.x + v.w / 2 + 120, v.y + v.h / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect.poll(() => gizmoLayout(page)).not.toBe(before);
  await expect(page.locator('#stat')).not.toContainText('selected');
});

test('the corner gizmo snaps to an axis view and 9 looks from the other side', async ({ page }) => {
  await openBench(page);
  await page.locator('.nav-handle', { hasText: /^X$/ }).locator('circle').click();
  await expect(page.locator('.nav-gizmo button').nth(2)).toHaveAttribute('title', /Orthographic/);
  await expect
    .poll(() =>
      page.locator('.nav-handle', { hasText: /^X$/ }).locator('circle').getAttribute('cx'),
    )
    .toBe('0.0');
  const right = await gizmoLayout(page);
  await hoverView(page);
  await page.keyboard.press('9');
  await expect.poll(() => gizmoLayout(page)).not.toBe(right);
  await expect(page.locator('.nav-handle', { hasText: /^X$/ })).toHaveClass(/far/);
});

test('assembly steps walk the build in the order the Part panel sets', async ({ page }) => {
  await openBench(page);
  // Shift+click the four legs in the Parts list and give them step 1.
  const rows = page.locator('.out-row');
  await rows.filter({ hasText: 'Leg LF' }).first().click();
  for (const n of ['Leg RF', 'Leg LB', 'Leg RB'])
    await rows
      .filter({ hasText: n })
      .first()
      .click({ modifiers: ['Control'] });
  await expect(page.locator('#stat')).toContainText('4 selected');
  await page.locator('#pStep').fill('1');
  await page.locator('#pStep').press('Enter');
  await page.locator('#pStep').press('Escape'); // leave the field so keys reach the view
  await hoverView(page);
  await page.keyboard.press('Shift+E');
  const bar = page.locator('.assembly-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Step 1 of 2: Leg LF, Leg RF, Leg LB, Leg RB');
  await page.keyboard.press(']');
  await expect(bar).toContainText('Step 2 of 2 (unnumbered)');
  await page.keyboard.press('Shift+E');
  await expect(bar).toBeHidden();
  await page.locator('#bUndo').click();
  await expect(page.locator('#pStep')).toHaveValue('');
});

test('D labels every part and shows the selection extents', async ({ page }) => {
  await openBench(page);
  await hoverView(page);
  await page.keyboard.press('d');
  const shown = page.locator('.dim-label:not(.extent)').filter({ visible: true });
  await expect(shown).toHaveCount(12);
  await expect(shown.first()).toContainText('"');
  await selectPart(page, 'Leg LF');
  await expect(page.locator('.dim-label.extent').filter({ visible: true })).toHaveCount(3);
  await expect(page.locator('.dim-label.extent').filter({ hasText: /^H/ })).toContainText(
    '33 1/4"',
  );
  await expect(shown).toHaveCount(11); // the part label already names the selected one
  await hoverView(page);
  await page.keyboard.press('d');
  await expect(page.locator('.dim-label').filter({ visible: true })).toHaveCount(0);
});

test('M measures between two snapped points', async ({ page }) => {
  await openBench(page);
  const v = await hoverView(page);
  await page.keyboard.press('m');
  await expect(page.locator('#viewport')).toHaveCSS('cursor', 'crosshair');
  // Two points on the bench top: the readout gives the distance and its axis parts.
  await page.mouse.click(v.x + v.w * 0.41, v.y + v.h * 0.37);
  await page.mouse.click(v.x + v.w * 0.55, v.y + v.h * 0.39);
  const label = page.locator('.measure-label');
  await expect(label).toBeVisible();
  await expect(label).toContainText('ΔX');
  await expect(label).toContainText('"');
  await page.keyboard.press('Escape');
  await expect(label).toBeHidden();
  await expect(page.locator('#viewport')).toHaveCSS('cursor', 'auto');
});

test('F places a fastener marker on a face and lists it as hardware', async ({ page }) => {
  await openBench(page);
  const v = await hoverView(page);
  await page.keyboard.press('f');
  const bar = page.locator('.fasten-bar');
  await expect(bar).toBeVisible();
  await page.mouse.click(v.x + v.w * 0.48, v.y + v.h * 0.37); // the bench top
  await expect(page.locator('#bUndo')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  await page.locator('[data-tab="cut"]').click();
  await expect(page.locator('#cutBody')).toContainText('Hardware');
  await expect(page.locator('#cutBody')).toContainText('screw');
  await page.locator('#bUndo').click();
  await expect(page.locator('#bUndo')).toBeDisabled();
});

test('E explodes the view, which is look-only, and collapses again', async ({ page }) => {
  await openBench(page);
  await selectPart(page, 'Leg LF');
  const before = await page.locator('#pX').inputValue();
  await hoverView(page);
  await page.keyboard.press('e');
  const bar = page.locator('.explode-bar:not(.assembly-bar)');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Looking only');
  // A grab does not start while exploded: no readout, no move cursor, nothing to undo.
  await page.keyboard.press('g');
  await expect(page.locator('.drag-label')).toBeHidden();
  await expect(page.locator('#viewport')).not.toHaveCSS('cursor', 'move');
  await expect(page.locator('#pX')).toHaveValue(before);
  await expect(page.locator('#bUndo')).toBeDisabled();
  await bar.locator('#explodeDone').click();
  await expect(bar).toBeHidden();
  // The slider's amount is remembered: E again explodes to the same amount.
  await page.keyboard.press('e');
  await expect(bar).toBeVisible();
  await expect(bar.locator('#explodeAmt')).toHaveValue('50');
  await page.keyboard.press('e');
  await expect(bar).toBeHidden();
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
