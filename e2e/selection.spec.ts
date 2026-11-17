import { test, expect, type Page } from './fixtures';

const PAGE = '/test/selection.html';

const selected = (page: Page): Promise<string[]> =>
  page.locator('#list li[aria-selected="true"]').evaluateAll((els) => els.map((el) => el.textContent ?? ''));

test('click / Shift+click / Ctrl+click / Ctrl+Shift+click from real mouse events', async ({ page }) => {
  await page.goto(PAGE);
  const item = (name: string) => page.locator('#list li', { hasText: name });
  await item('Banana').click();
  expect(await selected(page)).toEqual(['Banana']);
  await item('Elder').click({ modifiers: ['Shift'] });
  expect(await selected(page)).toEqual(['Banana', 'Cherry', 'Elder']); // Date is not selectable
  await item('Apple').click({ modifiers: ['ControlOrMeta'] });
  expect(await selected(page)).toEqual(['Apple', 'Banana', 'Cherry', 'Elder']);
  await item('Fig').click({ modifiers: ['ControlOrMeta', 'Shift'] }); // anchor = Apple: adds Apple…Fig
  expect(await selected(page)).toEqual(['Apple', 'Banana', 'Cherry', 'Elder', 'Fig']);
  await item('Cherry').click();
  expect(await selected(page)).toEqual(['Cherry']);
  const changes = await page.locator('#changes').textContent();
  await item('Date').click({ force: true }); // unselectable (aria-disabled): no change
  await expect(page.locator('#changes')).toHaveText(changes!);
});
