import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// examples-interaction.html — events (SPEC §12.5), before-callbacks, /actions
// (§12.12) and /menu (§12.13). Each section's timeline lists <li data-kind data-step>;
// these specs assert the ORDER the page shows, so the page can't drift from core.

const PAGE = '/examples-interaction.html';

/** The steps logged in a section's timeline since the last action marker. */
async function steps(page: Page, section: string): Promise<string[]> {
  return page.locator(`#demo-${section}-log`).evaluate((ol) => {
    const items = Array.from(ol.children) as HTMLElement[];
    let start = 0;
    items.forEach((li, i) => { if (li.dataset.kind === 'action') start = i; });
    return items.slice(start).filter((li) => li.dataset.step).map((li) => li.dataset.step!);
  });
}

async function logText(page: Page, section: string): Promise<string> {
  return page.locator(`#demo-${section}-log`).innerText();
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
});

test.describe('IA01 emit()', () => {
  test('twin first with the detail, then listeners with the same object; bubbles, not composed', async ({ page }) => {
    await page.locator('#do-ia01-fire').click();
    await expect.poll(() => steps(page, 'ia01')).toEqual([
      'emit(\'ping\')',
      'onPing twin',
      'listener on el',
      'el.on() listener',
      'bubbled to parent div',
      'document listener',
    ]);
    await expect(page.locator('#demo-ia01-log')).toContainText("e.detail === twin's detail: true");
    const readout = page.locator('#demo-ia01-readout');
    await expect(readout).toContainText('bubbles true · composed false');
    await expect(readout).toContainText('Object.keys(detail) ["count","emittedBy"]');
    await expect(readout).toContainText('JSON.stringify(detail) {"count":1,"emittedBy":"demo-ia01-emitter"}');
    await expect(readout).toContainText('detail.element === target true');
    await expect(readout).toContainText('detail.controller === el.controller true');
    await expect(readout).toContainText('detail.controller.count 1');
  });

  test('a throwing twin is logged and the DOM event still fires', async ({ page }) => {
    await page.locator('#do-ia01-throw').check();
    await page.locator('#do-ia01-fire').click();
    await expect.poll(() => steps(page, 'ia01')).toEqual([
      'emit(\'ping\')',
      'onPing twin',
      'console.error',
      'listener on el',
      'el.on() listener',
      'bubbled to parent div',
      'document listener',
    ]);
    await expect(page.locator('#demo-ia01-log')).toContainText('demo: onPing twin threw');
  });

  test('a non-composed event stops at the outer shadow root; a composed one leaks out', async ({ page }) => {
    await page.locator('#do-ia01-inner').click();
    await expect.poll(() => steps(page, 'ia01')).toEqual([
      'emit(\'ping\')',
      'onPing twin (inner)',
      "listener on the shell's shadow root",
    ]);
    await page.locator('#do-ia01-inner-wide').click();
    await expect.poll(() => steps(page, 'ia01')).toEqual([
      'emit(\'ping-wide\')',
      'onPingWide twin (inner)',
      "listener on the shell's shadow root",
      'listener on the outer host',
      'document listener',
    ]);
    await expect(page.locator('#demo-ia01-readout')).toContainText('composed true');
  });

  test('the emitter\'s own shadow button fires through the same path', async ({ page }) => {
    await page.locator('#demo-ia01-emitter').getByRole('button', { name: 'emit ping', exact: true }).click();
    await expect.poll(() => steps(page, 'ia01')).toContain('onPing twin');
    expect(await steps(page, 'ia01')).toContain('document listener');
  });
});

