import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// /menu openMenu() phone presentation (SPEC §12.13): presentation 'auto' → core's phone switch
// (resolvePresentation) → a bottom sheet on a phone (touch, short side < 600), the floating menu
// on a desktop. Sheet: full width at the bottom, header (title + close), 44px rows, submenus drill
// in (Back row), backdrop / Escape / close button / phone Back close, page scroll locked, focus
// returns to the opener.
//
// Fixture: test/menu-sheet.html (<fx-files> from test/interaction-fixtures.ts).

const steps = (page: Page) => page.evaluate(() => (window as any).fx.steps() as string[]);
const details = (page: Page, step: string) =>
  page.evaluate((s) => (window as any).fx.log.filter((e: any) => e.step === s).map((e: any) => e.detail) as string[], step);

const files = (page: Page) => page.locator('#files');
const row = (page: Page, name: string) => files(page).locator(`li[data-name="${name}"]`);
const sheet = (page: Page) => files(page).locator('.km-menu-sheet');
const backdrop = (page: Page) => files(page).locator('.km-menu-sheet-backdrop');
const title = (page: Page) => files(page).locator('.km-menu-sheet__title');
const shownLevel = (page: Page) => files(page).locator('.km-menu:not([hidden])');
const item = (page: Page, text: string) => shownLevel(page).locator('.km-menu__item', { hasText: text });
const actionsButton = (page: Page) => files(page).locator('.do-actions');
const focusedText = (page: Page) =>
  page.evaluate(() => (document.getElementById('files')!.shadowRoot!.activeElement as HTMLElement | null)?.textContent ?? null);
const bodyPosition = (page: Page) => page.evaluate(() => getComputedStyle(document.body).position);
/** The open / close slide (motion tokens) has played out — geometry is final. */
const animated = (page: Page) => sheet(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => {}));
const sheetEntry = (page: Page) => page.evaluate(() => (history.state as { kmBackEntry?: boolean } | null)?.kmBackEntry ?? null);

