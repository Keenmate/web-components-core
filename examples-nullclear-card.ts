/**
 * `<nullclear-card>` — a tiny demo `BlissElement` for eyeballing the null-clear
 * contract (SPEC §6.1) WITHOUT pulling in one of the five real KM components.
 *
 * It renders a 3-row "tree" whose middle row is focused, and drives a stub
 * engine exactly like `TreeController.updateProps` does — the `!== undefined`
 * guard lets a partial resend omit untouched keys, and `focusedNodeClass` is a
 * clearable field (direct assign; `null` clears, resolved to a built-in default
 * at apply time).
 *
 * The teaching knob is `assembleMode`:
 *   - `'preserve'` — assemble via `this.engineConfig(...)` (the fix): a cleared
 *     `focused-node-class` reaches the engine as `{ focusedNodeClass: null }`,
 *     so the row reverts to the built-in default.
 *   - `'strip'`    — layer the OLD per-component `if (v === null) delete` loop on
 *     top: the cleared key is dropped, the engine's guard skips it, and the stale
 *     custom class sticks. This is the bug the contract fixes.
 *
 * Demo-only — not part of the published package (`files` ships `dist/` only).
 */
import { BlissElement, define, toFunction, toText } from './src/index.js';
import type { InputDef } from './src/index.js';

const DEFAULT_FOCUS_CLASS = 'nc-focus-default';
const NON_ENGINE_KEYS = ['onEngineUpdate'] as const;

type EngineUpdateInfo = {
  received: Record<string, unknown>;
  sawKey: boolean;
  appliedClass: string;
};

/** Stub engine — the `!== undefined` guard + a clearable field, per SPEC §6.1. */
class StubEngine {
  #focusedClass: string | null = null;
  constructor(private readonly apply: (cssClass: string) => void) {}
  updateProps(updates: Record<string, unknown>): EngineUpdateInfo {
    // Clearable field: present-with-null clears it; absent/undefined leaves it.
    if (updates.focusedNodeClass !== undefined) this.#focusedClass = updates.focusedNodeClass as string | null;
    const appliedClass = this.#focusedClass ?? DEFAULT_FOCUS_CLASS; // null → built-in default
    this.apply(appliedClass);
    return { received: updates, sawKey: 'focusedNodeClass' in updates, appliedClass };
  }
}

export class NullclearCard extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'focusedNodeClass', attribute: 'focused-node-class', converter: toText({ isNullable: true }), on: 'update' },
    { configKey: 'onEngineUpdate', converter: toFunction(), on: 'none' },
  ];

  /** Demo-only toggle (not an input): how the engine config is assembled. */
  assembleMode: 'preserve' | 'strip' = 'preserve';

  #engine?: StubEngine;
  #focusedRow?: HTMLElement;

  #render(): void {
    const root = this.attachShadow ? (this.shadowRoot ?? this.attachShadow({ mode: 'open' })) : null;
    if (!root) return;
    root.innerHTML = `
      <style>
        .nc-list { display: grid; gap: .4rem; }
        .nc-row { padding: .55rem .8rem; border-radius: 8px; background: #f1f5f9; font: 500 .95rem system-ui; }
        .nc-focused { position: relative; }
        .nc-focus-default { box-shadow: inset 3px 0 0 #3b82f6; background: #eff6ff; }
        .ring-gold { box-shadow: inset 3px 0 0 #d97706; background: #fffbeb; }
        .ring-red  { box-shadow: inset 3px 0 0 #dc2626; background: #fef2f2; }
      </style>
      <div class="nc-list">
        <div class="nc-row">Row 1</div>
        <div class="nc-row nc-focused ${DEFAULT_FOCUS_CLASS}" id="focused">Row 2 (focused)</div>
        <div class="nc-row">Row 3</div>
      </div>`;
    this.#focusedRow = root.getElementById('focused') as HTMLElement;
  }

  /** Build the engine config the way the demo's current mode dictates. */
  #assemble(partial: Record<string, unknown>): Record<string, unknown> {
    const cfg = this.engineConfig(NON_ENGINE_KEYS); // nulls PRESERVED
    Object.assign(cfg, partial);
    if (this.assembleMode === 'strip') {
      // The old per-component bug, layered back on for contrast.
      for (const k of Object.keys(cfg)) if (cfg[k] === null) delete cfg[k];
    }
    return cfg;
  }

  #drive(partial: Record<string, unknown>): void {
    if (!this.#engine) return;
    const info = this.#engine.updateProps(this.#assemble(partial));
    if (this.#focusedRow) this.#focusedRow.className = `nc-row nc-focused ${info.appliedClass}`;
    const cb = this.config.onEngineUpdate as ((info: EngineUpdateInfo) => void) | null;
    cb?.(info);
  }

  protected override reinit(): void {
    this.#render();
    this.#engine = new StubEngine(() => {});
    this.#drive({}); // first paint from full config
  }

  protected override update(partial: Record<string, unknown>): void {
    this.#drive(partial);
  }
}

define('nullclear-card', NullclearCard as unknown as CustomElementConstructor);
