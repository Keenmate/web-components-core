import { test, expect } from './fixtures';

const PAGE = '/test/icons.html';

test('a named icon is masked from its token in currentColor; an unset token draws nothing; text and markup', async ({ page }) => {
  await page.goto(PAGE);
  const named = page.locator('#named .km-icon');
  await expect(named).toHaveClass(/fx__icon--gear/);
  const style = await named.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { mask: cs.maskImage || cs.webkitMaskImage, bg: cs.backgroundColor, w: cs.width };
  });
  expect(style.mask).toMatch(/^url\(/);
  expect(style.bg).toBe('rgb(200, 0, 0)'); // currentColor
  expect(style.w).toBe('32px'); // 1em
  const unset = await page.locator('#unset .km-icon').evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage);
  expect(unset).toMatch(/^linear-gradient/); // transparent: nothing drawn
  await expect(page.locator('#emoji')).toHaveText('🚀');
  await expect(page.locator('#svg svg rect')).toHaveCount(1);
});

test('/menu renders an icon name through renderIcon', async ({ page }) => {
  await page.goto(PAGE);
  await page.click('#menu-trigger');
  const item = page.locator('.km-menu [role="menuitem"]', { hasText: 'Settings' });
  await expect(item.locator('.km-menu__icon .km-icon')).toHaveCount(1);
  await expect(page.locator('.km-menu [role="menuitem"]', { hasText: 'Go' }).locator('.km-menu__icon')).toHaveText('🚀');
});