test.beforeEach(async ({ page }) => {
  await page.goto('/test/menu-sheet.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test.describe('phone (touch, 390 x 844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  test('the dropdown opens as a bottom sheet: full width, header, touch-size rows, page locked; an item runs', async ({ page }) => {
    await actionsButton(page).tap();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toHaveAttribute('role', 'dialog');
    await expect(backdrop(page)).toBeVisible();
    await expect(title(page)).toHaveText('Actions');
    await animated(page);
    const box = (await sheet(page).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
    expect(Math.round(box.y + box.height)).toBe(844);
    const heights = await shownLevel(page)
      .locator('.km-menu__item')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    const closeButton = files(page).locator('.km-menu-sheet__close');
    const close = (await closeButton.boundingBox())!;
    expect(close.height).toBeGreaterThanOrEqual(44);
    // The shared sheet chrome (SHEET_CHROME_CSS): a round chip with the masked ✕, no text glyph.
    await expect(closeButton).toHaveClass(/\bkm-sheet-close\b/);
    await expect(closeButton).toHaveText('');
    expect(await closeButton.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('50%');
    expect(await closeButton.evaluate((el) => getComputedStyle(el, '::before').maskImage)).toContain('url(');
    // No keyboard-shortcut hints on the touch presentation.
    await expect(item(page, 'New file').locator('.km-menu__shortcut')).toBeHidden();
    expect(await bodyPosition(page)).toBe('fixed');
    expect(await sheetEntry(page)).toBe(true);

    await item(page, 'Help').tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect(backdrop(page)).toHaveCount(0);
    expect(await details(page, 'onClose')).toEqual(['action']);
    await expect.poll(() => details(page, 'action event')).toEqual(['help']);
    expect(await bodyPosition(page)).not.toBe('fixed');
    await expect.poll(() => sheetEntry(page)).toBeNull(); // the history entry is given back
  });

  test('a context menu drills into submenus (a Back row goes up); a nested leaf runs', async ({ page }) => {
    await row(page, 'report.pdf').click({ button: 'right' });
    await expect(sheet(page)).toBeVisible();
    await expect(title(page)).toHaveText('report.pdf');
    await expect(files(page).locator('.km-menu')).toHaveCount(1);

    await item(page, 'Share').tap();
    await expect(title(page)).toHaveText('Share');
    await expect(files(page).locator('.km-menu')).toHaveCount(2);
    await expect(shownLevel(page)).toHaveCount(1); // the root is hidden, not cascaded
    await expect(shownLevel(page).locator('.km-menu__item').first()).toHaveClass(/km-menu__item--back/);

    await item(page, 'Back').tap();
    await expect(title(page)).toHaveText('report.pdf');
    await expect(files(page).locator('.km-menu')).toHaveCount(1);
    await expect.poll(() => focusedText(page)).toBe('Share');

    await item(page, 'Share').tap();
    await item(page, 'More').tap();
    await expect(title(page)).toHaveText('More');
    await item(page, 'QR code').tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => details(page, 'action event')).toEqual(['qr']);
  });

  test('a backdrop tap closes ("outside-click") without clicking through; focus returns to the opener', async ({ page }) => {
    await actionsButton(page).tap();
    await expect(sheet(page)).toBeVisible();
    await animated(page);
    // Tap above the sheet, right over the Actions button: the backdrop takes it.
    const btn = (await actionsButton(page).boundingBox())!;
    expect(btn.y + btn.height).toBeLessThan((await sheet(page).boundingBox())!.y);
    await page.touchscreen.tap(btn.x + btn.width / 2, btn.y + btn.height / 2);
    await expect(sheet(page)).toHaveCount(0);
    expect(await details(page, 'onClose')).toEqual(['outside-click']);
    expect((await steps(page)).filter((s) => s === 'openMenu()')).toHaveLength(1); // no click-through re-open
    await expect.poll(() => focusedText(page)).toBe('Actions');
  });

  test('the close button and Escape close it; focus returns', async ({ page }) => {
    await actionsButton(page).tap();
    await files(page).locator('.km-menu-sheet__close').tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => focusedText(page)).toBe('Actions');

    await actionsButton(page).tap();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    expect(await details(page, 'onClose')).toEqual(['close-button', 'escape']);
    await expect.poll(() => focusedText(page)).toBe('Actions');
  });

  test('the phone Back button goes up one submenu level, then closes ("back")', async ({ page }) => {
    await row(page, 'report.pdf').click({ button: 'right' });
    await item(page, 'Share').tap();
    await expect(title(page)).toHaveText('Share');
    await page.evaluate(() => history.back());
    await expect(title(page)).toHaveText('report.pdf');
    await expect(sheet(page)).toBeVisible();
    await page.evaluate(() => history.back());
    await expect(sheet(page)).toHaveCount(0);
    expect(await details(page, 'onClose')).toEqual(['back']);
    expect(page.url()).toContain('/test/menu-sheet.html'); // never left the page
  });

  test('closing keeps the page scrolled where it was: close button, Back, Back after a submenu Back', async ({ page }) => {
    // A tall page with the fixture well below the top.
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '1500px';
      document.body.prepend(spacer);
      document.body.style.minHeight = '4000px';
    });
    await files(page).evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
    const before = await scrollY();
    expect(before).toBeGreaterThan(1000);
    const settled = async () => {
      await expect(sheet(page)).toHaveCount(0);
      await page.waitForTimeout(300); // the deferred history.back() and its traversal
      expect(await scrollY()).toBe(before);
    };

    await actionsButton(page).tap();
    await expect(sheet(page)).toBeVisible();
    await files(page).locator('.km-menu-sheet__close').tap();
    await settled();

    await actionsButton(page).tap();
    await expect(sheet(page)).toBeVisible();
    await page.evaluate(() => history.back());
    await settled();

    await row(page, 'report.pdf').click({ button: 'right' });
    await item(page, 'Share').tap();
    await expect(title(page)).toHaveText('Share');
    await page.evaluate(() => history.back()); // up one level: the entry is re-armed
    await expect(title(page)).toHaveText('report.pdf');
    await files(page).locator('.km-menu-sheet__close').tap();
    await settled();
    expect(await page.evaluate(() => history.scrollRestoration)).toBe('auto'); // the page's own mode is back
  });

  test("presentation 'floating' opts out on a phone", async ({ page }) => {
    await files(page).evaluate((el) => (el.dataset.presentation = 'floating'));
    await actionsButton(page).tap();
    await expect(files(page).locator('.km-menu')).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    await expect(backdrop(page)).toHaveCount(0);
  });
});

