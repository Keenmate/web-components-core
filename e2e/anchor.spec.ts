import { test, expect } from './fixtures';

// anchor() (core /positioning) in a real browser: the floating box is positioned fixed with a
// resolved left/top that lands at the requested placement + offset, and re-anchoring with new
// options moves it.
//
// Fixture: test/anchor.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/anchor.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('anchors a floating box to the reference (fixed, resolved left/top, placement + offset)', async ({ page }) => {
  const box = page.locator('.fx-float');
  await expect(box).toBeVisible();
  const pos = await box.evaluate((el) => ({ position: getComputedStyle(el).position, left: el.style.left }));
  expect(pos.position).toBe('fixed');
  expect(pos.left).not.toBe('');

  const r = (await page.locator('#ref').boundingBox())!;
  await expect.poll(async () => {
    const b = (await box.boundingBox())!;
    return {
      centered: Math.abs(b.x + b.width / 2 - (r.x + r.width / 2)) < 1,
      gap: Math.round(b.y - (r.y + r.height)),
    };
  }).toEqual({ centered: true, gap: 8 });
});

test('re-anchoring with another placement moves the box', async ({ page }) => {
  await page.evaluate(() => (window as any).rebuild({ placement: 'right', offset: 12 }));
  const r = (await page.locator('#ref').boundingBox())!;
  await expect.poll(async () => {
    const b = (await page.locator('.fx-float').boundingBox())!;
    return Math.round(b.x - (r.x + r.width));
  }).toBe(12);
});
