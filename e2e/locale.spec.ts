import { test, expect } from './fixtures';

const PAGE = '/test/locale.html';

test.use({ locale: 'en-US' });

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('#a .month')).toHaveText('January');
});

test('the browser locale, Intl-derived settings, labels as text vs HTML', async ({ page }) => {
  await expect(page.locator('#a .settings')).toHaveText('en-US|MM/DD/YYYY|12h|0');
  await expect(page.locator('#a .number')).toHaveText('1,234.5');
  await expect(page.locator('#a .cancel')).toHaveText('Cancel a<b>.txt'); // text: never escaped, never markup
  await expect(page.locator('#a .title b')).toHaveText('Files'); // the template is HTML
  await expect(page.locator('#a .title')).toHaveText('Files for <script>x'); // the value is data
  // the instance locale + labels win
  await expect(page.locator('#b .settings')).toHaveText('de-DE|DD.MM.YYYY|24h|1');
  await expect(page.locator('#b .month')).toHaveText('Januar');
  await expect(page.locator('#b .number')).toHaveText('1.234,5');
  await expect(page.locator('#b .cancel')).toHaveAccessibleName('Abbrechen a<b>.txt');
});

test('assigning window.components.locale re-renders every live component, keeping instance overrides', async ({ page }) => {
  await page.evaluate(() => {
    (window.components as Record<string, unknown>).locale = {
      locale: 'cs-CZ',
      thousandsSeparator: ' ',
      labels: { 'fx-locale': { cancel: 'Zrušit {name}', title: 'Soubory: {user}' } },
    };
  });
  await expect(page.locator('#a .month')).toHaveText('leden');
  await expect(page.locator('#a .cancel')).toHaveText('Zrušit a<b>.txt');
  await expect(page.locator('#a .number')).toHaveText('1 234,5');
  await expect(page.locator('#b .month')).toHaveText('Januar'); // its own locale
  await expect(page.locator('#b .number')).toHaveText('1 234,5'); // the page-wide separator applies to every element
  await expect(page.locator('#b .cancel')).toHaveText('Abbrechen a<b>.txt'); // its own labels
  expect(await page.evaluate(() => Object.keys(window.components!).includes('locale'))).toBe(false);
});

test('shouldEscapeLabels: an HTML label becomes text', async ({ page }) => {
  await page.evaluate(() => {
    (window.components as Record<string, unknown>).security = { shouldEscapeLabels: true };
  });
  await expect(page.locator('#a .title')).toHaveText('<b>Files</b> for <script>x');
  await expect(page.locator('#a .title b')).toHaveCount(0);
});

test('parseNumber with the resolved separators', async ({ page }) => {
  const parse = (text: string, locale: string): Promise<number | null> =>
    page.evaluate(([t, l]) => (window as unknown as { __parseNumber(t: string, s: object): number | null }).__parseNumber(t, { locale: l }), [text, locale]);
  expect(await parse('1 234,5', 'cs-CZ')).toBe(1234.5);
  expect(await parse('1.234,5', 'de-DE')).toBe(1234.5);
  expect(await parse('1,234.5', 'en-US')).toBe(1234.5);
  expect(await parse('abc', 'en-US')).toBeNull();
});
