import { test, expect, type Page } from './fixtures';

// Overlay tree step 2 (SPEC §12.9, review 2026-11-03 WP8) in a real browser: nested popovers
// that opt into Escape / outside-press routing.
//
// Fixture: test/overlay-tree.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/overlay-tree.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
  await page.locator('#open-outer').click();
  await page.locator('#open-inner').click();
  await expect(page.locator('#inner')).toBeVisible();
});

const log = (page: Page) => page.evaluate(() => (window as any).fixture.log as string[]);

test('opening the inner popover from inside the outer one keeps the outer open', async ({ page }) => {
  await expect(page.locator('#outer')).toBeVisible();
  expect(await log(page)).toEqual([]);
});

test('Escape closes one level per press, deepest first, and focus returns to the opener', async ({ page }) => {
  await page.locator('#inner-button').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#inner')).toBeHidden();
  await expect(page.locator('#outer')).toBeVisible();
  await expect(page.locator('#open-inner')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#outer')).toBeHidden();
  await expect(page.locator('#open-outer')).toBeFocused();
  expect(await log(page)).toEqual(['inner:escape', 'outer:escape']);
});

test('a press inside the outer panel closes only the inner one', async ({ page }) => {
  await page.locator('#outer-spot').click();
  await expect(page.locator('#inner')).toBeHidden();
  await expect(page.locator('#outer')).toBeVisible();
  expect(await log(page)).toEqual(['inner:outside-click']);
});

test('a press outside both closes the whole chain', async ({ page }) => {
  await page.locator('#outside').click();
  await expect(page.locator('#inner')).toBeHidden();
  await expect(page.locator('#outer')).toBeHidden();
  expect(await log(page)).toEqual(['inner:outside-click', 'outer:outside-click']);
});

test('a press on the outer trigger toggles it closed (not closed by the press, then reopened)', async ({ page }) => {
  await page.locator('#open-outer').click();
  await expect(page.locator('#outer')).toBeHidden();
});

test('a click whose propagation a page handler stops still closes the chain', async ({ page }) => {
  await page.locator('#stopper-box').click();
  await expect(page.locator('#inner')).toBeHidden();
  await expect(page.locator('#outer')).toBeHidden();
  await expect(page.locator('#stopper-box')).toBeChecked();
});

test('opening a sibling popover from the same outer panel closes the first inner one, not the outer', async ({ page }) => {
  await page.locator('#open-inner-2').click();
  await expect(page.locator('#inner-2')).toBeVisible();
  await expect(page.locator('#inner')).toBeHidden();
  await expect(page.locator('#outer')).toBeVisible();
  // …and back: the first one replaces the second the same way.
  await page.locator('#open-inner').click();
  await expect(page.locator('#inner')).toBeVisible();
  await expect(page.locator('#inner-2')).toBeHidden();
  await expect(page.locator('#outer')).toBeVisible();
  expect((await log(page)).filter((entry) => entry.startsWith('outer'))).toEqual([]);
});

test('Escape in a sibling closes only that sibling; closing the outer closes its open child', async ({ page }) => {
  await page.locator('#open-inner-2').click();
  await page.locator('#inner-2-button').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#inner-2')).toBeHidden();
  await expect(page.locator('#outer')).toBeVisible();
  await page.locator('#open-inner-2').click();
  await page.evaluate(() => (window as any).fixture.outerPopover.close());
  await expect(page.locator('#inner-2')).toBeHidden();
  await expect(page.locator('#outer')).toBeHidden();
  expect((await log(page)).slice(-2)).toEqual(['inner-2:parent', 'outer:api']);
});
