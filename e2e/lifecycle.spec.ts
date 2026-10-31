import { test, expect } from './fixtures';
import type { Page } from './fixtures';

// The BlissElement lifecycle (SPEC §6.3 / §6.5): first build reinit → connect →
// ready (onReady twin, ready event, whenReady(), [ready], :state(ready)) on the
// microtask; reinit vs update afterwards; defer / release() / removing `defer`,
// latched; DOM moves re-activate without rebuilding, detached config applies
// before connect; removedCallback only after a real removal; destroy() is final
// and idempotent; a throwing reinit() is rethrown, owed and retried, with no
// connect()/ready before a successful build.
//
// Every <fx-lifecycle> hook lands in the page-wide `window.lc` log; `act()` resets
// it, so `hooks()` lists what one action caused.
//
// Fixture: test/lifecycle.html (element in test/lifecycle-fixtures.ts)

const PAGE = '/test/lifecycle.html';
const FIRST_BUILD = ['reinit', 'connect', 'onReady twin', 'ready event', 'whenReady()'];

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => document.body.dataset.ready !== undefined);
});

/**
 * Reset the hook log, then run `body` — an async function body with `$` (a card by id,
 * attached or not; else getElementById),
 * `makeCard`, `lc` and the `#stage` container in scope. Returns what it returns.
 */
async function act<R = unknown>(page: Page, body: string): Promise<R> {
  return page.evaluate(async (body) => {
    const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
    const w = window as any;
    w.lc.reset();
    const $ = (id: string) => w.cards.get(id) ?? document.getElementById(id);
    return new AsyncFn('$', 'makeCard', 'lc', 'stage', body)($, w.makeCard, w.lc, $('stage'));
  }, body) as Promise<R>;
}

const hooks = (page: Page) => page.evaluate(() => (window as any).lc.hooks() as string[]);

const state = (page: Page, id: string) =>
  page.evaluate((id) => {
    const el = document.getElementById(id) as any;
    return { isReady: el.isReady, isDestroyed: el.isDestroyed, builds: el.builds, connects: el.connects };
  }, id);

test('reinit → connect → ready (event, twin, whenReady) on the microtask; reinit vs update', async ({ page }) => {
  const ready = await act<{ sync: boolean; microtask: boolean }>(
    page,
    `const el = makeCard('c1');
     stage.append(el);
     const sync = el.isReady;
     const microtask = await Promise.resolve().then(() => el.isReady);
     return { sync, microtask };`,
  );
  expect(ready).toEqual({ sync: false, microtask: true });
  await expect.poll(() => hooks(page)).toEqual(FIRST_BUILD);
  expect(await page.evaluate(() => (window as any).lc.entries.find((e: any) => e.hook === 'ready event').detail)).toBe(
    'detail.element === el: true',
  );

  const el = page.locator('#c1');
  await expect(el).toHaveAttribute('ready', '');
  expect(await el.evaluate((n) => n.matches(':state(ready)'))).toBe(true);

  await act(page, "const el = $('c1'); el.label = 'Rebuilt'; await el.whenSettled();");
  expect(await hooks(page)).toEqual(['reinit']);
  await act(page, "const el = $('c1'); el.accent = 'green'; await el.whenSettled();");
  expect(await hooks(page)).toEqual(['update']);
  await act(page, "const el = $('c1'); el.batch(() => { el.label = 'Both'; el.accent = 'amber'; });");
  expect(await hooks(page)).toEqual(['reinit']); // the rebuild absorbs the update
});

test('defer holds the first build; release() builds once with everything; latched', async ({ page }) => {
  await act(
    page,
    `const el = makeCard('c2');
     el.shouldDefer = true;
     stage.append(el);
     el.label = 'Configured';
     el.accent = 'green';
     // (whenSettled() would wait for release — the held flush is still pending.)
     await new Promise((r) => requestAnimationFrame(() => r()));`,
  );
  expect(await hooks(page)).toEqual([]); // nothing built while held
  expect((await state(page, 'c2')).isReady).toBe(false);

  await act(page, "$('c2').release();");
  await expect.poll(() => hooks(page)).toEqual(FIRST_BUILD);
  expect(await page.evaluate(() => (window as any).lc.entries[0].detail)).toBe('label="Configured"');

  await act(page, "const el = $('c2'); el.shouldDefer = true; el.batch(() => { el.label = 'Again'; });");
  expect(await hooks(page)).toEqual(['reinit']); // defer no longer holds
});

test('removing the defer attribute releases too', async ({ page }) => {
  await act(page, "const el = makeCard('c3'); el.shouldDefer = true; stage.append(el); await new Promise((r) => requestAnimationFrame(() => r()));");
  expect(await hooks(page)).toEqual([]);
  await act(page, "$('c3').removeAttribute('defer');");
  await expect.poll(() => hooks(page)).toEqual(FIRST_BUILD);
});

