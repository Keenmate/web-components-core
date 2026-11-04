import { test, expect } from './fixtures';

// Review 2026-11-03 E-23 (e2e part): browser semantics jsdom only approximates.
//
// Fixture: test/upgrade.html (a blank page that exposes core on window.core)

test.beforeEach(async ({ page }) => {
  await page.goto('/test/upgrade.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('E-23 e2e #2: moving a form-associated element between fieldsets flips disabled without a rebuild', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { BlissElement, define, toBool } = (window as any).core;
    const calls: string[] = [];
    class Moved extends BlissElement {
      static formAssociated = true;
      static inputs = [{ configKey: 'isDisabled', attribute: 'disabled', converter: toBool('presence'), default: false, shouldReflect: true }];
      reinit() {
        calls.push(`reinit:${this.isEffectivelyDisabled}`);
      }
      update() {
        calls.push('update');
      }
      connect() {
        calls.push('connect');
      }
      disconnect() {
        calls.push('disconnect');
      }
      disabledChanged(isDisabled: boolean) {
        calls.push(`disabledChanged:${isDisabled}`);
      }
    }
    define('e23-moved-el', Moved);
    const enabled = document.createElement('fieldset');
    const disabled = document.createElement('fieldset');
    disabled.disabled = true;
    document.body.append(enabled, disabled);
    const el = document.createElement('e23-moved-el') as any;
    enabled.appendChild(el);
    const states: boolean[] = [el.isEffectivelyDisabled];
    disabled.appendChild(el); // move into the disabled fieldset
    states.push(el.isEffectivelyDisabled, el.isDisabled, el.hasAttribute('disabled'));
    enabled.appendChild(el); // and back
    states.push(el.isEffectivelyDisabled);
    return { calls, states };
  });
  expect(result.states).toEqual([false, true, false, false, false]); // the fieldset never writes isDisabled
  expect(result.calls.filter((c) => c.startsWith('reinit'))).toEqual(['reinit:false']); // moves never rebuild
  expect(result.calls).not.toContain('update');
  expect(result.calls.filter((c) => c.startsWith('disabledChanged'))).toEqual(['disabledChanged:true', 'disabledChanged:false']);
});

test('E-23 #12: adoptNode into an iframe document adopts the motion presets there; no removedCallback', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { BlissElement, define } = (window as any).core;
    let removed = 0;
    const calls: string[] = [];
    class Travelling extends BlissElement {
      reinit() {
        calls.push('reinit');
      }
      connect() {
        calls.push('connect');
      }
      disconnect() {
        calls.push('disconnect');
      }
      removedCallback() {
        removed += 1;
      }
    }
    define('e23-travelling-el', Travelling);
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const el = document.createElement('e23-travelling-el') as any;
    el.motion = 'snappy';
    document.body.appendChild(el);
    const motionIn = (d: Document): boolean =>
      [...d.adoptedStyleSheets].some((s) => [...s.cssRules].some((r) => r.cssText.includes('data-motion'))) ||
      [...d.querySelectorAll('style')].some((s) => (s.textContent ?? '').includes('data-motion'));
    const before = motionIn(doc);
    doc.body.appendChild(doc.adoptNode(el));
    const after = motionIn(doc);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 20)));
    const removedAfterMove = removed;
    el.remove();
    await new Promise((r) => setTimeout(r, 50)); // rAF in the iframe doc or the macrotask fallback
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 20)));
    return { before, after, removedAfterMove, removed, calls, dataMotion: el.getAttribute('data-motion') };
  });
  expect(result.before).toBe(false);
  expect(result.after).toBe(true);
  expect(result.dataMotion).toBe('snappy');
  expect(result.calls).toEqual(['reinit', 'connect', 'disconnect', 'connect', 'disconnect']);
  expect(result.removedAfterMove).toBe(0);
  expect(result.removed).toBe(1);
});
