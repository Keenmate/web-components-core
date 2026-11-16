import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRtl } from './direction.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('isRtl', () => {
  it('null / no dir → false', () => {
    expect(isRtl(null)).toBe(false);
    const el = document.createElement('span');
    document.body.append(el);
    expect(isRtl(el)).toBe(false);
  });

  it('without a computed direction (jsdom): the nearest dir attribute, across shadow roots', () => {
    document.body.innerHTML = '<section dir="RTL"><div id="host"></div></section>';
    const host = document.getElementById('host')!;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<span id="inner"></span><p dir="ltr"><b id="ltr"></b></p>';
    expect(isRtl(root.getElementById('inner'))).toBe(true);
    expect(isRtl(root.getElementById('ltr'))).toBe(false);
  });

  it('a computed direction wins (a CSS direction rule, dir="auto")', () => {
    document.body.innerHTML = '<div dir="rtl"><span id="s"></span></div>';
    const s = document.getElementById('s')!;
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'ltr' } as CSSStyleDeclaration);
    expect(isRtl(s)).toBe(false);
  });
});
