import { test, expect, type Page } from './fixtures';

const PAGE = '/test/form-inputs.html';

type Args = [id: string, name: string | null, values: (string | number)[], format: string | null, opts?: Record<string, unknown>];
const setValue = (page: Page, ...args: Args): Promise<string | null> =>
  page.evaluate(([id, name, values, format, opts]) =>
    (document.getElementById(id as string) as unknown as { setValue(...a: unknown[]): string | null }).setValue(name, values, format, opts ?? {}),
  args);

/** Submit the real form (GET) and return the submitted pairs from the URL. */
async function submit(page: Page): Promise<[string, string][]> {
  await Promise.all([page.waitForURL(/\?_=1/), page.click('#submit')]);
  return [...new URL(page.url()).searchParams.entries()].filter(([k]) => k !== '_');
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready);
});

test('a string value submits as one `name` field (json default)', async ({ page }) => {
  await setValue(page, 'a', 'country', ['cz', 'sk'], null);
  expect(await submit(page)).toEqual([['country', '["cz","sk"]']]);
});

test('array format submits one `name[]` field per value; text joins with the separator', async ({ page }) => {
  await setValue(page, 'a', 'tags', ['a', 'b', 'c'], 'array');
  await setValue(page, 'b', 'ids', [1, 2], 'text', { separator: ';' });
  expect(await submit(page)).toEqual([['tags[]', 'a'], ['tags[]', 'b'], ['tags[]', 'c'], ['ids', '1;2']]);
});

test('a disabled control and a cleared name submit nothing; rewrites reuse the inputs', async ({ page }) => {
  await setValue(page, 'a', 'tags', ['a', 'b'], 'array');
  await setValue(page, 'a', 'tags', ['x'], 'array');
  expect(await page.locator('#a > input').count()).toBe(1);
  await setValue(page, 'a', 'tags', ['x'], 'array', { isDisabled: true });
  await setValue(page, 'b', null, ['y'], 'text');
  expect(await page.locator('#b > input').count()).toBe(0);
  expect(await submit(page)).toEqual([]);
});

test('two fields with the same name: no ids, both submit', async ({ page }) => {
  await setValue(page, 'a', 'country', ['cz'], 'text');
  await setValue(page, 'b', 'country', ['sk'], 'text');
  expect(await page.locator('fx-field input[id]').count()).toBe(0);
  expect(await submit(page)).toEqual([['country', 'cz'], ['country', 'sk']]);
});

test('a throwing format callback submits an empty value and reports the error', async ({ page }) => {
  const error = await page.evaluate(() =>
    (document.getElementById('a') as unknown as { setValue(...a: unknown[]): string | null }).setValue('x', ['a'], 'json', {
      callback: () => { throw new Error('bad format'); },
    }),
  );
  expect(error).toContain('bad format');
  expect(await submit(page)).toEqual([['x', '']]);
});
