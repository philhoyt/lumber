/**
 * End-to-end checks over the sample workbench: the things a unit test cannot reach,
 * because they live in the scene, the panels and the keyboard wiring together.
 */
import { expect, test, type Page } from '@playwright/test';

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
