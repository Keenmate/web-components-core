import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// The null-clear engine-config contract (SPEC §6.1): removing a nullable input's attribute
// reaches the engine as `{ key: null }` via engineConfig() (nulls preserved), so an engine with
// an `!== undefined` guard reverts to its built-in default. The contrast case layers the old
// per-component delete-null loop on top: the key goes absent, the guard skips it and the stale
// value sticks (the bug the contract fixes).
//
// Fixture: test/nullclear.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/nullclear.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

const setAttr = (page: Page, id: string, value: string | null) =>
  page.evaluate(
    async ([id, value]) => {
      const el = document.getElementById(id!) as any;
      if (value === null) el.removeAttribute('focused-node-class');
      else el.setAttribute('focused-node-class', value);
      await el.whenSettled();
      return { applied: el.dataset.applied as string, received: el.lastReceived as Record<string, unknown> };
    },
    [id, value],
  );

test('preserve: clearing a nullable input reverts to the built-in default', async ({ page }) => {
  expect((await setAttr(page, 'preserve', 'ring-gold')).applied).toBe('ring-gold');

  const cleared = await setAttr(page, 'preserve', null); // removeAttribute → focusedNodeClass = null
  expect(cleared.received).toHaveProperty('focusedNodeClass', null);
  expect(cleared.applied).toBe('focus-default');
});

test('strip: the old delete-null loop makes the clear a silent no-op', async ({ page }) => {
  expect((await setAttr(page, 'strip', 'ring-gold')).applied).toBe('ring-gold');

  const cleared = await setAttr(page, 'strip', null);
  expect(cleared.received).not.toHaveProperty('focusedNodeClass');
  expect(cleared.applied).toBe('ring-gold'); // stale value sticks — the bug
});
