/** The project as a whole: the sample, the cut list and buy list, share links. */
import { expect, test } from '@playwright/test';
import { openBench } from './helpers';

test('loads the sample workbench', async ({ page }) => {
  await openBench(page);
  await expect(page).toHaveTitle(/Lumber/);
  await expect(page.locator('#projName')).toHaveText('Workbench (sample)');
  await expect(page.locator('#overall')).toContainText('48" W × 24" D × 34" H');
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
