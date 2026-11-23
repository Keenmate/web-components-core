/**
 * Demo elements for the lists page (SPEC §12.25–§12.27, §12.30, §12.31) — stand-ins for a real component's
 * combobox, toolbar / calendar grid and long list, WITHOUT pulling in one of the KM components.
 *
 * `<core-demo-combo>` — a search input + listbox: `observeTextInput` filters (IME-safe), `createActiveDescendant`
 * moves the highlight while focus stays in the input, Enter picks (`isImeEnter` skipped).
 * `<core-demo-roving layout="toolbar | grid">` — one tab stop, the arrows move real focus (`createRovingFocus`,
 * typeahead on the toolbar).
 * `<core-demo-biglist count selection-mode has-keep-scroll>` — `createVirtualWindow` rows + `createSelection`
 * (click / Ctrl / Shift, Shift+Arrow, Space, Ctrl+A) + optional `keepScrollAcrossMove`.
 *
 * Their CSS is the element's own (shadow) CSS, like any component's; page tokens (--kmwc-*) inherit in, so
 * they follow light / dark. Demo-only — not part of the published package.
 */
import {
  BlissElement, define, toBool, toEnum, toInt, escapeHtml,
  observeTextInput, isImeEnter, createVirtualWindow, createSelection, keepScrollAcrossMove,
} from './src/index.js';
import type { InputDef, VirtualWindow, Selection } from './src/index.js';
import { createActiveDescendant, createRovingFocus } from './src/a11y/index.js';
import type { ActiveDescendant, RovingFocus } from './src/a11y/index.js';

const BOX_CSS = `
  :host { display: block; }
  .box { border: 1px solid var(--kmwc-border-color); border-radius: var(--kmwc-radius-md, 8px);
         background: var(--kmwc-page-bg); color: var(--kmwc-text-color-1); }
  .is-active, .row.is-cursor { outline: 2px solid var(--kmwc-accent-color); outline-offset: -2px; }
  [aria-selected="true"] { background: color-mix(in srgb, var(--kmwc-accent-color) 18%, transparent); font-weight: 600; }
`;

const COUNTRIES = [
  'Argentina', 'Australia', 'Austria', 'Belgium', 'Brazil', 'Canada', 'Chile', 'Czechia', 'Denmark', 'Estonia',
  'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland', 'Italy', 'Japan', 'Latvia',
  'Lithuania', 'Mexico', 'Netherlands', 'Norway', 'Poland', 'Portugal', 'Slovakia', 'Slovenia', 'Spain', 'Sweden',
];

/** A combobox: focus stays in the input, `aria-activedescendant` points at the highlighted option. */
export class CoreDemoCombo extends BlissElement {
  protected static override inputs: readonly InputDef[] = [];
  protected static override events = ['active', 'pick', 'text'];

