import { test, expect } from './fixtures';

// createPopover() (core /positioning) in a real browser:
//   - open() mounts the panel portaled into <body>, fixed, below the reference (bottom-start +
//     offset) with matchWidth 'exact' → the reference's width;
//   - close() (here via the page's outside-click handler) unmounts it; toggling reopens.
//
// Fixture: test/popover.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/popover.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('toggles a portaled panel and closes on outside click', async ({ page }) => {
  const ref = page.locator('#ref');
  await ref.click();
  const panel = page.locator('.fx-panel');
  await expect(panel).toBeVisible({ timeout: 2000 });
  expect(await panel.evaluate((el) => el.parentElement?.tagName)).toBe('BODY'); // portaled
  expect(await page.evaluate(() => (window as any).pop.isOpen)).toBe(true);

  await page.mouse.click(5, 300); // outside
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).pop.isOpen)).toBe(false);

  await ref.click();
  await expect(panel).toBeVisible();
  await ref.click(); // toggle closes
  await expect(panel).toHaveCount(0);
});

test('placement bottom-start + offset, matchWidth exact', async ({ page }) => {
  const ref = page.locator('#ref');
  await ref.click();
  const panel = page.locator('.fx-panel');
  await expect(panel).toBeVisible();
  const r = (await ref.boundingBox())!;
  await expect.poll(async () => {
    const p = (await panel.boundingBox())!;
    return {
      left: Math.round(p.x - r.x),
      gap: Math.round(p.y - (r.y + r.height)),
      width: Math.round(p.width - r.width),
    };
  }).toEqual({ left: 0, gap: 6, width: 0 });
});

// createPopover() fit additions (docs/review/2026-11-06-createpopover-fit.md, group A).

test('close() puts back the inline sizes anchor() wrote (maxHeight / matchWidth)', async ({ page }) => {
  const sizes = await page.evaluate(async () => {
    const panel = document.createElement('div');
    panel.style.maxHeight = '999px'; // the author's own value
    const p = (window as any).createPopover({ reference: document.getElementById('ref'), panel, matchWidth: 'exact', maxHeight: true });
    p.open();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const open = { width: panel.style.width, maxHeight: panel.style.maxHeight };
    p.close();
    return { open, closed: { width: panel.style.width, maxHeight: panel.style.maxHeight } };
  });
  expect(sizes.open.width).toBe('360px');
  expect(sizes.open.maxHeight).not.toBe('999px'); // the size() cap replaced it while open
  expect(sizes.closed).toEqual({ width: '', maxHeight: '999px' });
});

test('shouldCloseOnScroll hears a scroller inside a shadow root; hidden until placed', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const root = document.getElementById('shadow-host')!.shadowRoot!;
    const panel = document.createElement('div');
    panel.textContent = 'inner panel';
    const reasons: string[] = [];
    const p = (window as any).createPopover({
      reference: root.querySelector('.inner-ref'),
      panel,
      container: root,
      visibleClass: 'is-open',
      shouldCloseOnScroll: true,
      onClose: (reason: string) => reasons.push(reason),
    });
    p.open();
    const atOpen = { hasClass: panel.classList.contains('is-open'), visibility: panel.style.visibility };
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const afterPlacement = panel.style.visibility;
    const isInShadowRoot = panel.parentNode === root;
    root.querySelector('.scroller')!.scrollTop = 50;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { atOpen, afterPlacement, isInShadowRoot, isOpen: p.isOpen, reasons };
  });
  expect(result).toEqual({
    atOpen: { hasClass: true, visibility: 'hidden' },
    afterPlacement: '',
    isInShadowRoot: true,
    isOpen: false,
    reasons: ['scroll'],
  });
});

test('outside click is decided when the click ends: a page button driving the popover keeps it open', async ({ page }) => {
  const result = await page.evaluate(() => {
    const ref = document.getElementById('ref')!;
    const panel = document.createElement('div');
    panel.textContent = 'click-time panel';
    const pop = (window as any).createPopover({ reference: ref, panel, shouldCloseOnOutsideClick: true, offset: 6 });
    const drive = document.createElement('button');
    drive.id = 'drive';
    drive.textContent = 'scroll the panel (API)';
    drive.addEventListener('click', () => pop.claimCurrentClick());
    const plain = document.createElement('button');
    plain.id = 'plain';
    plain.textContent = 'something else';
    document.body.prepend(drive, plain);
    (window as any).clickPop = pop;
    pop.open();
    return pop.isOpen;
  });
  expect(result).toBe(true);
  await page.locator('#drive').click(); // claims this click
  expect(await page.evaluate(() => (window as any).clickPop.isOpen)).toBe(true);
  await page.locator('#plain').click(); // an ordinary outside click
  expect(await page.evaluate(() => (window as any).clickPop.isOpen)).toBe(false);
});

test('a reference removed from the page while open takes the panel with it (a re-rendered row)', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const row = document.createElement('button');
    row.textContent = 'row';
    document.body.append(row);
    const panel = document.createElement('div');
    panel.textContent = 'row panel';
    const reasons: string[] = [];
    const pop = (window as any).createPopover({ reference: row, panel, onClose: (r: string) => reasons.push(r) });
    pop.open();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    row.remove();
    for (let i = 0; i < 10 && pop.isOpen; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
    return { isOpen: pop.isOpen, isMounted: panel.isConnected, reasons };
  });
  expect(result).toEqual({ isOpen: false, isMounted: false, reasons: ['reference-removed'] });
});
