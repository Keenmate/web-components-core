/**
 * Demo `BlissElement`s for the reactive-input example page (examples-inputs.html,
 * chapter IN). Each one is a genuine core element — a `static inputs` table and
 * the `reinit()` / `update(partial)` hooks — with a tiny shadow-DOM render so the
 * page can show what the component actually applied.
 *
 *   - `<core-demo-inputs>`     IN01/IN02 — one row per converter type
 *                              (toText, toInt, toBool, toEnum, toList, toFunction),
 *                              reflection, absent == default, invalid values.
 *   - `<core-demo-reactivity>` IN03/IN04 — `on: 'update' | 'reinit' | 'none'`
 *                              inputs, hook counters + the `update` partial, an
 *                              imperative method that calls `this.flush()`.
 *   - `<core-demo-presets>`    IN05 — `getBatchValuesCallback` (one input sets
 *                              others in the same batch) and `getLiveValue`
 *                              (the getter returns live component state).
 *
 * Demo-only — not part of the published package (`files` ships `dist/` only).
 */
import { BlissElement, define, toBool, toEnum, toFunction, toInt, toList, toObjectArray, toText } from './src/index.js';
import type { InputDef } from './src/index.js';

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** What a hook call looked like — the `hook` event detail. */
export interface HookCall {
  hook: 'reinit' | 'update';
  /** The `update(partial)` argument (absent for `reinit()`). */
  partial?: Record<string, unknown>;
  reinitCount: number;
  updateCount: number;
}

type HookEvents = { hook: HookCall };

// ─────────────────────────────────────────────────────────────────────────────
// <core-demo-inputs> — IN01 / IN02
// ─────────────────────────────────────────────────────────────────────────────

export type FormatLabelCallback = (label: string, count: number) => string;

