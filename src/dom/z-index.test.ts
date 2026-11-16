import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Z_INDEX } from './z-index.js';

const parse = (v: string): { token: string; fallback: number } => {
  const m = /^var\((--base-z-[a-z-]+), (\d+)\)$/.exec(v);
  if (!m) throw new Error(`not a tier: ${v}`);
  return { token: m[1] as string, fallback: Number(m[2]) };
};

describe('Z_INDEX', () => {
  it('maps each tier onto its --base-z-* token with the base-css-variables default', () => {
    expect(Z_INDEX).toEqual({
      modalBackdrop: 'var(--base-z-modal-backdrop, 6000)',
      modal: 'var(--base-z-modal, 7000)',
      dropdown: 'var(--base-z-dropdown, 7500)',
      popover: 'var(--base-z-popover, 7600)',
      toast: 'var(--base-z-toast, 8000)',
      tooltip: 'var(--base-z-tooltip, 9000)',
    });
  });

  it('orders the fallbacks: anything opened inside a modal stacks above it', () => {
    const order = ['modalBackdrop', 'modal', 'dropdown', 'popover', 'toast', 'tooltip'] as const;
    const values = order.map((tier) => parse(Z_INDEX[tier]).fallback);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });

  // base-css-variables is the reference for the values; checked when it sits next to core.
  let baseCss = '';
  try {
    baseCss = readFileSync(resolve(process.cwd(), '../base-css-variables/base-variables.css'), 'utf8');
  } catch {
    // not checked out next to core
  }

  it.skipIf(!baseCss.includes('--base-z-'))('fallbacks match base-css-variables', () => {
    for (const value of Object.values(Z_INDEX)) {
      const { token, fallback } = parse(value);
      expect(baseCss, token).toMatch(new RegExp(`${token}:\\s*${fallback}\\s*;`));
    }
  });
});
