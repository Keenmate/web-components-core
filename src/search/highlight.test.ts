import { describe, expect, it } from 'vitest';
import { NO_SEARCH_TERM, createRegexCompiler, findHighlightRanges, prepareSearchTerm, wrapRanges } from './index.js';
import type { SearchBehavior, SearchMatch } from './index.js';

/** Prepare `term` the default way and return the wrapped label. */
function mark(label: string, term: string, behavior: SearchBehavior = 'normalized', match: SearchMatch = 'contains') {
  const active = prepareSearchTerm(term, { behavior, match, regex: createRegexCompiler() });
  const r = findHighlightRanges(label, active, { behavior, match });
  return wrapRanges(r.text, r.ranges);
}

describe('findHighlightRanges', () => {
  it('marks the accented original for an unaccented term', () => {
    expect(mark('Český Krumlov', 'ces')).toBe('<mark>Čes</mark>ký Krumlov');
    expect(mark('Łódź', 'lodz')).toBe('<mark>Łódź</mark>');
  });

  it('follows the behavior', () => {
    expect(mark('Český', 'ces', 'case-insensitive')).toBe('Český');
    expect(mark('Český', 'čes', 'case-insensitive')).toBe('<mark>Čes</mark>ký');
    expect(mark('Český', 'čes', 'exact')).toBe('Český');
  });

  it('returns NFC text for a decomposed label, with ranges into it', () => {
    const nfd = 'Zli\u0301n'; // Zlín, 5 code units
    const active = prepareSearchTerm('zli', { behavior: 'normalized', match: 'contains', regex: createRegexCompiler() });
    const r = findHighlightRanges(nfd, active, { behavior: 'normalized', match: 'contains' });
    expect(r.text).toBe('Zlín');
    expect(r.ranges).toEqual([[0, 3]]);
    expect(wrapRanges(r.text, r.ranges)).toBe('<mark>Zl\u00ED</mark>n');
  });

  it('keeps combining marks that cannot compose inside the match', () => {
    // q + combining dot below has no precomposed form, so it survives NFC
    const r = findHighlightRanges('aq\u0323b', { kind: 'text', text: 'q' }, { behavior: 'normalized', match: 'contains' });
    expect(r.ranges).toEqual([[1, 3]]);
  });

  it('marks ß whole for "ss", and partially-matched expansions whole', () => {
    expect(mark('Straße', 'strasse')).toBe('<mark>Straße</mark>');
    expect(mark('Straße', 'stras')).toBe('<mark>Straß</mark>e');
  });

  it('word modes mark only word starts / ends', () => {
    expect(mark('Old Town Townsend downtown', 'town', 'normalized', 'word-starts-with')).toBe(
      'Old <mark>Town</mark> <mark>Town</mark>send downtown',
    );
    expect(mark('Old Town Townsend downtown', 'town', 'normalized', 'word-ends-with')).toBe(
      'Old <mark>Town</mark> Townsend down<mark>town</mark>',
    );
  });

  it('a regex term marks its matches on the label as-is', () => {
    const r = findHighlightRanges('Ústí nad Labem', { kind: 'regex', re: /^Ústí|Labem/ }, { behavior: 'normalized', match: 'regex' });
    expect(wrapRanges(r.text, r.ranges)).toBe('<mark>Ústí</mark> nad <mark>Labem</mark>');
  });

  it('no term or empty label → no ranges, label untouched', () => {
    expect(findHighlightRanges('Zlín', NO_SEARCH_TERM, { behavior: 'normalized', match: 'contains' })).toEqual({
      text: 'Zlín',
      ranges: [],
    });
    expect(findHighlightRanges('', { kind: 'text', text: 'a' }, { behavior: 'normalized', match: 'contains' }).ranges).toEqual([]);
  });

  it('handles astral code points without splitting surrogates', () => {
    expect(mark('😀 Brno', 'brno')).toBe('😀 <mark>Brno</mark>');
  });
});

describe('wrapRanges', () => {
  it('wraps with custom open/close', () => {
    expect(wrapRanges('abcdef', [[1, 3]], { open: '[', close: ']' })).toBe('a[bc]def');
  });

  it('escapes every slice but not the markers', () => {
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    expect(wrapRanges('a<b & c', [[1, 3]], { escape })).toBe('a<mark>&lt;b</mark> &amp; c');
  });

  it('skips empty and overlapping parts', () => {
    expect(wrapRanges('abcdef', [[1, 1], [1, 3], [2, 4]])).toBe('a<mark>bc</mark><mark>d</mark>ef');
  });
});
