import { test, expect, type Page } from './fixtures';

const PAGE = '/test/modal.html';

/** The deep focused element's id (through shadow roots). */
const focusedId = (page: Page): Promise<string> =>
  page.evaluate(() => {
    let a: Element | null = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a?.id || a?.getAttribute('data-value') || a?.className || '';
  });
const log = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __log: string[] }).__log);

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
});

test.describe('startModalSession (a component panel in a shadow root)', () => {
  test('focus goes in, Tab cycles inside, the page behind is inert, Escape closes and focus returns', async ({ page }) => {
    await page.click('#open-own');
    expect(await focusedId(page)).toBe('first');

    // Tab cycles: first → open-dropdown → last → first; Shift+Tab back to last
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await focusedId(page)).toBe('last');
    await page.keyboard.press('Tab');
    expect(await focusedId(page)).toBe('first');
    await page.keyboard.press('Shift+Tab');
    expect(await focusedId(page)).toBe('last');

    // the page behind: inert (the browser ignores the click), the field in the same shadow root too
    expect(await page.locator('#page-button').evaluate((el) => el.hasAttribute('inert'))).toBe(true);
    expect(await page.locator('#host').evaluate((h) => h.shadowRoot!.getElementById('field')!.hasAttribute('inert'))).toBe(true);
    await page.mouse.click(5, 5); // the backdrop covers the page
    expect(await log(page)).toEqual(['dismiss:backdrop']);
    expect(await focusedId(page)).toBe('open-own');
    expect(await page.locator('#page-button').evaluate((el) => el.hasAttribute('inert'))).toBe(false);

    await page.click('#open-own');
    await page.keyboard.press('Escape');
    expect((await log(page)).at(-1)).toBe('dismiss:escape');
    expect(await focusedId(page)).toBe('open-own');
  });

  test('a dropdown portaled to <body> from inside works and closes first on Escape', async ({ page }) => {
    await page.click('#open-own');
    await page.locator('#host').evaluate((h) => (h.shadowRoot!.getElementById('open-dropdown') as HTMLElement).click());
    const item = page.locator('#dropdown-item');
    await expect(item).toBeVisible();
    expect(await item.evaluate((el) => !!el.closest('[inert]'))).toBe(false);
    // it is clickable (above the backdrop: dropdown tier > modal tier)
    await item.click();
    expect(await focusedId(page)).toBe('dropdown-item');

    await page.keyboard.press('Escape');
    expect(await log(page)).toEqual(['dropdown:escape']);
    await expect(item).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(await log(page)).toEqual(['dropdown:escape', 'dismiss:escape']);
  });

  test('page scroll is locked while open', async ({ page }) => {
    await page.click('#open-own');
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe('/dialog', () => {
  test('promptDialog: validates, Enter submits, focus returns to the opener', async ({ page }) => {
    await page.click('#open-prompt');
    const input = page.locator('.km-dialog-layer .km-dialog__input');
    await expect(input).toBeFocused();
    await page.keyboard.type('ftp://x'); // the initial value is selected: typing replaces it
    await page.keyboard.press('Enter');
    await expect(page.locator('.km-dialog__error')).toHaveText('Must start with https://');
    await input.fill('https://picsum.photos/300');
    await page.keyboard.press('Enter');
    await expect(page.locator('#result')).toHaveText('https://picsum.photos/300');
    await expect(page.locator('.km-dialog-layer')).toHaveCount(0);
    expect(await focusedId(page)).toBe('open-prompt');
  });

  test('confirmDialog (danger): focus starts on Cancel; Escape resolves false; Delete resolves true', async ({ page }) => {
    await page.click('#open-confirm');
    expect(await focusedId(page)).toBe('cancel');
    await page.keyboard.press('Escape');
    await expect(page.locator('#result')).toHaveText('false');

    await page.click('#open-confirm');
    await page.locator('.km-dialog__action.is-danger').click();
    await expect(page.locator('#result')).toHaveText('true');
  });

  test('desktop: a centered card, as tall as its content, above the backdrop', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('#open-confirm');
    const box = (await page.locator('.km-dialog').boundingBox())!;
    const vp = page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - vp.height / 2)).toBeLessThan(2);
    expect(box.height).toBeLessThan(300);
    const z = await page.locator('.km-dialog').evaluate((el) => getComputedStyle(el).zIndex);
    expect(z).toBe('7000');
  });
});

test.describe('/dialog on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a bottom sheet: full width, at the bottom, as tall as its content', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // measure the resting place, not the slide-in
    await page.tap('#open-confirm');
    const { box, vw, vh } = await page.locator('.km-dialog').evaluate((el) => ({
      box: el.getBoundingClientRect().toJSON() as DOMRect,
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
    }));
    expect(Math.round(box.width)).toBe(vw);
    expect(Math.round(box.bottom)).toBe(vh);
    expect(box.height).toBeLessThan(vh / 2);
    await page.tap('.km-dialog__action.is-danger');
    await expect(page.locator('#result')).toHaveText('true');
  });
});

test.describe('ghost click (a sheet opened on the press, real taps)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('without the guard the opening tap picks the option under the finger', async ({ page }) => {
    await page.locator('#guard').setChecked(false);
    await page.tap('#press-open');
    await expect.poll(() => log(page)).toEqual(['press-open', 'press-option']);
  });

  test('isOpenedByPointer swallows that click; the next tap works', async ({ page }) => {
    await page.tap('#press-open');
    await page.waitForTimeout(100);
    expect(await log(page)).toEqual(['press-open']);
    await expect(page.locator('#press-panel')).toBeVisible();
    await page.tap('#press-option');
    await expect.poll(() => log(page)).toEqual(['press-open', 'press-option']);
    await page.tap('#press-close');
    await expect(page.locator('#press-panel')).toBeHidden();
  });
});
