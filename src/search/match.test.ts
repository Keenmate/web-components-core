import { describe, expect, it } from 'vitest';
import { findRegexMatches, findTextMatches, matchesText, statelessRegex } from './index.js';
import type { SearchMatch } from './index.js';

describe('findTextMatches / matchesText', () => {
  const cases: Array<[SearchMatch, string, string, Array<[number, number]>]> = [
    ['contains', 'old town townsend', 'town', [[4, 8], [9, 13]]],
    ['equals', 'haxkl324', 'haxkl324', [[0, 8]]],
    ['equals', 'haxkl3245', 'haxkl324', []],
    ['starts-with', 'townsend', 'town', [[0, 4]]],
    ['starts-with', 'old town', 'town', []],
    ['ends-with', 'old town', 'town', [[4, 8]]],
    ['ends-with', 'townsend', 'town', []],
    ['word-starts-with', 'old town townsend', 'town', [[4, 8], [9, 13]]],
    ['word-starts-with', 'downtown', 'town', []],
    ['word-ends-with', 'old town townsend', 'town', [[4, 8]]],
    ['word-ends-with', 'downtown', 'town', [[4, 8]]],
    // punctuation and digits: `-` separates words, digits are word characters
    ['word-starts-with', 'ha-324/56', '324', [[3, 6]]],
    ['word-starts-with', 'ha324', '324', []],
    ['word-ends-with', 'ha-324/56', 'ha', [[0, 2]]],
    // letters beyond ASCII are word characters
    ['word-starts-with', 'čtown', 'town', []],
  ];

  it.each(cases)('%s: "%s" / "%s"', (match, text, term, expected) => {
    expect(findTextMatches(text, term, match)).toEqual(expected);
    expect(matchesText(text, term, match)).toBe(expected.length > 0);
  });

  it('never returns overlapping ranges', () => {
    expect(findTextMatches('aaaa', 'aa', 'contains')).toEqual([[0, 2], [2, 4]]);
  });

  it('empty term: no ranges, but matches', () => {
    for (const match of ['contains', 'word-starts-with', 'word-ends-with', 'starts-with'] as const) {
      expect(findTextMatches('abc', '', match)).toEqual([]);
      expect(matchesText('abc', '', match)).toBe(true);
    }
  });

  it('regex mode falls back to contains for text', () => {
    expect(findTextMatches('old town', 'town', 'regex')).toEqual([[4, 8]]);
  });
});

describe('findRegexMatches', () => {
  it('finds every match regardless of the g flag', () => {
    expect(findRegexMatches('HA-324 / HA-56', /HA-\d+/)).toEqual([[0, 6], [9, 14]]);
    expect(findRegexMatches('HA-324 / HA-56', /HA-\d+/g)).toEqual([[0, 6], [9, 14]]);
  });

  it('skips zero-length matches', () => {
    expect(findRegexMatches('abc', /x*/)).toEqual([]);
    expect(findRegexMatches('abc', /^/)).toEqual([]);
  });
});

describe('statelessRegex', () => {
  it('strips g and y so test() is repeatable', () => {
    const re = statelessRegex(/a/gi);
    expect(re.flags).toBe('i');
    expect([re.test('a'), re.test('a'), re.test('a')]).toEqual([true, true, true]);
    expect(statelessRegex(/a/y).flags).toBe('');
  });

  it('returns a flag-free regex unchanged', () => {
    const re = /a/i;
    expect(statelessRegex(re)).toBe(re);
  });
});
