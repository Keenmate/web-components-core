import { test, expect } from './fixtures';

const PAGE = '/test/icons.html';

test('a built-in name is masked from its token in currentColor; an unset token draws the contract glyph; text and markup', async ({ page }) => {
  await page.goto(PAGE);
  const named = page.locator('#named .km-icon');
  await expect(named).toHaveClass(/fx__icon--settings/);
  const style = await named.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { mask: cs.maskImage || cs.webkitMaskImage, bg: cs.backgroundColor, w: cs.width };
  });
  expect(style.mask).toMatch(/^url\(/);
  expect(style.mask).toContain('0 0 10 10'); // the page's --base-icon-settings wins
  expect(style.bg).toBe('rgb(200, 0, 0)'); // currentColor
  expect(style.w).toBe('32px'); // 1em
  const unset = await page.locator('#unset .km-icon').evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage);
  expect(unset).toMatch(/^url\(/); // no page token: ICON_CSS's copy of the contract bell
  expect(unset).toContain('0 0 24 24');
  await expect(page.locator('#emoji')).toHaveText('🚀');
  await expect(page.locator('#svg svg rect')).toHaveCount(1);
});

test('window.components.renderIconCallback maps an app name; other class names render as an icon font', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('#hook svg.app-star')).toHaveAttribute('data-component', 'fx-host');
  const font = page.locator('#font i');
  await expect(font).toHaveClass('fx__icon demo-font extra');
  await expect(font).toHaveAttribute('aria-hidden', 'true');
  expect(await font.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"F"');
});

test('/menu renders an icon name through renderIcon', async ({ page }) => {
  await page.goto(PAGE);
  await page.click('#menu-trigger');
  const item = page.locator('.km-menu [role="menuitem"]', { hasText: 'Settings' });
  await expect(item.locator('.km-menu__icon .km-icon')).toHaveCount(1);
  await expect(page.locator('.km-menu [role="menuitem"]', { hasText: 'Star' }).locator('.km-menu__icon svg.app-star')).toHaveCount(1);
  await expect(page.locator('.km-menu [role="menuitem"]', { hasText: 'Go' }).locator('.km-menu__icon')).toHaveText('🚀');
});

test('icon maps: component defaults, el.icons and window.components.icons override them and repaint (Q12)', async ({ page }) => {
  await page.goto(PAGE);
  const del = page.locator('#iconed [data-icon="rowDelete"]');
  const add = page.locator('#iconed [data-icon="rowAdd"]');
  await expect(del.locator('.km-icon')).toHaveClass(/fx__icon--delete/); // default = a built-in name
  await expect(add.locator('svg.default-add')).toHaveCount(1); // default = markup
  // Page-wide flat map, tag key before the bare name; assigned after render → iconsChanged() repaints.
  await page.evaluate(() => {
    (window.components as Record<string, unknown>).icons = { 'fx-iconed.rowAdd': 'fa-solid fa-plus', rowAdd: 'never', rowDelete: '<b class="page-del">x</b>' };
  });
  await expect(add.locator('i')).toHaveClass('fx__icon fa-solid fa-plus');
  await expect(del.locator('b.page-del')).toHaveCount(1);
  // The instance map comes before the page map (JSON attribute).
  await page.locator('#iconed').evaluate((el) => el.setAttribute('icons', '{"rowDelete":"close"}'));
  await expect(del.locator('.km-icon')).toHaveClass(/fx__icon--close/);
  await expect(add.locator('i')).toHaveClass('fx__icon fa-solid fa-plus');
  // Maps come before the built-ins: a built-in name (close) is drawn by the built-in until a map replaces it.
  const close = page.locator('#iconed [data-icon="close"]');
  await expect(close.locator('.km-icon')).toHaveClass(/fx__icon--close/);
  await page.evaluate(() => {
    (window.components as Record<string, unknown>).icons = { 'fx-iconed.close': 'fa-solid fa-xmark' };
  });
  await expect(close.locator('i')).toHaveClass('fx__icon fa-solid fa-xmark');
});
