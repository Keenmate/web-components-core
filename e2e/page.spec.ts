import { test, expect } from './fixtures';
import type { Page } from './fixtures';

/**
 * Page-wide controls: window.components registry (SPEC §12.3), logging (§12.1), the
 * shared loader (§12.14), style injection (§12.8).
 *
 * Covered:
 *   - PG01 registry: tag entries only (logging / renderLoadingCallback non-enumerable), an entry
 *     created by a classic script BEFORE core loaded is adopted (same object, props kept),
 *     version()/config/logging, getInstances() tracks connect order (add / move re-tracks last /
 *     remove), shouldAutoDefine:false + entry.register(), getRegisteredTags()
 *   - PG02 logging: every bundle defaults to warn; instance loggers labelled [FXPG:CAT] #id;
 *     core's invalid-attribute warning routed to the element's INIT logger (reflected value
 *     written back) or to CORE:ELEMENT for a tag without a bundle; page switch
 *     (enable/disable, CORE included), per instance enable, per tag level, per category
 *   - PG03 loader: instance hook > page hook > default <span class="<prefix>-loader"> with
 *     role/aria-label; a throwing instance hook is logged and falls back to the default (the
 *     previous hook's cleanup runs); remove() restores the container (attributes + children)
 *   - PG04 adoptStyles shares one CSSStyleSheet across instances; createStyleSlot replaces in
 *     place and null removes it
 *
 * Fixture: test/page-wide.html (inline classic script pre-creates the early registry entry)
 */

const PAGE = '/test/page-wide.html';

type Line = { level: string; text: string };
type PgEl = HTMLElement & {
  isReady: boolean;
  isLoading: boolean;
  isLoggingEnabled: boolean;
  renderLoadingCallback: unknown;
  customStylesCallback: unknown;
  logSample(): void;
  startLoading(): void;
  stopLoading(): void;
  enableLogging(level?: string): void;
  disableLogging(): void;
  flush(): void;
};
type Entry = Record<string, unknown> & {
  version(): string;
  config: { name: string };
  logging?: { setLogLevel(l: string): void; setCategoryLevel(c: string, l: string): void };
  getInstances(): HTMLElement[];
  register(): void;
};
type Reg = Record<string, Entry> & {
  logging: { enableLogging(): void; disableLogging(): void; setLogLevel(l: string): void };
  renderLoadingCallback: unknown;
};
type Fx = {
  captureConsole(fn: () => void): Line[];
  levels(): { FXPG: Record<string, string>; CORE: Record<string, string> };
  getRegisteredTags(): string[];
  getInstances(tag: string): HTMLElement[];
  ids(list: HTMLElement[]): string[];
  loaderHooks: Record<string, unknown>;
  loaderState(el: HTMLElement): { isLoading: boolean; drawnBy: string | null; role: string | null; ariaLabel: string | null; children: number };
  hookLog: string[];
};
type W = { fx: Fx; components: Reg; __earlyEntry: unknown };

/** Run `body` in the page with (fx, registry, $) and return the console lines it printed. */
const capture = (page: Page, body: string) =>
  page.evaluate((src) => {
    const w = window as unknown as W;
    const $ = (id: string) => document.getElementById(id) as PgEl;
    const fn = new Function('fx', 'reg', '$', src) as (fx: Fx, reg: Reg, d: typeof $) => void;
    return w.fx.captureConsole(() => fn(w.fx, w.components, $));
  }, body);
const levels = (page: Page) => page.evaluate(() => (window as unknown as W).fx.levels());
const each = (v: string, cats: string[]) => Object.fromEntries(cats.map((c) => [c, v]));
const FX = ['INIT', 'DATA', 'UI'];
const CORE = ['ELEMENT', 'ACTIONS', 'MENU', 'THEME'];

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('body[data-ready="true"]')).toHaveCount(1);
});