  #input: HTMLInputElement | null = null;
  #listbox: HTMLElement | null = null;
  #nav: ActiveDescendant | null = null;
  #stopText: (() => void) | null = null;

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${BOX_CSS}
        input { box-sizing: border-box; inline-size: 100%; padding: .45rem .6rem; font: inherit; color: inherit;
                background: var(--kmwc-page-bg); border: 1px solid var(--kmwc-border-color-strong); border-radius: 6px; }
        [role="listbox"] { max-block-size: 180px; overflow-y: auto; margin-block-start: .3rem; }
        [role="option"] { padding: .3rem .6rem; cursor: pointer; }
        [role="option"]:empty::after, .empty { color: var(--kmwc-text-color-3); }
      </style>
      <input role="combobox" aria-expanded="true" aria-autocomplete="list" placeholder="Type a country, then ↓ / ↑ / Enter" aria-label="Country">
      <div class="box" role="listbox" aria-label="Countries"></div>`;
    this.#input = root.querySelector('input');
    this.#listbox = root.querySelector('[role="listbox"]');
    this.#render('');
  }

  protected override connect(): void {
    const input = this.#input!;
    const listbox = this.#listbox!;
    this.#nav = createActiveDescendant(input, listbox, {
      getItems: () => [...listbox.querySelectorAll<HTMLElement>('[role="option"]')],
      onActiveChange: (item) => {
        for (const o of listbox.querySelectorAll('.is-active')) o.classList.remove('is-active');
        item?.classList.add('is-active');
        this.emit('active', { value: item?.dataset.value ?? null, id: item?.id ?? null });
      },
      onActivate: (item) => this.#pick(item),
    });
    this.#stopText = observeTextInput(input, (term) => {
      this.emit('text', { term });
      this.#render(term);
    });
    input.addEventListener('keydown', this.#onKeydown);
    listbox.addEventListener('click', this.#onClick);
  }

  protected override disconnect(): void {
    this.#nav?.destroy();
    this.#stopText?.();
    this.#input?.removeEventListener('keydown', this.#onKeydown);
    this.#listbox?.removeEventListener('click', this.#onClick);
  }

  #onKeydown = (e: KeyboardEvent): void => {
    if (isImeEnter(e)) this.emit('text', { term: '(Enter confirmed an IME candidate — not a pick)' });
  };

  #onClick = (e: MouseEvent): void => {
    const item = (e.target as Element).closest<HTMLElement>('[role="option"]');
    if (item) this.#pick(item);
  };

  #pick(item: HTMLElement): void {
    this.#input!.value = item.dataset.value!;
    this.emit('pick', { value: item.dataset.value });
  }

  #render(term: string): void {
    const t = term.trim().toLowerCase();
    const hits = COUNTRIES.filter((c) => c.toLowerCase().includes(t));
    this.#listbox!.innerHTML = hits.length
      ? hits.map((c) => `<div role="option" data-value="${escapeHtml(c)}">${escapeHtml(c)}</div>`).join('')
      : '<div class="empty">No match</div>';
    this.#nav?.refresh();
  }
}

const TOOLBAR = ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Link', 'Image', 'Table', 'Quote'];

/** One tab stop; the arrows move real focus. `layout="toolbar"` (typeahead) or `"grid"` (a 7-column month). */
export class CoreDemoRoving extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'layout', attribute: 'layout', converter: toEnum(['toolbar', 'grid'] as const, { default: 'toolbar' }), on: 'reinit' },
  ];
  protected static override events = ['focus-item'];

  #roving: RovingFocus | null = null;

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const isGrid = this.config.layout === 'grid';
    const items = isGrid
      ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<span class="head" aria-hidden="true">${d}</span>`).join('') +
        Array.from({ length: 30 }, (_, i) => `<button role="gridcell" ${i % 7 === 5 ? 'aria-disabled="true"' : ''}>${i + 1}</button>`).join('')
      : TOOLBAR.map((t) => `<button>${t}</button>`).join('');
    root.innerHTML = `
      <style>${BOX_CSS}
        .box { padding: .4rem; display: flex; flex-wrap: wrap; gap: .3rem; }
        .box.grid { display: grid; grid-template-columns: repeat(7, minmax(0, 2.4rem)); }
        .box.grid button { padding: .35rem 0; min-width: 0; }   /* the 7 columns shrink on a 320px phone */
        .head { text-align: center; font-size: .75rem; color: var(--kmwc-text-color-3); }
        button { font: inherit; padding: .35rem .6rem; border: 1px solid var(--kmwc-border-color); border-radius: 6px;
                 background: var(--kmwc-page-bg); color: inherit; cursor: pointer; }
        button[aria-disabled="true"] { opacity: .4; }
        button:focus-visible { outline: 2px solid var(--kmwc-accent-color); outline-offset: 1px; }
      </style>
      <div class="box ${isGrid ? 'grid' : ''}" role="${isGrid ? 'grid' : 'toolbar'}" aria-label="${isGrid ? 'November' : 'Formatting'}">${items}</div>`;
    this.#roving?.destroy();
    const box = root.querySelector<HTMLElement>('.box')!;
    this.#roving = createRovingFocus(box, {
      getItems: () => [...box.querySelectorAll<HTMLElement>('button')],
      orientation: isGrid ? 'grid' : 'horizontal',
      columns: 7,
      hasTypeahead: !isGrid,
      isSkipped: (item) => item.getAttribute('aria-disabled') === 'true',
      onFocusItem: (item, index) => this.emit('focus-item', { label: item.textContent, index }),
    });
  }

  protected override destroyCallback(): void {
    this.#roving?.destroy();
  }
}

const ROW_HEIGHT = 28;

