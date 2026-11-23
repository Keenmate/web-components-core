/**
 * Roving focus (SPEC §12.25): a composite widget (toolbar, tree, calendar grid, tab list) is ONE tab
 * stop — the current item has `tabindex="0"`, every other `-1` — and the arrow keys move real focus
 * between the items. Copies: web-daterangepicker's day grid, web-treeview, web-editor's toolbar (no
 * arrows), `/menu`.
 *
 * Keys: the arrows by `orientation` (`horizontal` / `vertical` / `grid` with `columns`; Left / Right
 * follow the writing direction), Home / End (row start / end in a grid; Ctrl+Home / End = first /
 * last), optional type-to-find. Roles and `aria-selected` stay the component's.
 */

import { isRtl } from '../dom/direction.js';
import { scrollIntoContainer } from '../dom/scroll-container.js';
import { runSafely } from '../logging/safe-call.js';
import { createTypeahead } from './typeahead.js';

export type RovingOrientation = 'horizontal' | 'vertical' | 'grid';

export interface RovingFocusOptions {
  /** The items in order, read on every key (re-render freely). */
  getItems: () => readonly HTMLElement[];
  /** `vertical` (default): Up / Down; `horizontal`: Left / Right; `grid`: all four with `columns`. */
  orientation?: RovingOrientation;
  /** Items per row for `grid` (a function when it changes with the layout). */
  columns?: number | (() => number);
  /** At an end, the arrow goes round to the other end (default `false`). */
  isWrapping?: boolean;
  /** Printable keys jump to the next item whose text starts with what was typed (default `false`). */
  hasTypeahead?: boolean;
  /** The text type-to-find matches (default: `textContent`). */
  getItemText?: (item: HTMLElement) => string;
  /** An item the keys skip (default: none — APG keeps disabled items focusable). */
  isSkipped?: (item: HTMLElement) => boolean;
  /** Focus moved to `item` (keys, type-to-find, a click, `focusItem`). */
  focusItemCallback?: (item: HTMLElement, index: number) => void;
  /**
   * Bring the focused item into view inside its scroll container (never the page; focus itself uses
   * `preventScroll`). A function is asked per move — the component's `beforeScrollCallback` gate. Default `true`.
   */
  shouldScroll?: boolean | ((item: HTMLElement) => boolean);
}

export interface RovingFocus {
  /** The tab-stop item, or `null` when there are none. */
  readonly current: HTMLElement | null;
  readonly currentIndex: number;
  /** Make `target` the tab stop; `shouldFocus` (default `true`) also focuses it. */
  focusItem(target: number | HTMLElement, options?: { shouldFocus?: boolean }): void;
  /** After a re-render: keep the tab stop when it's still there, else the first item; re-apply `tabindex`. */
  refresh(): void;
  destroy(): void;
}

