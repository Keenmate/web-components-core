/**
 * One contract for every `render*Callback` (SPEC §12.35). The audit (B24) found each component reading its render
 * hooks' return values differently: a string was HTML here and text there, `null` meant "default" in one and
 * "empty" in another, an element was appended / replaced / ignored, and every repaint re-ran the hook.
 *
 * `renderSlot(container, result, { renderDefault, memoKey })`:
 * - a `string` → the container's HTML (render callbacks are code, like a template — not data);
 * - a `Node` (element, fragment) → mounted as the container's only content (moved, not cloned);
 * - `null` / `undefined` → `renderDefault(container)` — the component's built-in rendering;
 * - `false` → hidden: emptied and `hidden`.
 *
 * `result` may be a function (the hook call itself): with a `memoKey` equal to the previous one for this
 * container nothing runs — the hook isn't called and the DOM isn't touched. A same-string result is not
 * rewritten either.
 */

export type SlotResult = string | Node | null | undefined | false;
export type SlotKind = 'custom' | 'default' | 'hidden';

export interface RenderSlotOptions {
  /** Draw the built-in content (a `null` / `undefined` result). Without it the container is emptied. */
  renderDefault?: (container: HTMLElement) => void;
  /** Skip everything when it equals (`Object.is`) the key of the previous render of this container. */
  memoKey?: unknown;
}

interface SlotMemo {
  key: unknown;
  hasKey: boolean;
  kind: SlotKind;
  html: string | null;
}

const memos = new WeakMap<HTMLElement, SlotMemo>();

/** Render `result` into `container`; returns what it became. */
export function renderSlot(container: HTMLElement, result: SlotResult | (() => SlotResult), options: RenderSlotOptions = {}): SlotKind {
  const previous = memos.get(container);
  const hasKey = 'memoKey' in options && options.memoKey !== undefined;
  if (hasKey && previous?.hasKey && Object.is(previous.key, options.memoKey)) return previous.kind;

  const value = typeof result === 'function' ? result() : result;
  let kind: SlotKind;
  let html: string | null = null;
  if (value === false) {
    kind = 'hidden';
    container.replaceChildren();
    container.hidden = true;
  } else {
    container.hidden = false;
    if (value == null) {
      kind = 'default';
      if (options.renderDefault) options.renderDefault(container);
      else container.replaceChildren();
    } else if (typeof value === 'string') {
      kind = 'custom';
      html = value;
      if (!(previous?.kind === 'custom' && previous.html === value)) container.innerHTML = value;
    } else {
      kind = 'custom';
      if (container.firstChild !== value || container.childNodes.length !== 1) container.replaceChildren(value);
    }
  }
  memos.set(container, { key: options.memoKey, hasKey, kind, html });
  return kind;
}
