import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { define } from '../element/define.js';
import { getPageMotion, MOTION_CSS, observePageMotion, publishMotionHook } from './motion.js';

// Review 2026-11-03 V-19 #3 (motion test gaps). Computed durations are e2e (e2e/motion.spec.ts,
// e2e/review-gaps-v19.spec.ts); this file covers the page-wide state and adoption in jsdom.

class GapMotionEl extends BlissElement {}
define('gap-motion-el', GapMotionEl as unknown as CustomElementConstructor);

/** All MOTION_CSS text adopted into a root (constructable sheets or the <style> fallback). */
function hasPresets(root: Document | ShadowRoot): boolean {
  const sheets = (root.adoptedStyleSheets ?? []).flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join('\n');
  const styles = [...root.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
  return sheets.includes('data-motion') || styles.includes(MOTION_CSS);
}

afterEach(() => {
  publishMotionHook();
  window.components!.motion = 'auto';
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('V-19 #3 — listener isolation (V-07)', () => {
  it('a throwing page-motion listener is logged; the other listeners and <html> still follow', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const offBad = observePageMotion(() => {
      throw new Error('boom');
    });
    const seen: string[] = [];
    const offGood = observePageMotion((level) => seen.push(level));
    expect(() => {
      window.components!.motion = 'none';
    }).not.toThrow();
    expect(seen).toEqual(['none']);
    expect(document.documentElement.getAttribute('data-motion')).toBe('none');
    expect(error.mock.calls.flat().join(' ')).toContain('page motion listener threw');
    offBad();
    offGood();
  });
});

describe('V-19 #3 — window.components replaced after load (V-08)', () => {
  it('a level set on the replacement object is adopted on the next core access (documented limitation)', () => {
    publishMotionHook();
    const original = window.components;
    try {
      (window as { components?: unknown }).components = { motion: 'snappy' }; // the page replaces the registry
      expect(getPageMotion()).toBe('snappy'); // a core read re-publishes the accessor and adopts the value
      expect(document.documentElement.getAttribute('data-motion')).toBe('snappy');
      expect(Object.getOwnPropertyDescriptor(window.components!, 'motion')?.get).toBeTypeOf('function');
      expect(Object.keys(window.components!)).not.toContain('motion');
      window.components!.motion = 'none'; // the accessor on the NEW object works
      expect(document.documentElement.getAttribute('data-motion')).toBe('none');
      window.components!.motion = 'auto';
    } finally {
      (window as { components?: unknown }).components = original;
    }
  });

  it('a component connecting after the replacement also re-publishes it', () => {
    publishMotionHook();
    const original = window.components;
    try {
      (window as { components?: unknown }).components = { motion: 'smooth' };
      document.body.append(document.createElement('gap-motion-el'));
      expect(document.documentElement.getAttribute('data-motion')).toBe('smooth');
      window.components!.motion = 'auto';
    } finally {
      (window as { components?: unknown }).components = original;
    }
  });
});

describe('V-19 #3 — two copies of core', () => {
  it('one window.components.motion assignment reaches the listeners of both copies (shared listener set)', async () => {
    publishMotionHook();
    const seenA: string[] = [];
    const offA = observePageMotion((l) => seenA.push(l));
    vi.resetModules();
    const other = await import('./motion.js'); // another bundle
    expect(other.observePageMotion).not.toBe(observePageMotion);
    const seenB: string[] = [];
    const offB = other.observePageMotion((l) => seenB.push(l));
    window.components!.motion = 'snappy';
    expect(seenA).toEqual(['snappy']);
    expect(seenB).toEqual(['snappy']);
    expect(other.getPageMotion()).toBe('snappy');
    expect(document.documentElement.getAttribute('data-motion')).toBe('snappy'); // written once, by whichever writer
    offA();
    offB();
  });

  it('an element of the second copy follows the page level written through the first copy', async () => {
    vi.resetModules();
    const otherBase = await import('../element/bliss-element.js');
    const otherDefine = await import('../element/define.js');
    class OtherEl extends otherBase.BlissElement {}
    otherDefine.define('gap-motion-other', OtherEl as unknown as CustomElementConstructor);
    const own = document.createElement('gap-motion-other');
    own.setAttribute('motion', 'smooth');
    const plain = document.createElement('gap-motion-other');
    document.body.append(own, plain);
    window.components!.motion = 'none';
    expect(document.documentElement.getAttribute('data-motion')).toBe('none');
    expect(own.getAttribute('data-motion')).toBe('smooth'); // its own level still wins
    expect(plain.hasAttribute('data-motion')).toBe(false); // inherits the page level from <html>
  });
});

describe('V-19 #3 — an element moved from the document into a shadow root', () => {
  it('re-adopts the presets into the new root on reconnect', () => {
    const el = document.createElement('gap-motion-el');
    document.body.append(el);
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    expect(hasPresets(root)).toBe(false);
    root.append(el); // a DOM move: disconnect → connect in the new root
    expect(hasPresets(root)).toBe(true);
    el.setAttribute('motion', 'none');
    expect(el.getAttribute('data-motion')).toBe('none');
  });
});
// V-10 (page level + a section data-motion, closest wins): e2e/motion.spec.ts
// 'closest wins: element, then section, then page (window.components.motion on <html>), then own speed'.
