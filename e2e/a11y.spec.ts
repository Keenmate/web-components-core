import { test, expect, type Page } from './fixtures';

const PAGE = '/test/a11y.html';

/** The deep focused element's text / id. */
const focused = (page: Page): Promise<string> =>
  page.evaluate(() => {
    let a: Element | null = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a?.id || a?.textContent || '';
  });

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
});

test('active descendant in a shadow root: focus stays in the input, the option is exposed and scrolled into the list', async ({ page }) => {
  const input = page.locator('#combo').locator('#in');
  await input.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // Banana is aria-disabled: skipped
  expect(await focused(page)).toBe('in');
  const activeText = await input.evaluate((el) => (el.getRootNode() as ShadowRoot).getElementById(el.getAttribute('aria-activedescendant')!)!.textContent);
  expect(activeText).toBe('Cherry');
  await expect(page.locator('#combo').getByRole('option', { name: 'Cherry' })).toHaveAttribute('aria-selected', 'true');

  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown'); // → Grape, below the fold
  const inView = await page.locator('#combo').locator('#lb').evaluate((lb) => {
    const item = lb.querySelector('.is-active')!;
    const a = item.getBoundingClientRect();
    const b = lb.getBoundingClientRect();
    return { text: item.textContent, isInside: a.top >= b.top - 1 && a.bottom <= b.bottom + 1, pageY: window.scrollY };
  });
  expect(inView).toEqual({ text: 'Grape', isInside: true, pageY: 0 });

  await page.keyboard.press('Enter');
  await expect(page.locator('#picked')).toHaveText('Grape');
});

test('roving toolbar: one tab stop, arrows move focus, type-to-find, Tab leaves', async ({ page }) => {
  await page.locator('#combo').locator('#in').focus();
  await page.keyboard.press('Tab');
  expect(await focused(page)).toBe('Bold');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await focused(page)).toBe('Underline');
  await page.keyboard.press('s');
  expect(await focused(page)).toBe('Strike');
  await page.keyboard.press('Tab'); // the toolbar is ONE stop
  expect(await focused(page)).toBe('1');
  await page.keyboard.press('Shift+Tab'); // back to the remembered item
  expect(await focused(page)).toBe('Strike');
});

test('roving grid: arrows by row and column, Home / End per row, Ctrl+End', async ({ page }) => {
  await page.locator('#grid button').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  expect(await focused(page)).toBe('5');
  await page.keyboard.press('End');
  expect(await focused(page)).toBe('6');
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toBe('6'); // 9 doesn't exist
  await page.keyboard.press('Control+End');
  expect(await focused(page)).toBe('8');
  await page.keyboard.press('Tab');
  expect(await focused(page)).toBe('after');
});
