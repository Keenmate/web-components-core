import { test, expect } from './fixtures';
import type { Page } from './fixtures';

// Reactivity of the input table (SPEC §5 / §6 / §12.7): `on: 'update'` inputs send
// a partial, `on: 'reinit'` inputs rebuild, `on: 'none'` stay silent, a mixed batch
// reinits only; loose writes coalesce on a microtask, setAttributes()/batch() flush
// synchronously; whenSettled()/flush() read-after-write; configure-detached builds
// once; getBatchValuesCallback presets (explicit writes win) and getLiveValue
// getters (live state vs the assigned config, staged reads).
//
// Fixture: test/reactivity.html (elements in test/reactivity-fixtures.ts)

const PAGE = '/test/reactivity.html';

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => document.body.dataset.ready !== undefined);
});

type HookCall = { hook: 'reinit' | 'update'; partial?: Record<string, unknown> };

/**
 * Run `body` (an async function body with `el` = #id and `calls` = the hook calls
 * recorded so far) and return everything it recorded plus whatever it returned.
 */
async function run<R = unknown>(page: Page, id: string, body: string): Promise<{ calls: HookCall[]; out: R }> {
  return page.evaluate(
    async ({ id, body }) => {
      const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
      const el = document.getElementById(id)!;
      let out: unknown;
      const calls = await (window as any).recordHooks(el, async (calls: unknown[]) => {
        out = await new AsyncFn('el', 'calls', body)(el, calls);
      });
      return { calls, out: out as any };
    },
    { id, body },
  );
}

const counts = (page: Page, id: string) =>
  page.evaluate((id) => {
    const el = document.getElementById(id) as any;
    return { reinit: el.reinitCount, update: el.updateCount };
  }, id);

test.describe('update vs reinit vs none', () => {
  test('update inputs send a partial, reinit inputs rebuild, none inputs stay silent, mixed batch → reinit only', async ({ page }) => {
    const shadow = (sel: string) =>
      page.evaluate((sel) => document.getElementById('hooks')!.shadowRoot!.querySelector(sel)!.textContent, sel);
    expect(await counts(page, 'hooks')).toEqual({ reinit: 1, update: 0 }); // first connect = full build

    let r = await run(page, 'hooks', "el.caption = 'Quarterly'; await el.whenSettled();");
    expect(r.calls).toEqual([{ hook: 'update', partial: { caption: 'Quarterly' } }]);
    expect(await shadow('.caption')).toBe('Quarterly');

    r = await run(page, 'hooks', "el.caption = 'Batch 1'; el.accent = 'red'; await el.whenSettled();");
    expect(r.calls).toEqual([{ hook: 'update', partial: { caption: 'Batch 1', accent: 'red' } }]);
    expect(await counts(page, 'hooks')).toEqual({ reinit: 1, update: 2 });

    r = await run(page, 'hooks', "el.layout = 'grid'; await el.whenSettled();");
    expect(r.calls).toEqual([{ hook: 'reinit' }]);
    expect(await shadow('.stamp')).toBe('build #2');

    r = await run(page, 'hooks', "el.note = 'stored only'; await el.whenSettled(); return el.note;");
    expect(r.calls).toEqual([]);
    expect(r.out).toBe('stored only');
    expect(await counts(page, 'hooks')).toEqual({ reinit: 2, update: 2 });

    r = await run(page, 'hooks', "el.setAttributes({ caption: 'Mixed 2', layout: 'list' });");
    expect(r.calls).toEqual([{ hook: 'reinit' }]); // no partial for the mixed batch
    expect(await counts(page, 'hooks')).toEqual({ reinit: 3, update: 2 });
    expect(await shadow('.caption')).toBe('Mixed 2');
  });
});

