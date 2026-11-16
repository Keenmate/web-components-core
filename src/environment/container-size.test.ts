import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTAINER_SIZE_TOKENS, DEFAULT_CONTAINER_SIZES, resolveContainerSize } from './container-size.js';

describe('container sizes', () => {
  it('buckets a width against the default lines (480 / 768)', () => {
    const el = document.createElement('div');
    document.body.append(el);
    expect(resolveContainerSize(el, 479)).toBe('narrow');
    expect(resolveContainerSize(el, 480)).toBe('medium');
    expect(resolveContainerSize(el, 767)).toBe('medium');
    expect(resolveContainerSize(el, 768)).toBe('wide');
    el.remove();
  });

  // base-css-variables is the reference for the values; checked when it sits next to core.
  let baseCss = '';
  try {
    baseCss = readFileSync(resolve(process.cwd(), '../base-css-variables/base-variables.css'), 'utf8');
  } catch {
    // not checked out next to core
  }

  it.skipIf(!baseCss.includes('--base-container-'))('defaults match base-css-variables', () => {
    for (const key of ['narrow', 'medium'] as const) {
      expect(baseCss).toMatch(new RegExp(`${CONTAINER_SIZE_TOKENS[key]}:\\s*${DEFAULT_CONTAINER_SIZES[key]}px\\s*;`));
    }
  });
});
