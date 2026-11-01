/**
 * Demo `BlissElement`s for the forms example page (examples-forms.html, chapter FO —
 * SPEC §6.4 disabled state, §6.6 form validity).
 *
 *   - `<core-demo-field>`  a form-associated quantity field (`static formAssociated = true`).
 *                          It follows the KeenMate submission convention: the value is
 *                          submitted by a LIGHT-DOM hidden `<input name>` the component
 *                          renders as its own child — the host never calls
 *                          `internals.setFormValue()`. Form association is kept for
 *                          `el.form`, `formDisabledCallback` (core) and the validity API.
 *                          A value that isn't a whole number can't be produced →
 *                          `setFormatError(err, message, anchor)`; the hidden input submits ''.
 *                          `formResetCallback` is the COMPONENT's (core implements none).
 *   - `<core-demo-plain>`  the same idea without `formAssociated` — the "no constraint"
 *                          answers (`validity` undefined, `checkValidity()` true, …).
 *
 * Every applied state is reported through a `field-log` event so the page can show it.
 *
 * Demo-only — not part of the published package (`files` ships `dist/` only).
 */
import { BlissElement, define, toBool, toText } from './src/index.js';
import type { InputDef } from './src/index.js';

/** What the page's log receives (`field-log` event detail). */
export interface FieldLogDetail {
  /** `reinit` | `update` | `disabledChanged` | `formResetCallback` | `setFormatError` | `typed` */
  kind: string;
  text: string;
}

type FieldEvents = { 'field-log': FieldLogDetail; change: { value: string } };

// Page tokens (--kmwc-*) inherit into the shadow root, so the field matches the kit's native controls.
const STYLES = `
  :host { display: inline-block; vertical-align: top; }
  .f { display: grid; gap: .25rem; font-size: .875rem; font-weight: 500; min-width: 12rem; color: var(--kmwc-text-color-1); }
  .f input { font: inherit; font-weight: 400; min-height: var(--kmwc-control-height, 2.25rem); padding: 0 .75rem;
             border-radius: var(--kmwc-radius-sm, 6px); width: 100%; box-sizing: border-box;
             border: var(--kmwc-input-border, 1px solid #94a3b8); background: var(--kmwc-input-bg, Field);
             color: var(--kmwc-input-color, inherit); }
  .f input:hover { border: var(--kmwc-input-border-hover, 1px solid #94a3b8); }
  .f input:focus { outline: none; border: var(--kmwc-input-border-focus, 1px solid Highlight);
                   box-shadow: var(--kmwc-input-box-shadow-focus, none); }
  .f input:disabled { opacity: var(--kmwc-disabled-opacity, .55); background: var(--kmwc-input-disabled-bg, transparent); cursor: not-allowed; }
  :host(:invalid) .f input { border-color: var(--kmwc-danger-color, #dc2626);
                             box-shadow: 0 0 0 2px color-mix(in srgb, var(--kmwc-danger-color, #dc2626) 25%, transparent); }
  .f .hint { font: .72rem var(--kmwc-mono-font-family, ui-monospace, monospace); color: var(--kmwc-text-color-3); }
  :host(:disabled) .f .lbl::after { content: ' (disabled)'; font-weight: 400; color: var(--kmwc-text-color-3); }
`;

export class CoreDemoField extends BlissElement<FieldEvents> {
  static formAssociated = true;