test.describe('batching', () => {
  test('loose writes coalesce into one flush; across ticks one each', async ({ page }) => {
    const loose = await run<number>(
      page,
      'batching',
      "el.caption = 'Loose 1a'; el.accent = 'green'; el.caption = 'Loose 1b'; const sync = calls.length; await el.whenSettled(); return sync;",
    );
    expect(loose.out).toBe(0); // nothing ran synchronously
    expect(loose.calls).toEqual([{ hook: 'update', partial: { caption: 'Loose 1b', accent: 'green' } }]);

    const ticks = await run(
      page,
      'batching',
      "for (const n of [1, 2, 3]) { el.caption = 'Tick ' + n; await el.whenSettled(); }",
    );
    expect(ticks.calls).toHaveLength(3);
    expect(ticks.calls.every((c) => c.hook === 'update')).toBe(true);
  });

  test('setAttributes() and batch() flush synchronously as one call', async ({ page }) => {
    const set = await run<number>(page, 'batching', "el.setAttributes({ caption: 'Set 1', 'page-size': 6 }); return calls.length;");
    expect(set.out).toBe(1);
    expect(set.calls).toEqual([{ hook: 'reinit' }]);

    const batch = await run<number>(page, 'batching', "el.batch(() => { el.caption = 'Batch 2'; el.accent = 'red'; }); return calls.length;");
    expect(batch.out).toBe(1);
    expect(batch.calls).toEqual([{ hook: 'update', partial: { caption: 'Batch 2', accent: 'red' } }]);
  });

  test('whenSettled() and flush() give read-after-write', async ({ page }) => {
    const settled = await run<{ before: string; after: string }>(
      page,
      'batching',
      "el.layout = 'grid'; const before = el.readRenderedWithoutFlush().layout; await el.whenSettled(); return { before, after: el.readRenderedWithoutFlush().layout };",
    );
    expect(settled.out).toEqual({ before: 'list', after: 'grid' });

    const flushed = await run<{ stale: number; fresh: number }>(
      page,
      'batching',
      'el.pageSize = 5; const stale = el.readRenderedWithoutFlush().pageSize; el.pageSize = 6; const fresh = el.readRendered().pageSize; return { stale, fresh };',
    );
    expect(flushed.out).toEqual({ stale: 4, fresh: 6 }); // pre-write state vs flushed first
  });

  test('configure detached then append builds once', async ({ page }) => {
    const builds = await page.evaluate(async () => {
      const sandbox = document.getElementById('sandbox')!;
      const inDom = document.createElement('fx-reactivity') as any;
      sandbox.append(inDom); // builds with defaults
      inDom.layout = 'grid';
      inDom.pageSize = 8; // + one batch
      await inDom.whenSettled();
      const detached = document.createElement('fx-reactivity') as any;
      detached.layout = 'grid';
      detached.pageSize = 8; // held while detached
      sandbox.append(detached);
      const out = { inDom: inDom.reinitCount, detached: detached.reinitCount, rendered: detached.readRenderedWithoutFlush() };
      sandbox.replaceChildren();
      return out;
    });
    expect(builds.inDom).toBe(2);
    expect(builds.detached).toBe(1);
    expect(builds.rendered).toMatchObject({ layout: 'grid', pageSize: 8 }); // the one build saw the full config
  });
});

test.describe('presets & live getters', () => {
  const state = (page: Page) =>
    page.evaluate(() => {
      const el = document.getElementById('presets') as any;
      return {
        mode: el.mode,
        editTrigger: el.editTrigger,
        hasGridLines: el.hasGridLines,
        attrs: { mode: el.getAttribute('mode'), editTrigger: el.getAttribute('edit-trigger'), gridLines: el.getAttribute('grid-lines') },
      };
    });

  test('getBatchValuesCallback sets other inputs in the same batch; explicit writes win', async ({ page }) => {
    let r = await run(page, 'presets', "el.mode = 'excel'; await el.whenSettled();");
    expect(r.calls).toEqual([{ hook: 'update', partial: { mode: 'excel', editTrigger: 'dblclick', hasGridLines: true } }]);
    expect(await state(page)).toEqual({
      mode: 'excel',
      editTrigger: 'dblclick',
      hasGridLines: true,
      attrs: { mode: 'excel', editTrigger: 'dblclick', gridLines: '' }, // reflected
    });

    await run(page, 'presets', "el.mode = 'simple'; await el.whenSettled();");
    expect(await state(page)).toMatchObject({ editTrigger: 'click', hasGridLines: false });

    r = await run(page, 'presets', "el.setAttributes({ mode: 'excel', editTrigger: 'none' });");
    expect(r.calls).toEqual([{ hook: 'update', partial: { mode: 'excel', editTrigger: 'none', hasGridLines: true } }]);
    expect(await state(page)).toMatchObject({ editTrigger: 'none', attrs: { editTrigger: 'none' } });
  });

  test('getLiveValue: the getter reads live rows; config keeps the assigned array; staged read returns the assignment', async ({ page }) => {
    const read = () =>
      page.evaluate(() => {
        const el = document.getElementById('presets') as any;
        return { live: el.items, assigned: el.assignedItems };
      });

    const assign = await run(page, 'presets', "el.items = ['Alpha', 'Beta']; await el.whenSettled();");
    expect(assign.calls).toEqual([{ hook: 'reinit' }]);
    expect(await read()).toEqual({ live: ['Alpha', 'Beta'], assigned: ['Alpha', 'Beta'] });

    await page.locator('#presets .add-row').click(); // component-owned mutation
    expect(await read()).toEqual({ live: ['Alpha', 'Beta', 'Row 3'], assigned: ['Alpha', 'Beta'] });
    await expect(page.locator('#presets li', { hasText: 'Row 3' })).toBeVisible();

    const staged = await run<unknown>(page, 'presets', "el.items = ['Fresh']; const staged = el.items; await el.whenSettled(); return staged;");
    expect(staged.out).toEqual(['Fresh']); // read while staged → what was just assigned
    expect(await read()).toEqual({ live: ['Fresh'], assigned: ['Fresh'] });
  });
});