test('moves re-activate without rebuilding; detached config applies before connect', async ({ page }) => {
  await act(page, "const el = makeCard('c4', { label: 'Move me' }); $('box-a').insertBefore(el, $('neighbour')); await el.whenReady();");
  const transient = () =>
    page.evaluate(() => {
      const root = document.getElementById('c4')!.shadowRoot!;
      return { text: (root.querySelector('.lc-text') as HTMLInputElement).value, clicks: root.querySelector('.lc-click')!.textContent };
    });
  await page.locator('#c4 .lc-text').fill('hello');
  await page.locator('#c4 .lc-click').click();

  await act(page, "$('box-b').append($('c4'));"); // re-parent
  await expect.poll(() => hooks(page)).toEqual(['disconnect', 'connect']);
  await expect(page.locator('#box-b #c4')).toHaveCount(1);
  await act(page, "$('box-a').insertBefore($('c4'), $('neighbour'));"); // back, before the neighbour
  await act(page, "$('box-a').insertBefore($('c4'), $('neighbour').nextSibling);"); // reorder past it
  await expect.poll(() => hooks(page)).toEqual(['disconnect', 'connect']);
  expect(await transient()).toEqual({ text: 'hello', clicks: 'clicks: 1' });
  expect(await state(page, 'c4')).toMatchObject({ builds: 1 });

  await act(page, "const el = $('c4'); el.remove(); el.label = 'Changed while detached'; await Promise.resolve();");
  // The write is held while detached — no reinit (removedCallback may fire at the next frame).
  expect(await hooks(page)).not.toContain('reinit');
  await act(page, "const el = $('c4'); $('box-a').append(el); await el.whenSettled();");
  expect(await hooks(page)).toEqual(['reinit', 'connect']);
  expect(await page.evaluate(() => (window as any).lc.entries[0].detail)).toBe('label="Changed while detached"');
  expect((await transient()).text).toBe(''); // a real rebuild resets it
});

test('removedCallback fires after a real removal, never on a synchronous move', async ({ page }) => {
  await act(page, "const el = makeCard('c5'); stage.append(el); await el.whenReady();");

  await act(page, "const el = $('c5'); stage.removeChild(el); stage.append(el);");
  await page.waitForTimeout(100); // several frames
  expect(await hooks(page)).toEqual(['disconnect', 'connect']);

  await act(page, "$('c5').remove();");
  await expect.poll(() => hooks(page)).toEqual(['disconnect', 'removedCallback']);

  await act(page, "stage.append($('c5'));");
  await expect.poll(() => hooks(page)).toEqual(['connect']); // fresh activation, no reinit
  await page.waitForTimeout(50);
  expect(await hooks(page)).toEqual(['connect']);
});

test('destroy() → disconnect → destroyCallback; idempotent; reconnect warns and stays inert', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await act(page, "const el = makeCard('c6', { label: 'Destroy me' }); stage.append(el); await el.whenReady();");

  await act(page, "$('c6').destroy();");
  expect(await hooks(page)).toEqual(['disconnect', 'destroyCallback']);
  expect((await state(page, 'c6')).isDestroyed).toBe(true);

  await act(page, "$('c6').destroy();");
  expect(await hooks(page)).toEqual([]); // idempotent

  const settled = await act<boolean>(page, "const el = $('c6'); el.label = 'Renamed'; await el.whenSettled(); return true;");
  expect(settled).toBe(true); // whenSettled() still resolves
  expect(await hooks(page)).toEqual([]);

  await act(page, "const el = $('c6'); el.remove(); stage.append(el);");
  await page.waitForTimeout(100);
  expect(await hooks(page)).toEqual([]);
  await expect.poll(() => warnings.some((w) => w.includes('was destroyed'))).toBe(true);
});

test('a throwing reinit() is rethrown, owed, and retried; no connect() before a successful build', async ({ page, pageErrors }) => {
  await act(page, "const el = makeCard('c7', { label: 'Fragile' }); stage.append(el); await el.whenReady();");

  const caught = await act<string | null>(
    page,
    `const el = $('c7');
     el.shouldThrowNextReinit = true;
     try { el.batch(() => { el.label = 'Renamed'; }); return null; } catch (err) { return err.message; }`,
  );
  expect(caught).toBe('fixture: reinit() failed'); // rethrown to whoever flushed
  expect(await hooks(page)).toEqual(['reinit() threw']);
  expect(await page.evaluate(() => (document.getElementById('c7') as any).shouldThrowNextReinit)).toBe(false);

  await act(page, "const el = $('c7'); el.batch(() => { el.accent = 'green'; });"); // update-level change, but the owed rebuild wins
  expect(await hooks(page)).toEqual(['reinit']);

  // A failed FIRST build: no connect(), no ready, until a flush succeeds.
  await act(page, "stage.replaceChildren(); const el = makeCard('c8', { label: 'Fresh, armed' }); el.shouldThrowNextReinit = true; stage.append(el);");
  await expect.poll(() => hooks(page)).toContain('reinit() threw');
  await page.waitForTimeout(50);
  const afterFresh = await hooks(page);
  expect(afterFresh).not.toContain('connect');
  expect(afterFresh).not.toContain('ready event');
  expect(await state(page, 'c8')).toMatchObject({ isReady: false, connects: 0 });

  await act(page, "$('c8').flush();");
  await expect.poll(() => hooks(page)).toEqual(FIRST_BUILD);

  // The connectedCallback throw is reported as an uncaught error — expected here.
  await expect.poll(() => pageErrors.some((e) => e.includes('fixture: reinit() failed'))).toBe(true);
  const rest = pageErrors.filter((e) => !e.includes('fixture: reinit() failed'));
  pageErrors.length = 0;
  pageErrors.push(...rest);
});