test('PG01: registry entries, non-enumerable globals, adopted early entry, instance tracking, register()', async ({ page }) => {
  const read = () =>
    page.evaluate(() => {
      const { fx, components: reg, __earlyEntry } = window as unknown as W;
      return {
        keys: Object.keys(reg),
        hasLogging: 'logging' in reg,
        hasLoader: 'renderLoadingCallback' in reg,
        tags: fx.getRegisteredTags(),
        version: reg['fx-pg']!.version(),
        name: reg['fx-pg']!.config.name,
        tagLogging: !!reg['fx-pg']!.logging,
        instances: fx.ids(reg['fx-pg']!.getInstances()),
        earlyAdopted: reg['fx-pg-early'] === __earlyEntry,
        earlyNote: reg['fx-pg-early']!.note,
        earlyLogging: !!reg['fx-pg-early']!.logging,
        earlyDefined: !!customElements.get('fx-pg-early'),
        earlyInstances: fx.ids(fx.getInstances('fx-pg-early')),
      };
    });
  expect(await read()).toEqual({
    keys: ['fx-pg-early', 'fx-pg'],
    hasLogging: true,
    hasLoader: true,
    tags: ['fx-pg'],
    version: '0.0.0-test',
    name: 'fx-pg',
    tagLogging: true,
    instances: ['pg-a', 'pg-b', 'pg-load-a', 'pg-load-b'],
    earlyAdopted: true,
    earlyNote: 'set before core loaded',
    earlyLogging: false,
    earlyDefined: false,
    earlyInstances: [],
  });

  await page.evaluate(() => {
    const el = document.createElement('fx-pg');
    el.id = 'pg-x1';
    document.getElementById('stage')!.insertBefore(el, document.getElementById('pg-early'));
  });
  expect((await read()).instances).toEqual(['pg-a', 'pg-b', 'pg-load-a', 'pg-load-b', 'pg-x1']);
  await page.evaluate(() => document.getElementById('stage')!.insertBefore(document.getElementById('pg-a')!, document.getElementById('pg-early'))); // move: re-tracked once, now last
  expect((await read()).instances).toEqual(['pg-b', 'pg-load-a', 'pg-load-b', 'pg-x1', 'pg-a']);
  await page.evaluate(() => document.getElementById('pg-x1')!.remove());
  expect((await read()).instances).toEqual(['pg-b', 'pg-load-a', 'pg-load-b', 'pg-a']);

  await page.evaluate(() => (window as unknown as W).components['fx-pg-early']!.register());
  expect(await read()).toMatchObject({ earlyDefined: true, earlyInstances: ['pg-early'], tags: ['fx-pg', 'fx-pg-early'] });
  await expect(page.locator('#pg-early')).toHaveJSProperty('isReady', true);
});