test.describe('IA02 before-callbacks', () => {
  const list = (page: Page) => page.locator('#demo-ia02-list');

  test('unset / undefined continue; false rejects; a value replaces', async ({ page }) => {
    await page.locator('#do-ia02-rename').click();
    await expect(page.locator('#demo-ia02-log')).toContainText('rename() resolved true');
    await expect(list(page).locator('li[data-id="alpha"] .lbl')).toHaveText('Alpha #1');

    await page.locator('#do-ia02-rename-mode').selectOption('false');
    await page.locator('#do-ia02-rename').click();
    await expect(page.locator('#demo-ia02-log')).toContainText('rename() resolved false');
    expect(await steps(page, 'ia02')).toEqual(['rename()', 'beforeRenameCallback']);
    await expect(list(page).locator('li[data-id="alpha"] .lbl')).toHaveText('Alpha #1');

    await page.locator('#do-ia02-rename-mode').selectOption('string');
    await page.locator('#do-ia02-rename').click();
    await expect.poll(() => steps(page, 'ia02')).toEqual(['rename()', 'beforeRenameCallback', 'renamed', 'item-rename event']);
    await expect(list(page).locator('li[data-id="alpha"] .lbl')).toHaveText('Approved name');
  });

  test('async hooks are awaited; a throw rejects and is logged', async ({ page }) => {
    await page.locator('#do-ia02-rename-mode').selectOption('async-string');
    await page.locator('#do-ia02-rename').click();
    await expect(list(page).locator('li[data-id="alpha"] .lbl')).toHaveText('Checked name');

    await page.locator('#do-ia02-rename-mode').selectOption('throw');
    await page.locator('#do-ia02-rename').click();
    await expect(page.locator('#demo-ia02-log')).toContainText('rename() resolved false');
    await expect(page.locator('#demo-ia02-log')).toContainText('beforeRenameCallback threw');
  });

  test('runBeforeCallbackEager: sync hook selects in the same tick, async one later', async ({ page }) => {
    await page.locator('#do-ia02-select-mode').selectOption('sync-undefined');
    await page.locator('#do-ia02-select-beta').click();
    await expect(page.locator('#demo-ia02-log')).toContainText('select() returned — el.selectedId = "beta" (was null)');

    await page.locator('#do-ia02-select-mode').selectOption('sync-redirect');
    await page.locator('#do-ia02-select-alpha').click();
    await expect(page.locator('#demo-ia02-log')).toContainText('el.selectedId = "gamma" (was "beta")');
    await expect(list(page).locator('li[aria-selected="true"]')).toHaveAttribute('data-id', 'gamma');

    await page.locator('#do-ia02-select-mode').selectOption('async-undefined');
    await page.locator('#do-ia02-select-alpha').click();
    await expect(page.locator('#demo-ia02-log')).toContainText('el.selectedId = "gamma" (was "gamma")');
    await expect(page.locator('#demo-ia02-log')).toContainText('selection waits for it');
    await expect(list(page).locator('li[aria-selected="true"]')).toHaveAttribute('data-id', 'alpha');

    await page.locator('#do-ia02-select-mode').selectOption('sync-false');
    await page.locator('#do-ia02-select-beta').click();
    await expect(page.locator('#demo-ia02-log')).toContainText('selection rejected');
    await expect(list(page).locator('li[aria-selected="true"]')).toHaveAttribute('data-id', 'alpha');
  });
});

test.describe('IA03 /actions', () => {
  const bar = (page: Page) => page.locator('#demo-ia03-bar');
  const btn = (page: Page, item: string) => bar(page).locator(`button[data-id="${item}"], button[data-action="${item}"]`).first();

  test('order: beforeActionCallback → onClick → built-in → twin → event; event sees the new state', async ({ page }) => {
    await page.locator('#do-ia03-before-mode').selectOption('undefined');
    await btn(page, 'add').click();
    await expect.poll(() => steps(page, 'ia03')).toEqual([
      'beforeActionCallback',
      'item onClick',
      'built-in',
      'onAction twin',
      'action event',
    ]);
    await expect(page.locator('#demo-ia03-log')).toContainText('detail.count (at click) = 0 · el.count (now) = 1');
    await expect(page.locator('#demo-ia03-log')).toContainText('aria-busy="true"');
  });

  test('component default disables reset; hidden items are not rendered; toggles reflect aria-pressed', async ({ page }) => {
    await expect(btn(page, 'reset')).toBeDisabled();
    await expect(bar(page).locator('button[data-id="secret"]')).toHaveCount(0);
    await btn(page, 'add').click();
    await expect(btn(page, 'reset')).toBeEnabled();
    await expect(btn(page, 'bold')).toHaveAttribute('aria-pressed', 'false');
    await btn(page, 'bold').click();
    await expect(btn(page, 'bold')).toHaveAttribute('aria-pressed', 'true');
  });

  test('false cancels everything', async ({ page }) => {
    await page.locator('#do-ia03-before-mode').selectOption('false');
    await btn(page, 'add').click();
    await expect(page.locator('#demo-ia03-log')).toContainText('runAction() resolved false');
    expect(await steps(page, 'ia03')).toEqual(['beforeActionCallback']);
    await expect(bar(page).locator('.count')).toHaveText('count = 0');
  });

  test('a throwing onClick or built-in is logged and the event still fires', async ({ page }) => {
    await page.locator('#do-ia03-click-throws').check();
    await btn(page, 'hello').click();
    await expect.poll(() => steps(page, 'ia03')).toEqual(['item onClick', 'console.error', 'onAction twin', 'action event']);

    await btn(page, 'fail').click();
    await expect.poll(() => steps(page, 'ia03')).toEqual(['built-in', 'console.error', 'onAction twin', 'action event']);
    await expect(page.locator('#demo-ia03-log')).toContainText('built-in "fail" threw');
  });

  test('busy: a second click while the async before-callback runs is ignored', async ({ page }) => {
    await page.locator('#do-ia03-before-mode').selectOption('async');
    await btn(page, 'add').click();
    await expect(btn(page, 'add')).toHaveAttribute('aria-busy', 'true');
    await btn(page, 'add').click();
    await expect(page.locator('#demo-ia03-log')).toContainText('item is busy — this activation is ignored');
    await expect(bar(page).locator('.count')).toHaveText('count = 1');
    await expect(page.locator('#demo-ia03-log')).toContainText('runAction() resolved true');
    // Only one built-in ran.
    await expect(page.locator('#demo-ia03-log li[data-step="built-in"]')).toHaveCount(1);
  });

  test('HTML-authored data-action button joins in with its dataset', async ({ page }) => {
    await bar(page).locator('button[data-id="from-markup"]').click();
    await expect.poll(() => steps(page, 'ia03')).toEqual(['onAction twin', 'action event']);
    await expect(page.locator('#demo-ia03-log')).toContainText('id "from-markup" source "message"');
    await expect(page.locator('#demo-ia03-log')).toContainText('dataset {"row":"42"}');
  });
});

