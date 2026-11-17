import { test, expect, type Page } from './fixtures';

// The system clipboard is never touched (headless Chromium on Windows shares it): the fixture captures
// navigator.clipboard.writeText and execCommand('copy'), and a paste is a constructed ClipboardEvent.
const PAGE = '/test/clipboard.html';
const TEXT = 'row 1\tvalue\nrow 2\tvalue';
const written = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __written: string[] }).__written);

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
});

test('copyText through the Clipboard API', async ({ page }) => {
  await page.click('#copy');
  await expect(page.locator('#result')).toHaveText('true');
  expect(await written(page)).toEqual([`api:${TEXT}`]);
});

test('copyText falls back to a selected textarea + execCommand; focus comes back to the button', async ({ page }) => {
  await page.check('#break-api');
  await page.click('#copy');
  await expect(page.locator('#result')).toHaveText('true');
  expect(await written(page)).toEqual([`exec:${TEXT}`]); // the whole text was selected in the focused textarea
  await expect(page.locator('#copy')).toBeFocused();
  await expect(page.locator('textarea')).toHaveCount(0);
});

test('readPasteText from a paste event: text/plain, CRLF as LF', async ({ page }) => {
  await page.locator('#target').evaluate((input) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'a\r\nb');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#pasted')).toHaveText('"a\\nb"');
});