export function createRovingFocus(container: HTMLElement, options: RovingFocusOptions): RovingFocus {
  const { getItems, orientation = 'vertical', columns = 1, isWrapping = false, hasTypeahead = false, focusItemCallback } = options;
  const isSkipped = options.isSkipped ?? ((): boolean => false);
  const getText = options.getItemText ?? ((item: HTMLElement): string => item.textContent ?? '');
  const typeahead = hasTypeahead ? createTypeahead() : null;
  let current: HTMLElement | null = null;

  const cols = (): number => Math.max(1, Math.floor(typeof columns === 'function' ? columns() : columns) || 1);

  const setTabStop = (list: readonly HTMLElement[], stop: HTMLElement | null): void => {
    for (const item of list) item.tabIndex = item === stop ? 0 : -1;
    current = stop;
  };

  const focusItem = (target: number | HTMLElement, opts: { shouldFocus?: boolean } = {}): void => {
    const list = getItems();
    const item = typeof target === 'number' ? list[target] : list.includes(target) ? target : undefined;
    if (!item) return;
    setTabStop(list, item);
    if (opts.shouldFocus !== false) {
      item.focus({ preventScroll: true }); // a plain focus() scrolls every ancestor — the page too
      const scroll = options.shouldScroll ?? true;
      const isScrolling = typeof scroll === 'function' ? runSafely(() => scroll(item), { source: container, message: 'shouldScroll threw' }) : { isOk: true as const, value: scroll };
      if (isScrolling.isOk && isScrolling.value !== false) scrollIntoContainer(item, { block: 'nearest', inline: 'nearest' });
      if (focusItemCallback) runSafely(() => focusItemCallback(item, list.indexOf(item)), { source: container, message: 'focusItemCallback threw' });
    }
  };

  /** From `from`, step by `step` to the next not-skipped item inside `bound` (default: the whole list); only a ±1 step wraps. */
  const seek = (list: readonly HTMLElement[], from: number, step: number, canWrap: boolean, bound?: [number, number]): number => {
    const [lo, hi] = bound ?? [0, list.length - 1];
    const span = hi - lo + 1;
    let index = from;
    for (let i = 0; i < list.length; i++) {
      index += step;
      if (index < lo || index > hi) {
        if (!canWrap || Math.abs(step) !== 1) return -1;
        index = lo + ((((index - lo) % span) + span) % span);
      }
      if (!isSkipped(list[index]!)) return index;
    }
    return -1;
  };
  const firstFrom = (list: readonly HTMLElement[], lo: number, hi: number, step: 1 | -1): number => seek(list, step === 1 ? lo - 1 : hi + 1, step, false, [lo, hi]);

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.altKey || event.metaKey) return;
    const list = getItems();
    if (!list.length) return;
    const target = event.target as HTMLElement | null;
    const from = current && list.includes(current) ? list.indexOf(current) : Math.max(0, list.findIndex((item) => item === target || item.contains(target)));
    const rtl = isRtl(container);
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    const isGrid = orientation === 'grid';
    const n = isGrid ? cols() : 1;
    const rowStart = isGrid ? from - (from % n) : 0;
    const row: [number, number] | undefined = isGrid ? [rowStart, Math.min(rowStart + n - 1, list.length - 1)] : undefined;
    let next = -1;
    const key = event.key;
    if (event.ctrlKey) {
      if (key === 'Home') next = firstFrom(list, 0, list.length - 1, 1);
      else if (key === 'End') next = firstFrom(list, 0, list.length - 1, -1);
      else return;
    } else if ((key === forward || key === backward) && orientation !== 'vertical') {
      next = seek(list, from, key === forward ? 1 : -1, isWrapping, row);
    } else if ((key === 'ArrowDown' || key === 'ArrowUp') && orientation !== 'horizontal') {
      next = seek(list, from, (key === 'ArrowDown' ? 1 : -1) * n, isWrapping && !isGrid);
    } else if (key === 'Home' || key === 'End') {
      const [lo, hi] = row ?? [0, list.length - 1];
      next = firstFrom(list, lo, hi, key === 'Home' ? 1 : -1);
    } else if (typeahead) {
      const index = typeahead.handle(event, list.map(getText), from);
      if (index === -1) return;
      next = index;
    } else return;
    event.preventDefault();
    if (next !== -1 && next !== from) focusItem(next);
  };

  /** A click / programmatic focus on an item makes it the tab stop. */
  const onFocusin = (event: FocusEvent): void => {
    const list = getItems();
    const item = list.find((candidate) => candidate === event.target || candidate.contains(event.target as Node));
    if (!item || item === current) return;
    setTabStop(list, item);
    if (focusItemCallback) runSafely(() => focusItemCallback(item, list.indexOf(item)), { source: container, message: 'focusItemCallback threw' });
  };

  container.addEventListener('keydown', onKeydown);
  container.addEventListener('focusin', onFocusin);

  const refresh = (): void => {
    const list = getItems();
    const keep = current && list.includes(current) ? current : (list.find((item) => !isSkipped(item)) ?? list[0] ?? null);
    setTabStop(list, keep);
  };
  refresh();

  return {
    get current() {
      return current && getItems().includes(current) ? current : null;
    },
    get currentIndex() {
      return current ? getItems().indexOf(current) : -1;
    },
    focusItem,
    refresh,
    destroy() {
      container.removeEventListener('keydown', onKeydown);
      container.removeEventListener('focusin', onFocusin);
      typeahead?.reset();
    },
  };
}
