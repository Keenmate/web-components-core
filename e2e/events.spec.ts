import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// emit() (SPEC §12.5) and before-callbacks (runBeforeCallback / runBeforeCallbackEager):
//   - the on<Name> twin runs first WITH the detail, then the listeners with the same object;
//     the detail carries non-enumerable controller/element + enumerable eventContext() extras;
//     events bubble but are not composed (a composed row leaks out of a shadow root);
//   - a throwing twin is logged (console.error) and the DOM event still fires;
//   - before-callbacks: unset/undefined continue, false rejects, a value replaces, async is
//     awaited, a throw rejects + logs; the eager variant stays synchronous for a sync hook.
//
// Fixture: test/events.html (elements from test/interaction-fixtures.ts). Steps are read from
// window.fx.log.

const steps = (page: Page) => page.evaluate(() => (window as any).fx.steps() as string[]);
const reset = (page: Page) => page.evaluate(() => (window as any).fx.reset());
const lastEvent = (page: Page) => page.evaluate(() => (window as any).lastEvent);

test.beforeEach(async ({ page }) => {
  await page.goto('/test/events.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test.describe('emit()', () => {
  test('twin first with the detail, then listeners with the same object; bubbles, not composed', async ({ page }) => {
    await page.evaluate(() => (document.getElementById('emitter') as any).controller.fire('ping'));
    expect(await steps(page)).toEqual([
      "emit('ping')",
      'onPing twin',
      'listener on el',
      'el.on() listener',
      'bubbled to parent div',
      'document listener',
    ]);
    expect(await lastEvent(page)).toEqual({
      type: 'ping',
      bubbles: true,
      composed: false,
      keys: ['count', 'emittedBy'],
      json: '{"count":1,"emittedBy":"emitter"}',
      isElementTarget: true,
      isController: true,
      controllerCount: 1,
      isTwinDetail: true,
    });
  });

  test('a throwing twin is logged and the DOM event still fires', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).shouldTwinThrow = true;
      (document.getElementById('emitter') as any).controller.fire('ping');
    });
    expect(await steps(page)).toEqual([
      "emit('ping')",
      'onPing twin',
      'console.error',
      'listener on el',
      'el.on() listener',
      'bubbled to parent div',
      'document listener',
    ]);
    const errors = await page.evaluate(() => (window as any).fx.log.filter((e: any) => e.step === 'console.error'));
    expect(errors[0].detail).toContain('fixture: onPing twin threw');
  });

  test('a non-composed event stops at the outer shadow root; a composed one leaks out', async ({ page }) => {
    await page.evaluate(() => (document.getElementById('shell') as any).inner.controller.fire('ping'));
    expect(await steps(page)).toEqual(["emit('ping')", 'onPing twin (inner)', "listener on the shell's shadow root"]);

    await reset(page);
    await page.evaluate(() => (document.getElementById('shell') as any).inner.controller.fire('ping-wide'));
    expect(await steps(page)).toEqual([
      "emit('ping-wide')",
      'onPingWide twin (inner)',
      "listener on the shell's shadow root",
      'listener on the outer host',
      'document listener',
    ]);
    expect((await lastEvent(page)).composed).toBe(true);
  });

  test("the emitter's own shadow button fires through the same path", async ({ page }) => {
    await page.locator('#emitter').getByRole('button', { name: 'emit ping', exact: true }).click();
    const s = await steps(page);
    expect(s).toContain('onPing twin');
    expect(s).toContain('document listener');
  });
});

