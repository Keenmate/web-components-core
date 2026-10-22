import { test, expect } from './fixtures';

// Smoke-tests the human-facing example pages (index, the /positioning chapters,
// null-clear and search). It doubles as an integration check of the <tooltip-card> demo
// component (a real BlissElement driving createTooltip) and of createPopover.
// The pageErrors fixture fails the test on any uncaught error, so a broken
// import or a throwing helper can't sail through green.

test.describe('examples index', () => {
  test('renders a card per registered page and a version badge', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.card-link')).toHaveCount(6);
    await expect(page.locator('#version-badge')).toHaveText(/^v\d/);
    // The XXYY chapter codes show on the cards.
    await expect(page.locator('.card-code', { hasText: 'TT' })).toBeVisible();
  });
});

test.describe('examples-tooltip.html', () => {
  test.beforeEach(async ({ page }) => page.goto('/examples-tooltip.html'));

  test('TT01: a raw createTooltip chip shows its tooltip on hover', async ({ page }) => {
    await page.locator('#tt-placements .pos-trigger', { hasText: 'right' }).hover();
    await expect(page.locator('.demo-tt.is-visible')).toHaveText('placement: right', { timeout: 2000 });
  });

  test('TT03: the <tooltip-card> component shows a tooltip and reconfigures on a control change', async ({ page }) => {
    const card = page.locator('#live-card');
    await card.hover();
    await expect(page.locator('.demo-tt.is-visible')).toHaveText('A core tooltip', { timeout: 2000 });

    // Move away, change the text control → the on:'reinit' input rebuilds the tooltip.
    await page.mouse.move(0, 0);
    await page.locator('#card-text').fill('Reconfigured!');
    await page.locator('#card-text').dispatchEvent('change');
    await card.hover();
    await expect(page.locator('.demo-tt.is-visible')).toHaveText('Reconfigured!', { timeout: 2000 });
  });
});

test.describe('examples-popover.html', () => {
  test('PO01: toggles a portaled panel and closes on outside click', async ({ page }) => {
    await page.goto('/examples-popover.html');
    await page.locator('#po-btn').click();
    const panel = page.locator('.demo-panel').first();
    await expect(panel).toBeVisible({ timeout: 2000 });
    expect(await panel.evaluate((el) => el.parentElement?.tagName)).toBe('BODY'); // portaled

    await page.mouse.click(5, 5); // outside
    await expect(page.locator('.demo-panel')).toHaveCount(0);
  });
});

test.describe('examples-anchor.html', () => {
  test('AN01: anchors a floating box to the reference', async ({ page }) => {
    await page.goto('/examples-anchor.html');
    const box = page.locator('.demo-float');
    await expect(box).toBeVisible();
    // Positioned as fixed by anchor() with a resolved left/top.
    const pos = await box.evaluate((el) => ({ position: getComputedStyle(el).position, left: el.style.left }));
    expect(pos.position).toBe('fixed');
    expect(pos.left).not.toBe('');
  });
});

test.describe('examples-nullclear.html', () => {
  test.beforeEach(async ({ page }) => page.goto('/examples-nullclear.html'));

  const focusedClass = (page: import('@playwright/test').Page) =>
    page.locator('#live').evaluate((el) => (el.shadowRoot?.getElementById('focused') as HTMLElement).className);

  test('NC03 preserve: clearing a nullable input reverts to the built-in default', async ({ page }) => {
    await page.locator('#c-set').click();
    expect(await focusedClass(page)).toContain('ring-gold');

    await page.locator('#c-clear').click(); // removeAttribute → focusedNodeClass = null
    expect(await focusedClass(page)).toContain('nc-focus-default');
    expect(await focusedClass(page)).not.toContain('ring-gold');
    await expect(page.locator('#c-verdict')).toHaveClass(/ok/);
  });

  test('NC03 strip: the old delete-null loop makes the clear a silent no-op', async ({ page }) => {
    await page.locator('input[name="mode"][value="strip"]').check();
    await page.locator('#c-set').click();
    expect(await focusedClass(page)).toContain('ring-gold');

    await page.locator('#c-clear').click();
    expect(await focusedClass(page)).toContain('ring-gold'); // stale class sticks — the bug
    await expect(page.locator('#c-verdict')).toHaveClass(/bug/);
  });
});

test.describe('examples-search.html', () => {
  test.beforeEach(async ({ page }) => page.goto('/examples-search.html'));

  test('SE01: accent-insensitive filter + highlight; values normalized once', async ({ page }) => {
    const term = page.locator('#pg-term');
    await term.fill('ces');
    await expect(page.locator('#pg-results mark')).toHaveText(['Čes', 'Čes']);
    await term.fill('cesk');
    await term.fill('lodz');
    await expect(page.locator('#pg-results li')).toHaveCount(1);
    await expect(page.locator('#pg-normalized')).toHaveText('27'); // once, not per keystroke

    await page.locator('input[name="pg-behavior"][value="case-insensitive"]').check();
    await expect(page.locator('#pg-results li')).toHaveCount(0);
  });

  test('SE01: regex keeps the last valid pattern while typing', async ({ page }) => {
    await page.locator('#pg-match').selectOption('regex');
    await page.locator('#pg-term').fill('^(Ústí|Nové)');
    await expect(page.locator('#pg-results li')).toHaveCount(3);
    await page.locator('#pg-term').fill('^(Ústí|Nové');
    await expect(page.locator('#pg-results li')).toHaveCount(3);
  });

  test('SE04: highlight renders the returned NFC text', async ({ page }) => {
    await expect(page.locator('#hl-right mark')).toHaveText('Zl\u00ED');
    await expect(page.locator('#hl-ranges')).toHaveText('[[0,3]]');
    await expect(page.locator('#hl-escaped mark')).toHaveText('Brno');
    await expect(page.locator('#hl-escaped-src')).toContainText('&lt;b&gt;');
  });

  test('SE05: prepare turns ha-324/56 into a separator-insensitive regex', async ({ page }) => {
    await expect(page.locator('#pn-results li:not(.is-miss)')).toHaveCount(5); // incl. XHA-324/56-B (contains)
    await page.locator('#pn-prepare').uncheck();
    await expect(page.locator('#pn-results li:not(.is-miss)')).toHaveCount(2);
  });

  test('SE06: entries built once per item set, searched by postal code', async ({ page }) => {
    const term = page.locator('#cb-term');
    await term.fill('3');
    await term.fill('35');
    await term.fill('350 02');
    await expect(page.locator('#cb-results li')).toHaveCount(1);
    await expect(page.locator('#cb-built')).toHaveText('1');
    await expect(page.locator('#cb-indexed')).toHaveText('1');
    await page.locator('#cb-replace').click();
    await term.fill('lodz');
    await expect(page.locator('#cb-results li')).toHaveText(['Łódź90-001']);
    await expect(page.locator('#cb-built')).toHaveText('2');
  });
});