export class CoreDemoInputs extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'Inbox' }), shouldReflect: true },
    { configKey: 'count', attribute: 'count', converter: toInt({ min: 0, max: 10, default: 3 }), shouldReflect: true },
    { configKey: 'limit', attribute: 'limit', converter: toInt({ min: 1, max: 100, default: 50 }) },
    { configKey: 'isCompact', attribute: 'compact', converter: toBool('presence'), shouldReflect: true },
    {
      configKey: 'tone',
      attribute: 'tone',
      converter: toEnum(['info', 'success', 'warning'] as const, { default: 'info' }),
      shouldReflect: true,
    },
    { configKey: 'tags', attribute: 'tags', converter: toList({ default: ['mail', 'work'] }), shouldReflect: true },
    { configKey: 'formatLabelCallback', converter: toFunction<FormatLabelCallback>(), default: null },
  ];

  #root?: ShadowRoot;

  #render(): void {
    const root = (this.#root ??= this.attachShadow({ mode: 'open' }));
    const c = this.config as {
      label: string;
      count: number;
      isCompact: boolean;
      tone: string;
      tags: string[];
      formatLabelCallback: FormatLabelCallback | null;
    };
    const text = c.formatLabelCallback ? c.formatLabelCallback(c.label, c.count) : c.label;
    root.innerHTML = `
      <style>
        :host { display: inline-block; }
        .chip { display: inline-flex; align-items: center; gap: .5rem; padding: .5rem .85rem; border-radius: 999px;
                font: 500 .95rem system-ui, sans-serif; border: 1px solid transparent; }
        .compact { padding: .15rem .5rem; font-size: .8rem; }
        .chip { background: color-mix(in srgb, var(--tone) 12%, transparent); color: var(--tone);
                border-color: color-mix(in srgb, var(--tone) 45%, transparent); }
        .info { --tone: var(--kmwc-info-color, #075985); }
        .success { --tone: var(--kmwc-success-color, #166534); }
        .warning { --tone: var(--kmwc-warning-color, #92400e); }
        .count { background: currentColor; border-radius: 999px; min-width: 1.4em; text-align: center; }
        .count span { color: var(--kmwc-main-bg, #fff); font-size: .8em; padding: 0 .35em; }
        .tag { font-size: .75em; opacity: .8; }
      </style>
      <span class="chip ${esc(c.tone)}${c.isCompact ? ' compact' : ''}" part="chip">
        <span class="label">${esc(text)}</span>
        <span class="count"><span>${esc(c.count)}</span></span>
        ${c.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}
      </span>`;
  }

  protected override reinit(): void {
    this.#render();
  }

  protected override update(): void {
    this.#render();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// <core-demo-reactivity> — IN03 / IN04
// ─────────────────────────────────────────────────────────────────────────────

/** What the last `reinit()` / `update()` actually applied to the DOM. */
export interface RenderedState {
  caption: string;
  accent: string;
  layout: string;
  pageSize: number;
}

export class CoreDemoReactivity extends BlissElement<HookEvents> {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'caption', attribute: 'caption', converter: toText({ default: 'Report' }), on: 'update' },
    {
      configKey: 'accent',
      attribute: 'accent',
      converter: toEnum(['blue', 'green', 'red'] as const, { default: 'blue' }),
      on: 'update',
    },
    { configKey: 'layout', attribute: 'layout', converter: toEnum(['list', 'grid'] as const, { default: 'list' }), on: 'reinit' },
    { configKey: 'pageSize', attribute: 'page-size', converter: toInt({ min: 1, max: 12, default: 4 }), on: 'reinit' },
    { configKey: 'note', attribute: 'note', converter: toText(), on: 'none' },
  ];

  protected static override events = ['hook'];

  reinitCount = 0;
  updateCount = 0;
  #rendered: RenderedState | null = null;
  #root?: ShadowRoot;

  get #cfg(): RenderedState {
    const c = this.config;
    return { caption: c.caption as string, accent: c.accent as string, layout: c.layout as string, pageSize: c.pageSize as number };
  }

  /** Full rebuild: the whole shadow tree, from the merged `this.config`. */
  protected override reinit(): void {
    this.reinitCount += 1;
    this.#rendered = this.#cfg;
    const root = (this.#root ??= this.attachShadow({ mode: 'open' }));
    const { layout, pageSize } = this.#rendered;
    root.innerHTML = `
      <style>
        :host { display: block; }
        .box { border: 2px solid var(--accent); border-radius: 10px; padding: .6rem .8rem; font: .9rem system-ui, sans-serif; }
        .head { display: flex; justify-content: space-between; color: var(--accent); font-weight: 600; margin-bottom: .45rem; }
        .stamp { font: .75rem ui-monospace, monospace; opacity: .75; }
        .cells { display: grid; gap: .3rem; }
        .grid .cells { grid-template-columns: repeat(4, 1fr); }
        .cell { background: color-mix(in srgb, var(--accent) 14%, transparent); border-radius: 6px; padding: .2rem .45rem; font-size: .8rem; }
      </style>
      <div class="box ${layout}">
        <div class="head"><span class="caption"></span><span class="stamp">build #${this.reinitCount}</span></div>
        <div class="cells">${Array.from({ length: pageSize }, (_, i) => `<div class="cell">row ${i + 1}</div>`).join('')}</div>
      </div>`;
    this.#patch();
    this.emit('hook', { hook: 'reinit', reinitCount: this.reinitCount, updateCount: this.updateCount });
  }

  /** In-place patch: only the changed `on: 'update'` keys arrive in `partial`. */
  protected override update(partial: Record<string, unknown>): void {
    this.updateCount += 1;
    this.#rendered = { ...this.#rendered!, ...(partial as Partial<RenderedState>) };
    this.#patch();
    this.emit('hook', { hook: 'update', partial: { ...partial }, reinitCount: this.reinitCount, updateCount: this.updateCount });
  }

  #patch(): void {
    const root = this.#root;
    if (!root || !this.#rendered) return;
    const colors: Record<string, string> = { blue: '#2563eb', green: '#16a34a', red: '#dc2626' };
    (root.querySelector('.box') as HTMLElement).style.setProperty('--accent', colors[this.#rendered.accent] ?? '#2563eb');
    root.querySelector('.caption')!.textContent = this.#rendered.caption;
  }

  /** Imperative read WITHOUT flushing first — sees pre-write state after a loose assignment. */
  readRenderedWithoutFlush(): RenderedState | null {
    return this.#rendered && { ...this.#rendered };
  }

  /** Imperative read done right: `this.flush()` first, so `el.x = …; el.readRendered()` sees `x`. */
  readRendered(): RenderedState | null {
    this.flush();
    return this.#rendered && { ...this.#rendered };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// <core-demo-presets> — IN05
// ─────────────────────────────────────────────────────────────────────────────

const MODE_PRESETS: Record<string, Record<string, unknown> | null> = {
  simple: { editTrigger: 'click', hasGridLines: false },
  excel: { editTrigger: 'dblclick', hasGridLines: true },
  custom: null, // set nothing else
};

const isString = (v: unknown): v is string => typeof v === 'string';

export class CoreDemoPresets extends BlissElement<HookEvents> {
  protected static override inputs: readonly InputDef[] = [
    {
      configKey: 'mode',
      attribute: 'mode',
      converter: toEnum(['simple', 'excel', 'custom'] as const, { default: 'simple' }),
      shouldReflect: true,
      on: 'update',
      // One input sets others IN THE SAME BATCH (one update / reinit).
      getBatchValuesCallback: (mode) => MODE_PRESETS[mode as string] ?? null,
    },
    {
      configKey: 'editTrigger',
      attribute: 'edit-trigger',
      converter: toEnum(['click', 'dblclick', 'none'] as const, { default: 'click' }),
      shouldReflect: true,
      on: 'update',
    },
    { configKey: 'hasGridLines', attribute: 'grid-lines', converter: toBool('presence'), shouldReflect: true, on: 'update' },
    {
      configKey: 'items',
      converter: toObjectArray({ validateItem: isString, default: [] }),
      on: 'reinit',
      // The getter returns the LIVE rows (user-added ones included), not the assigned array.
      getLiveValue: (el: CoreDemoPresets) => el.#liveItems && [...el.#liveItems],
    },
  ];

  protected static override events = ['hook'];

  reinitCount = 0;
  updateCount = 0;
  #liveItems?: string[];
  #root?: ShadowRoot;

  /** Demo-only window onto `this.config.items` — the ASSIGNED value, which `getLiveValue` leaves alone. */
  get assignedItems(): readonly string[] {
    return this.config.items as string[];
  }

  /** Component-owned mutation (what a user editing rows would do). */
  addRow(text = `Row ${(this.#liveItems?.length ?? 0) + 1}`): void {
    this.flush();
    this.#liveItems?.push(text);
    this.#renderRows();
  }

  protected override reinit(): void {
    this.reinitCount += 1;
    this.#liveItems = [...(this.config.items as string[])];
    const root = (this.#root ??= this.attachShadow({ mode: 'open' }));
    root.innerHTML = `
      <style>
        :host { display: block; font: .9rem system-ui, sans-serif; }
        .meta { font: .8rem ui-monospace, monospace; margin-bottom: .4rem; opacity: .8; }
        table { border-collapse: collapse; min-width: 14rem; }
        td { padding: .25rem .6rem; }
        .lines td { border: 1px solid var(--kmwc-border-color-strong, #94a3b8); }
        button { margin-top: .5rem; }
      </style>
      <div class="meta"></div>
      <table><tbody></tbody></table>
      <button type="button" part="add-row" class="add-row">+ Add row (inside the component)</button>`;
    root.querySelector('.add-row')!.addEventListener('click', () => this.addRow());
    this.#renderRows();
    this.#renderMeta();
    this.emit('hook', { hook: 'reinit', reinitCount: this.reinitCount, updateCount: this.updateCount });
  }

  protected override update(partial: Record<string, unknown>): void {
    this.updateCount += 1;
    this.#renderRows();
    this.#renderMeta();
    this.emit('hook', { hook: 'update', partial: { ...partial }, reinitCount: this.reinitCount, updateCount: this.updateCount });
  }

  #renderMeta(): void {
    const c = this.config;
    this.#root!.querySelector('.meta')!.textContent = `mode=${c.mode} · edit on ${c.editTrigger} · grid lines ${c.hasGridLines ? 'on' : 'off'}`;
  }

  #renderRows(): void {
    const table = this.#root?.querySelector('table');
    if (!table) return;
    table.className = this.config.hasGridLines ? 'lines' : '';
    table.tBodies[0]!.innerHTML = (this.#liveItems ?? []).map((t) => `<tr><td>${esc(t)}</td></tr>`).join('') ||
      '<tr><td><em>no rows</em></td></tr>';
  }
}

define('core-demo-inputs', CoreDemoInputs as unknown as CustomElementConstructor);
define('core-demo-reactivity', CoreDemoReactivity as unknown as CustomElementConstructor);
define('core-demo-presets', CoreDemoPresets as unknown as CustomElementConstructor);
