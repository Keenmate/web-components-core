import { test, expect } from './fixtures';
import type { Page } from './fixtures';

// examples-inputs.html (chapter IN) — the reactive input table, converters,
// update vs reinit, batching, presets and live getters, driven through the
// page's own controls against the real <core-demo-*> BlissElements.

const PAGE = '/examples-inputs.html';

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => !!customElements.get('core-demo-presets'));
  // The page script finished wiring once the IN05 readout rendered.
  await expect(page.locator('#in05-state tr')).toHaveCount(6);
});

const row = (page: Page, key: string) => page.locator(`#in01-rows tr[data-key="${key}"]`);

test.describe('IN01 · one input table', () => {
  test('attribute and property writes go through the same pipeline; reflection; removal resets to default', async ({ page }) => {
    const el = page.locator('#in01-el');
    const count = row(page, 'count');

    // Defaults before any write.
    await expect(count.locator('.prop')).toHaveText('3');
    await expect(count.locator('.attr')).toHaveText('null (absent)');

    // Attribute path.
    await count.locator('.in-value').fill('7');
    await count.locator('button[data-act="attr"]').click();
    await expect(count.locator('.prop')).toHaveText('7');
    await expect(el.locator('.count')).toHaveText('7');

    // Property path — reflected back to the attribute.
    await count.locator('.in-value').fill('9');
    await count.locator('button[data-act="prop"]').click();
    await expect(count.locator('.prop')).toHaveText('9');
    await expect(count.locator('.attr')).toHaveText('"9"');

    // Removing the attribute resets to the default.
    await count.locator('button[data-act="remove"]').click();
    await expect(count.locator('.prop')).toHaveText('3');
    await expect(count.locator('.attr')).toHaveText('null (absent)');

    // A non-reflected input: property write leaves the attribute alone.
    const limit = row(page, 'limit');
    await limit.locator('button[data-act="prop"]').click();
    await expect(limit.locator('.prop')).toHaveText('20');
    await expect(limit.locator('.attr')).toHaveText('null (absent)');

    // toList via property → reflected as a joined list.
    const tags = row(page, 'tags');
    await tags.locator('button[data-act="prop"]').click();
    await expect(tags.locator('.prop')).toHaveText('["urgent","q4"]');
    await expect(tags.locator('.attr')).toHaveText('"urgent,q4"');

    // toBool('presence') reflects as presence.
    const compact = row(page, 'isCompact');
    await compact.locator('button[data-act="prop"]').click();
    await expect(compact.locator('.prop')).toHaveText('true');
    await expect(compact.locator('.attr')).toHaveText('""');
    await expect(el.locator('.chip')).toHaveClass(/compact/);
  });

  test('toFunction callback input: set re-renders through it, null clears', async ({ page }) => {
    const el = page.locator('#in01-el');
    const cb = row(page, 'formatLabelCallback');
    await expect(cb.locator('.prop')).toHaveText('null');
    await cb.locator('button[data-act="cb-set"]').click();
    await expect(el.locator('.label')).toHaveText('Inbox (3 new)');
    await cb.locator('button[data-act="cb-clear"]').click();
    await expect(cb.locator('.prop')).toHaveText('null');
    await expect(el.locator('.label')).toHaveText('Inbox');
  });
});

test.describe('IN02 · invalid values', () => {
  const click = (page: Page, op: string) => page.locator(`#in02-buttons button[data-op="${op}"]`).click();

  test('a bad attribute on a reflected input warns, keeps the value, and writes it back', async ({ page }) => {
    await click(page, 'attr-count-abc');
    await expect(page.locator('#in02-log .in02-warning').last()).toContainText('rejected invalid value for attribute count="abc"');
    await expect(page.locator('#in02-log .in02-result').last()).toContainText('el.count: 5 → 5 · attribute "5"');
    expect(await page.locator('#in02-el').getAttribute('count')).toBe('5');
  });

  test('a bad attribute on a non-reflected input keeps the value but leaves the markup', async ({ page }) => {
    await click(page, 'attr-limit-abc');
    await expect(page.locator('#in02-log .in02-warning').last()).toContainText('limit="abc"');
    await expect(page.locator('#in02-log .in02-result').last()).toContainText('el.limit: 50 → 50 · attribute "abc"');
  });

  test('property path: rejected values warn and keep the previous value', async ({ page }) => {
    await click(page, 'prop-count-99');
    await expect(page.locator('#in02-log .in02-warning').last()).toContainText('rejected invalid value for property "count"');
    await expect(page.locator('#in02-log .in02-result').last()).toContainText('el.count: 5 → 5');

    await click(page, 'prop-tone-purple');
    await expect(page.locator('#in02-log .in02-result').last()).toContainText('el.tone: "info" → "info"');

    await click(page, 'attr-count-8');
    await expect(page.locator('#in02-log .ok').last()).toContainText('accepted');
    await expect(page.locator('#in02-log .in02-result').last()).toContainText('el.count: 5 → 8');
  });
});

