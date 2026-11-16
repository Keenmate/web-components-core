import { afterEach, describe, expect, it } from 'vitest';
import { isMotionOff, parseCssTimeMs, readCssDurationMs, readCssLengthPx, readScrollBehavior } from './css-values.js';

afterEach(() => document.body.replaceChildren());

function el(style: string): HTMLElement {
  const div = document.createElement('div');
  div.setAttribute('style', style);
  document.body.append(div);
  return div;
}

describe('css values', () => {
  it('parseCssTimeMs reads s / ms / 0 and rejects the rest', () => {
    expect(parseCssTimeMs('0.15s')).toBe(150);
    expect(parseCssTimeMs('250ms')).toBe(250);
    expect(parseCssTimeMs(' 0 ')).toBe(0);
    expect(parseCssTimeMs('.5S')).toBe(500);
    expect(parseCssTimeMs('5')).toBeUndefined();
    expect(parseCssTimeMs('')).toBeUndefined();
    expect(parseCssTimeMs('var(--x)')).toBeUndefined();
  });

  it('readCssDurationMs resolves a token at the element, else the fallback', () => {
    // jsdom doesn't inherit custom properties; browsers do (the reason it takes the element).
    const host = el('--xx-transition-normal: 0.2s');
    expect(readCssDurationMs(host, '--xx-transition-normal')).toBe(200);
    expect(readCssDurationMs(host, '--xx-missing', 120)).toBe(120);
  });

  it('isMotionOff follows --base-duration-normal', () => {
    expect(isMotionOff(el(''))).toBe(false);
    expect(isMotionOff(el('--base-duration-normal: 0s'))).toBe(true);
    expect(isMotionOff(el('--base-duration-normal: 0.15s'))).toBe(false);
  });

  it('readScrollBehavior: component token, then the base token, then smooth', () => {
    expect(readScrollBehavior(el(''))).toBe('smooth');
    expect(readScrollBehavior(el('--base-scroll-behavior: auto'))).toBe('auto');
    expect(readScrollBehavior(el('--base-scroll-behavior: auto; --xx-scroll-behavior: smooth'), '--xx-scroll-behavior')).toBe('smooth');
    expect(readScrollBehavior(el('--base-scroll-behavior: auto'), '--xx-scroll-behavior')).toBe('auto');
  });

  it('readCssLengthPx falls back without the property or without layout (jsdom)', () => {
    expect(readCssLengthPx(el(''), '--xx-h', 24)).toBe(24);
    const host = el('--xx-h: 2rem');
    expect(readCssLengthPx(host, '--xx-h', 7)).toBe(7); // jsdom: no layout
    expect(host.childElementCount).toBe(0); // probe removed
  });
});
