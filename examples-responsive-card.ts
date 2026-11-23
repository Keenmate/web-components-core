/**
 * Demo `BlissElement`s for the responsive-rules page (SPEC §6.7) — tiny cards that
 * render their EFFECTIVE config (`this.config`, what a component applies) and
 * report every `reinit()` / `update(partial)` through a `config-applied` event, so
 * the page can show exactly when and how a responsive rule reached the component.
 *
 * Three tags, each with its OWN configKeys — page-wide rules
 * (`window.components.responsive*`) apply to every component that has the key, so
 * distinct keys keep the RS04 page-wide toggles from leaking into RS03 / RS05:
 *   - `<core-demo-rs-map>`      RS03 — `layout` (reinit), `columns`, `presentation`
 *   - `<core-demo-rs-layers>`   RS04 — `accent`, `density`, `label`, `badge`
 *                               (registered via `registerComponent`, so it gets
 *                               the per-tag `window.components[tag].responsive*`)
 *   - `<core-demo-rs-callback>` RS05 — `isCompact`, `cols`
 *   - `<core-demo-rs-size>`     RS06 — no inputs; overrides `sizeChanged()` and lays out one
 *                               tile per 120px of the width it is told
 *
 * Demo-only — not part of the published package (`files` ships `dist/` only).
 */
import {
  adoptStyles,
  BlissElement,
  createSheetHeader,
  define,
  registerComponent,
  resolveContainerSize,
  SHEET_CHROME_CSS,
  startSheetSession,
  toBool,
  toEnum,
  toInt,
  toText,
  Z_INDEX,
} from './src/index.js';
import type { ElementSize, InputDef, SheetSession } from './src/index.js';
import { createPopover, type PopoverHandle } from './src/positioning/index.js';

// Page tokens (--kmwc-*) inherit into the shadow root, so the card follows light / dark.
const STYLES = `
  :host { display: block; }
  .rs { border: 1px solid var(--kmwc-border-color, GrayText); border-left: 6px solid var(--rs-accent, #64748b);
        border-radius: var(--kmwc-radius-md, 10px); padding: var(--rs-pad, .7rem .9rem); font-size: .9rem; font-weight: 500;
        background: var(--kmwc-main-bg, Canvas); color: var(--kmwc-text-color-1, CanvasText); }
  .rs-title { font-weight: 700; margin-bottom: .35rem; }
  .rs-kv { font: .8rem var(--kmwc-mono-font-family, ui-monospace, monospace); line-height: 1.55; }
  .rs-kv b { color: var(--kmwc-info-color, #0369a1); }
  .rs-tiles { display: grid; gap: .35rem; margin-top: .5rem; grid-template-columns: repeat(var(--rs-cols, 3), minmax(0, 1fr)); }
  .rs-tiles.stack { grid-template-columns: 1fr; }
  .rs-tiles.list { display: flex; flex-direction: column; gap: .15rem; }
  .rs-tile { background: var(--kmwc-accent-light-bg, #e0f2fe); border-radius: var(--kmwc-radius-sm, 6px); padding: .3rem .4rem; text-align: center; font-size: .78rem; }
  .rs-hooks { margin-top: .4rem; font: .75rem var(--kmwc-mono-font-family, ui-monospace, monospace); color: var(--kmwc-text-color-3, GrayText); }
`;

const ACCENTS: Record<string, string> = { slate: '#64748b', amber: '#d97706', teal: '#0d9488', rose: '#e11d48', violet: '#7c3aed' };
const PADDING: Record<string, string> = { compact: '.35rem .6rem', comfortable: '.7rem .9rem', spacious: '1.2rem 1.4rem' };

export type ConfigAppliedDetail = {
  kind: 'reinit' | 'update';
  partial: Record<string, unknown> | null;
  config: Record<string, unknown>;
};

/** Shared rendering: effective config as key/value lines + hook counters. */
abstract class RsDemoCard extends BlissElement {
  protected static override events = ['config-applied'];

  reinitCount = 0;
  updateCount = 0;
  #root?: ShadowRoot;

  /** The configKeys to print, in order. */
  protected abstract get keys(): readonly string[];
  /** Subclass hook: style the card from the effective config. */
  protected abstract paintVisual(card: HTMLElement, tiles: HTMLElement): void;

