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
  ])('%s', async (_subpath, file) => {
    const mod = await import(file);
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('page-wide helpers are no-ops without a DOM', async () => {
    const core = await import('./index.js');
    expect(() => core.lockBodyScroll()()).not.toThrow();
    expect(() => core.dismissAllOverlays()).not.toThrow();
    expect(core.getEnvironment()).toBeTruthy();
    expect('normalizeSearchText' in core).toBe(false); // /search is its own subpath
  });
});
