/** The view itself: orbit, the corner gizmo, assembly steps, dimensions, measuring, fasteners, explode. */
import { expect, test } from '@playwright/test';
import { gizmoLayout, hoverView, openBench, selectPart } from './helpers';

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