  protected static override inputs: readonly InputDef[] = [
    { configKey: 'name', attribute: 'name', converter: toText({ default: '' }), on: 'reinit' },
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'Quantity' }), on: 'reinit' },
    // Not reflected: like a native input, the `value` ATTRIBUTE is the default value a form reset returns to.
    { configKey: 'value', attribute: 'value', converter: toText({ default: '' }) },
    // SPEC §6.4: must reflect on a form-associated element.
    { configKey: 'isDisabled', attribute: 'disabled', converter: toBool('presence'), default: false, shouldReflect: true },
  ];

  protected static override events = ['field-log', 'change'];

  // Generated input accessors (typed for this file).
  declare value: string;
  declare isDisabled: boolean;

  #root?: ShadowRoot;
  #input?: HTMLInputElement;
  #hidden?: HTMLInputElement;

  /** Demo readout of the protected disabled state (SPEC §6.4). */
  get debugDisabled(): { isFormDisabled: boolean; isEffectivelyDisabled: boolean } {
    return { isFormDisabled: this.isFormDisabled, isEffectivelyDisabled: this.isEffectivelyDisabled };
  }

  /** Demo: the light-DOM hidden input that carries the submitted value. */
  get hiddenInput(): HTMLInputElement | undefined {
    return this.#hidden;
  }

  /** Demo access to the protected `setFormatError()` (FO03 buttons). */
  demoSetFormatError(error: unknown | null, message?: string, anchor?: 'inner' | 'foreign'): void {
    const target = anchor === 'inner' ? this.#input : anchor === 'foreign' ? document.body : undefined;
    this.setFormatError(error, message, target);
    this.#log('setFormatError', error === null ? 'null → valid' : `→ "${this.validationMessage}"`);
  }

  #log(kind: string, text: string): void {
    this.emit('field-log', { kind, text });
  }

  protected override reinit(): void {
    const root = (this.#root ??= this.attachShadow({ mode: 'open' }));
    root.innerHTML = `<style>${STYLES}</style>
      <label class="f" part="field"><span class="lbl"></span><input class="inner" inputmode="numeric" autocomplete="off"><span class="hint"></span></label>`;
    root.querySelector('.lbl')!.textContent = this.config.label as string;
    this.#input = root.querySelector('.inner') as HTMLInputElement;
    this.#input.value = this.config.value as string;
    this.#input.addEventListener('input', () => {
      this.value = this.#input!.value;
      this.flush(); // apply now, so the hidden input / validity are current inside this handler
      this.#log('typed', JSON.stringify(this.#input!.value));
      this.emit('change', { value: this.#input!.value });
    });

    // Light-DOM hidden input: THIS is what the form submits (KeenMate convention).
    if (!this.#hidden) {
      this.#hidden = document.createElement('input');
      this.#hidden.type = 'hidden';
      this.append(this.#hidden);
    }
    this.#hidden.name = this.config.name as string;
    // A host associated by `form="id"` lives outside the <form>, so its light-DOM child must point there too.
    const formAttr = this.getAttribute('form');
    if (formAttr) this.#hidden.setAttribute('form', formAttr);
    else this.#hidden.removeAttribute('form');

    this.#applyDisabled(this.isEffectivelyDisabled);
    this.#produceValue();
    this.#log('reinit', `name="${this.config.name as string}", isEffectivelyDisabled=${this.isEffectivelyDisabled}`);
  }

  protected override update(partial: Record<string, unknown>): void {
    // isDisabled arrives here too — ignored: disabledChanged() applies it (SPEC §6.4).
    if ('value' in partial) {
      if (this.#input && this.#input.value !== partial.value) this.#input.value = partial.value as string;
      this.#produceValue();
    }
    this.#log('update', JSON.stringify(Object.keys(partial)));
  }

  protected override disabledChanged(isDisabled: boolean): void {
    this.#applyDisabled(isDisabled);
    this.#log('disabledChanged', `(${isDisabled})`);
  }

  /** The component's own reset (core implements no formResetCallback): back to the `value` attribute. */
  formResetCallback(): void {
    this.value = this.getAttribute('value') ?? '';
    this.flush();
    this.#log('formResetCallback', `value → ${JSON.stringify(this.value)}`);
  }

  #applyDisabled(isDisabled: boolean): void {
    if (this.#input) this.#input.disabled = isDisabled;
    // A light-DOM input is NOT disabled by the host's own `disabled` attribute — do it here.
    if (this.#hidden) this.#hidden.disabled = isDisabled;
  }

  /** Produce the submitted value: '' + setFormatError when it can't be a whole number. */
  #produceValue(): void {
    const raw = (this.config.value as string).trim();
    const hint = this.#root?.querySelector('.hint');
    if (raw === '' || /^-?\d+$/.test(raw)) {
      if (this.#hidden) this.#hidden.value = raw === '' ? '' : String(Number(raw));
      this.setFormatError(null);
      if (hint) hint.textContent = `submits ${JSON.stringify(this.#hidden?.value ?? '')}`;
      return;
    }
    if (this.#hidden) this.#hidden.value = '';
    this.setFormatError(new Error(`"${raw}" is not a whole number`), undefined, this.#input);
    if (hint) hint.textContent = 'invalid → submits ""';
  }
}

/** The same element without `formAssociated`: core's validity API answers "no constraint". */
export class CoreDemoPlain extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'Not form-associated' }), on: 'reinit' },
  ];

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{display:inline-block;padding:.4rem .7rem;border-radius:var(--kmwc-radius-sm,6px);
      border:1px dashed var(--kmwc-border-color-strong,#94a3b8);font-size:.875rem;font-weight:500}</style><span></span>`;
    root.querySelector('span')!.textContent = this.config.label as string;
  }
}

define('core-demo-field', CoreDemoField as unknown as CustomElementConstructor);
define('core-demo-plain', CoreDemoPlain as unknown as CustomElementConstructor);
