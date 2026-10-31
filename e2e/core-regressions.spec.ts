import { test, expect } from './fixtures';

// Real-browser regressions for core behaviour jsdom can't reproduce. Each test
// imports core straight from /src (the Vite dev server) on a blank example page.

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

test('el.form is null on a BlissElement that is NOT form-associated (no throw, no internals)', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { BlissElement, define } = await import('/src/index.ts');
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
    const { observeEnvironment, observeViewport } = await import('/src/index.ts');
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
    const { observeThemeContext } = await import('/src/index.ts');
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
