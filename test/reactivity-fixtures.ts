/**
 * Fixture elements for test/reactivity.html (e2e/reactivity.spec.ts).
 *
 *   - `<fx-reactivity>` — `on: 'update' | 'reinit' | 'none'` inputs; counts hook
 *     calls, emits a `hook` event per call (detail `{ hook, partial? }`), renders
 *     `.caption` / `.stamp` ("build #N"), and has two imperative reads of what the
 *     last hook applied: `readRenderedWithoutFlush()` (stale after a loose write)
 *     and `readRendered()` (calls `this.flush()` first).
 *   - `<fx-presets>` — `getBatchValuesCallback` (mode sets editTrigger /
 *     hasGridLines in the same batch) and `getLiveValue` (`items` getter returns
 *     the live rows; `assignedItems` exposes `this.config.items`; `addRow()` is
 *     the component-owned mutation, also bound to its shadow `.add-row` button).
 *   - `recordHooks(el, fn)` — the `hook` details `el` emitted while `fn` ran.
 *
 * Test-only; independent of the examples-*-card.ts demo elements.
 */
import { BlissElement, define, toBool, toEnum, toInt, toObjectArray, toText } from '../src/index.js';
import type { InputDef } from '../src/index.js';

export interface HookCall {
  hook: 'reinit' | 'update';
  partial?: Record<string, unknown>;
}

type HookEvents = { hook: HookCall };

export interface RenderedState {
  caption: string;
  accent: string;
  layout: string;
  pageSize: number;
}

export class FxReactivity extends BlissElement<HookEvents> {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'caption', attribute: 'caption', converter: toText({ default: 'Report' }), on: 'update' },
    { configKey: 'accent', attribute: 'accent', converter: toEnum(['blue', 'green', 'red'] as const, { default: 'blue' }), on: 'update' },
    { configKey: 'layout', attribute: 'layout', converter: toEnum(['list', 'grid'] as const, { default: 'list' }), on: 'reinit' },
    { configKey: 'pageSize', attribute: 'page-size', converter: toInt({ min: 1, max: 12, default: 4 }), on: 'reinit' },
    { configKey: 'note', attribute: 'note', converter: toText(), on: 'none' },
  ];

  protected static override events = ['hook'];

  reinitCount = 0;
  updateCount = 0;
  #rendered: RenderedState | null = null;
  #root?: ShadowRoot;

  protected override reinit(): void {
    this.reinitCount += 1;
    const c = this.config;
    this.#rendered = {
      caption: c.caption as string,
      accent: c.accent as string,
      layout: c.layout as string,
      pageSize: c.pageSize as number,
    };
    const root = (this.#root ??= this.attachShadow({ mode: 'open' }));
    root.innerHTML = `<div class="box"><span class="caption"></span> <span class="stamp">build #${this.reinitCount}</span></div>`;
    this.#patch();
    this.emit('hook', { hook: 'reinit' });
  }

  protected override update(partial: Record<string, unknown>): void {
    this.updateCount += 1;
    this.#rendered = { ...this.#rendered!, ...(partial as Partial<RenderedState>) };
    this.#patch();
    this.emit('hook', { hook: 'update', partial: { ...partial } });
  }

  #patch(): void {
    const box = this.#root?.querySelector('.box') as HTMLElement | null;
    if (!box || !this.#rendered) return;
    box.dataset.accent = this.#rendered.accent;
    box.dataset.layout = this.#rendered.layout;
    box.querySelector('.caption')!.textContent = this.#rendered.caption;
  }

  /** Imperative read WITHOUT flushing — sees pre-write state after a loose assignment. */
  readRenderedWithoutFlush(): RenderedState | null {
    return this.#rendered && { ...this.#rendered };
  }

  /** Imperative read done right: `this.flush()` first. */
  readRendered(): RenderedState | null {
    this.flush();
    return this.#rendered && { ...this.#rendered };
  }
}

const MODE_PRESETS: Record<string, Record<string, unknown> | null> = {
  simple: { editTrigger: 'click', hasGridLines: false },
  excel: { editTrigger: 'dblclick', hasGridLines: true },
  custom: null,
};

const isString = (v: unknown): v is string => typeof v === 'string';

export class FxPresets extends BlissElement<HookEvents> {
  protected static override inputs: readonly InputDef[] = [
    {
      configKey: 'mode',
      attribute: 'mode',
      converter: toEnum(['simple', 'excel', 'custom'] as const, { default: 'simple' }),
      shouldReflect: true,
      on: 'update',
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
      getLiveValue: (el: FxPresets) => el.#liveItems && [...el.#liveItems],
    },
  ];

  protected static override events = ['hook'];

  #liveItems?: string[];
  #root?: ShadowRoot;

  /** `this.config.items` — the ASSIGNED value, which `getLiveValue` leaves alone. */
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
    this.#liveItems = [...(this.config.items as string[])];
    const root = (this.#root ??= this.attachShadow({ mode: 'open' }));
    root.innerHTML = '<ul class="rows"></ul><button type="button" class="add-row">add row</button>';
    root.querySelector('.add-row')!.addEventListener('click', () => this.addRow());
    this.#renderRows();
    this.emit('hook', { hook: 'reinit' });
  }

  protected override update(partial: Record<string, unknown>): void {
    this.#renderRows();
    this.emit('hook', { hook: 'update', partial: { ...partial } });
  }

  #renderRows(): void {
    const ul = this.#root?.querySelector('.rows');
    if (!ul) return;
    ul.replaceChildren(
      ...(this.#liveItems ?? []).map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }),
    );
  }
}

/** Record the `hook` details `el` emits while `fn` (sync or async) runs. */
export async function recordHooks(el: HTMLElement, fn: (calls: HookCall[]) => unknown): Promise<HookCall[]> {
  const calls: HookCall[] = [];
  const onHook = (e: Event): void => {
    const { hook, partial } = (e as CustomEvent<HookCall>).detail;
    calls.push(partial ? { hook, partial } : { hook });
  };
  el.addEventListener('hook', onHook);
  try {
    await fn(calls);
  } finally {
    el.removeEventListener('hook', onHook);
  }
  return calls;
}

define('fx-reactivity', FxReactivity as unknown as CustomElementConstructor);
define('fx-presets', FxPresets as unknown as CustomElementConstructor);
