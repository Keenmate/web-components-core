// @vitest-environment node
import { describe, expect, it } from 'vitest';

// Review 2026-11-03 (WP12): every published entry point must import in an environment with no
// `window` / `document` / `HTMLElement` (SSR, a Node build step) — module-level code may not
// touch the DOM. One test per subpath of package.json#exports.

describe('entry points import without a DOM', () => {
  it('has no DOM here', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it.each([
    ['.', './index.js'],
    ['./testing', './testing/index.js'],
    ['./cem', './cem/index.js'],
    ['./positioning', './positioning/index.js'],
    ['./actions', './actions/index.js'],
    ['./search', './search/index.js'],
    ['./menu', './menu/index.js'],
    ['./dialog', './dialog/index.js'],
    ['./locale', './locale/index.js'],
    ['./a11y', './a11y/index.js'],
  ])('%s', async (_subpath, file) => {
    const mod = await import(file);
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  // Naming review 2026-11-23 §1: one entry point per symbol; §7 internals are not public.
  it('every runtime export has exactly one entry point, and no internal leaks', async () => {
    const files = ['./index.js', './testing/index.js', './cem/index.js', './positioning/index.js', './actions/index.js',
      './search/index.js', './menu/index.js', './dialog/index.js', './locale/index.js', './a11y/index.js'];
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of files) {
      for (const name of Object.keys(await import(file))) {
        if (seen.has(name)) duplicates.push(`${name}: ${seen.get(name)} + ${file}`);
        else seen.set(name, file);
      }
    }
    expect(duplicates).toEqual([]);
    const internals = ['defaultEventProperty', 'normalizeEventDefs', 'publishLoaderHook', 'publishIconHook',
      'publishLocaleHooks', 'coreLogging', 'parseLogLevel', 'toLogLevelNumber', 'resolveEnumAttribute'];
    expect(internals.filter((name) => seen.has(name))).toEqual([]);
    expect(seen.get('escapeHtml')).toBe('./index.js');
    expect(seen.get('createFocusTrap')).toBe('./a11y/index.js');
    expect(seen.get('getTabbables')).toBe('./a11y/index.js');
  });

  it('page-wide helpers are no-ops without a DOM', async () => {
    const core = await import('./index.js');
    expect(() => core.lockBodyScroll()()).not.toThrow();
    expect(() => core.dismissAllOverlays()).not.toThrow();
    expect(core.getEnvironment()).toBeTruthy();
    expect('normalizeSearchText' in core).toBe(false); // /search is its own subpath
  });
});