test.describe('IN03 · update vs reinit', () => {
  test('update inputs send a partial, reinit inputs rebuild, none inputs stay silent, mixed batch → reinit only', async ({ page }) => {
    const el = page.locator('#in03-el');
    await expect(page.locator('#in03-reinits')).toHaveText('reinit() × 1');

    await page.locator('#in03-caption-set').click();
    await expect(page.locator('#in03-log .in03-update').last()).toHaveText('◆ update({ caption: "Quarterly" })');
    await expect(page.locator('#in03-updates')).toHaveText('update() × 1');
    await expect(el.locator('.caption')).toHaveText('Quarterly');

    await page.locator('#in03-two-updates').click();
    await expect(page.locator('#in03-log .in03-update').last()).toHaveText('◆ update({ caption: "Batch 1", accent: "red" })');
    await expect(page.locator('#in03-updates')).toHaveText('update() × 2');

    await page.locator('#in03-layout').selectOption('grid');
    await expect(page.locator('#in03-reinits')).toHaveText('reinit() × 2');
    await expect(el.locator('.stamp')).toHaveText('build #2');

    await page.locator('#in03-note-set').click();
    await expect(page.locator('#in03-log .in03-none')).toHaveCount(1);
    await expect(page.locator('#in03-reinits')).toHaveText('reinit() × 2');
    await expect(page.locator('#in03-updates')).toHaveText('update() × 2');

    await page.locator('#in03-mixed').click();
    await expect(page.locator('#in03-reinits')).toHaveText('reinit() × 3');
    await expect(page.locator('#in03-updates')).toHaveText('update() × 2'); // no partial for the mixed batch
    await expect(el.locator('.caption')).toHaveText('Mixed 2');
  });
});

test.describe('IN04 · batching', () => {
  const lastCount = (page: Page) => page.locator('#in04-log .in04-count').last();

  test('loose writes coalesce into one flush; across ticks one each', async ({ page }) => {
    await page.locator('#in04-loose').click();
    await expect(page.locator('#in04-log .in04-sync-count').last()).toContainText('0 hook calls');
    await expect(lastCount(page)).toHaveText('1');
    await expect(page.locator('#in04-log .hook').last()).toContainText('update({ caption: "Loose 1b", accent: "green" })');

    await page.locator('#in04-ticks').click();
    await expect(lastCount(page)).toHaveText('3');
  });

  test('setAttributes() and batch() flush synchronously as one call', async ({ page }) => {
    await page.locator('#in04-setattrs').click();
    await expect(lastCount(page)).toHaveText('1');
    await expect(page.locator('#in04-log .hook').last()).toHaveText(/reinit\(\)/);

    await page.locator('#in04-batch').click();
    await expect(lastCount(page)).toHaveText('1');
    await expect(page.locator('#in04-log .hook').last()).toContainText('update({ caption: "Batch 2"');
  });

  test('whenSettled() and flush() give read-after-write', async ({ page }) => {
    await page.locator('#in04-settled').click();
    await expect(page.locator('#in04-log .in04-settled-layout')).toHaveText('grid');

    await page.locator('#in04-flush').click();
    await expect(page.locator('#in04-log .in04-stale')).toHaveText('4'); // pre-write state
    await expect(page.locator('#in04-log .in04-fresh')).toHaveText('6'); // flushed first
  });

  test('configure detached then append builds once', async ({ page }) => {
    await page.locator('#in04-builds').click();
    await expect(page.locator('#in04-log .in04-builds-indom')).toHaveText('2');
    await expect(page.locator('#in04-log .in04-builds-detached')).toHaveText('1');
  });
});

test.describe('IN05 · presets & live getters', () => {
  const read = (page: Page, key: string) => page.locator(`#in05-state tr[data-read="${key}"] td`);

  test('getBatchValuesCallback sets other inputs in the same batch; explicit writes win', async ({ page }) => {
    await page.locator('#in05-mode').selectOption('excel');
    await expect(page.locator('#in05-log .in05-update').last()).toHaveText(
      '◆ update({ mode: "excel", editTrigger: "dblclick", hasGridLines: true })',
    );
    await expect(read(page, 'el.editTrigger').nth(1)).toHaveText('"dblclick"');
    await expect(read(page, 'el.editTrigger').nth(2)).toHaveText('"dblclick"'); // reflected
    await expect(read(page, 'el.hasGridLines').nth(2)).toHaveText('""');

    await page.locator('#in05-mode').selectOption('simple');
    await expect(read(page, 'el.editTrigger').nth(1)).toHaveText('"click"');

    await page.locator('#in05-explicit').click();
    await expect(page.locator('#in05-log .in05-update').last()).toHaveText(
      '◆ update({ mode: "excel", editTrigger: "none", hasGridLines: true })',
    );
    await expect(read(page, 'el.editTrigger').nth(1)).toHaveText('"none"');
  });

  test('getLiveValue: the getter reads live rows; config keeps the assigned array; staged read returns the assignment', async ({ page }) => {
    await page.locator('#in05-assign').click();
    await expect(page.locator('#in05-log .in05-reinit').last()).toBeVisible();
    await expect(read(page, 'el.items (live getter)').nth(1)).toHaveText('["Alpha","Beta"]');

    await page.locator('#in05-el .add-row').click();
    await expect(read(page, 'el.items (live getter)').nth(1)).toHaveText('["Alpha","Beta","Row 3"]');
    await expect(read(page, 'this.config.items (assigned)').nth(1)).toHaveText('["Alpha","Beta"]');
    await expect(page.locator('#in05-el td', { hasText: 'Row 3' })).toBeVisible();

    await page.locator('#in05-staged').click();
    await expect(page.locator('#in05-log .in05-staged-read')).toHaveText('["Fresh"]');
    await expect(read(page, 'el.items (live getter)').nth(1)).toHaveText('["Fresh"]');
  });
});
