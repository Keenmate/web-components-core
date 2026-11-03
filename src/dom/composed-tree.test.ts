import { describe, expect, it } from 'vitest';
import { composedClosest, composedParent } from './composed-tree.js';

// Review 2026-11-03 (WP12): walking out of shadow roots, tested directly.
describe('composed tree', () => {
  it('composedParent steps from a shadow root child to the host', () => {
    const host = document.createElement('div');
    const inner = document.createElement('span');
    host.attachShadow({ mode: 'open' }).append(inner);
    document.body.append(host);
    expect(composedParent(inner)).toBe(host);
    expect(composedParent(host)).toBe(document.body);
    expect(composedParent(document.documentElement)).toBeNull();
    host.remove();
  });

  it('composedClosest finds a match past shadow boundaries', () => {
    const outer = document.createElement('section');
    outer.setAttribute('data-theme', 'dark');
    const host = document.createElement('div');
    const inner = document.createElement('span');
    host.attachShadow({ mode: 'open' }).append(inner);
    outer.append(host);
    document.body.append(outer);
    expect(composedClosest(inner, '[data-theme]')).toBe(outer);
    expect(composedClosest(inner, '.nope')).toBeNull();
    outer.remove();
  });
});
