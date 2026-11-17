/**
 * Clipboard (SPEC §12.32). Copy: web-grid wrote `navigator.clipboard.writeText` with no fallback (it rejects
 * outside a secure context — an intranet app on `http://` — and in some embedded webviews). Paste: web-grid
 * (twice) and web-daterangepicker read `clipboardData.getData('text')` each their own way.
 *
 * - `copyText(text)` → `Promise<boolean>`: the async Clipboard API, else a hidden `<textarea>` +
 *   `execCommand('copy')` (inside the user gesture; focus and selection put back). Never throws.
 * - `readPasteText(event, { type })` → the pasted text of a `paste` event: `text/plain` by default; CRLF / CR
 *   normalized to LF; `''` when there is none.
 */

import { deepActiveElement } from './active-element.js';

/** Copy `text`; `true` when it reached the clipboard. Call it from a user gesture (a click, a keydown). */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && (typeof window === 'undefined' || window.isSecureContext !== false)) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // permission denied / not focused — try the old way
    }
  }
  return copyWithTextarea(text);
}

function copyWithTextarea(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  // The focused element inside shadow roots (a grid cell), not the host `document.activeElement` reports.
  const active = deepActiveElement() as HTMLElement | null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)) : [];
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.cssText = 'position: fixed; top: 0; left: 0; width: 1px; height: 1px; padding: 0; border: 0; opacity: 0; pointer-events: none;';
  document.body.append(area);
  area.focus({ preventScroll: true });
  area.select();
  let isCopied = false;
  try {
    isCopied = document.execCommand('copy');
  } catch {
    isCopied = false;
  }
  area.remove();
  if (selection) {
    selection.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  }
  active?.focus?.({ preventScroll: true });
  return isCopied;
}

export interface ReadPasteOptions {
  /** The data type to read (default `'text/plain'`; `'text/html'` for markup). */
  type?: string;
  /** Turn CRLF / CR into LF (default `true`). */
  shouldNormalizeNewlines?: boolean;
}

/** The pasted text of a `paste` event (`''` when there is none of that type). */
export function readPasteText(event: ClipboardEvent | Event, options: ReadPasteOptions = {}): string {
  const data = (event as ClipboardEvent).clipboardData;
  if (!data) return '';
  const type = options.type ?? 'text/plain';
  let text = data.getData(type);
  if (!text && type === 'text/plain') text = data.getData('text'); // older engines' alias
  return options.shouldNormalizeNewlines === false ? text : text.replace(/\r\n?/g, '\n');
}
