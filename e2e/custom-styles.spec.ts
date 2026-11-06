import { expect, test, type Page } from '@playwright/test';

const PAGE = '/test/custom-styles.html';
const RED = 'rgb(255, 0, 0)'; // the component's own @layer component CSS
const GREEN = 'rgb(0, 128, 0)'; // test/custom-styles-days.css
const BLUE = 'rgb(0, 0, 255)';

type Fx = HTMLElement & { dayColor: string; customStyles: string | null; getCustomStylesCallback: unknown; whenSettled(): Promise<void> };

async function open(page: Page): Promise<void> {
  await page.goto(PAGE);
  await page.waitForFunction(() => !!customElements.get('fx-cs'));
}
const colors = (page: Page): Promise<string[]> =>
  page.$$eval('fx-cs', (els) => els.map((el) => (el as unknown as Fx).dayColor));

test.describe('custom CSS (SPEC §12.8)', () => {
  test('page customStyles with @import styles every instance; un-layered custom CSS beats @layer component', async ({ page }) => {
    await open(page);
    expect(await colors(page)).toEqual([RED, RED]);
    await page.evaluate(() => {
      window.components!['fx-cs']!.customStyles = "@import url('/test/custom-styles-days.css');";
    });
    await expect.poll(() => colors(page)).toEqual([GREEN, GREEN]);
    // An instance created later picks it up too.
    await page.evaluate(() => {
      const c = document.createElement('fx-cs');
      c.id = 'c';
      document.getElementById('stage')!.append(c);
    });
    await expect.poll(() => colors(page)).toEqual([GREEN, GREEN, GREEN]);
  });

  test('the instance layer comes after the page layer, so an instance overrides it', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      window.components!['fx-cs']!.customStyles = '.day { color: rgb(0, 128, 0) }';
      (document.getElementById('b') as unknown as Fx).customStyles = '.day { color: rgb(0, 0, 255) }';
    });
    await expect.poll(() => colors(page)).toEqual([GREEN, BLUE]);
    const order = await page.$eval('#b', (el) => [...el.shadowRoot!.querySelectorAll('style')].map((s) => s.className));
    expect(order).toEqual(['fx-cs-custom--page', 'fx-cs-custom']);
  });

  test('page getCustomStylesCallback gets each instance its own context and beats page customStyles', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const entry = window.components!['fx-cs']!;
      entry.customStyles = '.day { color: rgb(0, 128, 0) }';
      entry.getCustomStylesCallback = (ctx: { label: string }) =>
        ctx.label === 'A' ? '.day { color: rgb(0, 0, 255) }' : null;
    });
    // A: callback → blue; B: callback returns null → the page layer is empty (callback wins), own CSS → red.
    await expect.poll(() => colors(page)).toEqual([BLUE, RED]);
    await page.evaluate(() => {
      window.components!['fx-cs']!.getCustomStylesCallback = undefined;
    });
    await expect.poll(() => colors(page)).toEqual([GREEN, GREEN]);
  });
});
