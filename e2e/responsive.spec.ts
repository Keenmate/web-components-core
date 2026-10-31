import { test, expect, devices } from './fixtures';
import type { Page } from './fixtures';

const PAGE = '/examples-responsive.html';

async function open(page: Page): Promise<void> {
  await page.goto(PAGE);
  await expect(page.locator('body[data-ready="true"]')).toHaveCount(1);
}

const mapCell = (page: Page, key: string, col: string) => page.locator(`#map-table tr[data-key="${key}"] td.${col}`);
const layerRow = (page: Page, key: string) => page.locator(`#layers-table tr[data-key="${key}"]`);

// Desktop Chrome project (1280 × 900, mouse) unless a describe block emulates touch.
test.describe('desktop (mouse)', () => {
  test.beforeEach(async ({ page }) => open(page));

  test('RS01: snapshot — mouse device is desktop at any width; breakpoint follows the width', async ({ page }) => {
    await expect(page.locator('#env-device')).toHaveText('desktop');
    await expect(page.locator('#env-breakpoint')).toHaveText('desktop');
    await expect(page.locator('#env-touch')).toHaveText('false');

    await page.setViewportSize({ width: 700, height: 900 });
    await expect(page.locator('#env-breakpoint')).toHaveText('mobile');
    await expect(page.locator('#env-device')).toHaveText('desktop'); // capability over width
  });

  test('RS01: discrete channel fires only on a category flip; continuous fires on every size change', async ({ page }) => {
    const disc = page.locator('#disc-count');
    const cont = page.locator('#cont-count');
    const d0 = Number(await disc.textContent());
    const c0 = Number(await cont.textContent());

    // Within the desktop bucket: continuous yes, discrete no.
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect.poll(async () => Number(await cont.textContent())).toBeGreaterThan(c0);
    await page.waitForTimeout(150);
    expect(Number(await disc.textContent())).toBe(d0);

    // Cross the 1024 line → discrete fires.
    await page.setViewportSize({ width: 900, height: 900 });
    await expect.poll(async () => Number(await disc.textContent())).toBeGreaterThan(d0);
    await expect(page.locator('#env-breakpoint')).toHaveText('tablet');
  });

  test('RS01: simulated table — iPad portrait is tablet in the mobile bucket', async ({ page }) => {
    const row = page.locator('#sim-table tr[data-sim="iPad portrait"]');
    await expect(row.locator('td').nth(3)).toHaveText('tablet');
    await expect(row.locator('td').nth(4)).toHaveText('mobile');
    const narrowed = page.locator('#sim-table tr[data-sim="Desktop narrowed"]');
    await expect(narrowed.locator('td').nth(3)).toHaveText('desktop');
    await expect(narrowed.locator('td').nth(4)).toHaveText('mobile');
    await expect(page.locator('#sim-table tr[data-sim="Phone (landscape)"] td').nth(3)).toHaveText('mobile');
  });

  test('RS01: configureBreakpoints moves the lines globally; reset restores them', async ({ page }) => {
    await page.fill('#bp-mobile', '1300');
    await page.fill('#bp-tablet', '1600');
    await page.click('#bp-apply');
    await expect(page.locator('#env-breakpoint')).toHaveText('mobile');
    await page.click('#bp-reset');
    await expect(page.locator('#env-breakpoint')).toHaveText('desktop');
  });

  test('RS02: resolvePresentation — map per class, defaults, forced mode', async ({ page }) => {
    const result = (env: string) => page.locator(`#rp-table tr[data-env="${env}"] .rp-result`);
    // Initial map: { tablet: 'modal' }.
    await expect(result('Phone (portrait)')).toHaveText('fullscreen');
    await expect(result('iPad portrait')).toHaveText('modal');
    await expect(result('Desktop')).toHaveText('floating');
    await expect(result('Live (this window)')).toHaveText('floating');

    await page.selectOption('.rp-map[data-cls="tablet"]', '');
    await expect(result('iPad portrait')).toHaveText('floating');

    await page.selectOption('#rp-mode', 'modal');
    for (const env of ['Phone (portrait)', 'iPad portrait', 'Desktop']) await expect(result(env)).toHaveText('modal');
  });

  test('RS03: breakpoint axis flips a narrowed desktop window; base shows through when no entry applies', async ({ page }) => {
    await expect(mapCell(page, 'layout', 'eff')).toHaveText('"grid"');
    await expect(mapCell(page, 'columns', 'eff')).toHaveText('3');

    await page.setViewportSize({ width: 700, height: 900 });
    await expect(mapCell(page, 'layout', 'eff')).toHaveText('"stack"');
    await expect(mapCell(page, 'columns', 'eff')).toHaveText('1');
    await expect(mapCell(page, 'presentation', 'eff')).toHaveText('"floating"'); // desktop device → no device entry
    await expect(page.locator('#map-log')).toContainText('reinit()');

    // A base value: the instance map still wins under 768, base comes back above.
    await page.selectOption('#map-cols', '5');
    await expect(mapCell(page, 'columns', 'base')).toHaveText('5');
    await expect(mapCell(page, 'columns', 'eff')).toHaveText('1');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(mapCell(page, 'columns', 'eff')).toHaveText('5');
    await expect(mapCell(page, 'layout', 'eff')).toHaveText('"grid"');
  });

  test('RS04: precedence key by key, no reflection, null opt-out, dropped key restores base', async ({ page }) => {
    const eff = (k: string) => layerRow(page, k).locator('td.eff');
    const won = (k: string) => layerRow(page, k).locator('td.winner');

    await expect(eff('accent')).toHaveText('"slate"');

    await page.check('#l-global-map');
    await expect(eff('accent')).toHaveText('"amber"');
    await expect(eff('density')).toHaveText('"compact"');
    await expect(layerRow(page, 'accent').locator('td.attr')).toHaveText('—'); // overrides never reflect

    await page.check('#l-global-cb');
    await expect(eff('accent')).toHaveText('"teal"');
    await page.check('#l-tag-map');
    await expect(eff('density')).toHaveText('"spacious"');
    await expect(eff('label')).toHaveText('"tag map"');
    await page.check('#l-tag-cb');
    await expect(eff('label')).toHaveText('"tag callback"');

    // Explicit attribute beats every page rule.
    await page.check('#l-attr');
    await expect(eff('accent')).toHaveText('"rose"');
    await expect(won('accent')).toHaveText('instance attribute (explicit)');

    await page.check('#l-inst-map');
    await expect(eff('label')).toHaveText('"instance map"');
    await page.check('input[name="l-inst-cb"][value="partial"]');
    await expect(eff('badge')).toHaveText('"instance callback"');

    // Instance null = ignore every page rule; the instance's own values still apply.
    await page.check('input[name="l-inst-cb"][value="null"]');
    await expect(eff('density')).toHaveText('"comfortable"');
    await expect(eff('badge')).toHaveText('"none"');
    await expect(eff('label')).toHaveText('"instance map"');
    await expect(eff('accent')).toHaveText('"rose"');

    // Every row: the demo helper agrees with the element.
    await expect(page.locator('#layers-table td.check.bad')).toHaveCount(0);

    // Reset → all layers gone, base restored, globals cleared.
    await page.click('#l-reset');
    for (const [k, v] of [['accent', '"slate"'], ['density', '"comfortable"'], ['label', '"base"'], ['badge', '"none"']] as const) {
      await expect(eff(k)).toHaveText(v);
    }
    expect(await page.evaluate(() => { const c = (window as unknown as { components: { responsive: unknown; responsiveCallback: unknown } }).components; return [c.responsive ?? null, c.responsiveCallback ?? null]; })).toEqual([null, null]);
  });

  test('RS04: page-wide rules do not leak into the other demo elements (their keys differ)', async ({ page }) => {
    await page.click('#l-all');
    await expect(page.locator('#layers-table td.check.bad')).toHaveCount(0);
    await expect(mapCell(page, 'layout', 'eff')).toHaveText('"grid"');
  });

  test('RS05: a callback on a custom width re-runs continuously; update() only on a changed result', async ({ page }) => {
    await expect(page.locator('#cb-compact-val')).toHaveText('false');
    await expect(page.locator('#cb-cols-val')).toHaveText('4');

    await page.setViewportSize({ width: 800, height: 900 }); // between 600 and 900
    await expect(page.locator('#cb-cols-val')).toHaveText('2');
    await expect(page.locator('#cb-compact-val')).toHaveText('false');

    // Within the same breakpoint bucket ("mobile", ≤ 768): only the continuous channel can see 550.
    await page.setViewportSize({ width: 700, height: 900 });
    await page.setViewportSize({ width: 550, height: 900 });
    await expect(page.locator('#cb-compact-val')).toHaveText('true');
    await expect(page.locator('#cb-cols-val')).toHaveText('1');

    const updatesBefore = Number(await page.locator('#cb-updates').textContent());
    const runsBefore = Number(await page.locator('#cb-runs').textContent());
    await page.setViewportSize({ width: 560, height: 900 });
    await page.setViewportSize({ width: 570, height: 900 });
    await expect.poll(async () => Number(await page.locator('#cb-runs').textContent())).toBeGreaterThan(runsBefore);
    expect(Number(await page.locator('#cb-updates').textContent())).toBe(updatesBefore); // same result → diffed out

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('#cb-compact-val')).toHaveText('false');
    await expect(page.locator('#cb-cols-val')).toHaveText('4'); // dropped keys → base
  });
});

