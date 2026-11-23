import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// /menu openMenu() (SPEC §12.13) on a minimal file list:
//   - context menu: role="menu", named divider, disabled (callback) + toggle (menuitemcheckbox)
//     items, danger class; a leaf closes the menu, then runs runAction (closeCallback "action"
//     → beforeActionCallback → built-in → twin → event);
//   - a toggle keeps the menu open and re-renders; Escape closes; beforeActionCallback vetoes;
//   - submenus: static children (nested 2 levels) + lazy getChildrenCallback (loading row);
//     outside-click dismisses;
//   - keyboard: Shift+F10 opens focused, Home/End/arrows (skip disabled, wrap), → / ← submenus,
//     item shortcut, Tab closes, focus returns to the (re-rendered) row;
//   - dropdown from a button: keyboard activation focuses the first item; hidden items omitted;
//   - theming: page-wide --km-menu-* and the per-instance private --_km-menu-* layer.
//
// Fixture: test/menu.html (<fx-files> from test/interaction-fixtures.ts). The fixture fits the
// viewport so nothing scrolls: an open menu closes on any page scroll (reason "scroll").

const steps = (page: Page) => page.evaluate(() => (window as any).fx.steps() as string[]);
const reset = (page: Page) => page.evaluate(() => (window as any).fx.reset());
const details = (page: Page, step: string) =>
  page.evaluate((s) => (window as any).fx.log.filter((e: any) => e.step === s).map((e: any) => e.detail) as string[], step);

const files = (page: Page) => page.locator('#files');
const row = (page: Page, name: string) => files(page).locator(`li[data-name="${name}"]`);
const menus = (page: Page) => files(page).locator('.km-menu');
const item = (page: Page, text: string) => files(page).locator('.km-menu__item', { hasText: text });