test.describe('desktop', () => {
  test('unchanged: a floating menu at the point, cascading submenus, no sheet / backdrop / lock / history', async ({ page }) => {
    await row(page, 'report.pdf').click({ button: 'right' });
    const root = files(page).locator('.km-menu').first();
    await expect(root).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    await expect(backdrop(page)).toHaveCount(0);
    expect((await root.boundingBox())!.width).toBeLessThan(400);
    await root.locator('.km-menu__item', { hasText: 'Share' }).hover();
    await expect(files(page).locator('.km-menu')).toHaveCount(2);
    await expect(files(page).locator('.km-menu:not([hidden])')).toHaveCount(2); // both levels shown
    expect(await bodyPosition(page)).not.toBe('fixed');
    expect(await sheetEntry(page)).toBeNull();
    await page.keyboard.press('Escape'); // closes the submenu
    await page.keyboard.press('Escape');
    await expect(files(page).locator('.km-menu')).toHaveCount(0);
  });

  test("presentation 'drawer': a full-height panel on the start edge (end with side 'end'), sliding in / out", async ({ page }) => {
    await files(page).evaluate((el) => (el.dataset.presentation = 'drawer'));
    await actionsButton(page).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toHaveClass(/km-menu-sheet--drawer/);
    // the slide-in runs on the motion tokens (no reduced motion here)
    expect(await sheet(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('km-menu-in-left');
    await animated(page);
    const viewport = page.viewportSize()!;
    let box = (await sheet(page).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.height).toBe(viewport.height);
    expect(box.width).toBe(320);
    await files(page).locator('.km-sheet-close').click();
    // closing plays out (inert meanwhile), then the sheet leaves the DOM
    await expect(sheet(page)).toHaveClass(/km-menu-sheet--closing/);
    await expect(sheet(page)).toHaveCount(0);
    expect(await details(page, 'onClose')).toEqual(['close-button']);

    await files(page).evaluate((el) => (el.dataset.side = 'end'));
    await actionsButton(page).click();
    await animated(page);
    box = (await sheet(page).boundingBox())!;
    expect(Math.round(box.x + box.width)).toBe(viewport.width);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
  });

  test('reduced motion: the sheet opens and closes without animating', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await files(page).evaluate((el) => (el.dataset.presentation = 'sheet'));
    await actionsButton(page).click();
    await expect(sheet(page)).toBeVisible();
    expect(await sheet(page).evaluate((el) => getComputedStyle(el).animationDuration)).toBe('0s');
    await page.keyboard.press('Escape');
    expect(await sheet(page).count()).toBe(0); // removed at once, no close animation
  });

  test("presentation 'sheet' forces the sheet on a desktop", async ({ page }) => {
    await files(page).evaluate((el) => (el.dataset.presentation = 'sheet'));
    await actionsButton(page).click();
    await expect(sheet(page)).toBeVisible();
    await expect(title(page)).toHaveText('Actions');
    await item(page, 'Help').click();
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => details(page, 'action event')).toEqual(['help']);
  });
});
