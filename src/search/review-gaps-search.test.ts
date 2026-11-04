import { describe, expect, it } from 'vitest';
import { createRegexCompiler, findHighlightRanges, findTextMatches, prepareSearchTerm, wrapRanges } from './index.js';
import type { SearchBehavior, SearchMatch } from './index.js';

// Review 2026-11-03 A-27 (test gaps): the /search scenarios the other search tests did not cover yet.

function ranges(label: string, term: string, behavior: SearchBehavior, match: SearchMatch) {
  const active = prepareSearchTerm(term, { behavior, match, regex: createRegexCompiler() });
  return findHighlightRanges(label, active, { behavior, match });
}
function mark(label: string, term: string, behavior: SearchBehavior = 'normalized', match: SearchMatch = 'contains') {
  const r = ranges(label, term, behavior, match);
  return wrapRanges(r.text, r.ranges);
}
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('A-27 word boundaries (A-11)', () => {
  it('a combining mark continues the word: no word start right after it', () => {
    // q + combining dot below has no precomposed form, so the mark survives NFC / exact
    expect(findTextMatches('q\u0323bc bc', 'bc', 'word-starts-with')).toEqual([[5, 7]]);
    expect(ranges('q\u0323bc bc', 'bc', 'exact', 'word-starts-with').ranges).toEqual([[5, 7]]);
  });

  it('a combining mark continues the word: no word end right before it', () => {
    expect(findTextMatches('aq\u0323 aq', 'aq', 'word-ends-with')).toEqual([[4, 6]]);
  });

  it('an astral letter continues the word on both sides', () => {
    expect(findTextMatches('ab𝐀 ab', 'ab', 'word-ends-with')).toEqual([[5, 7]]);
    expect(findTextMatches('𝐀ab ab', 'ab', 'word-starts-with')).toEqual([[5, 7]]);
    // an astral NON-letter (emoji) separates words
    expect(findTextMatches('😀ab', 'ab', 'word-starts-with')).toEqual([[2, 4]]);
    expect(findTextMatches('ab😀', 'ab', 'word-ends-with')).toEqual([[0, 2]]);
  });

  it('a Devanagari vowel sign (kept by normalized) is part of the word', () => {
    // "कि" = क + ि (vowel sign); "ताब" must not count as a word start after it
    expect(ranges('किताब ताब', 'ताब', 'normalized', 'word-starts-with').ranges).toEqual([[6, 9]]);
  });

  // Documents today's behaviour (open question, not a bug per SPEC §12.11: the MATCH must
  // start a word, and "-" is not a word character, so a term starting with punctuation can
  // only match at a word start of the text when the text has the same punctuation there).
  it('word-starts-with: a term starting with punctuation ("-b" in "a-b") does not match', () => {
    expect(findTextMatches('a-b', '-b', 'word-starts-with')).toEqual([]);
    expect(findTextMatches('-b', '-b', 'word-starts-with')).toEqual([[0, 2]]);
    expect(findTextMatches('a -b', '-b', 'word-starts-with')).toEqual([[2, 4]]);
  });
});

describe('A-27 regex highlight on astral text (A-12)', () => {
  it('a regex highlight never splits an emoji and the wrapped HTML has no lone surrogate', () => {
    const label = '😀 Brno 🚀x';
    for (const re of [/./, /\S/, /o.?/, /[^ ]x/]) {
      const r = findHighlightRanges(label, { kind: 'regex', re }, { behavior: 'normalized', match: 'regex' });
      expect(r.text).toBe(label);
      expect(LONE_SURROGATE.test(wrapRanges(r.text, r.ranges).replace(/<\/?mark>/g, '|')), String(re)).toBe(false);
      for (const [a, b] of r.ranges) {
        expect(LONE_SURROGATE.test(label.slice(a, b)), `${re} ${a}-${b}`).toBe(false);
      }
    }
    const r = findHighlightRanges(label, { kind: 'regex', re: /[^ ]x/ }, { behavior: 'normalized', match: 'regex' });
    expect(wrapRanges(r.text, r.ranges)).toBe('😀 Brno <mark>🚀x</mark>');
  });
});

describe('A-27 case-insensitive full folding in highlights (A-14)', () => {
  it('Turkish İ: "istanbul" marks the whole "İstanbul"', () => {
    expect(mark('İstanbul', 'istanbul', 'case-insensitive')).toBe('<mark>İstanbul</mark>');
    expect(mark('İstanbul', 'İST', 'case-insensitive')).toBe('<mark>İst</mark>anbul');
    expect(mark('Kayseri İl', 'il', 'case-insensitive')).toBe('Kayseri <mark>İl</mark>');
  });

  it('ß / ẞ ~ ss: marked whole, and a partial match marks the ß', () => {
    expect(mark('Straße', 'STRASSE', 'case-insensitive')).toBe('<mark>Straße</mark>');
    expect(mark('STRAẞE', 'strasse', 'case-insensitive')).toBe('<mark>STRAẞE</mark>');
    expect(mark('Straße', 'stras', 'case-insensitive')).toBe('<mark>Straß</mark>e');
    // case-insensitive keeps diacritics: no accent folding sneaks in with the full folding
    expect(mark('Česká', 'ceska', 'case-insensitive')).toBe('Česká');
  });
});

describe('A-27 NBSP and ligatures in highlights (A-13)', () => {
  it('a typed space matches a no-break space; the label keeps its NBSP', () => {
    expect(mark('Nové\u00A0Město', 'nove mesto')).toBe('<mark>Nové\u00A0Město</mark>');
  });

  it('a ligature is marked whole by its expansion, partially matched ones too', () => {
    expect(mark('ﬁle manager', 'file')).toBe('<mark>ﬁle</mark> manager');
    expect(mark('ﬁle', 'f')).toBe('<mark>ﬁ</mark>le');
    expect(mark('ＡＢＣ', 'bc')).toBe('Ａ<mark>ＢＣ</mark>');
  });
});

describe('A-27 equals / ends-with and trailing combining marks', () => {
  // q + combining dot below stays decomposed after NFC; normalized strips the dot (Latin base).
  it('normalized equals covers the whole label, trailing mark included', () => {
    expect(ranges('Aq\u0323', 'aq', 'normalized', 'equals').ranges).toEqual([[0, 3]]);
    expect(mark('Aq\u0323', 'aq', 'normalized', 'equals')).toBe('<mark>Aq\u0323</mark>');
  });

  it('normalized ends-with keeps the trailing mark inside the range', () => {
    expect(ranges('Aq\u0323', 'q', 'normalized', 'ends-with').ranges).toEqual([[1, 3]]);
    expect(ranges('Aq\u0323b', 'b', 'normalized', 'ends-with').ranges).toEqual([[3, 4]]);
  });

  it('starts-with keeps a mark that trails the matched prefix', () => {
    expect(ranges('Aq\u0323b', 'aq', 'normalized', 'starts-with').ranges).toEqual([[0, 3]]);
  });

  it('exact / case-insensitive keep the mark, so the bare term no longer equals / ends the label', () => {
    expect(ranges('aq\u0323', 'aq', 'exact', 'equals').ranges).toEqual([]);
    expect(ranges('aq\u0323', 'q', 'case-insensitive', 'ends-with').ranges).toEqual([]);
    expect(ranges('aq\u0323', 'aq\u0323', 'exact', 'equals').ranges).toEqual([[0, 3]]);
  });
});
