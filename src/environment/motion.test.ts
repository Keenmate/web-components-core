import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { define } from '../element/define.js';
import { toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import { getPageMotion, MOTION_CSS, MOTION_PRESETS, observePageMotion, publishMotionHook } from './motion.js';

// jsdom: attributes, the page-wide accessor, adoption. Computed durations, nested shadow roots and
// the OS reduced-motion rule are checked in a real browser (e2e/motion.spec.ts).

class MotionEl extends BlissElement {
  protected static override inputs: readonly InputDef[] = [{ configKey: 'label', attribute: 'label', converter: toText() }];
}
define('motion-el', MotionEl as unknown as CustomElementConstructor);

const make = (attrs: Record<string, string> = {}): MotionEl => {
  const el = document.createElement('motion-el') as MotionEl;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
};

afterEach(() => {
  publishMotionHook();
  window.components!.motion = 'auto';
  document.body.innerHTML = '';
});

describe('motion — instance level', () => {
  it('defaults to auto and writes no data-motion', () => {
    const el = make();
    expect(el.motion).toBe('auto');
    expect(el.hasAttribute('data-motion')).toBe(false);
  });

  it('the attribute sets the level and core mirrors it to data-motion', () => {
    const el = make({ motion: 'none' });
    expect(el.motion).toBe('none');
    expect(el.getAttribute('data-motion')).toBe('none');
    el.removeAttribute('motion');
    expect(el.motion).toBe('auto');
    expect(el.hasAttribute('data-motion')).toBe(false);
  });

  it('the property reflects to the attribute', () => {
    const el = make();
    el.motion = 'snappy';
    expect(el.getAttribute('motion')).toBe('snappy');
    expect(el.getAttribute('data-motion')).toBe('snappy');
    el.motion = 'auto';
    expect(el.hasAttribute('motion')).toBe(false);
  });

  it('an invalid attribute warns, keeps the previous level and writes it back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make({ motion: 'smooth' });
    el.setAttribute('motion', 'fast');
    expect(el.motion).toBe('smooth');
    expect(el.getAttribute('motion')).toBe('smooth');
    expect(warn.mock.calls.flat().join(' ')).toMatch(/motion="fast"/);
    warn.mockRestore();
  });

  it('an invalid property warns and keeps the level', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make({ motion: 'none' });
    (el as unknown as { motion: string }).motion = 'turbo';
    expect(el.motion).toBe('none');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('setAttributes accepts motion', () => {
    const el = make();
    el.setAttributes({ motion: 'smooth' });
    expect(el.getAttribute('data-motion')).toBe('smooth');
  });
});

describe('motion — page-wide window.components.motion', () => {
  // Review V-10: the page level goes on <html> (the outermost layer), never on the hosts, so a
  // closer section's data-motion wins through inheritance.
  it('is written on <html>, not on the hosts; the instance level stays on its host', () => {
    const html = document.documentElement;
    const plain = make();
    const own = make({ motion: 'smooth' });
    window.components!.motion = 'none';
    expect(html.getAttribute('data-motion')).toBe('none');
    expect(plain.hasAttribute('data-motion')).toBe(false);
    expect(own.getAttribute('data-motion')).toBe('smooth');
    window.components!.motion = 'auto';
    expect(html.hasAttribute('data-motion')).toBe(false);
  });

  it('a level assigned before any component loaded reaches <html> when core publishes', () => {
    const components = window.components as Record<string, unknown>;
    delete components.motion;
    components.motion = 'snappy'; // a plain property, as a page sets it before loading components
    make(); // connecting publishes the accessor and adopts the value
    expect(document.documentElement.getAttribute('data-motion')).toBe('snappy');
  });

  it('an author-written <html data-motion> comes back when the page level returns to auto', () => {
    const html = document.documentElement;
    html.setAttribute('data-motion', 'smooth');
    try {
      window.components!.motion = 'none';
      expect(html.getAttribute('data-motion')).toBe('none');
      window.components!.motion = 'auto';
      expect(html.getAttribute('data-motion')).toBe('smooth');
    } finally {
      html.removeAttribute('data-motion');
    }
  });

  it('an invalid page value reads as auto', () => {
    window.components!.motion = 'banana' as never;
    expect(getPageMotion()).toBe('auto');
  });

  it('is non-enumerable and notifies listeners', () => {
    const seen: string[] = [];
    const off = observePageMotion((level) => seen.push(level));
    window.components!.motion = 'none';
    window.components!.motion = 'none'; // unchanged → no repeat
    off();
    window.components!.motion = 'smooth';
    expect(seen).toEqual(['none']);
    expect(Object.keys(window.components!)).not.toContain('motion');
  });

  it('leaves an author-written data-motion alone while the level is auto', () => {
    const el = document.createElement('motion-el') as MotionEl;
    el.setAttribute('data-motion', 'smooth');
    document.body.appendChild(el);
    window.components!.motion = 'auto';
    expect(el.getAttribute('data-motion')).toBe('smooth');
  });
});

describe('motion — presets', () => {
  it('connecting adopts the presets into the root the element lives in', () => {
    make();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('motion-el');
    root.appendChild(inner);
    const text = (sheets: readonly CSSStyleSheet[] | undefined, styles: Iterable<Element>) =>
      [...(sheets ?? []).flatMap((s) => [...s.cssRules].map((r) => r.cssText)), ...[...styles].map((s) => s.textContent ?? '')].join('\n');
    expect(text(document.adoptedStyleSheets, document.querySelectorAll('style'))).toContain('data-motion');
    expect(text(root.adoptedStyleSheets, root.querySelectorAll('style'))).toContain('data-motion');
  });

  it('MOTION_CSS: the reduced-motion block comes after the presets (so the OS wins)', () => {
    expect(MOTION_CSS.indexOf('prefers-reduced-motion')).toBeGreaterThan(MOTION_CSS.indexOf('[data-motion="smooth"]'));
    expect(MOTION_PRESETS.none).toEqual(['0s', '0s', '0s', '0s']);
  });

  // base-css-variables is the reference for the preset values; checked when it sits next to core.
  let baseCss = '';
  try {
    baseCss = readFileSync(resolve(process.cwd(), '../base-css-variables/base-variables.css'), 'utf8');
  } catch {
    // not checked out next to core
  }
  // One rule per level, selector on its own (`[data-motion="snappy"] {`), not a comment mention.
  const presetBlock = (level: string): string =>
    baseCss.match(new RegExp(`^\\s*\\[data-motion="${level}"\\]\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declares = (block: string, name: string, value: string): boolean =>
    new RegExp(`${name}:\\s*${escape(value)}\\s*;`).test(block);

  it.skipIf(!/\[data-motion=/.test(baseCss))('presets match base-css-variables (speeds and scroll behaviour)', () => {
    for (const [level, [fast, normal, medium, slow]] of Object.entries(MOTION_PRESETS)) {
      const block = presetBlock(level);
      expect(block, `${level} block`).not.toBe('');
      expect(declares(block, '--base-duration-fast', fast), `${level} fast`).toBe(true);
      expect(declares(block, '--base-duration-normal', normal), `${level} normal`).toBe(true);
      expect(declares(block, '--base-duration-medium', medium), `${level} medium`).toBe(true);
      expect(declares(block, '--base-duration-slow', slow), `${level} slow`).toBe(true);
      expect(declares(block, '--base-scroll-behavior', level === 'none' ? 'auto' : 'smooth'), `${level} scroll`).toBe(true);
    }
  });
});

// Review 2026-11-03 V-04.
describe('adoptMotionStyles — page-level data-motion', () => {
  it('an element inside a shadow root also adopts the presets into its document', async () => {
    const { adoptMotionStyles, MOTION_CSS } = await import('./motion.js');
    const host = document.createElement('div');
    document.body.append(host);
    const inner = document.createElement('span');
    host.attachShadow({ mode: 'open' }).append(inner);
    adoptMotionStyles(inner);
    const inDocument = [...document.querySelectorAll('style')].some((s) => s.textContent === MOTION_CSS);
    expect(inDocument).toBe(true);
    host.remove();
  });
});
