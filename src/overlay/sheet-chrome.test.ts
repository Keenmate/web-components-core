import { describe, it, expect, vi } from 'vitest';
import { createSheetHeader, SHEET_CHROME_CSS } from './sheet-chrome.js';

describe('createSheetHeader (the shared sheet chrome)', () => {
  it('builds header > title + close; the close is a labelled type=button with no text (the ✕ is a mask)', () => {
    const closeCallback = vi.fn();
    const { header, title, close } = createSheetHeader({ title: 'Pick a date', closeLabel: 'Zavřít', closeCallback });
    expect(header.className).toBe('km-sheet-header');
    expect(title?.className).toBe('km-sheet-title');
    expect(title?.textContent).toBe('Pick a date');
    expect(close.className).toBe('km-sheet-close');
    expect(close.type).toBe('button');
    expect(close.getAttribute('aria-label')).toBe('Zavřít');
    expect(close.textContent).toBe('');
    expect([...header.children]).toEqual([title, close]);
    close.click();
    expect(closeCallback).toHaveBeenCalledTimes(1);
  });

  it('no title → no title element (a header holding a search field)', () => {
    const { header, title, close } = createSheetHeader({ closeLabel: 'Close', closeCallback: () => {} });
    expect(title).toBeNull();
    expect([...header.children]).toEqual([close]);
    expect(createSheetHeader({ title: '', closeLabel: 'Close', closeCallback: () => {} }).title).not.toBeNull();
  });

  it('the stylesheet draws the close with --base-icon-close and stays in @layer component', () => {
    expect(SHEET_CHROME_CSS.trimStart().startsWith('@layer component {')).toBe(true);
    expect(SHEET_CHROME_CSS).toContain('var(--_km-sheet-close-icon, var(--km-sheet-close-icon, var(--base-icon-close, url(');
  });

  it('the full-screen frame (.km-sheet): pinned top / inline-start (no bottom: the keyboard inset sets height), safe areas, modal tier, 4-layer colours', () => {
    const rule = SHEET_CHROME_CSS.slice(SHEET_CHROME_CSS.indexOf('.km-sheet {'), SHEET_CHROME_CSS.indexOf('.km-sheet:focus'));
    expect(rule).toContain('position: fixed;');
    expect(rule).toContain('top: 0;');
    expect(rule).toContain('inset-inline-start: 0;');
    expect(rule).not.toMatch(/inset: 0|bottom:/);
    expect(rule).toContain('width: 100dvw;');
    expect(rule).toContain('height: 100dvh;');
    expect(rule).toContain('padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);');
    expect(rule).toContain('z-index: var(--_km-sheet-z-index, var(--km-sheet-z-index, var(--base-z-modal, 7000)));');
    expect(rule).toContain(
      'background: var(--_km-sheet-bg, var(--km-sheet-bg, var(--base-elevated-bg, var(--base-main-bg, light-dark(#ffffff, #2b2b2b)))));',
    );
    expect(rule).toContain('color: var(--_km-sheet-color, var(--km-sheet-color, var(--base-text-color-1, light-dark(#242424, #f5f5f5))));');
    expect(rule).toContain('var(--_km-sheet-duration, var(--km-sheet-duration, var(--base-duration-medium, 0.25s)))');
    expect(SHEET_CHROME_CSS).toContain('.km-sheet-body {');
    expect(SHEET_CHROME_CSS).toContain('.km-sheet.km-sheet--closing {');
  });
});
