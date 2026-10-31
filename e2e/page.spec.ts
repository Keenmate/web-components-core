import { test, expect } from './fixtures';

// examples-page.html — page-wide controls: window.components (SPEC §12.3), logging
// (§12.1), the shared loader (§12.14), style injection (§12.8). The specs assert the
// readouts / captured console lines the page shows, so the page can't drift from core.

const PAGE = '/examples-page.html';

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => customElements.get('core-demo-pg') !== undefined);
});

test('PG01: registry entries, non-enumerable globals, adopted early entry, instance tracking, register()', async ({ page }) => {
  const r = page.locator('#pg01-readout');
  await expect(r).toContainText('Object.keys(window.components) ["core-demo-pg-early","core-demo-pg"]');
  await expect(r).toContainText("'logging' in true · 'renderLoaderCallback' in true");
  await expect(r).toContainText('getRegisteredTags() ["core-demo-pg"]');
  await expect(r).toContainText('version() 0.0.0-demo · config.name core-demo-pg · logging controls');
  await expect(r).toContainText('getInstances() [#demo-pg-a, #demo-pg-b, #demo-pg-load-a, #demo-pg-load-b]');
  await expect(r).toContainText('early entry adopted true · .note "set by the page before core loaded" · logging none');
  await expect(r).toContainText("customElements.get('core-demo-pg-early') undefined");

  await page.locator('#pg01-add').click();
  await expect(r).toContainText('#demo-pg-load-b, #demo-pg-x1]');
  await page.locator('#pg01-move').click(); // A moves: re-tracked once, now last
  await expect(r).toContainText('getInstances() [#demo-pg-b, #demo-pg-load-a, #demo-pg-load-b, #demo-pg-x1, #demo-pg-a]');
  await page.locator('#pg01-remove').click();
  await expect(r).toContainText('getInstances() [#demo-pg-b, #demo-pg-load-a, #demo-pg-load-b, #demo-pg-a]');

  await page.locator('#pg01-register').click();
  await expect(r).toContainText("customElements.get('core-demo-pg-early') defined · getInstances('core-demo-pg-early') [#demo-pg-early]");
  await expect(r).toContainText('getRegisteredTags() ["core-demo-pg","core-demo-pg-early"]');
  await expect(page.locator('#demo-pg-early')).toHaveJSProperty('isReady', true);
});