test.beforeEach(async ({ page }) => {
  await page.goto('/test/menu.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('context menu: roles, named divider, disabled + toggle items, a leaf runs the action', async ({ page }) => {
  await row(page, 'contract.docx').click({ button: 'right' });
  const root = menus(page).first();
  await expect(root).toBeVisible();
  await expect(root).toHaveAttribute('role', 'menu');
  await expect(root.locator('.km-menu__divider--named')).toHaveText('Danger zone');
  await expect(item(page, 'Archive')).toHaveAttribute('aria-disabled', 'true'); // locked file
  await expect(item(page, 'Pinned')).toHaveAttribute('role', 'menuitemcheckbox');
  await expect(item(page, 'Pinned')).toHaveAttribute('aria-checked', 'false');
  await expect(item(page, 'Delete')).toHaveClass(/km-menu__item--danger/);

  await item(page, 'Rename').click();
  await expect(menus(page)).toHaveCount(0);
  await expect.poll(() => steps(page)).toEqual([
    'openMenu()',
    'closeCallback',
    'beforeActionCallback',
    'built-in',
    'onAction twin',
    'action event',
  ]);
  expect(await details(page, 'closeCallback')).toEqual(['action']);
  await expect(row(page, 'renamed-contract.docx')).toHaveCount(1);
});

test('toggle keeps the menu open and re-renders; veto via beforeActionCallback', async ({ page }) => {
  await row(page, 'report.pdf').click({ button: 'right' });
  await item(page, 'Pinned').click();
  await expect(item(page, 'Pinned')).toHaveAttribute('aria-checked', 'true');
  await expect(menus(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menus(page)).toHaveCount(0);
  expect(await details(page, 'closeCallback')).toEqual(['escape']);

  await page.evaluate(() => ((window as any).shouldVetoDelete = true));
  await reset(page);
  await row(page, 'report.pdf').click({ button: 'right' });
  await item(page, 'Delete').click();
  await expect.poll(() => steps(page)).toEqual(['openMenu()', 'closeCallback', 'beforeActionCallback']);
  await expect(row(page, 'report.pdf')).toHaveCount(1);
});

test('submenus (static + lazy) and outside-click dismiss', async ({ page }) => {
  await row(page, 'report.pdf').click({ button: 'right' });
  await item(page, 'Share').hover();
  await expect(item(page, 'Copy link')).toBeVisible();
  await item(page, 'More').hover();
  await expect(item(page, 'QR code')).toBeVisible();
  await expect(menus(page)).toHaveCount(3);

  await item(page, 'Move to').hover();
  await expect(files(page).locator('.km-menu__loading')).toBeVisible();
  await expect(item(page, 'Archive 2025')).toBeVisible();
  await item(page, 'Archive 2025').click();
  await expect.poll(() => details(page, 'action event')).toHaveLength(1);
  expect(JSON.parse((await details(page, 'action event'))[0])).toMatchObject({ id: 'move:Archive 2025', source: 'context-menu' });

  await reset(page);
  await row(page, 'report.pdf').click({ button: 'right' });
  await expect(menus(page)).toHaveCount(1);
  await page.mouse.click(600, 10); // outside, in view
  await expect(menus(page)).toHaveCount(0);
  expect(await details(page, 'closeCallback')).toEqual(['outside-click']);
});

test('keyboard: Shift+F10 opens with focus, arrows skip disabled, → / ← submenus, shortcut, Tab closes', async ({ page }) => {
  await row(page, 'contract.docx').focus();
  await page.keyboard.press('Shift+F10');
  await expect(item(page, 'Open')).toBeFocused();
  await page.keyboard.press('End');
  await expect(item(page, 'Delete')).toBeFocused();
  await page.keyboard.press('ArrowUp'); // Archive is disabled (locked) → skipped
  await expect(item(page, 'Move to')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(item(page, 'Share')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(item(page, 'Copy link')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(item(page, 'Share')).toBeFocused();
  await expect(menus(page)).toHaveCount(1);
  await page.keyboard.press('Home');
  await expect(item(page, 'Open')).toBeFocused();
  await page.keyboard.press('ArrowUp'); // wraps
  await expect(item(page, 'Delete')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menus(page)).toHaveCount(0);
  expect(await details(page, 'closeCallback')).toEqual(['tab']);

  await row(page, 'budget.xlsx').focus();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('F2'); // the Rename shortcut
  await expect(menus(page)).toHaveCount(0);
  await expect(row(page, 'renamed-budget.xlsx')).toBeFocused(); // focus returned to the row, kept across the re-render
});

test('dropdown from a button: keyboard activation focuses the first item; hidden item omitted', async ({ page }) => {
  const btn = files(page).locator('.do-actions');
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(item(page, 'New file')).toBeFocused();
  await expect(item(page, 'Never shown')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(menus(page)).toHaveCount(0);
  await expect(btn).toBeFocused();
  await expect(row(page, 'new-4.txt')).toHaveCount(1);
  expect(JSON.parse((await details(page, 'action event'))[0])).toMatchObject({ action: 'new-file', source: 'toolbar' });
});

test('theming: page-wide --km-menu-* and the per-instance private layer', async ({ page }) => {
  const bg = () => menus(page).first().evaluate((m) => getComputedStyle(m).backgroundColor);
  const open = async () => {
    await row(page, 'report.pdf').click({ button: 'right' });
    await expect(menus(page)).toHaveCount(1);
  };
  const close = async () => {
    await page.keyboard.press('Escape');
    await expect(menus(page)).toHaveCount(0);
  };
  await open();
  const base = await bg();
  await close();

  await page.evaluate(() => document.documentElement.classList.add('fx-menu-theme'));
  await open();
  expect(await bg()).toBe('rgb(255, 251, 235)'); // #fffbeb
  await expect(menus(page).first()).toHaveCSS('border-radius', '12px');
  await close();

  await page.evaluate(() => document.getElementById('files')!.classList.add('fx-instance-theme'));
  await open();
  expect(await bg()).toBe('rgb(236, 254, 255)'); // #ecfeff — instance beats the page layer
  await close();

  await page.evaluate(() => {
    document.getElementById('files')!.classList.remove('fx-instance-theme');
    document.documentElement.classList.remove('fx-menu-theme');
  });
  await open();
  expect(await bg()).toBe(base);
});