test.describe('IA04 /menu', () => {
  // A scroll outside an open menu dismisses it (reason 'scroll'). Playwright scrolls the
  // target into view right before it acts; that scroll's event arrives a frame later, and
  // the devkit chapter nav follows a page scroll by scrolling its own panel — both after
  // the menu opened. So scroll first and wait until no scroll event fired for a while
  // (reduced motion: the devkit page otherwise scrolls smoothly).
  test.use({ reducedMotion: 'reduce' });
  const settle = async (page: Page, target: ReturnType<Page['locator']>) => {
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise<void>((resolve) => {
      let timer = setTimeout(done, 250);
      function onScroll() { clearTimeout(timer); timer = setTimeout(done, 250); }
      function done() { document.removeEventListener('scroll', onScroll, true); resolve(); }
      document.addEventListener('scroll', onScroll, true);
    }));
  };
  const rightClick = async (page: Page, name: string) => {
    await settle(page, row(page, name));
    await row(page, name).click({ button: 'right' });
  };
  const focusRow = async (page: Page, name: string) => {
    await settle(page, row(page, name));
    await row(page, name).focus();
  };
  const files = (page: Page) => page.locator('#demo-ia04-files');
  const row = (page: Page, name: string) => files(page).locator(`li[data-name="${name}"]`);
  const menus = (page: Page) => files(page).locator('.km-menu');
  const item = (page: Page, text: string) => files(page).locator('.km-menu__item', { hasText: text });

  test('context menu: roles, named divider, disabled + toggle items, a leaf runs the action', async ({ page }) => {
    await rightClick(page, 'contract.docx');
    const root = menus(page).first();
    await expect(root).toBeVisible();
    await expect(root).toHaveAttribute('role', 'menu');
    await expect(root.locator('.km-menu__divider--named')).toHaveText('Danger zone');
    await expect(item(page, 'Archive')).toHaveAttribute('aria-disabled', 'true'); // locked file
    await expect(item(page, 'Pinned')).toHaveAttribute('role', 'menuitemcheckbox');
    await expect(item(page, 'Pinned')).toHaveAttribute('aria-checked', 'false');
    await expect(item(page, 'Delete')).toHaveClass(/km-menu__item--danger/);

    await item(page, 'Rename').click();
    await expect(menus(page)).toHaveCount(0);
    await expect.poll(() => steps(page, 'ia04')).toEqual([
      'openMenu()',
      'closeCallback',
      'beforeActionCallback',
      'built-in',
      'onAction twin',
      'action event',
    ]);
    await expect(page.locator('#demo-ia04-log')).toContainText('reason "action"');
    await expect(row(page, 'renamed-contract.docx')).toHaveCount(1);
  });

  test('toggle keeps the menu open and re-renders; veto via beforeActionCallback', async ({ page }) => {
    await rightClick(page, 'report.pdf');
    await item(page, 'Pinned').click();
    await expect(item(page, 'Pinned')).toHaveAttribute('aria-checked', 'true');
    await expect(menus(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(menus(page)).toHaveCount(0);
    await expect(page.locator('#demo-ia04-log')).toContainText('reason "escape"');

    await page.locator('#do-ia04-veto-delete').check();
    await rightClick(page, 'report.pdf');
    await item(page, 'Delete').click();
    await expect.poll(() => steps(page, 'ia04')).toEqual(['openMenu()', 'closeCallback', 'beforeActionCallback']);
    await expect(row(page, 'report.pdf')).toHaveCount(1);
  });

  test('submenus (static + lazy) and outside-click dismiss', async ({ page }) => {
    await rightClick(page, 'report.pdf');
    await item(page, 'Share').hover();
    await expect(item(page, 'Copy link')).toBeVisible();
    await item(page, 'More').hover();
    await expect(item(page, 'QR code')).toBeVisible();
    await expect(menus(page)).toHaveCount(3);

    await item(page, 'Move to').hover();
    await expect(files(page).locator('.km-menu__loading')).toBeVisible();
    await expect(item(page, 'Archive 2025')).toBeVisible();
    await item(page, 'Archive 2025').click();
    await expect(page.locator('#demo-ia04-log')).toContainText('action event');
    await expect(page.locator('#demo-ia04-log')).toContainText('"move:Archive 2025"');

    await rightClick(page, 'report.pdf');
    // Press somewhere already in view (left edge of another row): clicking far away would
    // scroll the page first, and that scroll can dismiss the menu before the press does.
    await row(page, 'contract.docx').click({ position: { x: 4, y: 4 } });
    await expect(menus(page)).toHaveCount(0);
    await expect(page.locator('#demo-ia04-log')).toContainText('reason "outside-click"');
  });

  test('keyboard: Shift+F10 opens with focus, arrows skip disabled, → / ← submenus, shortcut, Tab closes', async ({ page }) => {
    await focusRow(page, 'contract.docx');
    await page.keyboard.press('Shift+F10');
    await expect(item(page, 'Open')).toBeFocused();
    await page.keyboard.press('End');
    await expect(item(page, 'Delete')).toBeFocused();
    await page.keyboard.press('ArrowUp'); // Archive is disabled (locked) → skipped
    await expect(item(page, 'Move to')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(item(page, 'Share')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(item(page, 'Copy link')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(item(page, 'Share')).toBeFocused();
    await expect(menus(page)).toHaveCount(1);
    await page.keyboard.press('Home');
    await expect(item(page, 'Open')).toBeFocused();
    await page.keyboard.press('ArrowUp'); // wraps
    await expect(item(page, 'Delete')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menus(page)).toHaveCount(0);
    await expect(page.locator('#demo-ia04-log')).toContainText('reason "tab"');

    await focusRow(page, 'budget.xlsx');
    await page.keyboard.press('Shift+F10');
    await page.keyboard.press('F2'); // the Rename shortcut
    await expect(menus(page)).toHaveCount(0);
    await expect(row(page, 'renamed-budget.xlsx')).toBeFocused(); // focus returned to the row, kept across the re-render
  });

  test('dropdown from a button: keyboard activation focuses the first item; hidden item omitted', async ({ page }) => {
    const btn = files(page).locator('.do-actions');
    await settle(page, btn);
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(item(page, 'New file')).toBeFocused();
    await expect(item(page, 'Never shown')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(menus(page)).toHaveCount(0);
    await expect(btn).toBeFocused();
    await expect(row(page, 'new-4.txt')).toHaveCount(1);
    await expect(page.locator('#demo-ia04-log')).toContainText('source "toolbar"');
  });

  test('theming: page-wide --km-menu-* and the per-instance private layer', async ({ page }) => {
    const bg = () => menus(page).first().evaluate((m) => getComputedStyle(m).backgroundColor);
    const open = async () => {
      await rightClick(page, 'report.pdf');
      await expect(menus(page)).toHaveCount(1);
    };
    await open();
    const base = await bg();
    await page.keyboard.press('Escape');

    await page.locator('#do-ia04-page-theme').check();
    await open();
    expect(await bg()).toBe('rgb(255, 251, 235)'); // #fffbeb (light)
    await expect(menus(page).first()).toHaveCSS('border-radius', '12px');
    await page.keyboard.press('Escape');

    await page.locator('#do-ia04-instance-theme').check();
    await open();
    expect(await bg()).toBe('rgb(236, 254, 255)'); // #ecfeff — instance beats the page layer
    await page.keyboard.press('Escape');

    await page.locator('#do-ia04-instance-theme').uncheck();
    await page.locator('#do-ia04-page-theme').uncheck();
    await open();
    expect(await bg()).toBe(base);
  });
});

test('no horizontal overflow at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
