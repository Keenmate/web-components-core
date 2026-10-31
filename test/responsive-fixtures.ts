/**
 * Minimal BlissElements for test/responsive.html (e2e/responsive.spec.ts, SPEC §6.7).
 *
 * Each records every reinit() / update(partial) in `calls` so the spec can assert
 * on the hook flow directly. Distinct configKeys per tag keep page-wide rules
 * (which apply to every component that has the key) from leaking between them.
 *
 *   - <fx-rs-map>       layout (reinit), columns, presentation
 *   - <fx-rs-layers>    accent, density, label, badge — registered via registerComponent
 *                       so the per-tag window.components[tag].responsive* layer exists
 *   - <fx-rs-callback>  isCompact, cols
 */
import { BlissElement, define, registerComponent, toBool, toEnum, toInt, toText } from '../src/index.js';
import type { InputDef } from '../src/index.js';

export type HookCall = { kind: 'reinit' } | { kind: 'update'; partial: Record<string, unknown> };

abstract class RsFixture extends BlissElement {
  calls: HookCall[] = [];

  get reinitCount(): number {
    return this.calls.filter((c) => c.kind === 'reinit').length;
  }

  get updateCount(): number {
    return this.calls.filter((c) => c.kind === 'update').length;
  }

  protected override reinit(): void {
    this.calls.push({ kind: 'reinit' });
    this.#paint();
  }

  protected override update(partial: Record<string, unknown>): void {
    this.calls.push({ kind: 'update', partial: { ...partial } });
    this.#paint();
  }

  #paint(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host { display: block; overflow-wrap: anywhere; font: 12px ui-monospace, monospace; }</style><span></span>';
    root.querySelector('span')!.textContent = `${this.localName} ${JSON.stringify(this.config)}`;
  }
}

export class FxRsMap extends RsFixture {
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
}

export class FxRsLayers extends RsFixture {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'accent', attribute: 'accent', converter: toEnum(['slate', 'amber', 'teal', 'rose'] as const, { default: 'slate' }), on: 'update' },
    { configKey: 'density', attribute: 'density', converter: toEnum(['comfortable', 'compact', 'spacious'] as const, { default: 'comfortable' }), on: 'update' },
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'base' }), on: 'update' },
    { configKey: 'badge', attribute: 'badge', converter: toText({ default: 'none' }), on: 'update' },
  ];
}

export class FxRsCallback extends RsFixture {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'isCompact', attribute: 'compact', converter: toBool('default-false'), on: 'update' },
    { configKey: 'cols', attribute: 'cols', converter: toInt({ min: 1, max: 6, default: 4 }), on: 'update' },
  ];
}

define('fx-rs-map', FxRsMap as unknown as CustomElementConstructor);
registerComponent('fx-rs-layers', FxRsLayers as unknown as CustomElementConstructor, {
  config: { name: 'fx-rs-layers', version: 'test' },
});
define('fx-rs-callback', FxRsCallback as unknown as CustomElementConstructor);
