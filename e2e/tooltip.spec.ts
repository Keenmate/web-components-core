import { test, expect } from './fixtures';

const PAGE = '/test/tooltip.html';

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
});

// ---------------------------------------------------------------------------
// The regression this suite exists for.
//
// follow-cursor tooltips used to attach their mousemove listener only inside
// show() — which runs AFTER the show delay. A pointer that entered the trigger
// and then stayed still (the normal "hover to read" case) fired no mousemove
// during the delay, so the cursor rect was still undefined when show() ran and
// the VirtualElement fell back to the trigger's full rect — pinning the tooltip
// to the trigger's corner instead of the cursor. The fix seeds the cursor rect
// on mouseenter and tracks movement through the delay.
//
// jsdom (the unit suite) has no layout, so it can only prove WHICH reference is
// used; this test proves the tooltip actually LANDS at the cursor.
// ---------------------------------------------------------------------------
test('follow-cursor + show delay: a stationary hover anchors the tooltip at the cursor, not the trigger corner', async ({ page }) => {
  const trigger = page.locator('#follow-delay');
  const box = (await trigger.boundingBox())!;
  expect(box).not.toBeNull();

  // Enter well inside the trigger (40px right, 60px down from its origin), then
  // DO NOT move again — let the 400ms show delay elapse on a stationary pointer.
  const cx = box.x + 40;
  const cy = box.y + 60;
  await page.mouse.move(cx, cy);

  const tip = page.locator('.follow-tt.is-visible');
  await expect(tip).toBeVisible({ timeout: 2000 });

  const tipBox = (await tip.boundingBox())!;
  const tipCenterX = tipBox.x + tipBox.width / 2;
  const tipBottom = tipBox.y + tipBox.height;

  // 'top' placement against the seeded cursor point: the tooltip is centred on
  // the cursor's X and sits just above the cursor's Y.
  expect(Math.abs(tipCenterX - cx)).toBeLessThan(24); // centred on the cursor, not the trigger centre (~110px off)
  expect(tipBottom).toBeLessThanOrEqual(cy + 1); // above the cursor
  // …and crucially BELOW the trigger's top edge — the old bug anchored to the
  // full trigger rect and placed the tooltip entirely above the trigger (tipBottom < box.y).
  expect(tipBottom).toBeGreaterThan(box.y);
});

test('follow-cursor: the tooltip tracks the pointer as it moves across the trigger', async ({ page }) => {
  const trigger = page.locator('#follow-delay');
  const box = (await trigger.boundingBox())!;
  const midY = box.y + box.height / 2;

  await page.mouse.move(box.x + 30, midY);
  const tip = page.locator('.follow-tt.is-visible');
  await expect(tip).toBeVisible({ timeout: 2000 });
  const x1 = (await tip.boundingBox())!.x;

  // Move toward the far side of the row — the tooltip should follow the pointer.
  await page.mouse.move(box.x + box.width - 30, midY);
  await page.waitForTimeout(50);
  const x2 = (await tip.boundingBox())!.x;

  expect(x2 - x1).toBeGreaterThan(100);
});

