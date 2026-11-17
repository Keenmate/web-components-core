/**
 * Typed text, IME-safe (SPEC §12.30). Japanese / Chinese / Korean input (and phone keyboards with
 * suggestions) COMPOSE text: `input` events fire for every intermediate state with `isComposing`, and the
 * Enter that confirms a candidate is a keydown too. A search field that reacts to every `input` searches for
 * half-typed syllables; one that handles Enter picks an option while the user only confirmed a kana.
 * web-commandpalette had the one correct copy.
 *
 * - `onTextInput(input, callback)` calls `callback(value)` once per committed change: `input` events while
 *   composing are skipped, `compositionend` delivers the result, and Firefox's extra `input` after
 *   `compositionend` (same value) is dropped.
 * - `isImeEnter(event)` — the keydown belongs to the IME (confirming a candidate), not to the component.
 */

export type TextInputElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

/** The current text of an input / textarea / contenteditable. */
const valueOf = (el: TextInputElement): string =>
  'value' in el && typeof (el as HTMLInputElement).value === 'string' ? (el as HTMLInputElement).value : (el.textContent ?? '');

/** Subscribe to committed text changes; returns the unsubscribe. */
export function onTextInput(input: TextInputElement, callback: (value: string, event: Event) => void): () => void {
  /** The value `compositionend` just delivered — Firefox follows it with a plain `input` of the same value. */
  let composedValue: string | null = null;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  const onInput = (event: Event): void => {
    if ((event as InputEvent).isComposing) return;
    const value = valueOf(input);
    if (composedValue !== null && value === composedValue) {
      composedValue = null;
      return;
    }
    composedValue = null;
    callback(value, event);
  };
  const onCompositionEnd = (event: Event): void => {
    const value = valueOf(input);
    composedValue = value;
    if (clearTimer) clearTimeout(clearTimer);
    // The duplicate (if any) comes in the same task; after that a same-value `input` is a real edit.
    clearTimer = setTimeout(() => {
      composedValue = null;
      clearTimer = null;
    }, 0);
    callback(value, event);
  };
  input.addEventListener('input', onInput);
  input.addEventListener('compositionend', onCompositionEnd);
  return () => {
    input.removeEventListener('input', onInput);
    input.removeEventListener('compositionend', onCompositionEnd);
    if (clearTimer) clearTimeout(clearTimer);
  };
}

/**
 * The key event belongs to an IME composition (Enter / arrows confirming or choosing a candidate): ignore
 * it. `isComposing`, or `keyCode` 229 — Safari's keydown for the confirming Enter comes after
 * `compositionend` with `isComposing: false`.
 */
export function isImeEnter(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
