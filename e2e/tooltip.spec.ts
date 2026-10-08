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
