/**
 * Type-to-find (SPEC §12.25): printable keys typed within `timeoutMs` build one search string; the
 * next item (after the current one, wrapping) whose text starts with it wins. Repeating one letter
 * cycles through the items starting with it (APG listbox / tree / menu behaviour).
 */

export interface Typeahead {
  /** Feed a keydown; the matching index, or `-1` (not printable / no match). */
  handle(event: KeyboardEvent, texts: readonly string[], currentIndex: number): number;
  reset(): void;
}

export const TYPEAHEAD_TIMEOUT_MS = 500;

/** A key that types a character (no Ctrl / Alt / Meta; Space only inside a running search). */
export function isPrintableKey(event: KeyboardEvent, isSearching: boolean): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return false;
  if (event.key.length !== 1 && !/^\p{L}$/u.test(event.key)) return false;
  return event.key !== ' ' || isSearching;
}

export function createTypeahead(timeoutMs = TYPEAHEAD_TIMEOUT_MS): Typeahead {
  let buffer = '';
  let lastAt = 0;
  return {
    handle(event, texts, currentIndex) {
      const now = Date.now();
      if (now - lastAt > timeoutMs) buffer = '';
      if (!isPrintableKey(event, buffer !== '')) return -1;
      lastAt = now;
      const ch = event.key.toLocaleLowerCase();
      // Same letter repeated: cycle through the items starting with it.
      const isRepeat = buffer.length > 0 && [...buffer].every((c) => c === ch);
      buffer += ch;
      const term = isRepeat ? ch : buffer;
      const n = texts.length;
      const start = isRepeat || buffer.length === 1 ? currentIndex + 1 : currentIndex;
      for (let i = 0; i < n; i++) {
        const index = (((start + i) % n) + n) % n;
        if (texts[index]!.trim().toLocaleLowerCase().startsWith(term)) return index;
      }
      return -1;
    },
    reset() {
      buffer = '';
      lastAt = 0;
    },
  };
}
