import { describe, it, expect, vi } from 'vitest';
import { createSheetHeader, SHEET_CHROME_CSS } from './sheet-chrome.js';

describe('createSheetHeader (the shared sheet chrome)', () => {
  it('builds header > title + close; the close is a labelled type=button with no text (the ✕ is a mask)', () => {
    const onClose = vi.fn();
    const { header, title, close } = createSheetHeader({ title: 'Pick a date', closeLabel: 'Zavřít', onClose });
    expect(header.className).toBe('km-sheet-header');
    expect(title?.className).toBe('km-sheet-title');
    expect(title?.textContent).toBe('Pick a date');
    expect(close.className).toBe('km-sheet-close');
    expect(close.type).toBe('button');
    expect(close.getAttribute('aria-label')).toBe('Zavřít');
    expect(close.textContent).toBe('');
    expect([...header.children]).toEqual([title, close]);
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('no title → no title element (a header holding a search field)', () => {
    const { header, title, close } = createSheetHeader({ closeLabel: 'Close', onClose: () => {} });
    expect(title).toBeNull();
    expect([...header.children]).toEqual([close]);
    expect(createSheetHeader({ title: '', closeLabel: 'Close', onClose: () => {} }).title).not.toBeNull();
  });

  it('the stylesheet draws the close with --base-icon-close and stays in @layer component', () => {
    expect(SHEET_CHROME_CSS.trimStart().startsWith('@layer component {')).toBe(true);
    expect(SHEET_CHROME_CSS).toContain('var(--_km-sheet-close-icon, var(--km-sheet-close-icon, var(--base-icon-close, url(');
  });
});
