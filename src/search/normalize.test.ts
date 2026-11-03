import { describe, expect, it } from 'vitest';
import { normalizeSearchText } from './index.js';

const NFD_C_CARON = 'c\u030C'; // c + combining caron
const NFC_C_CARON = '\u010D'; // č

describe('normalizeSearchText', () => {
  it('defaults to normalized: lowercase, diacritics stripped', () => {
    expect(normalizeSearchText('Český Krumlov')).toBe('cesky krumlov');
    expect(normalizeSearchText('Müller')).toBe('muller');
    expect(normalizeSearchText('Ústí nad Orlicí')).toBe('usti nad orlici');
  });

  it('folds letters without a Unicode decomposition', () => {
    expect(normalizeSearchText('Łódź')).toBe('lodz');
    expect(normalizeSearchText('Straße')).toBe('strasse');
    expect(normalizeSearchText('Øresund Đakovo Ðór Ħamrun Iıl')).toBe('oresund dakovo dor hamrun iil');
    expect(normalizeSearchText('Æsir Œuvre')).toBe('aesir oeuvre');
  });

  it('folds Greek final sigma to σ so ΟΔΟΣ, οδος and οδοσ agree', () => {
    expect(normalizeSearchText('ΟΔΟΣ')).toBe(normalizeSearchText('οδος'));
    expect(normalizeSearchText('ΟΔΟΣ', 'case-insensitive')).toBe(normalizeSearchText('οδος', 'case-insensitive'));
  });

  it('case-insensitive folds case but keeps diacritics', () => {
    expect(normalizeSearchText('Český', 'case-insensitive')).toBe('český');
    // Review A-14: full case folding — `ß` ~ `SS`, Turkish `İ` ~ `i`.
    expect(normalizeSearchText('Straße', 'case-insensitive')).toBe(normalizeSearchText('STRASSE', 'case-insensitive'));
    expect(normalizeSearchText('İstanbul', 'case-insensitive')).toBe('istanbul');
  });

  // Review A-13.
  it('normalized keeps the marks that are part of a letter in their script', () => {
    expect(normalizeSearchText('किताब')).not.toBe(normalizeSearchText('कतब')); // Devanagari vowel sign
    expect(normalizeSearchText('が')).not.toBe(normalizeSearchText('か')); // kana dakuten
    expect(normalizeSearchText('Čeś')).toBe('ces'); // a lone mark after a Latin letter is a diacritic
  });

  it('normalized folds ligatures, full-width forms, no-break spaces and extra letters', () => {
    expect(normalizeSearchText('ﬁle')).toBe('file');
    expect(normalizeSearchText('ＡＢ')).toBe('ab');
    expect(normalizeSearchText('a b')).toBe('a b');
    expect(normalizeSearchText('Þór ŧ ĳ ŀ')).toBe('thor t ij l');
  });

  it('exact leaves the text unchanged (apart from NFC)', () => {
    expect(normalizeSearchText('Český', 'exact')).toBe('Český');
  });

  it.each(['normalized', 'case-insensitive', 'exact'] as const)(
    '%s: composed and decomposed accents compare equal',
    (behavior) => {
      expect(normalizeSearchText(NFD_C_CARON + 'es', behavior)).toBe(normalizeSearchText(NFC_C_CARON + 'es', behavior));
    },
  );
});