/** A virtual list with file-manager selection; `has-keep-scroll` keeps its scroll position across a DOM move. */
export class CoreDemoBiglist extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'count', attribute: 'count', converter: toInt({ min: 0 }), default: 20, on: 'reinit' },
    { configKey: 'selectionMode', attribute: 'selection-mode', converter: toEnum(['multi', 'single'] as const, { default: 'multi' }), on: 'update' },
    { configKey: 'hasKeepScroll', attribute: 'has-keep-scroll', converter: toBool('default-false'), default: false, on: 'reinit' },
  ];
  protected static override events = ['selection-change', 'range'];

  #scroller: HTMLElement | null = null;
  #virtual: VirtualWindow | null = null;
  #selection: Selection<number> | null = null;
  #keys: number[] = [];
  #cursor = 0;
  #stopKeep: (() => void) | null = null;

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${BOX_CSS}
        .box { block-size: 240px; overflow-y: auto; outline: none; }
        .box:focus-visible { box-shadow: 0 0 0 2px var(--kmwc-accent-color); }
        .row { box-sizing: border-box; block-size: ${ROW_HEIGHT}px; padding: 0 .7rem; display: flex; align-items: center;
               gap: .6rem; border-bottom: 1px solid var(--kmwc-border-color); cursor: default; user-select: none;
               font-family: var(--kmwc-mono-font-family, monospace); font-size: .85rem; }
        .row.is-disabled { color: var(--kmwc-text-color-3); text-decoration: line-through; }
      </style>
      <div class="box" role="listbox" tabindex="0" aria-label="Rows"></div>`;
    const scroller = root.querySelector<HTMLElement>('.box')!;
    this.#scroller = scroller;
    const count = this.config.count as number;
    this.#keys = Array.from({ length: count }, (_, i) => i);
    this.#cursor = 0;

    this.#virtual?.destroy();
    this.#selection = createSelection<number>({
      mode: () => this.config.selectionMode as 'multi' | 'single',
      getOrderedKeys: () => this.#keys,
      isSelectable: (i) => i % 10 !== 7, // every row ending in 7 is disabled
      onChange: ({ added, removed, values }) => {
        this.#virtual?.refresh();
        this.emit('selection-change', { added: added.slice(0, 5), removed: removed.slice(0, 5), size: values.length });
      },
    });
    this.#virtual = createVirtualWindow(scroller, {
      getCount: () => this.#keys.length,
      rowHeight: ROW_HEIGHT,
      overscan: 5,
      render: ({ start, end, window }) => {
        let html = '';
        for (let i = start; i < end; i++) {
          const isOff = i % 10 === 7;
          html += `<div class="row${i === this.#cursor ? ' is-cursor' : ''}${isOff ? ' is-disabled' : ''}" role="option" data-i="${i}"
            aria-selected="${this.#selection!.has(i)}"${isOff ? ' aria-disabled="true"' : ''}>row ${String(i).padStart(6, '0')}</div>`;
        }
        window!.innerHTML = html;
        this.emit('range', { start, end, rendered: end - start, total: this.#keys.length });
      },
    });
    scroller.setAttribute('aria-multiselectable', String(this.config.selectionMode === 'multi'));

    this.#stopKeep?.();
    this.#stopKeep = this.config.hasKeepScroll ? keepScrollAcrossMove(this, () => (this.#scroller ? [this.#scroller] : [])) : null;
  }

  protected override update(): void {
    this.#scroller?.setAttribute('aria-multiselectable', String(this.config.selectionMode === 'multi'));
    this.#selection?.clear();
  }

  protected override connect(): void {
    this.#scroller!.addEventListener('click', this.#onClick);
    this.#scroller!.addEventListener('keydown', this.#onKeydown);
  }

  protected override disconnect(): void {
    this.#scroller?.removeEventListener('click', this.#onClick);
    this.#scroller?.removeEventListener('keydown', this.#onKeydown);
  }

  protected override destroyCallback(): void {
    this.#virtual?.destroy();
    this.#stopKeep?.();
  }

  /** Scroll row `index` into view (inside the list only) and put the cursor on it. */
  goTo(index: number): void {
    this.flush();
    this.#cursor = Math.max(0, Math.min(index, this.#keys.length - 1));
    this.#virtual?.scrollToIndex(this.#cursor, { block: 'center' });
    this.#virtual?.refresh();
  }

  /** How many row elements are in the DOM right now. */
  get renderedRows(): number {
    return this.shadowRoot?.querySelectorAll('.row').length ?? 0;
  }

  #onClick = (e: MouseEvent): void => {
    const row = (e.target as Element).closest<HTMLElement>('.row');
    if (!row) return;
    this.#cursor = Number(row.dataset.i);
    this.#selection!.click(this.#cursor, e);
    this.#virtual!.refresh();
  };

  #onKeydown = (e: KeyboardEvent): void => {
    const sel = this.#selection!;
    const last = this.#keys.length - 1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.#cursor = Math.max(0, Math.min(last, this.#cursor + (e.key === 'ArrowDown' ? 1 : -1)));
      if (e.shiftKey) sel.extendTo(this.#cursor);
      else sel.setAnchor(this.#cursor);
      this.#virtual!.scrollToIndex(this.#cursor, { block: 'nearest' });
      this.#virtual!.refresh();
    } else if (e.key === ' ') {
      e.preventDefault();
      sel.toggle(this.#cursor);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      sel.selectAll();
    } else if (e.key === 'Escape') {
      sel.clear();
    }
  };
}

define('core-demo-combo', CoreDemoCombo);
define('core-demo-roving', CoreDemoRoving);
define('core-demo-biglist', CoreDemoBiglist);