// Touch emulation needs the viewport meta tag (the page has it) — see SPEC §12.7.
test.describe('iPad portrait (touch, 768 × 1024)', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });
  test.beforeEach(async ({ page }) => open(page));

  test('RS01/RS03: tablet device in the mobile bucket — device entry beats breakpoint entry', async ({ page }) => {
    await expect(page.locator('#env-touch')).toHaveText('true');
    await expect(page.locator('#env-device')).toHaveText('tablet');
    await expect(page.locator('#env-breakpoint')).toHaveText('mobile');

    await expect(mapCell(page, 'layout', 'eff')).toHaveText('"grid"'); // device.tablet over breakpoint.mobile "stack"
    await expect(mapCell(page, 'columns', 'eff')).toHaveText('2');
    await expect(mapCell(page, 'presentation', 'eff')).toHaveText('"modal"');
    await expect(page.locator('#rp-table tr[data-env="Live (this window)"] .rp-result')).toHaveText('modal');
  });
});

test.describe('phone (iPhone 13 profile)', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
  test.use(iphone);
  test.beforeEach(async ({ page }) => open(page));

  test('RS01/RS02/RS03: phone is mobile on both axes', async ({ page }) => {
    await expect(page.locator('#env-device')).toHaveText('mobile');
    await expect(page.locator('#env-breakpoint')).toHaveText('mobile');
    await expect(page.locator('#rp-table tr[data-env="Live (this window)"] .rp-result')).toHaveText('fullscreen');
    await expect(mapCell(page, 'layout', 'eff')).toHaveText('"stack"');
    await expect(mapCell(page, 'presentation', 'eff')).toHaveText('"fullscreen"');
  });
});
