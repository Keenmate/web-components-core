import { findRegexMatches, findTextMatches } from './match.js';
import { normalizeSearchText } from './normalize.js';
import type { ActiveSearchTerm, HighlightResult, SearchBehavior, SearchMatch, SearchRange } from './types.js';

/**
 * Where to highlight `term` in a label, following the same rules as matching: `ces` marks
 * `Čes` in `Český`, word modes mark only word starts / ends, `ß` is marked whole by `ss`.
 * A regex term marks its own matches on the label as-is.
 *
 * For a text term the label is NFC-normalized and then folded one code point at a time,
 * recording where each folded character came from, so ranges map back onto the label —
 * including characters that fold to nothing (combining marks after a match stay inside it).
 *
 * The ranges index into the returned `text`, which for text terms is the NFC form of the
 * input — always render the returned `text`, never the original string.
 */
export function findHighlightRanges(
  text: string,
  term: ActiveSearchTerm,
  opts: { behavior: SearchBehavior; match: SearchMatch },
): HighlightResult {
  if (term.kind === 'none' || !text) return { text, ranges: [] };
  if (term.kind === 'regex') return { text, ranges: findRegexMatches(text, term.re) };

  const nfc = text.normalize('NFC');
  let folded = '';
  const start: number[] = []; // nfc start index of each folded char's source code point
  const end: number[] = []; // ...and its end index
  for (let i = 0; i < nfc.length; ) {
    const ch = String.fromCodePoint(nfc.codePointAt(i)!);
    const f = normalizeSearchText(ch, opts.behavior);
    for (let k = 0; k < f.length; k++) {
      start.push(i);
      end.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }

  const match = opts.match === 'regex' ? 'contains' : opts.match;
  const ranges = findTextMatches(folded, term.text, match).map(([a, b]): SearchRange => {
    // Extend over any following characters that folded to nothing (combining marks).
    const next = b < folded.length ? start[b]! : nfc.length;
    return [start[a]!, Math.max(end[b - 1]!, next)];
  });
  return { text: nfc, ranges };
}

export interface WrapRangesOptions {
  /** Inserted before each range. Default `<mark>`. */
  open?: string;
  /** Inserted after each range. Default `</mark>`. */
  close?: string;
  /**
   * Applied to every slice of `text` (marked and unmarked), not to `open` / `close`. Pass an
   * HTML escaper when `text` is plain text; omit it when `text` is already trusted HTML.
   */
  escape?: (s: string) => string;
}

/**
 * Wrap `ranges` of `text` in `open` / `close` (default `<mark>…</mark>`). Use with
 * {@link findHighlightRanges}: `wrapRanges(r.text, r.ranges)`. Ranges must be sorted;
 * overlapping parts and empty ranges are skipped.
 */
export function wrapRanges(text: string, ranges: readonly SearchRange[], opts: WrapRangesOptions = {}): string {
  const { open = '<mark>', close = '</mark>', escape = (s: string) => s } = opts;
  let out = '';
  let last = 0;
  for (const [a, b] of ranges) {
    const from = Math.max(a, last);
    if (b <= from) continue;
    out += escape(text.slice(last, from)) + open + escape(text.slice(from, b)) + close;
    last = b;
  }
  return out + escape(text.slice(last));
}
