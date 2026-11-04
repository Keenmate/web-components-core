import { test, expect } from './fixtures';

// Real-browser regressions for core behaviour jsdom can't reproduce:
//   - el.form on a non-form-associated BlissElement is null (no throw, no internals attached);
//   - one throwing environment listener (discrete + viewport channels) doesn't stop the others;
//   - one throwing theme listener doesn't stop the others.
//   - setAttributes() warns about a key that isn't an input (a renamed `data` → `nodes` once
//     left web-treeview's performance page with an empty tree and no error).
// Each test builds its own elements against core (window.core, loaded from /src).
//
// Fixture: test/regressions.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/regressions.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('el.form is null on a BlissElement that is NOT form-associated (no throw, no internals)', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { BlissElement, define } = (window as any).core;
    class PlainEl extends BlissElement {}
    class FormEl extends BlissElement {
      static formAssociated = true;
    }
    define('regression-plain-form-el', PlainEl);
    define('regression-form-el', FormEl);

    const form = document.createElement('form');
    const plain = document.createElement('regression-plain-form-el') as InstanceType<typeof PlainEl>;
    const associated = document.createElement('regression-form-el') as InstanceType<typeof FormEl>;
    form.append(plain, associated);
    document.body.appendChild(form);

    let plainForm: unknown = 'not read';
    let error: string | null = null;
    try {
      plainForm = plain.form;
    } catch (e) {
      error = String(e);
    }
    // The browser lets internals be attached only once: if el.form attached them,
    // this second attach throws "already attached".
    let canStillAttach = true;
    try {
      plain.attachInternals();
    } catch {
      canStillAttach = false;
    }
    const out = { error, isPlainNull: plainForm === null, canStillAttach, isAssociatedForm: associated.form === form };
    form.remove();
    return out;
  });

  expect(result.error).toBeNull();
  expect(result.isPlainNull).toBe(true);
  expect(result.canStillAttach).toBe(true);
  expect(result.isAssociatedForm).toBe(true); // the form-associated path still works
});

test('a throwing environment listener does not stop the others (discrete + viewport channels)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(async () => {
    const { observeEnvironment, observeViewport } = (window as any).core;
    const w = window as unknown as { seen: { discrete: string[]; viewport: number[] }; errors: string[] };
    w.seen = { discrete: [], viewport: [] };
    w.errors = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      w.errors.push(args.map(String).join(' '));
      original(...args);
    };
    const opts = { shouldFireImmediately: false };
    observeEnvironment(() => {
      throw new Error('boom');
    }, opts);
    observeEnvironment((env) => w.seen.discrete.push(env.breakpoint), opts);
    observeViewport(() => {
      throw new Error('boom');
    }, opts);
    observeViewport((env) => w.seen.viewport.push(env.viewportWidth), opts);
  });

  await page.setViewportSize({ width: 700, height: 800 }); // desktop → mobile bucket

  await expect.poll(() => page.evaluate(() => (window as any).seen.discrete)).toEqual(['mobile']);
  await expect.poll(() => page.evaluate(() => (window as any).seen.viewport.at(-1))).toBe(700);
  const errors: string[] = await page.evaluate(() => (window as any).errors);
  expect(errors.some((e) => e.includes('environment listener threw'))).toBe(true);
});

test('a throwing theme listener does not stop the others', async ({ page }) => {
  await page.evaluate(async () => {
    const { observeThemeContext } = (window as any).core;
    const w = window as unknown as { themes: (string | null)[] };
    w.themes = [];
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    observeThemeContext(a, undefined, (scheme) => {
      if (scheme === 'dark') throw new Error('boom');
    });
    observeThemeContext(b, undefined, (scheme) => w.themes.push(scheme));
    document.documentElement.setAttribute('data-theme', 'light');
  });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect.poll(() => page.evaluate(() => (window as any).themes.at(-1))).toBe('dark');
});

test('setAttributes() warns about a key that is not an input instead of dropping it silently', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { BlissElement, define, toText } = (window as any).core;
    class RenamedEl extends BlissElement {
      static inputs = [{ configKey: 'label', attribute: 'label', converter: toText({ default: '' }) }];
      updates: unknown[] = [];
      protected update(partial: unknown) { this.updates.push(partial); }
    }
    define('regression-renamed-el', RenamedEl);
    const el = document.createElement('regression-renamed-el') as InstanceType<typeof RenamedEl>;
    document.body.appendChild(el);
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    try {
      el.setAttributes({ data: [{ id: 1 }], label: 'ok' });
    } finally {
      console.warn = original;
    }
    el.remove();
    return { warnings, updates: el.updates };
  });
  expect(result.updates).toEqual([{ label: 'ok' }]); // the real input still applies
  expect(result.warnings.some((w) => w.includes('setAttributes: "data" is not an input of <regression-renamed-el>'))).toBe(true);
});

// Review 2026-11-03 E-01: the write-back of an invalid core attribute runs while the browser
// still has the other initial attributes queued; they used to be swallowed by the reflect guard.
// Both orders: parsed before define (upgrade) and created by the parser for a defined tag.
for (const when of ['upgrade', 'defined'] as const) {
  test(`an invalid motion attribute first in markup keeps the attributes after it (${when})`, async ({ page }) => {
    const result = await page.evaluate((when) => {
      const { BlissElement, define, toText, toInt } = (window as any).core;
      const tag = `regression-motion-${when}`;
      class MotionFirst extends BlissElement {
        static inputs = [
          { configKey: 'label', attribute: 'label', converter: toText({ default: '' }) },
          { configKey: 'pageSize', attribute: 'page-size', converter: toInt({ default: 1 }) },
        ];
      }
      const original = console.warn;
      console.warn = () => {};
      try {
        const host = document.createElement('div');
        document.body.appendChild(host);
        if (when === 'defined') define(tag, MotionFirst);
        host.innerHTML = `<${tag} motion="bogus" label="hi" page-size="5"></${tag}>`;
        if (when === 'upgrade') define(tag, MotionFirst);
        const el = host.firstElementChild as any;
        return { label: el.label, pageSize: el.pageSize, hasMotion: el.hasAttribute('motion') };
      } finally {
        console.warn = original;
      }
    }, when);
    expect(result).toEqual({ label: 'hi', pageSize: 5, hasMotion: false });
  });
}

// Review V-15: sizeChanged / observeElementSize report the LAYOUT size, not the transformed box.
test('observeElementSize reports the layout size of a scaled element (first fire and on resize)', async ({ page }) => {
  const seen = await page.evaluate(async () => {
    const { observeElementSize } = (window as any).core;
    const el = document.createElement('div');
    el.style.cssText = 'width: 200px; height: 40px; transform: scale(0.5); transform-origin: 0 0';
    document.body.appendChild(el);
    const sizes: Array<{ width: number; height: number }> = [];
    const unsub = observeElementSize(el, (size: { width: number; height: number }) => sizes.push({ ...size }), { throttleMs: 0 });
    el.style.width = '300px';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    unsub();
    const visual = el.getBoundingClientRect().width;
    el.remove();
    return { sizes, visual };
  });
  expect(seen.visual).toBe(150); // the transformed box is half as wide…
  expect(seen.sizes[0]).toEqual({ width: 200, height: 40 }); // …but the first fire is the layout size
  expect(seen.sizes.at(-1)).toEqual({ width: 300, height: 40 }); // and so is the observer's
});
