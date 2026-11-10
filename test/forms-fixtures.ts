/**
 * Minimal BlissElements for test/forms.html (e2e/forms.spec.ts — SPEC §6.4 / §6.6).
 *
 *   - <fx-field>  form-associated quantity field. Submits through a LIGHT-DOM hidden
 *                 <input name> (Keenmate convention; never setFormValue). A value that
 *                 isn't a whole number → setFormatError(err, undefined, inner input) and
 *                 the hidden input submits ''. Its own formResetCallback (core has none)
 *                 returns to the `value` attribute. Hook calls land in `hooks`.
 *   - <fx-plain>  a BlissElement WITHOUT formAssociated (the "no constraint" answers).
 */
import { BlissElement, define, toBool, toText } from '../src/index.js';
import type { InputDef } from '../src/index.js';

export class FxField extends BlissElement {
  static formAssociated = true;

  protected static override inputs: readonly InputDef[] = [
    { configKey: 'name', attribute: 'name', converter: toText({ default: '' }), on: 'reinit' },
    // Not reflected: like a native input, the `value` ATTRIBUTE is the reset default.
    { configKey: 'value', attribute: 'value', converter: toText({ default: '' }) },
    { configKey: 'isDisabled', attribute: 'disabled', converter: toBool('presence'), default: false, shouldReflect: true },
  ];

  declare value: string;
  declare isDisabled: boolean;

  /** `disabledChanged(x)` / `formResetCallback` calls, in order. */
  hooks: string[] = [];
  inner?: HTMLInputElement;
  hiddenInput?: HTMLInputElement;

  /** Test access to the protected disabled state. */
  get disabledState(): { isFormDisabled: boolean; isEffectivelyDisabled: boolean } {
    return { isFormDisabled: this.isFormDisabled, isEffectivelyDisabled: this.isEffectivelyDisabled };
  }

  /** Test access to the protected setFormatError(). */
  testSetFormatError(error: unknown, message?: string, anchor?: 'inner' | 'foreign'): void {
    const target = anchor === 'inner' ? this.inner : anchor === 'foreign' ? document.body : undefined;
    this.setFormatError(error, message, target);
  }

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = '<input class="inner" inputmode="numeric" size="8">';
    this.inner = root.querySelector('.inner') as HTMLInputElement;
    this.inner.value = this.config.value as string;
    this.inner.addEventListener('input', () => {
      this.value = this.inner!.value;
      this.flush();
      this.dispatchEvent(new Event('change', { bubbles: true }));
    });
    if (!this.hiddenInput) {
      this.hiddenInput = document.createElement('input');
      this.hiddenInput.type = 'hidden';
      this.append(this.hiddenInput);
    }
    this.hiddenInput.name = this.config.name as string;
    // A host associated by form="id" lives outside the <form>: its light-DOM child must point there too.
    const formAttr = this.getAttribute('form');
    if (formAttr) this.hiddenInput.setAttribute('form', formAttr);
    else this.hiddenInput.removeAttribute('form');
    this.#applyDisabled(this.isEffectivelyDisabled);
    this.#produceValue();
  }

  protected override update(partial: Record<string, unknown>): void {
    // isDisabled arrives here too — ignored: disabledChanged() applies it (SPEC §6.4).
    if ('value' in partial) {
      if (this.inner && this.inner.value !== partial.value) this.inner.value = partial.value as string;
      this.#produceValue();
    }
  }

  protected override disabledChanged(isDisabled: boolean): void {
    this.#applyDisabled(isDisabled);
    this.hooks.push(`disabledChanged(${isDisabled})`);
  }

  formResetCallback(): void {
    this.value = this.getAttribute('value') ?? '';
    this.flush();
    this.hooks.push(`formResetCallback → ${JSON.stringify(this.value)}`);
  }

  #applyDisabled(isDisabled: boolean): void {
    if (this.inner) this.inner.disabled = isDisabled;
    // The host's own `disabled` doesn't disable a light-DOM input — do it here.
    if (this.hiddenInput) this.hiddenInput.disabled = isDisabled;
  }

  #produceValue(): void {
    const raw = (this.config.value as string).trim();
    if (raw === '' || /^-?\d+$/.test(raw)) {
      if (this.hiddenInput) this.hiddenInput.value = raw === '' ? '' : String(Number(raw));
      this.setFormatError(null);
      return;
    }
    if (this.hiddenInput) this.hiddenInput.value = '';
    this.setFormatError(new Error(`"${raw}" is not a whole number`), undefined, this.inner);
  }
}

export class FxPlain extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'plain' }), on: 'reinit' },
  ];
}

define('fx-field', FxField as unknown as CustomElementConstructor);
define('fx-plain', FxPlain as unknown as CustomElementConstructor);
