import { test, expect } from './fixtures';

const PAGE = '/test/layer.html';

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
});

test('a layer covers past the clipping parent and above a z-indexed neighbour, styled + themed', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __openCover(): void }).__openCover());
  const cover = page.locator('.km-layer').locator('.cover');
  await expect(cover).toHaveText('drop files here');
  const box = (await cover.boundingBox())!;
  const host = (await page.locator('#host').boundingBox())!;
  expect(Math.round(box.x)).toBe(Math.round(host.x));
  expect(Math.round(box.height)).toBe(120); // the clip's overflow: hidden doesn't cut it
  // the neighbour (z-index 50) overlaps the bottom of the clip: the layer is above it
  const top = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.className, [box.x + 10, box.y + box.height - 5]);
  expect(top).toBe('km-layer');
  // the component CSS reached the shadow root; the page token reached it; the host's theme attribute came along
  expect(await cover.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 120, 212)');
  expect(await cover.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  // the component's LAYERED :host rule beats core's reset (km-layer-base is the lowest layer)
  expect(await page.locator('.km-layer').evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
  // the host's text look came along (the layer is outside the host, under core's all: initial reset)
  expect(await cover.evaluate((el) => getComputedStyle(el).fontFamily)).toBe('monospace');
  // cssVars: an instance token set on the host reached the layer
  expect(await cover.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe('rgb(255, 0, 0)');
});

test('place() compensates a transformed container (containing block for fixed elements)', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __openInTransformed(): void }).__openInTransformed());
  const box = (await page.locator('#transformed .km-layer').boundingBox())!;
  expect(Math.round(box.x)).toBe(100);
  expect(Math.round(box.y)).toBe(300);
});

test('drawer preset: on the end edge, full height, modal; Escape slides it out and focus returns', async ({ page }) => {
  await page.click('#open-drawer');
  const drawer = page.locator('#drawer');
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(400); // the slide-in
  const vp = page.viewportSize()!;
  const box = (await drawer.boundingBox())!;
  expect(Math.round(box.x + box.width)).toBe(vp.width);
  expect(Math.round(box.height)).toBe(vp.height);
  expect(await drawer.evaluate((el) => getComputedStyle(el).zIndex)).toBe('7000');
  await expect(page.locator('#drawer-first')).toBeFocused();
  expect(await page.locator('#open-drawer').evaluate((el) => !!el.closest('[inert]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('#open-drawer')).toBeFocused();
});

test('full-screen frame (.km-sheet): covers the viewport at the modal tier, header + scrolling body, modal; Escape closes', async ({ page }) => {
  await page.click('#open-sheet');
  const sheet = page.locator('#sheet');
  await expect(sheet).toBeVisible();
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const viewport = page.viewportSize()!;
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.y).toBe(0);
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.round(box.height)).toBe(viewport.height);
  expect(await sheet.evaluate((el) => getComputedStyle(el).zIndex)).toBe('7000');
  // the header stays; the body is the scroller and fills the rest
  const header = (await sheet.locator('.km-sheet-header').boundingBox())!;
  const body = page.locator('#sheet-body');
  const bodyBox = (await body.boundingBox())!;
  expect(Math.round(bodyBox.y)).toBe(Math.round(header.y + header.height));
  expect(Math.round(bodyBox.y + bodyBox.height)).toBe(viewport.height);
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await body.evaluate((el) => (el.scrollTop = 200));
  expect(Math.round((await sheet.locator('.km-sheet-header').boundingBox())!.y)).toBe(Math.round(header.y));
  expect(await page.locator('#open-sheet').evaluate((el) => !!el.closest('[inert]'))).toBe(true);
  // pinned top / start only (no bottom): the keyboard inset's inline height wins, the body shrinks with it
  await sheet.evaluate((el) => (el.style.height = '300px'));
  expect(Math.round((await sheet.boundingBox())!.height)).toBe(300);
  expect(Math.round((await body.boundingBox())!.y + (await body.boundingBox())!.height)).toBe(300);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('#open-sheet')).toBeFocused();
});

test('non-modal drawer (startPanelSession): the page stays usable; a click outside and Escape close it', async ({ page }) => {
  await page.click('#open-panel-drawer');
  const drawer = page.locator('#panel-drawer');
  await expect(drawer).toBeVisible();
  expect(await drawer.getAttribute('role')).toBe('dialog');
  expect(await drawer.getAttribute('aria-modal')).toBeNull();
  expect(await page.locator('#page-field').evaluate((el) => !!el.closest('[inert]'))).toBe(false);
  await expect(page.locator('.km-modal-backdrop')).toHaveCount(0);
  await page.locator('#page-field').click(); // the page works: the click lands, and it is outside → closes
  await expect(page.locator('#page-field')).toBeFocused();
  await expect(drawer).toHaveCount(0);
  await page.click('#open-panel-drawer');
  await expect(page.locator('#panel-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel-drawer')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __panelReasons: string[] }).__panelReasons)).toEqual(['outside-click', 'escape']);
});

test('drawer preset: --start in RTL sits on the right edge', async ({ page }) => {
  await page.click('#open-drawer-rtl');
  await page.waitForTimeout(400); // the slide-in (from the right in RTL)
  const box = (await page.locator('#drawer').boundingBox())!;
  expect(Math.round(box.x + box.width)).toBe(page.viewportSize()!.width);
  await page.mouse.click(5, 5); // the backdrop
  await expect(page.locator('#drawer')).toHaveCount(0);
});
