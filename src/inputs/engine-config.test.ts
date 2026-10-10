import { describe, expect, it } from 'vitest';
import { collectEngineConfig } from './engine-config.js';

describe('collectEngineConfig', () => {
  it('returns a shallow copy, not the original bag', () => {
    const config = { a: 1 };
    const out = collectEngineConfig(config);
    expect(out).toEqual({ a: 1 });
    expect(out).not.toBe(config);
    out.a = 2;
    expect(config.a).toBe(1);
  });

  it('PRESERVES null — the whole point of the contract', () => {
    const out = collectEngineConfig({ focusedNodeClass: null, label: 'x' });
    expect('focusedNodeClass' in out).toBe(true);
    expect(out.focusedNodeClass).toBe(null);
    expect(out.label).toBe('x');
  });

  it('preserves every falsy value, not just null', () => {
    const out = collectEngineConfig({ a: 0, b: '', c: false, d: undefined, e: null });
    expect(out).toEqual({ a: 0, b: '', c: false, d: undefined, e: null });
  });

  it('drops only the excluded keys', () => {
    const out = collectEngineConfig({ a: 1, theme: 'dark', onSelect: () => {} }, { exclude: ['theme', 'onSelect'] });
    expect(out).toEqual({ a: 1 });
  });

  it('exclude is not a null filter — an excluded key goes regardless of value, a null key stays', () => {
    const out = collectEngineConfig({ cleared: null, theme: null }, { exclude: ['theme'] });
    expect(out).toEqual({ cleared: null });
  });

  it('tolerates excluding a key that is not present', () => {
    expect(collectEngineConfig({ a: 1 }, { exclude: ['missing'] })).toEqual({ a: 1 });
  });

  it('accepts any iterable for exclude (e.g. a Set)', () => {
    const out = collectEngineConfig({ a: 1, b: 2, c: 3 }, { exclude: new Set(['a', 'c']) });
    expect(out).toEqual({ b: 2 });
  });
});
