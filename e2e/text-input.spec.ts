import { test, expect, type Page } from './fixtures';

const PAGE = '/test/text-input.html';
const log = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __log: string[] }).__log);

test('plain typing: one callback per keystroke', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('#search').pressSequentially('ab');
  await page.keyboard.press('Enter');
  expect(await log(page)).toEqual(['text:a', 'text:ab', 'enter:submit']);
});

test('an IME composition: no callback for the intermediate states, one for the committed text', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'CDP IME');
  await page.goto(PAGE);
  await page.locator('#search').focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'k', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: '漢字', selectionStart: 2, selectionEnd: 2 });
  expect(await log(page)).toEqual([]);
  await cdp.send('Input.insertText', { text: '漢字' }); // commit
  await expect.poll(() => log(page)).toEqual(['text:漢字']);
  await expect(page.locator('#search')).toHaveValue('漢字');
});
