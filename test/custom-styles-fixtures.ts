/**
 * <fx-cs> for test/custom-styles.html (e2e/custom-styles.spec.ts — SPEC §12.8 custom CSS).
 * Its own CSS sits in `@layer component` (the KeenMate authoring rule), adopted as a shared
 * sheet; custom CSS goes through createCustomStyles(): the page layer
 * (window.components['fx-cs'].customStyles / .getCustomStylesCallback) then the instance layer
 * (custom-styles attribute / getCustomStylesCallback property).
 */
import { BlissElement, adoptStyles, createCustomStyles, registerComponent, toFunction, toText } from '../src/index.js';
import type { CustomStylesCallback, CustomStylesHandle, InputDef } from '../src/index.js';

const MAIN_CSS = '@layer component { .day { color: rgb(255, 0, 0); padding: 2px; } }';

export interface FxCsContext {
  element: HTMLElement;
  label: string;
}

export class FxCs extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'day' }), on: 'update' },
    { configKey: 'customStyles', attribute: 'custom-styles', converter: toText({ isNullable: true }), on: 'update' },
    { configKey: 'getCustomStylesCallback', converter: toFunction<CustomStylesCallback<FxCsContext>>(), default: null, on: 'update' },
  ];

  #styles?: CustomStylesHandle;

  /** The rendered day's computed colour (what the e2e asserts). */
  get dayColor(): string {
    const day = this.shadowRoot?.querySelector('.day');
    return day ? getComputedStyle(day).color : '';
  }

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    adoptStyles(root, MAIN_CSS);
    root.querySelector('.day')?.remove();
    const day = document.createElement('span');
    day.className = 'day';
    day.textContent = this.config.label as string;
    root.append(day);
    this.#styles ??= createCustomStyles<FxCsContext>(this, root, {
      cssClass: 'fx-cs-custom',
      getContext: () => ({ element: this, label: this.config.label as string }),
      getInstanceStyles: () => ({
        css: this.config.customStyles as string | null,
        callback: this.config.getCustomStylesCallback as CustomStylesCallback<FxCsContext> | null,
      }),
    });
    this.#styles.refresh();
  }

  protected override update(partial: Record<string, unknown>): void {
    if ('label' in partial) this.shadowRoot!.querySelector('.day')!.textContent = this.config.label as string;
    this.#styles?.refresh();
  }

  protected override destroyCallback(): void {
    this.#styles?.destroy();
  }
}

registerComponent('fx-cs', FxCs as unknown as CustomElementConstructor, { config: { name: 'fx-cs', version: '0.0.0' } });
