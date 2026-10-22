import { describe, expect, it, vi } from 'vitest';
import { NO_SEARCH_TERM, createRegexCompiler, matchesSearchTerm, prepareSearchTerm } from './index.js';
import type { PrepareSearchTermOptions } from './index.js';

const opts = (over: Partial<PrepareSearchTermOptions> = {}): PrepareSearchTermOptions => ({
  behavior: 'normalized',
  match: 'contains',
  regex: createRegexCompiler(),
  ...over,
});

describe('createRegexCompiler', () => {
  it('compiles without flags and keeps the last valid pattern', () => {
    const c = createRegexCompiler();
    expect(c.compile('^(Ústí|')).toBeNull();
    const re = c.compile('^(Ústí|Nové)');
    expect(re?.flags).toBe('');
    expect(c.compile('^(Ústí|Nové')).toBe(re);
    c.reset();
    expect(c.compile('(')).toBeNull();
  });
});

describe('prepareSearchTerm (default)', () => {
  it('trims and normalizes per behavior', () => {
    expect(prepareSearchTerm('  Čes ', opts())).toEqual({ kind: 'text', text: 'ces' });
    expect(prepareSearchTerm('Čes', opts({ behavior: 'case-insensitive' }))).toEqual({ kind: 'text', text: 'čes' });
    expect(prepareSearchTerm('Čes', opts({ behavior: 'exact' }))).toEqual({ kind: 'text', text: 'Čes' });
  });

  it('empty or whitespace → none', () => {
    expect(prepareSearchTerm('', opts())).toBe(NO_SEARCH_TERM);
    expect(prepareSearchTerm('   ', opts())).toBe(NO_SEARCH_TERM);
  });

  it('regex match compiles the trimmed term without normalizing it', () => {
    const t = prepareSearchTerm(' ^Ústí ', opts({ match: 'regex' }));
    expect(t.kind).toBe('regex');
    expect(t.kind === 'regex' && t.re.source).toBe('^Ústí');
  });

  it('an invalid pattern reuses the last valid one, none before any', () => {
    const o = opts({ match: 'regex' });
    expect(prepareSearchTerm('(', o)).toBe(NO_SEARCH_TERM);
    const valid = prepareSearchTerm('Br', o);
    expect(prepareSearchTerm('Br(', o)).toEqual(valid);
  });
});

describe('prepareSearchTerm (prepare callback)', () => {
  it('a string is used as-is, not normalized again', () => {
    expect(prepareSearchTerm('x', opts({ prepare: () => 'ČES' }))).toEqual({ kind: 'text', text: 'ČES' });
  });

  it('a string with match regex is compiled', () => {
    const t = prepareSearchTerm('x', opts({ match: 'regex', prepare: () => 'a+' }));
    expect(t.kind === 'regex' && t.re.source).toBe('a+');
  });

  it('a RegExp is made stateless', () => {
    const t = prepareSearchTerm('ha-324/56', opts({ prepare: () => /ha[^a-z0-9]*324/gi }));
    expect(t.kind === 'regex' && t.re.flags).toBe('i');
  });

  it('null / undefined / empty → none', () => {
    for (const r of [null, undefined, '']) {
      expect(prepareSearchTerm('x', opts({ prepare: () => r }))).toBe(NO_SEARCH_TERM);
    }
  });

  it('an object → none, reported via onObjectTerm', () => {
    const onObjectTerm = vi.fn();
    const obj = { zip: '33500' };
    expect(prepareSearchTerm('x', opts({ prepare: () => obj, onObjectTerm }))).toBe(NO_SEARCH_TERM);
    expect(onObjectTerm).toHaveBeenCalledWith(obj);
  });

  it('receives the untrimmed term', () => {
    const prepare = vi.fn(() => 'a');
    prepareSearchTerm(' a ', opts({ prepare }));
    expect(prepare).toHaveBeenCalledWith(' a ');
  });
});

describe('matchesSearchTerm', () => {
  it('none matches everything', () => {
    expect(matchesSearchTerm(NO_SEARCH_TERM, 'contains', '', '')).toBe(true);
  });

  it('text tests the prepared value per match mode', () => {
    const term = { kind: 'text', text: 'kru' } as const;
    expect(matchesSearchTerm(term, 'contains', 'cesky krumlov', 'Český Krumlov')).toBe(true);
    expect(matchesSearchTerm(term, 'starts-with', 'cesky krumlov', 'Český Krumlov')).toBe(false);
    expect(matchesSearchTerm(term, 'word-starts-with', 'cesky krumlov', 'Český Krumlov')).toBe(true);
  });

  it('regex tests the raw value', () => {
    const term = { kind: 'regex', re: /^Čes/ } as const;
    expect(matchesSearchTerm(term, 'regex', 'cesky', 'Český')).toBe(true);
    expect(matchesSearchTerm(term, 'regex', 'Český', 'cesky')).toBe(false);
  });

  it('computes lazy values only when the term needs them', () => {
    const prepared = vi.fn(() => 'abc');
    const raw = vi.fn(() => 'ABC');
    matchesSearchTerm({ kind: 'text', text: 'b' }, 'contains', prepared, raw);
    expect([prepared.mock.calls.length, raw.mock.calls.length]).toEqual([1, 0]);
    matchesSearchTerm({ kind: 'regex', re: /B/ }, 'regex', prepared, raw);
    expect([prepared.mock.calls.length, raw.mock.calls.length]).toEqual([1, 1]);
  });
});
