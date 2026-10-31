import { test, expect } from './fixtures';

// createPopover() (core /positioning) in a real browser:
//   - open() mounts the panel portaled into <body>, fixed, below the reference (bottom-start +
//     offset) with matchWidth 'exact' → the reference's width;
//   - close() (here via the page's outside-click handler) unmounts it; toggling reopens.
//
// Fixture: test/popover.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/popover.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('toggles a portaled panel and closes on outside click', async ({ page }) => {
  const ref = page.locator('#ref');
  await ref.click();
  const panel = page.locator('.fx-panel');
  await expect(panel).toBeVisible({ timeout: 2000 });
  expect(await panel.evaluate((el) => el.parentElement?.tagName)).toBe('BODY'); // portaled
  expect(await page.evaluate(() => (window as any).pop.isOpen)).toBe(true);

  await page.mouse.click(5, 300); // outside
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).pop.isOpen)).toBe(false);

  await ref.click();
  await expect(panel).toBeVisible();
  await ref.click(); // toggle closes
  await expect(panel).toHaveCount(0);
});

test('placement bottom-start + offset, matchWidth exact', async ({ page }) => {
  const ref = page.locator('#ref');
  await ref.click();
  const panel = page.locator('.fx-panel');
  await expect(panel).toBeVisible();
  const r = (await ref.boundingBox())!;
  await expect.poll(async () => {
    const p = (await panel.boundingBox())!;
    return {
      left: Math.round(p.x - r.x),
      gap: Math.round(p.y - (r.y + r.height)),
      width: Math.round(p.width - r.width),
    };
  }).toEqual({ left: 0, gap: 6, width: 0 });
});
