import type { SearchBehavior } from './types.js';

/** Letters `normalized` folds by hand — they have no Unicode decomposition (or, for `ς`,
 *  lowercase differently by position) so stripping combining marks alone misses them. */
const FOLD_EXTRA: Record<string, string> = {
  'ł': 'l', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ħ': 'h', 'ı': 'i', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ς': 'σ',
};

/**
 * The standard search normalization, used by built-in search for both the item values and
 * the term — and exported so a custom search (`searchCallback`, `getSearchValueCallback`,
 * `getSearchTermCallback`, a FlexSearch encoder) can prepare text exactly the same way.
 *
 * - `normalized` (default) — lowercase, diacritics stripped: `Český` → `cesky`, `Łódź` → `lodz`
 * - `case-insensitive` — lowercase only: `Český` → `český`
 * - `exact` — unchanged
 *
 * Every mode applies Unicode NFC first, so a composed `č` and a decomposed `c` + combining
 * caron compare equal.
 */
export function normalizeSearchText(text: string, behavior: SearchBehavior = 'normalized'): string {
  if (behavior === 'exact') return text.normalize('NFC');
  if (behavior === 'case-insensitive') return text.normalize('NFC').toLowerCase().replace(/ς/g, 'σ');
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[łøđðħıßæœς]/g, (ch) => FOLD_EXTRA[ch] ?? ch);
}
