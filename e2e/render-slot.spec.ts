import { test, expect } from './fixtures';

type W = { __paint(): void; __set(mode: string, version: number): void };

test('memoized repaints keep a focused custom input; a new key re-runs the hook; false hides; null draws the default', async ({ page }) => {
  await page.goto('/test/render-slot.html');
  await page.locator('#inner').fill('typed');
  await page.evaluate(() => {
    (window as unknown as W).__paint();
    (window as unknown as W).__paint();
  });
  await expect(page.locator('#inner')).toBeFocused();
  await expect(page.locator('#inner')).toHaveValue('typed');
  await expect(page.locator('#calls')).toHaveText('1');

  await page.evaluate(() => (window as unknown as W).__set('custom', 2)); // new key, same HTML: hook runs, DOM kept
  await expect(page.locator('#calls')).toHaveText('2');
  await expect(page.locator('#inner')).toHaveValue('typed');

  await page.evaluate(() => (window as unknown as W).__set('hide', 2));
  await expect(page.locator('#slot')).toBeHidden();
  await page.evaluate(() => (window as unknown as W).__set('default', 2));
  await expect(page.locator('#slot')).toHaveText('default text');
});