test.describe('before-callbacks', () => {
  const label = (page: Page, id: string) => page.locator(`#guarded li[data-id="${id}"] .lbl`);

  /** Install a beforeRenameCallback (by mode) that logs its call, then rename('alpha'). */
  const rename = (page: Page, mode: string) =>
    page.evaluate(async (mode) => {
      const fx = (window as any).fx;
      const el = document.getElementById('guarded') as any;
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const hooks: Record<string, ((ctx: unknown) => unknown) | null> = {
        unset: null,
        undefined: () => undefined,
        false: () => false,
        string: () => 'Approved name',
        'async-string': async () => {
          await wait(300);
          return 'Checked name';
        },
        throw: () => {
          throw new Error('fixture: beforeRenameCallback threw');
        },
      };
      const fn = hooks[mode];
      el.beforeRenameCallback =
        fn &&
        ((ctx: any) => {
          fx.step('beforeRenameCallback', String(ctx.element === el));
          return fn(ctx);
        });
      fx.reset();
      return el.rename('alpha') as Promise<boolean>;
    }, mode);

  test('unset / undefined continue; false rejects; a value replaces', async ({ page }) => {
    expect(await rename(page, 'unset')).toBe(true);
    await expect(label(page, 'alpha')).toHaveText('Alpha #1');

    expect(await rename(page, 'undefined')).toBe(true);
    expect(await steps(page)).toEqual(['rename()', 'beforeRenameCallback', 'renamed', 'item-rename event']);
    await expect(label(page, 'alpha')).toHaveText('Alpha #2');

    expect(await rename(page, 'false')).toBe(false);
    expect(await steps(page)).toEqual(['rename()', 'beforeRenameCallback']);
    await expect(label(page, 'alpha')).toHaveText('Alpha #2');

    expect(await rename(page, 'string')).toBe(true);
    expect(await steps(page)).toEqual(['rename()', 'beforeRenameCallback', 'renamed', 'item-rename event']);
    await expect(label(page, 'alpha')).toHaveText('Approved name');
    // ctx carries the element (withContext).
    const hook = await page.evaluate(() => (window as any).fx.log.find((e: any) => e.step === 'beforeRenameCallback'));
    expect(hook.detail).toBe('true');
  });

  test('async hooks are awaited; a throw rejects and is logged', async ({ page }) => {
    expect(await rename(page, 'async-string')).toBe(true);
    await expect(label(page, 'alpha')).toHaveText('Checked name');

    expect(await rename(page, 'throw')).toBe(false);
    expect(await steps(page)).toEqual(['rename()', 'beforeRenameCallback', 'console.error']);
    const err = await page.evaluate(() => (window as any).fx.log.find((e: any) => e.step === 'console.error'));
    expect(err.detail).toContain('fixture: beforeRenameCallback threw');
  });

  test('runBeforeCallbackEager: sync hook selects in the same tick, async one later', async ({ page }) => {
    /** select(id) with a hook by mode; returns selectedId read synchronously right after select(). */
    const select = (mode: string, id: string) =>
      page.evaluate(
        ([mode, id]) => {
          const fx = (window as any).fx;
          const el = document.getElementById('guarded') as any;
          const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
          const hooks: Record<string, () => unknown> = {
            'sync-undefined': () => undefined,
            'sync-false': () => false,
            'sync-redirect': () => 'gamma',
            'async-undefined': async () => {
              await wait(300);
              return undefined;
            },
          };
          el.beforeSelectCallback = hooks[mode];
          fx.reset();
          el.select(id);
          return el.selectedId as string | null;
        },
        [mode, id],
      );
    const selected = (page: Page) => page.locator('#guarded li[aria-selected="true"]');

    expect(await select('sync-undefined', 'beta')).toBe('beta');
    expect(await select('sync-redirect', 'alpha')).toBe('gamma');
    await expect(selected(page)).toHaveAttribute('data-id', 'gamma');

    expect(await select('async-undefined', 'alpha')).toBe('gamma'); // not yet
    expect(await steps(page)).toEqual(['select()', 'deferred']);
    await expect(selected(page)).toHaveAttribute('data-id', 'alpha');
    expect(await steps(page)).toEqual(['select()', 'deferred', 'selected', 'item-select event']);

    expect(await select('sync-false', 'beta')).toBe('alpha');
    expect(await steps(page)).toEqual(['select()', 'selection rejected']);
    await expect(selected(page)).toHaveAttribute('data-id', 'alpha');
  });
});