  #render(): void {
    this.#root ??= this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `<style>${STYLES}</style>
      <div class="rs" part="card">
        <div class="rs-title">&lt;${this.localName}&gt;</div>
        <div class="rs-kv"></div>
        <div class="rs-tiles"></div>
        <div class="rs-hooks"></div>
      </div>`;
  }

  #paint(): void {
    const root = this.#root;
    if (!root) return;
    const cfg = this.config;
    (root.querySelector('.rs-kv') as HTMLElement).innerHTML = this.keys
      .map((k) => `${k}: <b data-key="${k}">${JSON.stringify(cfg[k])}</b>`)
      .join('<br>');
    (root.querySelector('.rs-hooks') as HTMLElement).textContent = `reinit() × ${this.reinitCount} · update() × ${this.updateCount}`;
    this.paintVisual(root.querySelector('.rs') as HTMLElement, root.querySelector('.rs-tiles') as HTMLElement);
  }

  protected override reinit(): void {
    this.reinitCount += 1;
    this.#render();
    this.#paint();
    this.emit('config-applied', { kind: 'reinit', partial: null, config: { ...this.config } } satisfies ConfigAppliedDetail);
  }

  protected override update(partial: Record<string, unknown>): void {
    this.updateCount += 1;
    this.#paint();
    this.emit('config-applied', { kind: 'update', partial: { ...partial }, config: { ...this.config } } satisfies ConfigAppliedDetail);
  }
}

function tiles(el: HTMLElement, count: number, cls: string): void {
  el.className = `rs-tiles ${cls}`;
  el.innerHTML = Array.from({ length: count }, (_, i) => `<div class="rs-tile">item ${i + 1}</div>`).join('');
}

/** RS03 — an instance responsive map flips layout / columns / presentation. */
export class RsMapCard extends RsDemoCard {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'layout', attribute: 'layout', converter: toEnum(['grid', 'stack', 'list'] as const, { default: 'grid' }), on: 'reinit' },
    { configKey: 'columns', attribute: 'columns', converter: toInt({ min: 1, max: 6, default: 3 }), on: 'update' },
    {
      configKey: 'presentation',
      attribute: 'presentation',
      converter: toEnum(['floating', 'modal', 'fullscreen'] as const, { default: 'floating' }),
      on: 'update',
    },
  ];
  protected get keys(): readonly string[] {
    return ['layout', 'columns', 'presentation'];
  }
  protected paintVisual(_card: HTMLElement, el: HTMLElement): void {
    const cfg = this.config as { layout: string; columns: number };
    el.style.setProperty('--rs-cols', String(cfg.columns));
    tiles(el, 6, cfg.layout);
  }
}

/** RS04 — four keys, one per precedence story. */
export class RsLayersCard extends RsDemoCard {
  protected static override inputs: readonly InputDef[] = [
    {
      configKey: 'accent',
      attribute: 'accent',
      converter: toEnum(['slate', 'amber', 'teal', 'rose', 'violet'] as const, { default: 'slate' }),
      on: 'update',
    },
    {
      configKey: 'density',
      attribute: 'density',
      converter: toEnum(['comfortable', 'compact', 'spacious'] as const, { default: 'comfortable' }),
      on: 'update',
    },
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'base' }), on: 'update' },
    { configKey: 'badge', attribute: 'badge', converter: toText({ default: 'none' }), on: 'update' },
  ];
  protected get keys(): readonly string[] {
    return ['accent', 'density', 'label', 'badge'];
  }
  protected paintVisual(card: HTMLElement, el: HTMLElement): void {
    const cfg = this.config as { accent: string; density: string };
    card.style.setProperty('--rs-accent', ACCENTS[cfg.accent] ?? '#64748b');
    card.style.setProperty('--rs-pad', PADDING[cfg.density] ?? '.7rem .9rem');
    el.replaceChildren();
  }
}

/** RS05 — driven by an instance responsiveCallback on a custom width. */
export class RsCallbackCard extends RsDemoCard {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'isCompact', attribute: 'compact', converter: toBool('default-false'), on: 'update' },
    { configKey: 'cols', attribute: 'cols', converter: toInt({ min: 1, max: 6, default: 4 }), on: 'update' },
  ];
  protected get keys(): readonly string[] {
    return ['isCompact', 'cols'];
  }
  protected paintVisual(card: HTMLElement, el: HTMLElement): void {
    const cfg = this.config as { isCompact: boolean; cols: number };
    card.style.setProperty('--rs-pad', cfg.isCompact ? PADDING.compact! : PADDING.comfortable!);
    el.style.setProperty('--rs-cols', String(cfg.cols));
    tiles(el, 4, '');
  }
}

define('core-demo-rs-map', RsMapCard as unknown as CustomElementConstructor);
// Registered so `window.components['core-demo-rs-layers'].responsive*` (the per-tag layer) exists.
registerComponent('core-demo-rs-layers', RsLayersCard as unknown as CustomElementConstructor, {
  config: { name: 'core-demo-rs-layers', version: 'demo' },
});
define('core-demo-rs-callback', RsCallbackCard as unknown as CustomElementConstructor);

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** What `<core-demo-rs-size>` reports on every `sizeChanged()` (the `size-report` event). */
export type SizeReportDetail = { size: ElementSize; visual: { width: number; height: number }; columns: number };

/**
 * RS06 — a component that makes a STRUCTURAL decision from its width (one tile per 120px),
 * the job `sizeChanged()` is for. It shows the size the hook reported next to the visual box
 * (`getBoundingClientRect()`, transforms applied), so scaling the element shows the difference.
 */
export class RsSizeCard extends BlissElement {
  protected static override events = ['size-report'];
  #root?: ShadowRoot;

  protected override reinit(): void {
    this.#root ??= this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `<style>${STYLES}</style>
      <div class="rs"><div class="rs-title">sizeChanged() → layout</div>
      <div class="rs-kv" part="kv">waiting for the first report…</div><div class="rs-tiles"></div></div>`;
  }

  protected override sizeChanged(size: ElementSize): void {
    const root = this.#root;
    if (!root) return;
    const columns = Math.max(1, Math.floor(size.width / 120));
    const rect = this.getBoundingClientRect();
    const visual = { width: round1(rect.width), height: round1(rect.height) };
    root.querySelector('.rs-kv')!.innerHTML =
      `sizeChanged: <b>${round1(size.width)} × ${round1(size.height)}</b> → <b>${columns}</b> tile(s)<br>` +
      `visual box (getBoundingClientRect): ${visual.width} × ${visual.height}`;
    const tilesEl = root.querySelector<HTMLElement>('.rs-tiles')!;
    tilesEl.style.setProperty('--rs-cols', String(columns));
    tiles(tilesEl, columns, '');
    this.emit('size-report', { size, visual, columns } satisfies SizeReportDetail);
  }
}

define('core-demo-rs-size', RsSizeCard as unknown as CustomElementConstructor);

const PICKER_STYLES = `
  :host { display: block; }
  .pk { border: 1px solid var(--kmwc-border-color, GrayText); border-radius: var(--kmwc-radius-md, 10px); padding: .6rem;
        background: var(--kmwc-main-bg, Canvas); color: var(--kmwc-text-color-1, CanvasText); font-size: .85rem; }
  .pk-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .25rem .75rem;
             font: .75rem var(--kmwc-mono-font-family, ui-monospace, monospace);
             color: var(--kmwc-text-color-3, GrayText); margin-bottom: .4rem; }
  .pk-head b { color: var(--kmwc-info-color, #0369a1); }
  .pk-months { display: grid; grid-template-columns: repeat(var(--pk-months, 2), minmax(0, 1fr)); gap: .5rem; }
  .pk-month { border-radius: var(--kmwc-radius-sm, 6px); background: var(--kmwc-accent-light-bg, #e0f2fe); padding: .4rem; }
  .pk-month-title { font-weight: 700; text-align: center; margin-bottom: .25rem; }
  .pk-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; font-size: .7rem; text-align: center; }
  .pk-days button { font: inherit; padding: .25rem 0; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }
  .pk-days button:hover { background: var(--kmwc-main-bg, Canvas); }
  .pk-foot { display: flex; gap: .4rem; justify-content: flex-end; margin-top: .5rem; }
  .pk-foot button { font: inherit; font-size: .8rem; padding: .2rem .6rem; }

  /* field mode (RS08): a field that OPENS the calendar */
  .pk-input { display: flex; justify-content: space-between; align-items: center; width: 100%; box-sizing: border-box;
              font: inherit; font-size: .9rem; padding: .5rem .7rem; cursor: pointer; text-align: start;
              border: 1px solid var(--kmwc-border-color, GrayText); border-radius: var(--kmwc-radius-sm, 6px);
              background: var(--kmwc-main-bg, Canvas); color: var(--kmwc-text-color-1, CanvasText); }
  .pk-input::after { content: "▾"; color: var(--kmwc-text-color-3, GrayText); }
  .pk-panel { display: none; z-index: ${Z_INDEX.dropdown}; box-shadow: 0 8px 24px rgb(0 0 0 / .18);
              width: min(calc(var(--pk-months, 2) * 15rem), calc(100vw - 2rem)); box-sizing: border-box; }
  .pk-panel.is-open { display: block; }
  .pk-sheet { position: fixed; inset: 0; z-index: ${Z_INDEX.modal}; display: flex; flex-direction: column;
              background: var(--kmwc-main-bg, Canvas); color: var(--kmwc-text-color-1, CanvasText);
              animation: pk-sheet-in var(--base-duration-medium, .25s) ease-out; }
  .pk-sheet .pk { border: 0; border-radius: 0; flex: 1; overflow: auto; width: auto; box-shadow: none; }
  .pk-sheet .pk-days button { padding: .6rem 0; font-size: .95rem; }
  .pk-sheet .pk-foot button { padding: .6rem 1rem; font-size: 1rem; }
  @keyframes pk-sheet-in { from { transform: translateY(100%); } }
`;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June'];

/**
 * RS07 / RS08 — a mini date picker for the `container` axis: `months`, the Today / Clear buttons and
 * `presentation` come from rules. It shows the width and bucket it is in (`sizeChanged` + core's
 * `resolveContainerSize`, the same lines the rules use).
 *
 * Inline (RS07): the calendar is drawn in place. Field mode (RS08, {@link hasField}): a field that OPENS the
 * calendar — `presentation: 'floating'` as a dropdown under it (core `createPopover`), `'fullscreen'` as a
 * full-screen sheet (core `createSheetHeader` + `SHEET_CHROME_CSS` + `startSheetSession`: page scroll
 * locked, phone Back closes it).
 */
export class RsPickerCard extends BlissElement {
  protected static override events = ['config-applied'];
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'months', attribute: 'months', converter: toInt({ min: 1, max: 3, default: 2 }), on: 'update' },
    { configKey: 'isTodayButtonVisible', attribute: 'show-today', converter: toBool('default-true'), on: 'update' },
    { configKey: 'isClearButtonVisible', attribute: 'show-clear', converter: toBool('default-true'), on: 'update' },
    {
      configKey: 'presentation',
      attribute: 'presentation',
      converter: toEnum(['floating', 'fullscreen'] as const, { default: 'floating' }),
      on: 'update',
    },
  ];
  #root?: ShadowRoot;
  #width = 0;
  /** The calendar (`.pk`): in place (inline), or the dropdown panel / the sheet's body (field mode). */
  #calendar?: HTMLElement;
  #input?: HTMLButtonElement;
  #popover?: PopoverHandle;
  #sheet?: { el: HTMLElement; session: SheetSession };

  /** Field mode: a field that opens the calendar (RS08). */
  protected get hasField(): boolean {
    return false;
  }

  get isOpen(): boolean {
    return !!this.#popover?.isOpen || !!this.#sheet;
  }

  protected override reinit(): void {
    this.#root ??= this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    this.close();
    this.#popover?.destroy();
    this.#popover = undefined;
    adoptStyles(this.#root, SHEET_CHROME_CSS);
    if (this.hasField) {
      this.#root.innerHTML = `<style>${PICKER_STYLES}</style>
        <div class="pk-head"></div>
        <button type="button" class="pk-input" aria-haspopup="dialog">Pick a date…</button>
        <div class="pk pk-panel"><div class="pk-months"></div><div class="pk-foot"></div></div>`;
      this.#input = this.#root.querySelector('.pk-input') as HTMLButtonElement;
      this.#calendar = this.#root.querySelector('.pk-panel') as HTMLElement;
      this.#input.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
      this.#popover = createPopover({
        reference: this.#input,
        panel: this.#calendar,
        container: this.#root,
        shouldKeepMounted: true,
        visibleClass: 'is-open',
        placement: 'bottom-start',
        shouldFlip: true,
        maxHeight: { padding: 8 },
        shouldCloseOnEscape: true,
        shouldCloseOnOutsideClick: true,
      });
    } else {
      this.#root.innerHTML = `<style>${PICKER_STYLES}</style>
        <div class="pk"><div class="pk-head"></div><div class="pk-months"></div><div class="pk-foot"></div></div>`;
      this.#calendar = this.#root.querySelector('.pk') as HTMLElement;
    }
    this.#calendar.addEventListener('click', (e) => this.#onCalendarClick(e));
    this.#paint();
    this.emit('config-applied', {});
  }

  protected override update(partial: Record<string, unknown>): void {
    // The way it opens changed while open (a phone rotated, the window resized): close; the next open uses the new one.
    if ('presentation' in partial && this.isOpen) this.close();
    this.#paint();
    this.emit('config-applied', {});
  }

  protected override sizeChanged(size: ElementSize): void {
    this.#width = size.width;
    this.#paintHead();
  }

  protected override disconnect(): void {
    this.close();
  }

  protected override destroyCallback(): void {
    this.#popover?.destroy();
  }

  /** Open the calendar the way `presentation` says. */
  open(): void {
    if (!this.hasField || this.isOpen || !this.#calendar || !this.#root) return;
    const { presentation } = this.config as { presentation: string };
    if (presentation === 'fullscreen') {
      const sheet = document.createElement('div');
      sheet.className = 'pk-sheet';
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      const { header } = createSheetHeader({ title: 'Pick a date', closeLabel: 'Close', closeCallback: () => this.close() });
      this.#calendar.classList.add('is-open');
      sheet.append(header, this.#calendar);
      this.#root.append(sheet);
      // scroll lock + keyboard inset + the phone Back gesture, undone by one end()
      const session = startSheetSession(sheet, { backCallback: () => this.close() });
      this.#sheet = { el: sheet, session };
      (header.querySelector('.km-sheet-close') as HTMLElement | null)?.focus();
    } else {
      this.#popover?.open();
    }
    this.#paintHead();
  }

  /** Close it (whichever way it is open). */
  close(): void {
    if (this.#sheet) {
      const { el, session } = this.#sheet;
      this.#sheet = undefined;
      session.end();
      // the calendar goes back to its dropdown place
      this.#calendar?.classList.remove('is-open');
      if (this.#calendar && this.#root) this.#root.append(this.#calendar);
      el.remove();
      this.#input?.focus();
    }
    if (this.#popover?.isOpen) this.#popover.close();
    this.#paintHead();
  }

  #onCalendarClick(e: Event): void {
    const button = (e.target as Element).closest('button');
    if (!button || !this.hasField) return;
    if (button.dataset.day) this.#pick(`${button.dataset.month} ${button.dataset.day}`);
    else if (button.hasAttribute('data-today')) this.#pick('Today');
    else if (button.hasAttribute('data-clear')) this.#pick(null);
  }

  #pick(text: string | null): void {
    if (this.#input) this.#input.textContent = text ?? 'Pick a date…';
    this.close();
  }

  #paintHead(): void {
    const head = this.#root?.querySelector('.pk-head');
    if (!head) return;
    const width = Math.round(this.#width || this.offsetWidth);
    const presentation = (this.config as { presentation: string }).presentation;
    const state = this.hasField ? ` <span>${this.isOpen ? 'open' : 'closed'}</span>` : '';
    head.innerHTML = `<span>width <b data-width>${width}px</b></span><span>container <b data-bucket>${resolveContainerSize(this, width)}</b></span><span>opens <b data-presentation>${presentation}</b>${state}</span>`;
  }

  #paint(): void {
    const root = this.#root;
    if (!root) return;
    const cfg = this.config as { months: number; isTodayButtonVisible: boolean; isClearButtonVisible: boolean };
    const months = root.querySelector('.pk-months') as HTMLElement;
    this.style.setProperty('--pk-months', String(cfg.months));
    months.innerHTML = MONTH_NAMES.slice(0, cfg.months)
      .map((m) => {
        const days = Array.from({ length: 28 }, (_, i) =>
          this.hasField ? `<button type="button" data-month="${m}" data-day="${i + 1}">${i + 1}</button>` : `<span>${i + 1}</span>`,
        ).join('');
        return `<div class="pk-month" data-month><div class="pk-month-title">${m}</div><div class="pk-days">${days}</div></div>`;
      })
      .join('');
    (root.querySelector('.pk-foot') as HTMLElement).innerHTML =
      (cfg.isTodayButtonVisible ? '<button type="button" data-today>Today</button>' : '') +
      (cfg.isClearButtonVisible ? '<button type="button" data-clear>Clear</button>' : '');
    this.#paintHead();
  }
}

/** RS08 — the same picker as a FIELD that opens, 3 months by default (its own tag, so its page rule doesn't touch RS07's). */
export class RsBookingPicker extends RsPickerCard {
  protected static override inputs: readonly InputDef[] = RsPickerCard.inputs.map((row) =>
    row.configKey === 'months' ? { ...row, converter: toInt({ min: 1, max: 3, default: 3 }) } : row,
  );
  protected override get hasField(): boolean {
    return true;
  }
}
registerComponent('core-demo-rs-booking', RsBookingPicker as unknown as CustomElementConstructor, {
  config: { name: 'core-demo-rs-booking', version: 'demo' },
});

// Registered so the per-tag page rule `window.components['core-demo-rs-picker'].responsive` exists.
registerComponent('core-demo-rs-picker', RsPickerCard as unknown as CustomElementConstructor, {
  config: { name: 'core-demo-rs-picker', version: 'demo' },
});
