import { test, expect } from './fixtures';
import type { Page } from './fixtures';

// Review 2026-11-03 I-18 (e2e list): numeric and list ATTRIBUTE cases in a real browser —
// strict whole-string numbers, range, whitespace, and toList's CSV / JSON-array forms
// with reflection. (inputs.spec.ts covers only property writes for these.)
//
// Fixture: test/inputs.html (elements in test/inputs-fixtures.ts) —
// count: toInt 0..10, default 3, reflected; limit: toInt 1..100, default 50;
// tags: toList, default ['mail','work'], reflected.

const PAGE = '/test/inputs.html';

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => document.body.dataset.ready !== undefined);
});

type Result = { warnings: string[]; prop: unknown; attr: string | null };

/** On #id: set (or remove, with `null`) `attr`, settle, read back the property + attribute + warnings. */
const setAttr = (page: Page, id: string, key: string, attr: string, raw: string | null) =>
  page.evaluate(
    async ({ id, key, attr, raw }): Promise<Result> => {
      const el = document.getElementById(id) as HTMLElement & Record<string, any>;
      const warnings = (window as any).captureWarnings(() =>
        raw === null ? el.removeAttribute(attr) : el.setAttribute(attr, raw),
      );
      await el.whenSettled();
      return { warnings, prop: el[key], attr: el.getAttribute(attr) };
    },
    { id, key, attr, raw },
  );

test.describe('numeric attributes (toInt)', () => {
  test('a whole-string integer is accepted, whitespace trimmed; the reflected value is written back', async ({ page }) => {
    expect(await setAttr(page, 'el', 'count', 'count', '7')).toMatchObject({ warnings: [], prop: 7, attr: '7' });
    expect(await setAttr(page, 'el', 'count', 'count', ' 4 ')).toMatchObject({ warnings: [], prop: 4 });
    expect(await setAttr(page, 'el', 'count', 'count', '+2')).toMatchObject({ warnings: [], prop: 2 });
  });

  for (const raw of ['12px', '1.9', '1e3', '0x10', 'Infinity']) {
    test(`count="${raw}" is invalid: warns, keeps the previous value, writes it back`, async ({ page }) => {
      await setAttr(page, 'el', 'count', 'count', '6');
      const r = await setAttr(page, 'el', 'count', 'count', raw);
      expect(r.warnings.join('\n')).toContain(`count="${raw}"`);
      expect(r).toMatchObject({ prop: 6, attr: '6' });
    });
  }

  test('out of range is invalid; removal resets to the default', async ({ page }) => {
    await setAttr(page, 'el', 'count', 'count', '6');
    const low = await setAttr(page, 'el', 'count', 'count', '-5');
    expect(low.warnings.join('\n')).toContain('out of range');
    expect(low).toMatchObject({ prop: 6, attr: '6' });
    expect(await setAttr(page, 'el', 'count', 'count', '11')).toMatchObject({ prop: 6, attr: '6' });
    expect(await setAttr(page, 'el', 'count', 'count', null)).toMatchObject({ prop: 3, attr: null });
  });

  test('a non-reflected numeric input keeps the bad markup but not the value', async ({ page }) => {
    await setAttr(page, 'el', 'limit', 'limit', '20');
    const r = await setAttr(page, 'el', 'limit', 'limit', '30px');
    expect(r.warnings.join('\n')).toContain('limit="30px"');
    expect(r).toMatchObject({ prop: 20, attr: '30px' });
  });
});

test.describe('list attributes (toList)', () => {
  test('CSV items are trimmed; a blank attribute is the default', async ({ page }) => {
    expect(await setAttr(page, 'el', 'tags', 'tags', ' a , b ,c')).toMatchObject({ warnings: [], prop: ['a', 'b', 'c'] });
    expect(await setAttr(page, 'el', 'tags', 'tags', '   ')).toMatchObject({ prop: ['mail', 'work'] });
    expect(await setAttr(page, 'el', 'tags', 'tags', null)).toMatchObject({ prop: ['mail', 'work'], attr: null });
  });

  test('a JSON-array attribute carries items with the separator; reflection writes JSON back', async ({ page }) => {
    const r = await setAttr(page, 'el', 'tags', 'tags', '["a,b","c"]');
    expect(r).toMatchObject({ warnings: [], prop: ['a,b', 'c'], attr: '["a,b","c"]' });
    const viaProp = await page.evaluate(async () => {
      const el = document.getElementById('el') as HTMLElement & Record<string, any>;
      el.tags = ['x,y', 'z'];
      await el.whenSettled();
      const json = el.getAttribute('tags');
      el.tags = [];
      await el.whenSettled();
      return { json, empty: el.getAttribute('tags'), tags: el.tags };
    });
    expect(viaProp).toEqual({ json: '["x,y","z"]', empty: '[]', tags: [] });
  });

  test('a malformed JSON array warns and keeps the previous list', async ({ page }) => {
    await setAttr(page, 'el', 'tags', 'tags', 'a,b');
    const r = await setAttr(page, 'el', 'tags', 'tags', '["a",');
    expect(r.warnings).not.toEqual([]);
    expect(r).toMatchObject({ prop: ['a', 'b'], attr: 'a,b' });
  });
});
