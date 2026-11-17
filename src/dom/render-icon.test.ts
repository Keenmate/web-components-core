import { describe, expect, it } from 'vitest';
import { renderIcon } from './render-icon.js';

describe('renderIcon', () => {
  it('markup raw, a name masked from its token, anything else escaped text', () => {
    expect(renderIcon('<svg viewBox="0 0 1 1"></svg>')).toBe('<svg viewBox="0 0 1 1"></svg>');
    expect(renderIcon('gear', { prefix: 'cp' })).toBe(
      '<span class="km-icon cp__icon cp__icon--gear" style="--_km-icon: var(--base-icon-gear, linear-gradient(transparent 0 0))" aria-hidden="true"></span>',
    );
    expect(renderIcon('chevron-right')).toContain('var(--base-icon-chevron-right,');
    expect(renderIcon('🚀')).toBe('🚀');
    expect(renderIcon('a"><img src=x onerror=1>')).not.toContain('<img');
    expect(renderIcon('  ')).toBe('');
    expect(renderIcon(null)).toBe('');
  });
});
