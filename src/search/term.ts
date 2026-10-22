import { matchesText, statelessRegex } from './match.js';
import { normalizeSearchText } from './normalize.js';
import type { ActiveSearchTerm, PreparedSearchTerm, SearchBehavior, SearchMatch } from './types.js';

/** The "no search" term — every item matches, nothing is highlighted. */
export const NO_SEARCH_TERM: ActiveSearchTerm = Object.freeze({ kind: 'none' });

/** Compiles typed patterns for `search-match="regex"`, keeping the last valid one. */
export interface RegexCompiler {
  /**
   * Compile `pattern` (no flags — a typed regex is case-sensitive, it runs on the raw value).
   * An invalid pattern (usually mid-typing: `^(Ústí|`) returns the last valid RegExp
   * instead, so results don't flash empty; `null` until one compiled.
   */
  compile(pattern: string): RegExp | null;
  /** Forget the last valid pattern (search rules changed, search cleared). */
  reset(): void;
}

/** One per component instance — it remembers that instance's last valid pattern. */
export function createRegexCompiler(): RegexCompiler {
  let lastValid: RegExp | null = null;
  return {
    compile(pattern) {
      try {
        lastValid = new RegExp(pattern);
      } catch {
        // keep lastValid
      }
      return lastValid;
    },
    reset() {
      lastValid = null;
    },
  };
}

export interface PrepareSearchTermOptions {
  behavior: SearchBehavior;
  match: SearchMatch;
  /** The instance's compiler (see {@link createRegexCompiler}). */
  regex: RegexCompiler;
  /**
   * The consumer's `getSearchTermCallback`, already bound to its context. When given, its
   * result is used as-is: a RegExp is matched raw, a string is NOT normalized again (with
   * `match: 'regex'` it is compiled as a pattern).
   */
  prepare?: (term: string) => PreparedSearchTerm;
  /** Called when `prepare` returns an object — unusable for built-in search; the component warns. */
  onObjectTerm?: (term: Record<string, unknown>) => void;
}

/**
 * Turn a typed term into an {@link ActiveSearchTerm} for built-in search.
 *
 * Without `prepare`: trim; empty → none; `match: 'regex'` → compile; otherwise
 * `normalizeSearchText(trimmed, behavior)`. Normalize the item values with the same
 * behavior (once per item, not per keystroke) and test them with {@link matchesSearchTerm}.
 */
export function prepareSearchTerm(term: string, opts: PrepareSearchTermOptions): ActiveSearchTerm {
  if (opts.prepare) {
    const prepared = opts.prepare(term);
    if (prepared instanceof RegExp) return { kind: 'regex', re: statelessRegex(prepared) };
    if (prepared == null || prepared === '') return NO_SEARCH_TERM;
    if (typeof prepared !== 'string') {
      opts.onObjectTerm?.(prepared);
      return NO_SEARCH_TERM;
    }
    return opts.match === 'regex' ? compiled(opts.regex, prepared) : { kind: 'text', text: prepared };
  }
  const trimmed = term.trim();
  if (!trimmed) return NO_SEARCH_TERM;
  if (opts.match === 'regex') return compiled(opts.regex, trimmed);
  return { kind: 'text', text: normalizeSearchText(trimmed, opts.behavior) };
}

function compiled(regex: RegexCompiler, pattern: string): ActiveSearchTerm {
  const re = regex.compile(pattern);
  return re ? { kind: 'regex', re } : NO_SEARCH_TERM;
}

/**
 * Whether an item matches. `prepared` is its search value normalized with the current
 * behavior (cache it per item); `raw` is the un-normalized value a regex is tested against.
 * Pass either as a function to compute it only when this term needs it.
 */
export function matchesSearchTerm(
  term: ActiveSearchTerm,
  match: SearchMatch,
  prepared: string | (() => string),
  raw: string | (() => string),
): boolean {
  if (term.kind === 'none') return true;
  if (term.kind === 'regex') return term.re.test(typeof raw === 'function' ? raw() : raw);
  const text = typeof prepared === 'function' ? prepared() : prepared;
  return matchesText(text, term.text, match === 'regex' ? 'contains' : match);
}
