import type { SearchMatch, SearchRange } from './types.js';

/** A letter, digit, or a combining mark (part of the letter before it — Indic vowel signs). */
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** The code point ending just before `index` (a surrogate pair is one character). */
function codePointBefore(text: string, index: number): string {
  const low = text.charCodeAt(index - 1);
  const isLowSurrogate = low >= 0xdc00 && low <= 0xdfff;
  return isLowSurrogate && index >= 2 ? text.slice(index - 2, index) : text.slice(index - 1, index);
}

/** A word starts at `index` (start of text, or preceded by a non-letter/digit/mark). */
function isWordStart(text: string, index: number): boolean {
  return index === 0 || !WORD_CHAR.test(codePointBefore(text, index));
}

/** A word ends at `index` (exclusive; end of text, or followed by a non-letter/digit/mark). */
function isWordEnd(text: string, index: number): boolean {
  return index === text.length || !WORD_CHAR.test(String.fromCodePoint(text.codePointAt(index)!));
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

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * Ranges `[start, end)` of every non-empty `re` match in `text`, regardless of its flags.
 * Typed patterns have no `u` flag (multiselect parity), so `.` can match half of a surrogate
 * pair; a boundary inside a pair is widened to the whole character (an emoji is never split
 * into two U+FFFD), and ranges that then overlap are merged (review A-12).
 */
export function findRegexMatches(text: string, re: RegExp): SearchRange[] {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const ranges: SearchRange[] = [];
  for (const m of text.matchAll(global)) {
    if (m[0].length === 0) continue;
    let start = m.index;
    let end = m.index + m[0].length;
    if (start > 0 && isLowSurrogate(text.charCodeAt(start)) && isHighSurrogate(text.charCodeAt(start - 1))) start--;
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end))) end++;
    const prev = ranges[ranges.length - 1];
    if (prev && start < prev[1]) prev[1] = Math.max(prev[1], end);
    else ranges.push([start, end]);
  }
  return ranges;
}

/** A RegExp safe to `.test()` repeatedly — `g` / `y` make `test()` stateful via `lastIndex`. */
export function statelessRegex(re: RegExp): RegExp {
  return /[gy]/.test(re.flags) ? new RegExp(re.source, re.flags.replace(/[gy]/g, '')) : re;
}
