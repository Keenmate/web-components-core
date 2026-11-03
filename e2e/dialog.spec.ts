import { test, expect, type Page } from './fixtures';

// Review 2026-11-03 D-02 (WP6a): a modal <dialog> sits in the browser's top layer, so a panel
// portaled to <body> rendered UNDER it (and was inert). The default container is now the
// nearest open top-layer element around the trigger.
//
// Fixture: test/dialog.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/dialog.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
  await page.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).showModal());
});

/** Is `selector` the topmost element at its own centre (i.e. visible above the backdrop, clickable)? */
const isOnTop = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { isInsideDialog: !!el.closest('dialog'), isHit: !!hit && (hit === el || el.contains(hit)) };
  }, selector);

test('a popover opened from inside the dialog renders above it and is clickable', async ({ page }) => {
  await page.evaluate(() => {
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'panel';
    panel.textContent = 'Panel';
    (window as any).fixture.createPopover({ reference: document.getElementById('trigger'), panel }).open();
  });
  await expect.poll(() => isOnTop(page, '#panel')).toEqual({ isInsideDialog: true, isHit: true });
  await page.locator('#panel').click(); // would throw "intercepted by <dialog>" if under the backdrop
});

test('a tooltip on a trigger inside the dialog renders above it', async ({ page }) => {
  await page.evaluate(() => {
    const tip = (window as any).fixture.createTooltip({ trigger: document.getElementById('trigger'), content: 'Tip', cssClass: 'tip' });
    tip.show();
    (window as any).tipElement = document.querySelector('.tip');
    (window as any).tipElement.id = 'tip';
  });
  await expect.poll(() => isOnTop(page, '#tip')).toEqual({ isInsideDialog: true, isHit: true });
});

test('a menu hosted inside the dialog renders above it and its items are clickable', async ({ page }) => {
  await page.evaluate(() => {
    const host = document.getElementById('menu-host')!;
    (window as any).picked = null;
    (window as any).fixture.openMenu([{ id: 'one', text: 'One' }], {}, {
      host,
      at: { x: 40, y: 40 },
      runAction: (item: { id: string }) => ((window as any).picked = item.id),
    });
  });
  await page.locator('.km-menu__item[data-id="one"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).picked)).toBe('one');
});