test('PG02: default warn; core messages routed; page switch, per tag, per instance', async ({ page }) => {
  const log = page.locator('#pg02-log');
  const r = page.locator('#pg02-readout');
  const linesSinceLastAction = () =>
    log.evaluate((el) => {
      const items = Array.from(el.children) as HTMLElement[];
      let start = 0;
      items.forEach((d, i) => { if (d.classList.contains('act')) start = i + 1; });
      return items.slice(start).map((d) => d.textContent ?? '');
    });

  await expect(r).toContainText('PGDEMO INIT warn · DATA warn · UI warn');
  await page.locator('#pg02-sample-a').click();
  await expect.poll(linesSinceLastAction).toEqual([
    'warn  [PGDEMO:UI] #demo-pg-a warn line (UI)',
    'error [PGDEMO:UI] #demo-pg-a error line (UI)',
  ]);

  await page.locator('#pg02-core-a').click();
  await expect.poll(async () => (await linesSinceLastAction()).join('\n')).toMatch(/^warn {2}\[PGDEMO:INIT\] #demo-pg-a .*tone/);
  await expect(page.locator('#demo-pg-a')).toHaveAttribute('tone', 'info'); // reflected → written back

  await page.locator('#pg02-core-early').click();
  await expect(log).toContainText('not defined yet');
  await page.locator('#pg01-register').click();
  await page.locator('#pg02-core-early').click();
  await expect.poll(async () => (await linesSinceLastAction()).join('\n')).toMatch(/\[CORE:ELEMENT\] core-demo-pg-early#demo-pg-early .*tone/);

  // Page-wide: debug everywhere, CORE included.
  await page.locator('#pg02-g-enable').click();
  await expect(r).toContainText('PGDEMO INIT debug · DATA debug · UI debug');
  await expect(r).toContainText('CORE   ELEMENT debug');
  await page.locator('#pg02-sample-b').click();
  await expect.poll(linesSinceLastAction).toHaveLength(4);

  // Silence everything, then make ONE instance loud.
  await page.locator('#pg02-g-disable').click();
  await expect(r).toContainText('PGDEMO INIT silent · DATA silent · UI silent');
  await page.locator('#pg02-core-a').click();
  await expect.poll(linesSinceLastAction).toEqual(['(no console output)']);
  await page.locator('#pg02-i-enable').click();
  await expect(r).toContainText('A.isLoggingEnabled true · B.isLoggingEnabled false');
  await page.locator('#pg02-sample-a').click();
  await expect.poll(linesSinceLastAction).toHaveLength(4);
  await page.locator('#pg02-sample-b').click();
  await expect.poll(linesSinceLastAction).toEqual(['(no console output)']);
  await page.locator('#pg02-i-disable').click();

  // Per tag wins for that tag; per category.
  await page.locator('#pg02-t-error').click();
  await expect(r).toContainText('PGDEMO INIT error · DATA error · UI error');
  await expect(r).toContainText('CORE   ELEMENT silent');
  await page.locator('#pg02-t-cat').click();
  await expect(r).toContainText('PGDEMO INIT error · DATA debug · UI error');
  await page.locator('#pg02-sample-b').click();
  await expect.poll(linesSinceLastAction).toEqual([
    'info  [PGDEMO:DATA] #demo-pg-b info line (DATA)',
    'error [PGDEMO:UI] #demo-pg-b error line (UI)',
  ]);

  // Reset restores the defaults.
  await page.locator('#pg-reset').click();
  await expect(r).toContainText('PGDEMO INIT warn · DATA warn · UI warn');
  await expect(r).toContainText('CORE   ELEMENT warn · ACTIONS warn · MENU warn · THEME warn');
});

test('PG03: loader precedence instance > page > default; throwing hook → default; remove() restores', async ({ page }) => {
  const r = page.locator('#pg03-readout');
  const log = page.locator('#pg03-log');
  await page.locator('#pg03-start').click();
  await expect(r).toContainText('#demo-pg-load-a  isLoading true · drawn by default <span class="pgd-loader"> · role "status" · aria-label "Loading…"');
  await expect(r).toContainText('#demo-pg-load-b  isLoading true · drawn by default');

  await page.locator('#pg03-page').check();
  await expect(r).toContainText('#demo-pg-load-a  isLoading true · drawn by page hook');
  await expect(r).toContainText('#demo-pg-load-b  isLoading true · drawn by page hook');
  await expect(log).toContainText("page hook ← { component: 'core-demo-pg', context: 'overlay', label: 'Loading…' }");

  await page.locator('input[name="pg03-inst"][value="bar"]').check();
  await expect(r).toContainText('#demo-pg-load-a  isLoading true · drawn by page hook');
  await expect(r).toContainText('#demo-pg-load-b  isLoading true · drawn by instance hook');

  await page.locator('input[name="pg03-inst"][value="throw"]').check();
  await expect(log).toContainText('B cleanup ran (timer cleared)');
  await expect(log).toContainText('error [PGDEMO:UI] #demo-pg-load-b renderLoadingCallback threw — drawing the default loader');
  await expect(r).toContainText('#demo-pg-load-b  isLoading true · drawn by default');

  await page.locator('#pg03-stop').click();
  await expect(r).toContainText('#demo-pg-load-a  isLoading false · drawn by — · role null · aria-label null · children 0');
  await expect(r).toContainText('#demo-pg-load-b  isLoading false · drawn by — · role null · aria-label null · children 0');

  await page.locator('#pg-reset').click();
  await expect(r).toContainText('typeof window.components.renderLoaderCallback undefined');
  await expect(page.locator('#pg03-page')).not.toBeChecked();
});

test('PG04: adoptStyles shares one sheet; createStyleSlot replaces in place', async ({ page }) => {
  const r = page.locator('#pg04-readout');
  await expect(r).toContainText('A.sheet[0] === B.sheet[0] true');
  await expect(r).toContainText('style.pgd-custom count 0');
  await page.locator('#pg04-red').click();
  await expect(r).toContainText('style.pgd-custom count 1 · css ".pg { border: 2px dashed #dc2626; }"');
  await page.locator('#pg04-green').click();
  await expect(r).toContainText('style.pgd-custom count 1 · css ".pg { border: 4px solid #16a34a; }"');
  await page.locator('#pg04-null').click();
  await expect(r).toContainText('style.pgd-custom count 0 · css null');
});
