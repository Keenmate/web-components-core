import { describe, expect, it } from 'vitest';
import { deepClosest, deepParent } from './composed-tree.js';

// Review 2026-11-03 (WP12): walking out of shadow roots, tested directly.
describe('composed tree', () => {
  it('deepParent steps from a shadow root child to the host', () => {
    const host = document.createElement('div');
    const inner = document.createElement('span');
    host.attachShadow({ mode: 'open' }).append(inner);
    document.body.append(host);
    expect(deepParent(inner)).toBe(host);
    expect(deepParent(host)).toBe(document.body);
    expect(deepParent(document.documentElement)).toBeNull();
    host.remove();
  });

  it('deepClosest finds a match past shadow boundaries', () => {
    const outer = document.createElement('section');
    outer.setAttribute('data-theme', 'dark');
    const host = document.createElement('div');
    const inner = document.createElement('span');
    host.attachShadow({ mode: 'open' }).append(inner);
    outer.append(host);
    document.body.append(outer);
    expect(deepClosest(inner, '[data-theme]')).toBe(outer);
    expect(deepClosest(inner, '.nope')).toBeNull();
    outer.remove();
  });
});
