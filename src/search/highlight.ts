import { findRegexMatches, findTextMatches } from './match.js';
import { foldWithSourceMap } from './normalize.js';
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
  // folded + the nfc [start, end) of each folded char's source code point
  const { folded, start, end } = foldWithSourceMap(nfc, opts.behavior);

  const match = opts.match === 'regex' ? 'contains' : opts.match;
  const ranges: SearchRange[] = [];
  for (const [a, b] of findTextMatches(folded, term.text, match)) {
    // Extend over any following characters that folded to nothing (combining marks).
    const next = b < folded.length ? start[b]! : nfc.length;
    const range: SearchRange = [start[a]!, Math.max(end[b - 1]!, next)];
    // Two matches inside one multi-char fold (`s` + `s` of `ß`) map onto the same
    // source character — merge, so the ranges stay non-overlapping.
    const prev = ranges[ranges.length - 1];
    if (prev && range[0] < prev[1]) prev[1] = Math.max(prev[1], range[1]);
    else ranges.push(range);
  }
  return { text: nfc, ranges };
}

/** Escape text for HTML (`&`, `<`, `>`, `"`, `'`) — element content and quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export interface WrapRangesOptions {
  /** Inserted before each range. Default `<mark>`. */
  open?: string;
  /** Inserted after each range. Default `</mark>`. */
  close?: string;
  /**
   * Applied to every slice of `text` (marked and unmarked), not to `open` / `close`.
   * Default {@link escapeHtml}: `text` is plain text, so the result is safe HTML. For text that
   * is ALREADY HTML use {@link highlightHtml} — escaping it would show its tags, and not
   * escaping it would let a range cut through a tag or an entity.
   */
  escape?: (s: string) => string;
}

/**
 * Wrap `ranges` of the plain `text` in `open` / `close` (default `<mark>…</mark>`), escaping
 * every slice of `text` for HTML (see {@link WrapRangesOptions.escape}). Use with
 * {@link findHighlightRanges}: `wrapRanges(r.text, r.ranges)`. Ranges must be sorted;
 * overlapping parts and empty ranges are skipped.
 */
export function wrapRanges(text: string, ranges: readonly SearchRange[], opts: WrapRangesOptions = {}): string {
  const { open = '<mark>', close = '</mark>', escape = escapeHtml } = opts;
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

const ENTITY = /^&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));/i;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Highlight `term` in a label that is already TRUSTED HTML (e.g. `<b>Praha</b> &amp; okolí`),
 * returning HTML. Tags are kept as they are and never marked; each run of text between tags
 * is matched on its decoded text (entities count as the one character they stand for and are
 * never split), so a `<mark>` can't land inside a tag or an entity. A match that spans a tag
 * boundary (`Pra<b>ha</b>`) isn't highlighted. Only for HTML you trust — for plain text use
 * {@link findHighlightRanges} + {@link wrapRanges}, which escapes.
 */
export function highlightHtml(
  html: string,
  term: ActiveSearchTerm,
  opts: { behavior: SearchBehavior; match: SearchMatch; open?: string; close?: string },
): string {
  if (term.kind === 'none' || !html) return html;
  const { open = '<mark>', close = '</mark>' } = opts;
  let out = '';
  for (const part of html.split(/(<[^>]*>)/)) {
    if (part.startsWith('<') || part === '') {
      out += part; // a tag (or an empty split) — untouched
      continue;
    }
    out += highlightTextRun(part.normalize('NFC'), term, opts, open, close);
  }
  return out;
}

/** One run of HTML text (no tags): decode entities with a source map, highlight, map back. */
function highlightTextRun(
  raw: string,
  term: ActiveSearchTerm,
  opts: { behavior: SearchBehavior; match: SearchMatch },
  open: string,
  close: string,
): string {
  let decoded = '';
  const from: number[] = []; // raw start of each decoded UTF-16 unit
  const to: number[] = []; // ...and its raw end
  for (let i = 0; i < raw.length; ) {
    const entity = raw[i] === '&' ? ENTITY.exec(raw.slice(i)) : null;
    if (entity) {
      const code = entity[1] ? Number(entity[1]) : entity[2] ? Number.parseInt(entity[2], 16) : undefined;
      // An unknown named entity becomes U+FFFC: one character that matches nothing.
      const ch = code !== undefined ? String.fromCodePoint(code) : NAMED_ENTITIES[entity[3]!.toLowerCase()] ?? '￼';
      for (let k = 0; k < ch.length; k++) {
        from.push(i);
        to.push(i + entity[0].length);
      }
      decoded += ch;
      i += entity[0].length;
    } else {
      from.push(i);
      to.push(i + 1);
      decoded += raw[i];
      i += 1;
    }
  }
  const result = findHighlightRanges(decoded, term, opts);
  if (result.text !== decoded || result.ranges.length === 0) return raw; // NFC moved the text: leave it
  let out = '';
  let last = 0;
  for (const [a, b] of result.ranges) {
    const rawStart = Math.max(from[a]!, last);
    const rawEnd = to[b - 1]!;
    if (rawEnd <= rawStart) continue;
    out += raw.slice(last, rawStart) + open + raw.slice(rawStart, rawEnd) + close;
    last = rawEnd;
  }
  return out + raw.slice(last);
}