test('basic tooltip shows on hover and hides on leave, portaled to the body with position:fixed', async ({ page }) => {
  const trigger = page.locator('#basic');
  await trigger.hover();

  const tip = page.locator('.basic-tt.is-visible');
  await expect(tip).toBeVisible({ timeout: 2000 });
  await expect(tip).toHaveText('basic tooltip');

  // Portaled into the document body (not nested in the trigger) and fixed-positioned.
  expect(await tip.evaluate((el) => el.parentElement?.tagName)).toBe('BODY');
  expect(await tip.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');

  // Move the pointer away → hide() removes the element from the DOM.
  await page.mouse.move(0, 0);
  await expect(page.locator('.basic-tt')).toHaveCount(0);
});

test('tooltip shows on keyboard focus and hides on blur (no cursor involved)', async ({ page }) => {
  const trigger = page.locator('#focus-basic');
  await trigger.focus();

  const tip = page.locator('.focus-tt.is-visible');
  await expect(tip).toBeVisible({ timeout: 2000 });
  await expect(tip).toHaveText('focus tooltip');

  await trigger.blur();
  await expect(page.locator('.focus-tt')).toHaveCount(0);
});

test("a BlissElement-owned tooltip shows on hover and rebuilds when its on:'reinit' input changes", async ({ page }) => {
  const host = page.locator('#host-card');
  await host.hover();
  await expect(page.locator('.host-tt.is-visible')).toHaveText('A core tooltip', { timeout: 2000 });

  await page.mouse.move(0, 0);
  await expect(page.locator('.host-tt')).toHaveCount(0);
  await host.evaluate((el) => el.setAttribute('tooltip-text', 'Reconfigured!'));
  await host.hover();
  await expect(page.locator('.host-tt.is-visible')).toHaveText('Reconfigured!', { timeout: 2000 });
});

// Delegated mode: ONE tooltip for many targets in a component's shadow root (calendar days, grid cells).
test.describe('delegated tooltip (selector)', () => {
  const tip = (page: import('@playwright/test').Page) => page.locator('fx-cells .cells-tt');
  const cell = (page: import('@playwright/test').Page, n: number) => page.locator('fx-cells .cell').nth(n - 1);

  test('hover: the show delay once, then it follows the pointer from cell to cell; a cell without content shows none', async ({ page }) => {
    await cell(page, 1).hover();
    await expect(tip(page)).toHaveText('tip 1');
    await expect(tip(page)).toHaveClass(/is-visible/);
    const first = (await tip(page).boundingBox())!;
    await cell(page, 2).hover();
    await expect(tip(page)).toHaveText('tip 2', { timeout: 150 }); // no second delay
    const second = (await tip(page).boundingBox())!;
    expect(second.x).toBeGreaterThan(first.x); // re-anchored to the second cell
    await cell(page, 3).hover();
    await expect(tip(page)).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect(tip(page)).toHaveCount(0);
  });

  test('keyboard focus shows the focused cell\'s tooltip', async ({ page }) => {
    await cell(page, 2).focus();
    await expect(tip(page)).toHaveText('tip 2');
    await expect(cell(page, 2)).toHaveAttribute('aria-describedby', /km-tooltip-/);
    await page.keyboard.press('Escape');
    await expect(tip(page)).toHaveCount(0);
  });
});

test.describe('delegated tooltip, toggle on tap (phone)', () => {
  test.use({ viewport: { width: 900, height: 900 }, isMobile: true, hasTouch: true });
  test('a tap toggles, another cell switches, a tap outside closes', async ({ page }) => {
    await page.goto(`${PAGE}?tap`);
    const tip = page.locator('fx-cells .cells-tt');
    const cell = (n: number) => page.locator('fx-cells .cell').nth(n - 1);
    await cell(1).tap();
    await expect(tip).toHaveText('tip 1');
    await cell(1).tap();
    await expect(tip).toHaveCount(0);
    await cell(1).tap();
    await cell(2).tap();
    await expect(tip).toHaveText('tip 2');
    await page.touchscreen.tap(20, 850);
    await expect(tip).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Exit fade + data-placement (SPEC §12.2). The fixture's tooltips only toggle opacity on
// `.is-visible`; the fade timing is core's TOOLTIP_CSS (--base-duration-fast, 0.1s fallback).
// ---------------------------------------------------------------------------

/** Install, for the tooltip `selector`, a probe: ms from the hiding class appearing to the element leaving the DOM. */
const watchFade = (page: import('@playwright/test').Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel)!;
    (window as unknown as { fade: Promise<{ ms: number; wasMountedWhileHiding: boolean }> }).fade = new Promise((resolve) => {
      let t0 = -1;
      let wasMountedWhileHiding = false;
      const mo = new MutationObserver(() => {
        if (t0 < 0 && el.classList.contains('km-tooltip--hiding')) {
          t0 = performance.now();
          wasMountedWhileHiding = el.isConnected;
        }
        if (!el.isConnected) {
          mo.disconnect();
          resolve({ ms: t0 < 0 ? 0 : performance.now() - t0, wasMountedWhileHiding });
        }
      });
      mo.observe(el, { attributes: true, attributeFilter: ['class'] });
      mo.observe(document.body, { childList: true });
    });
  }, selector);
const fadeResult = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { fade: Promise<{ ms: number; wasMountedWhileHiding: boolean }> }).fade);
/** Wait out the ENTRY fade (a hide mid-entry reverses from there and ends sooner). */
const settled = (page: import('@playwright/test').Page, selector: string) =>
  expect.poll(() => page.locator(selector).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

test.describe('exit fade + data-placement', () => {
  test('hiding fades out: stays mounted, not hit-testable, removed after the token duration', async ({ page }) => {
    await page.locator('#basic').hover();
    const tip = page.locator('.basic-tt.is-visible');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveAttribute('data-placement', 'top');
    await settled(page, '.basic-tt');
    expect(await tip.evaluate((el) => getComputedStyle(el).transitionDuration)).toContain('0.1s');
    await watchFade(page, '.basic-tt');
    await page.mouse.move(5, 5);
    const { ms, wasMountedWhileHiding } = await fadeResult(page);
    expect(wasMountedWhileHiding).toBe(true);
    expect(ms).toBeGreaterThan(60); // the fade ran (0.1s), not an instant removal
    expect(ms).toBeLessThan(1000);
    await expect(page.locator('.basic-tt')).toHaveCount(0);
  });

  test('mid-fade: opacity is on its way down and pointer-events are off', async ({ page }) => {
    await page.locator('#basic').hover();
    await expect(page.locator('.basic-tt.is-visible')).toBeVisible();
    await settled(page, '.basic-tt');
    const mid = await page.evaluate(async () => {
      const trigger = document.getElementById('basic')!;
      const el = document.querySelector<HTMLElement>('.basic-tt')!;
      trigger.dispatchEvent(new MouseEvent('mouseleave'));
      await new Promise((r) => setTimeout(r, 40));
      const style = getComputedStyle(el);
      return { connected: el.isConnected, opacity: Number(style.opacity), pointerEvents: style.pointerEvents };
    });
    expect(mid.connected).toBe(true);
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.pointerEvents).toBe('none');
  });

  test('showing again during the fade cancels it: same element, back to visible, never removed', async ({ page }) => {
    await page.locator('#basic').hover();
    await expect(page.locator('.basic-tt.is-visible')).toBeVisible();
    await settled(page, '.basic-tt');
    const result = await page.evaluate(async () => {
      const trigger = document.getElementById('basic')!;
      const el = document.querySelector<HTMLElement>('.basic-tt')!;
      let removed = false;
      const mo = new MutationObserver(() => {
        if (!el.isConnected) removed = true;
      });
      mo.observe(document.body, { childList: true });
      trigger.dispatchEvent(new MouseEvent('mouseleave'));
      await new Promise((r) => setTimeout(r, 30));
      const wasHiding = el.classList.contains('km-tooltip--hiding');
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await new Promise((r) => setTimeout(r, 300));
      mo.disconnect();
      return {
        wasHiding,
        removed,
        isSame: document.querySelector('.basic-tt') === el,
        visible: el.classList.contains('is-visible'),
        hiding: el.classList.contains('km-tooltip--hiding'),
        opacity: Number(getComputedStyle(el).opacity),
      };
    });
    expect(result).toEqual({ wasHiding: true, removed: false, isSame: true, visible: true, hiding: false, opacity: 1 });
  });

  test('data-motion="none" on a section: the tooltip is removed at once (no fade)', async ({ page }) => {
    await page.locator('#still').hover();
    const tip = page.locator('.still-tt.is-visible');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveAttribute('data-motion', 'none'); // followed the section's level to <body>
    expect(await tip.evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0s(, 0s)*$/);
    await watchFade(page, '.still-tt');
    await page.mouse.move(5, 5);
    const { ms } = await fadeResult(page);
    expect(ms).toBeLessThan(20);
  });

  test('data-placement is the RESOLVED placement: top at the viewport edge flips to bottom', async ({ page }) => {
    await page.locator('#edge').hover();
    const tip = page.locator('.edge-tt.is-visible');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveAttribute('data-placement', 'bottom');
    const [tipBox, edgeBox] = await Promise.all([tip.boundingBox(), page.locator('#edge').boundingBox()]);
    expect(tipBox!.y).toBeGreaterThanOrEqual(edgeBox!.y + edgeBox!.height);
  });
});
