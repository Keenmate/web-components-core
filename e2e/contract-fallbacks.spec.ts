import { test, expect, type Page } from './fixtures';

// 713cb52: core's /dialog + /menu fallbacks follow the @keenmate/base-css-variables contract. With NO
// base-variables.css on the page, the derived formulas (oklch(from …) / color-mix) must resolve to real
// colours (an invalid formula computes to transparent), the prompt field height is 3.5 × 10px, and the
// light-dark() surfaces / text follow the colour scheme.
//
// Fixture: test/dialog.html (no base-variables.css; `fixture.openMenu`, /dialog imported on demand)

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const SCHEMES = [
  { scheme: 'light', menuBg: 'rgb(255, 255, 255)', text: 'rgb(51, 65, 85)' },
  { scheme: 'dark', menuBg: 'rgb(30, 41, 59)', text: 'rgb(241, 245, 249)' },
] as const;

async function load(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('/test/dialog.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    document.documentElement.style.colorScheme = 'light dark';
  });
}

for (const { scheme, menuBg, text } of SCHEMES) {
  test.describe(`contract fallbacks, ${scheme}`, () => {
    test('promptDialog: formulas resolve, field 35px, text follows the scheme', async ({ page }) => {
      await load(page, scheme);
      await page.evaluate(async () => {
        const { promptDialog } = await import('/src/dialog/index.ts' as string);
        void promptDialog({ title: 'Name', message: 'Your name' });
      });
      await expect(page.locator('.km-dialog-layer .km-dialog__input')).toBeVisible();
      const s = await page.evaluate(() => {
        const root = document.querySelector('.km-dialog-layer')!.shadowRoot!;
        const panel = getComputedStyle(root.querySelector('.km-dialog')!);
        const input = getComputedStyle(root.querySelector('.km-dialog__input')!);
        return {
          bg: panel.backgroundColor,
          border: panel.borderTopColor,
          color: panel.color,
          inputBorder: input.borderTopColor,
          inputMinHeight: input.minHeight,
        };
      });
      expect(s.bg).not.toBe(TRANSPARENT);
      expect(s.border).not.toBe(TRANSPARENT);
      expect(s.inputBorder).not.toBe(TRANSPARENT);
      expect(s.inputMinHeight).toBe('35px');
      expect(s.color).toBe(text);
    });

    test('menu: border resolves, background + text follow the scheme', async ({ page }) => {
      await load(page, scheme);
      await page.evaluate(() => {
        (window as any).fixture.openMenu([{ id: 'one', text: 'One' }], {}, { host: document.body, at: { x: 40, y: 40 } });
      });
      await expect(page.locator('.km-menu').first()).toBeVisible();
      const s = await page.evaluate(() => {
        const menu = getComputedStyle(document.querySelector('.km-menu')!);
        return { bg: menu.backgroundColor, border: menu.borderTopColor, color: menu.color };
      });
      expect(s.border).not.toBe(TRANSPARENT);
      expect(s.bg).toBe(menuBg);
      expect(s.color).toBe(text);
    });
  });
}
