import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// Review 2026-11-03 A-27 (e2e gaps of /menu openMenu, SPEC §12.13), in a real browser:
//   - RTL: submenus open to the LEFT of their owner, ← opens / → goes back;
//   - nested hover intent: a diagonal pointer path across a sibling parent keeps the open
//     submenu; resting on the sibling opens its submenu after the delay;
//   - custom renderMenuCallback: Tab moves between the form fields, the menu stays open;
//     Escape / the menu's own close() dismiss it;
//   - shadow-DOM opener: focus returns to the button INSIDE the shadow root (Escape, an item).
//
// Fixture: test/menu-review-gaps.html (<fx-menu-opener> — a button in a shadow root, the menu
// appended to that root).

const opener = (page: Page, id: string) => page.locator(`#${id}`).locator('button.open');
const menus = (page: Page, id: string) => page.locator(`#${id}`).locator('.km-menu');
const item = (page: Page, id: string, itemId: string) => page.locator(`#${id}`).locator(`.km-menu__item[data-id="${itemId}"]`);
const closes = (page: Page) => page.evaluate(() => (window as any).closes as string[]);
const deepFocus = (page: Page) => page.evaluate(() => (window as any).deepFocus() as string | null);

test.beforeEach(async ({ page }) => {
  await page.goto('/test/menu-review-gaps.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('RTL: the submenu opens to the left of its owner; ← opens and → goes back', async ({ page }) => {
  await opener(page, 'rtl').focus();
  await page.keyboard.press('Enter'); // keyboard activation → first item focused
  await expect(item(page, 'rtl', 'p')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(item(page, 'rtl', 'p1')).toBeFocused();
  await expect(menus(page, 'rtl')).toHaveCount(2);
  const owner = (await item(page, 'rtl', 'p').boundingBox())!;
  const sub = (await menus(page, 'rtl').nth(1).boundingBox())!;
  expect(sub.x + sub.width).toBeLessThanOrEqual(owner.x + 1); // fully on the left side
  await page.keyboard.press('ArrowRight');
  await expect(menus(page, 'rtl')).toHaveCount(1);
  await expect(item(page, 'rtl', 'p')).toBeFocused();

  // LTR control: the same menu opens to the right, and ← does not open it
  await page.keyboard.press('Escape');
  await opener(page, 'ltr').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft');
  await expect(menus(page, 'ltr')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(menus(page, 'ltr')).toHaveCount(2);
  const ltrOwner = (await item(page, 'ltr', 'p').boundingBox())!;
  const ltrSub = (await menus(page, 'ltr').nth(1).boundingBox())!;
  expect(ltrSub.x).toBeGreaterThanOrEqual(ltrOwner.x + ltrOwner.width - 1);
});

test('hover intent: a diagonal path across a sibling parent keeps the open submenu', async ({ page }) => {
  await opener(page, 'ltr').click();
  const p = (await item(page, 'ltr', 'p').boundingBox())!;
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await expect(item(page, 'ltr', 'p1')).toBeVisible();
  // Head for "P four" (below Q's row) — the straight line crosses "Parent Q".
  const target = (await item(page, 'ltr', 'p4').boundingBox())!;
  const q = (await item(page, 'ltr', 'q').boundingBox())!;
  expect(target.y).toBeGreaterThan(q.y + q.height / 2); // the path really crosses Q
  await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 12 });
  await expect(item(page, 'ltr', 'p4')).toBeVisible();
  await page.waitForTimeout(400); // well past the hover-intent delay
  await expect(item(page, 'ltr', 'p4')).toBeVisible();
  await expect(item(page, 'ltr', 'q1')).toHaveCount(0);
  await expect(item(page, 'ltr', 'p4')).toBeFocused();

  // Resting on Q opens its submenu (after the delay) instead.
  await page.mouse.move(q.x + q.width / 2, q.y + q.height / 2, { steps: 4 });
  await expect(item(page, 'ltr', 'q1')).toBeVisible();
  await expect(item(page, 'ltr', 'p1')).toHaveCount(0);
});

test('custom renderMenuCallback: Tab moves between its fields; Escape and its own close() dismiss', async ({ page }) => {
  await opener(page, 'custom').click();
  const menu = menus(page, 'custom');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveClass(/km-menu--custom/);
  await menu.locator('.f1').click();
  await page.keyboard.type('abc');
  await page.keyboard.press('Tab');
  await expect(menu.locator('.f2')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(menu.locator('.f1')).toBeFocused();
  await expect(menu.locator('.f1')).toHaveValue('abc'); // typing went to the field, not to the menu
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menus(page, 'custom')).toHaveCount(0);
  expect(await deepFocus(page)).toBe('custom:open'); // focus back on the shadow-DOM opener

  await opener(page, 'custom').click();
  await menus(page, 'custom').locator('.done').click();
  await expect(menus(page, 'custom')).toHaveCount(0);
  expect(await closes(page)).toEqual(['custom:escape', 'custom:api']);
});

test('shadow-DOM opener: Escape and a keyboard-run item return focus inside the shadow root', async ({ page }) => {
  await opener(page, 'ltr').focus();
  await page.keyboard.press('Enter');
  await expect(item(page, 'ltr', 'p')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menus(page, 'ltr')).toHaveCount(0);
  expect(await deepFocus(page)).toBe('ltr:open');

  await page.keyboard.press('Enter'); // focus is on the opener again → reopens
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'ltr', 'r')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menus(page, 'ltr')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).ran)).toEqual(['r']);
  expect(await deepFocus(page)).toBe('ltr:open');
  expect(await closes(page)).toEqual(['ltr:escape', 'ltr:action']);
});
