/** Shared steps for the end-to-end specs: open the bench, pick a part, aim at the view. */
import { expect, type Page } from '@playwright/test';

/** Open a fresh app (no saved projects) showing the sample bench. */
export async function openBench(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#stat')).toContainText('12 parts');
}

/** Click a part's row in the Parts list. */
export async function selectPart(page: Page, name: string): Promise<void> {
  await page.locator('.out-row', { hasText: name }).first().click();
  await expect(page.locator('#stat')).toContainText('1 selected');
}

/** Put the pointer over the middle of the 3D view, where the modal keys apply. */
export async function hoverView(
  page: Page,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await page.locator('#viewport canvas').boundingBox();
  if (!box) throw new Error('no viewport');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/** Where the corner gizmo draws each handle: a fingerprint of the camera's orientation. */
export async function gizmoLayout(page: Page): Promise<string> {
  return page
    .locator('.nav-handles')
    .evaluate((g) =>
      [...g.querySelectorAll('circle')]
        .map((c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`)
        .join(' '),
    );
}
