import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { createLoggers } from '../logging/create-loggers.js';
import { registerComponent } from './register-component.js';

// Review 2026-11-03 V-19 #5 (global test gaps). Cross-copy getInstances / getRegisteredTags (V-02)
// and the same tag from two copies (V-03) are in register-component.test.ts ('two copies of core on one page').

let seq = 0;
const freshTag = (): string => `gap-reg-${seq++}`;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('V-19 #5 — registerComponent with an existing NON-object window.components[tag]', () => {
  it.each([['a string', 'oops'], ['a number', 42], ['true', true], ['a function', () => 'x']])(
    '%s is replaced by the full registry entry',
    (_label, value) => {
      const tag = freshTag();
      window.components ??= {};
      (window.components as Record<string, unknown>)[tag] = value;
      class El extends BlissElement {}
      const entry = registerComponent(tag, El as unknown as CustomElementConstructor, { config: { name: 'x', version: '3' } });
      expect(window.components![tag]).toBe(entry);
      expect(entry.version()).toBe('3');
      expect(typeof entry.register).toBe('function');
      expect(customElements.get(tag)).toBe(El);
      const el = document.createElement(tag);
      document.body.append(el);
      expect(entry.getInstances()).toEqual([el]);
    },
  );
});

describe('V-19 #5 — registerComponent after the page replaced window.components', () => {
  it('puts its entry on the new object and re-publishes the page-wide accessors there', () => {
    const original = window.components;
    try {
      (window as { components?: unknown }).components = { motion: 'none' }; // a plain value, set before re-publish
      const tag = freshTag();
      class El extends BlissElement {}
      const entry = registerComponent(tag, El as unknown as CustomElementConstructor, {
        config: { name: 'x', version: '1' },
        logging: createLoggers(`GAPREG${seq}`),
      });
      const components = window.components!;
      expect(components[tag]).toBe(entry);
      expect(entry.logging).toBeDefined();
      expect(Object.getOwnPropertyDescriptor(components, 'logging')?.value?.enableLogging).toBeTypeOf('function');
      for (const key of ['motion', 'renderLoadingCallback', 'responsive', 'responsiveCallback']) {
        expect(Object.getOwnPropertyDescriptor(components, key)?.get, key).toBeTypeOf('function');
      }
      expect(Object.keys(components)).toEqual([tag]); // the settings stay non-enumerable
      expect(components.motion).toBe('none'); // the pre-set plain value was adopted
      expect(document.documentElement.getAttribute('data-motion')).toBe('none');
      components.motion = 'auto';
    } finally {
      (window as { components?: unknown }).components = original;
    }
  });
});
