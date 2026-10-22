import type { SearchMatch, SearchRange } from './types.js';

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** A word starts at `index` (start of text, or preceded by a non-letter/digit). */
function isWordStart(text: string, index: number): boolean {
  return index === 0 || !WORD_CHAR.test(text[index - 1] ?? '');
}

/** A word ends at `index` (exclusive; end of text, or followed by a non-letter/digit). */
function isWordEnd(text: string, index: number): boolean {
  return index === text.length || !WORD_CHAR.test(text[index] ?? '');
}

/**
 * Ranges `[start, end)` in `text` where `term` matches under `match`, non-overlapping and
 * in order. Both strings must already be prepared the same way (`normalizeSearchText`).
 * `regex` is not a text mode: it is treated as `contains` here — use {@link findRegexMatches}.
 */
export function findTextMatches(text: string, term: string, match: SearchMatch): SearchRange[] {
  if (!term) return [];
  switch (match) {
    case 'equals':
      return text === term ? [[0, text.length]] : [];
    case 'starts-with':
      return text.startsWith(term) ? [[0, term.length]] : [];
    case 'ends-with':
      return text.endsWith(term) ? [[text.length - term.length, text.length]] : [];
    default: {
      const ranges: SearchRange[] = [];
      for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + 1)) {
        const end = at + term.length;
        if (match === 'word-starts-with' && !isWordStart(text, at)) continue;
        if (match === 'word-ends-with' && !isWordEnd(text, end)) continue;
        // Non-overlapping, so highlights never nest.
        const prev = ranges[ranges.length - 1];
        if (prev && at < prev[1]) continue;
        ranges.push([at, end]);
      }
      return ranges;
    }
  }
}

/**
 * Whether `term` matches `text` under `match` (both already prepared). The per-keystroke
 * hot path — the simple modes exit early without collecting ranges. An empty term matches.
 */
export function matchesText(text: string, term: string, match: SearchMatch): boolean {
  switch (match) {
    case 'equals':
      return text === term;
    case 'starts-with':
      return text.startsWith(term);
    case 'ends-with':
      return text.endsWith(term);
    case 'word-starts-with':
    case 'word-ends-with':
      return !term || findTextMatches(text, term, match).length > 0;
    default:
      return text.includes(term);
  }
}

/** Ranges `[start, end)` of every non-empty `re` match in `text`, regardless of its flags. */
export function findRegexMatches(text: string, re: RegExp): SearchRange[] {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const ranges: SearchRange[] = [];
  for (const m of text.matchAll(global)) {
    if (m[0].length > 0) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** A RegExp safe to `.test()` repeatedly — `g` / `y` make `test()` stateful via `lastIndex`. */
export function statelessRegex(re: RegExp): RegExp {
  return /[gy]/.test(re.flags) ? new RegExp(re.source, re.flags.replace(/[gy]/g, '')) : re;
}
