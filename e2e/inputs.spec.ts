import { test, expect } from './fixtures';
import type { Page } from './fixtures';

// The reactive input table (SPEC §4 / §6): attribute and property writes share one
// pipeline, reflection (incl. toList / toBool('presence')), removing an attribute
// resets to the default, a toFunction callback input, and the invalid-value rule
// (warn + keep the previous value; a reflected input writes it back).
// Reactivity (update / reinit / none, batching, presets, live getters) lives in
// e2e/reactivity.spec.ts.
//
// Fixture: test/inputs.html (elements in test/inputs-fixtures.ts)

const PAGE = '/test/inputs.html';

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => document.body.dataset.ready !== undefined);
});

type State = { prop: unknown; attr: string | null };

/** Run a write on #id, wait for it to settle, read back the property + attribute. */
async function write(page: Page, id: string, key: string, attr: string | null, op: string): Promise<State> {
  return page.evaluate(
    async ({ id, key, attr, op }) => {
      const el = document.getElementById(id) as HTMLElement & Record<string, any>;
      new Function('el', op)(el);
      await el.whenSettled();
      return { prop: el[key], attr: attr ? el.getAttribute(attr) : null };
    },
    { id, key, attr, op },
  );
}

const shadowText = (page: Page, id: string, sel: string) =>
  page.evaluate(({ id, sel }) => document.getElementById(id)!.shadowRoot!.querySelector(sel)!.textContent, { id, sel });

test.describe('one input table', () => {
  test('attribute and property writes go through the same pipeline; reflection; removal resets to default', async ({ page }) => {
    // Defaults before any write.
    expect(await write(page, 'el', 'count', 'count', '')).toEqual({ prop: 3, attr: null });

    // Attribute path.
    expect(await write(page, 'el', 'count', 'count', "el.setAttribute('count', '7')")).toEqual({ prop: 7, attr: '7' });
    expect(await shadowText(page, 'el', '.count')).toBe('7');

    // Property path — reflected back to the attribute.
    expect(await write(page, 'el', 'count', 'count', 'el.count = 9')).toEqual({ prop: 9, attr: '9' });
    expect(await shadowText(page, 'el', '.count')).toBe('9');

    // Removing the attribute resets to the default.
    expect(await write(page, 'el', 'count', 'count', "el.removeAttribute('count')")).toEqual({ prop: 3, attr: null });
    expect(await shadowText(page, 'el', '.count')).toBe('3');

    // A non-reflected input: property write leaves the attribute alone.
    expect(await write(page, 'el', 'limit', 'limit', 'el.limit = 20')).toEqual({ prop: 20, attr: null });

    // toList via property → reflected as a joined list.
    expect(await write(page, 'el', 'tags', 'tags', "el.tags = ['urgent', 'q4']")).toEqual({ prop: ['urgent', 'q4'], attr: 'urgent,q4' });

    // toBool('presence') reflects as presence.
    expect(await write(page, 'el', 'isCompact', 'compact', 'el.isCompact = true')).toEqual({ prop: true, attr: '' });
    await expect(page.locator('#el .chip')).toHaveClass(/compact/);
    expect(await write(page, 'el', 'isCompact', 'compact', 'el.isCompact = false')).toEqual({ prop: false, attr: null });
  });

  test('toFunction callback input: set re-renders through it, null clears', async ({ page }) => {
    expect(await write(page, 'el', 'formatLabelCallback', null, '')).toEqual({ prop: null, attr: null });
    await write(page, 'el', 'formatLabelCallback', null, 'el.formatLabelCallback = (l, c) => `${l} (${c} new)`');
    expect(await shadowText(page, 'el', '.label')).toBe('Inbox (3 new)');
    expect(await write(page, 'el', 'formatLabelCallback', null, 'el.formatLabelCallback = null')).toEqual({ prop: null, attr: null });
    expect(await shadowText(page, 'el', '.label')).toBe('Inbox');
  });
});

test.describe('invalid values', () => {
  type Result = { warnings: string[]; before: unknown; after: unknown; attr: string | null };

  /** Run `op` on #el2 capturing core's warnings; report the value before/after and the attribute. */
  const run = (page: Page, key: string, attr: string, op: string) =>
    page.evaluate(
      async ({ key, attr, op }): Promise<Result> => {
        const el = document.getElementById('el2') as HTMLElement & Record<string, any>;
        const before = el[key];
        const warnings = (window as any).captureWarnings(() => new Function('el', op)(el));
        await el.whenSettled();
        return { warnings, before, after: el[key], attr: el.getAttribute(attr) };
      },
      { key, attr, op },
    );

  test('a bad attribute on a reflected input warns, keeps the value, and writes it back', async ({ page }) => {
    const r = await run(page, 'count', 'count', "el.setAttribute('count', 'abc')");
    expect(r.warnings.join('\n')).toContain('rejected invalid value for attribute count="abc"');
    expect(r).toMatchObject({ before: 5, after: 5, attr: '5' });
  });

  test('a bad attribute on a non-reflected input keeps the value but leaves the markup', async ({ page }) => {
    const r = await run(page, 'limit', 'limit', "el.setAttribute('limit', 'abc')");
    expect(r.warnings.join('\n')).toContain('limit="abc"');
    expect(r).toMatchObject({ before: 50, after: 50, attr: 'abc' });
  });

  test('property path: rejected values warn and keep the previous value', async ({ page }) => {
    const out = await run(page, 'count', 'count', 'el.count = 99');
    expect(out.warnings.join('\n')).toContain('rejected invalid value for property "count"');
    expect(out).toMatchObject({ before: 5, after: 5, attr: '5' });

    const tone = await run(page, 'tone', 'tone', "el.tone = 'purple'");
    expect(tone.warnings).not.toEqual([]);
    expect(tone).toMatchObject({ before: 'info', after: 'info' });

    const ok = await run(page, 'count', 'count', "el.setAttribute('count', '8')");
    expect(ok.warnings).toEqual([]);
    expect(ok).toMatchObject({ before: 5, after: 8, attr: '8' });
  });
});

test.describe('input-rejected (SPEC §6)', () => {
  test('a refused write fires the event before it returns; setAttributes() returns the list', async ({ page }) => {
    const out = await page.evaluate(() => {
      const el = document.getElementById('el2') as HTMLElement & { count: number; setAttributes(v: object): unknown[] };
      const seen: unknown[] = [];
      el.addEventListener('input-rejected', (e) => seen.push({ ...(e as CustomEvent).detail }));
      el.setAttribute('limit', 'abc');
      const afterAttr = seen.length;
      el.count = 99;
      const afterProp = seen.length;
      const returned = el.setAttributes({ count: 2, colour: 'red' });
      return { seen, afterAttr, afterProp, returned: returned.map((r) => ({ ...(r as object) })), count: el.count };
    });
    expect(out.afterAttr).toBe(1);
    expect(out.afterProp).toBe(2);
    expect(out.seen[0]).toEqual({ configKey: 'limit', attribute: 'limit', value: 'abc', reason: 'expected an integer', kept: 50, source: 'attribute' });
    expect(out.seen[1]).toEqual({ configKey: 'count', value: 99, kept: 5, source: 'property' });
    expect(out.returned).toEqual([{ configKey: 'colour', value: 'red', reason: 'not an input of <fx-inputs>', kept: undefined, source: 'property' }]);
    expect(out.count).toBe(2);
  });
});