test('PG02: default warn; core messages routed; page switch, per tag, per instance', async ({ page }) => {
  expect(await levels(page)).toEqual({ FXPG: each('warn', FX), CORE: each('warn', CORE) });

  expect(await capture(page, "$('pg-a').logSample()")).toEqual([
    { level: 'warn', text: '[FXPG:UI] #pg-a warn line (UI)' },
    { level: 'error', text: '[FXPG:UI] #pg-a error line (UI)' },
  ]);

  // Core's invalid-attribute warning goes through the element's INIT logger; reflected → written back.
  let lines = await capture(page, "$('pg-a').setAttribute('tone', 'nope')");
  expect(lines).toHaveLength(1);
  expect(lines[0]!.level).toBe('warn');
  expect(lines[0]!.text).toMatch(/^\[FXPG:INIT\] #pg-a .*tone/);
  await expect(page.locator('#pg-a')).toHaveAttribute('tone', 'info');

  // A tag with no logging bundle → CORE:ELEMENT, labelled tag#id.
  await page.evaluate(() => (window as unknown as W).components['fx-pg-early']!.register());
  lines = await capture(page, "$('pg-early').setAttribute('tone', 'nope')");
  expect(lines.map((l) => l.text).join('\n')).toMatch(/\[CORE:ELEMENT\] fx-pg-early#pg-early .*tone/);

  // Page-wide: debug everywhere, CORE included.
  await capture(page, 'reg.logging.enableLogging()');
  expect(await levels(page)).toEqual({ FXPG: each('debug', FX), CORE: each('debug', CORE) });
  expect(await capture(page, "$('pg-b').logSample()")).toHaveLength(4);

  // Silence everything, then make ONE instance loud.
  await capture(page, 'reg.logging.disableLogging()');
  expect((await levels(page)).FXPG).toEqual(each('silent', FX));
  expect(await capture(page, "$('pg-a').setAttribute('tone', 'nope')")).toEqual([]);
  await capture(page, "$('pg-a').enableLogging('debug')");
  expect(await page.evaluate(() => ['pg-a', 'pg-b'].map((id) => (document.getElementById(id) as PgEl).isLoggingEnabled))).toEqual([true, false]);
  expect(await capture(page, "$('pg-a').logSample()")).toHaveLength(4);
  expect(await capture(page, "$('pg-b').logSample()")).toEqual([]);
  await capture(page, "$('pg-a').disableLogging()");

  // Per tag wins for that tag; per category.
  await capture(page, "reg['fx-pg'].logging.setLogLevel('error')");
  expect(await levels(page)).toEqual({ FXPG: each('error', FX), CORE: each('silent', CORE) });
  await capture(page, "reg['fx-pg'].logging.setCategoryLevel('FXPG:DATA', 'debug')");
  expect((await levels(page)).FXPG).toEqual({ INIT: 'error', DATA: 'debug', UI: 'error' });
  expect(await capture(page, "$('pg-b').logSample()")).toEqual([
    { level: 'info', text: '[FXPG:DATA] #pg-b info line (DATA)' },
    { level: 'error', text: '[FXPG:UI] #pg-b error line (UI)' },
  ]);

  // The closest level wins: a page call made later doesn't overwrite the tag's own level.
  await capture(page, "reg.logging.setLogLevel('info')");
  expect(await levels(page)).toEqual({ FXPG: { INIT: 'error', DATA: 'debug', UI: 'error' }, CORE: each('info', CORE) });
  await capture(page, "reg['fx-pg'].logging.resetLogging()");
  expect((await levels(page)).FXPG).toEqual(each('info', FX)); // follows the page again

  // An element's own level can also be quieter than its type; resetLogging() hands it back.
  await capture(page, "$('pg-a').resetLogging()");
  expect(await capture(page, "$('pg-a').logSample()")).toHaveLength(3); // info, warn, error
  await capture(page, "$('pg-a').enableLogging('error')");
  expect(await capture(page, "$('pg-a').logSample()")).toEqual([{ level: 'error', text: '[FXPG:UI] #pg-a error line (UI)' }]);
  await capture(page, "$('pg-a').resetLogging()");

  // Back to nothing set: the built-in warn everywhere.
  await capture(page, 'reg.logging.resetLogging()');
  expect(await levels(page)).toEqual({ FXPG: each('warn', FX), CORE: each('warn', CORE) });
});

test('PG03: loader precedence instance > page > default; throwing hook → default; remove() restores', async ({ page }) => {
  const state = () =>
    page.evaluate(() => {
      const { fx, components } = window as unknown as W;
      return {
        a: fx.loaderState(document.getElementById('pg-load-a')!),
        b: fx.loaderState(document.getElementById('pg-load-b')!),
        pageHook: typeof components.renderLoadingCallback,
      };
    });
  /** stop both, apply `body`, start both again; returns the console lines of the restart. */
  const restart = (body: string) =>
    capture(page, `$('pg-load-a').stopLoading(); $('pg-load-b').stopLoading(); ${body}; $('pg-load-a').startLoading(); $('pg-load-b').startLoading();`);

  await restart('');
  let s = await state();
  expect(s.a).toEqual({ isLoading: true, drawnBy: 'default', role: 'status', ariaLabel: 'Loading…', children: 1 });
  expect(s.b.drawnBy).toBe('default');

  await restart('reg.renderLoadingCallback = fx.loaderHooks.page');
  s = await state();
  expect([s.a.drawnBy, s.b.drawnBy]).toEqual(['page', 'page']);
  expect(await page.evaluate(() => (window as unknown as W).fx.hookLog)).toContain('page hook fx-pg overlay Loading…');

  await restart("$('pg-load-b').renderLoadingCallback = fx.loaderHooks.bar");
  s = await state();
  expect([s.a.drawnBy, s.b.drawnBy]).toEqual(['page', 'instance']);

  const lines = await restart("$('pg-load-b').renderLoadingCallback = fx.loaderHooks.throw");
  expect(await page.evaluate(() => (window as unknown as W).fx.hookLog)).toContain('instance cleanup');
  expect(lines).toContainEqual({ level: 'error', text: expect.stringContaining('[FXPG:UI] #pg-load-b renderLoadingCallback threw — drawing the default loader') });
  s = await state();
  expect(s.b.drawnBy).toBe('default');

  await capture(page, "$('pg-load-a').stopLoading(); $('pg-load-b').stopLoading()");
  s = await state();
  for (const st of [s.a, s.b]) expect(st).toEqual({ isLoading: false, drawnBy: null, role: null, ariaLabel: null, children: 0 });

  await capture(page, 'reg.renderLoadingCallback = null');
  expect((await state()).pageHook).toBe('undefined');
});

test('PG04: adoptStyles shares one sheet; createStyleSlot replaces in place', async ({ page }) => {
  const read = () =>
    page.evaluate(() => {
      const a = document.getElementById('pg-a')!.shadowRoot!;
      const b = document.getElementById('pg-b')!.shadowRoot!;
      const slot = a.querySelectorAll('style.fxpg-custom');
      return { shared: a.adoptedStyleSheets[0] === b.adoptedStyleSheets[0] && a.adoptedStyleSheets.length > 0, count: slot.length, css: slot[0]?.textContent ?? null };
    });
  const set = (css: string | null) =>
    page.evaluate((c) => {
      const el = document.getElementById('pg-a') as PgEl;
      el.customStylesCallback = c === null ? null : () => c;
      el.flush();
    }, css);

  expect(await read()).toEqual({ shared: true, count: 0, css: null });
  await set('.pg { border: 2px dashed #dc2626; }');
  expect(await read()).toEqual({ shared: true, count: 1, css: '.pg { border: 2px dashed #dc2626; }' });
  await set('.pg { border: 4px solid #16a34a; }');
  expect(await read()).toEqual({ shared: true, count: 1, css: '.pg { border: 4px solid #16a34a; }' });
  await set(null);
  expect(await read()).toEqual({ shared: true, count: 0, css: null });
});
