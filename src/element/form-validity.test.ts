import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toBool } from '../inputs/converters.js';

/**
 * jsdom's ElementInternals has no constraint-validation support, so model the
 * browser's: setValidity stores flags + message, the anchor must be a
 * shadow-including descendant, checkValidity fires a cancelable `invalid`.
 */
function fakeInternals(host: HTMLElement) {
  let flags: ValidityStateFlags = {};
  let message = '';
  const valid = (): boolean => !Object.values(flags).some(Boolean);
  const internals = {
    form: null,
    willValidate: true,
    get validity() {
      return { ...flags, valid: valid() } as unknown as ValidityState;
    },
    get validationMessage() {
      return message;
    },
    setValidity: vi.fn((next: ValidityStateFlags = {}, msg?: string, anchor?: HTMLElement) => {
      const invalid = Object.values(next).some(Boolean);
      if (invalid && !msg) throw new TypeError('message required');
      if (anchor && !host.contains(anchor) && !host.shadowRoot?.contains(anchor)) {
        throw new DOMException('anchor', 'NotFoundError');
      }
      flags = { ...next };
      message = invalid ? msg! : '';
    }),
    checkValidity: vi.fn(() => {
      if (valid()) return true;
      host.dispatchEvent(new Event('invalid', { cancelable: true }));
      return false;
    }),
    reportValidity: vi.fn(() => internals.checkValidity()),
    ariaRequired: null as string | null,
    states: new Set<string>(),
  };
  return internals;
}

class FormatField extends BlissElement {
  static formAssociated = true;
  fail(error: unknown | null, message?: string, anchor?: HTMLElement): void {
    this.setFormatError(error, message, anchor);
  }
  flag(flag: keyof ValidityStateFlags, message: string | null): void {
    this.setValidityFlag(flag, message);
  }
}
define('format-field-element', FormatField as unknown as CustomElementConstructor);

class PlainField extends BlissElement {
  fail(error: unknown | null, message?: string): void {
    this.setFormatError(error, message);
  }
}
define('plain-field-element', PlainField as unknown as CustomElementConstructor);

function make(): { el: FormatField; internals: ReturnType<typeof fakeInternals> } {
  const el = new FormatField();
  const internals = fakeInternals(el);
  vi.spyOn(el, 'attachInternals').mockReturnValue(internals as unknown as ElementInternals);
  return { el, internals };
}

afterEach(() => vi.restoreAllMocks());

describe('form validity API (SPEC §6.6)', () => {
  it('reads validity / validationMessage / willValidate through internals', () => {
    const { el } = make();
    expect(el.validity?.valid).toBe(true);
    expect(el.validationMessage).toBe('');
    expect(el.willValidate).toBe(true);
    expect(el.checkValidity()).toBe(true);
    expect(el.reportValidity()).toBe(true);
  });

  it('setFormatError(error, message) marks the host invalid; null clears it', () => {
    const { el, internals } = make();
    const onInvalid = vi.fn();
    el.addEventListener('invalid', onInvalid);

    el.fail(new Error('boom'), 'The value could not be formatted.');
    expect(internals.setValidity).toHaveBeenLastCalledWith({ customError: true }, 'The value could not be formatted.');
    expect(el.validity?.valid).toBe(false);
    expect(el.validity?.customError).toBe(true);
    expect(el.validationMessage).toBe('The value could not be formatted.');
    expect(el.checkValidity()).toBe(false);
    expect(el.reportValidity()).toBe(false);
    expect(onInvalid).toHaveBeenCalledTimes(2);

    el.fail(null);
    expect(internals.setValidity).toHaveBeenLastCalledWith({});
    expect(el.validity?.valid).toBe(true);
    expect(el.validationMessage).toBe('');
    expect(el.checkValidity()).toBe(true);
  });

  it('falls back to the error message, a string error, then a generic message', () => {
    const { el } = make();
    el.fail(new Error('bad date'));
    expect(el.validationMessage).toBe('bad date');
    el.fail('nope');
    expect(el.validationMessage).toBe('nope');
    el.fail({ code: 1 });
    expect(el.validationMessage).toBe('The value is invalid.');
  });

  it('passes an anchor through; a rejected anchor is dropped with a warning', () => {
    const { el, internals } = make();
    const inside = document.createElement('input');
    el.appendChild(inside);
    el.fail(new Error('x'), 'msg', inside);
    expect(internals.setValidity).toHaveBeenLastCalledWith({ customError: true }, 'msg', inside);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outside = document.createElement('input');
    el.fail(new Error('x'), 'msg', outside);
    expect(internals.setValidity).toHaveBeenLastCalledWith({ customError: true }, 'msg');
    expect(el.validity?.customError).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('is inert on a non-form-associated class (no attachInternals, no-constraint answers)', () => {
    const el = new PlainField();
    const spy = vi.spyOn(el, 'attachInternals');
    el.fail(new Error('x'), 'msg');
    expect(el.validity).toBeUndefined();
    expect(el.validationMessage).toBe('');
    expect(el.willValidate).toBe(false);
    expect(el.checkValidity()).toBe(true);
    expect(el.reportValidity()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('degrades when attachInternals is unavailable (SSR / older jsdom)', () => {
    const el = new FormatField();
    Object.defineProperty(el, 'attachInternals', { value: undefined, configurable: true });
    expect(() => el.fail(new Error('x'))).not.toThrow();
    expect(el.validity).toBeUndefined();
    expect(el.checkValidity()).toBe(true);
  });

  it('setValidityFlag keeps each flag on its own: clearing one never clears another', () => {
    const { el } = make();
    el.flag('valueMissing', 'Add at least 2 files.');
    expect(el.validity?.valueMissing).toBe(true);
    expect(el.validationMessage).toBe('Add at least 2 files.');
    el.fail(new Error('bad format'));
    expect(el.validity?.customError).toBe(true);
    expect(el.validity?.valueMissing).toBe(true);
    expect(el.validationMessage).toBe('Add at least 2 files.'); // the earliest flag still set
    el.fail(null); // clearing the format error keeps valueMissing
    expect(el.validity?.customError).toBeFalsy();
    expect(el.validity?.valueMissing).toBe(true);
    el.flag('valueMissing', null);
    expect(el.validity?.valid).toBe(true);
    expect(el.validationMessage).toBe('');
  });
});

class RequiredField extends BlissElement {
  static formAssociated = true;
  static override inputs = [
    { configKey: 'isRequired', attribute: 'required', converter: toBool('presence'), default: false, shouldReflect: true, on: 'update' as const },
    { configKey: 'isReadonly', attribute: 'readonly', converter: toBool('presence'), default: false, shouldReflect: true, on: 'update' as const },
    { configKey: 'isDisabled', attribute: 'disabled', converter: toBool('presence'), default: false, shouldReflect: true, on: 'update' as const },
  ];
  value: string[] = [];
  anchor?: HTMLElement;
  setValue(next: string[]): void {
    this.value = next;
    this.refreshRequired();
  }
  protected override isValueEmpty(): boolean {
    return this.value.length === 0;
  }
  protected override getRequiredMessage(): string {
    return 'Pick something.';
  }
  protected override getValidityAnchor(): HTMLElement | undefined {
    return this.anchor;
  }
}
define('required-field-element', RequiredField as unknown as CustomElementConstructor);

class RequiredFlagField extends FormatField {}
define('required-flag-field-element', RequiredFlagField as unknown as CustomElementConstructor);

describe('isRequired → valueMissing (SPEC §6.6)', () => {
  function mount(attrs = ''): { el: RequiredField & Record<string, unknown>; internals: ReturnType<typeof fakeInternals> } {
    const el = new RequiredField() as RequiredField & Record<string, unknown>;
    const internals = fakeInternals(el);
    vi.spyOn(el, 'attachInternals').mockReturnValue(internals as unknown as ElementInternals);
    for (const name of attrs.split(' ').filter(Boolean)) el.setAttribute(name, '');
    document.body.append(el);
    return { el, internals };
  }
  afterEach(() => document.body.replaceChildren());

  it('required + empty → valueMissing with the component message, aria-required, :state(required); a value clears it', async () => {
    const { el, internals } = mount('required');
    await el.whenSettled();
    expect(el.validity?.valueMissing).toBe(true);
    expect(el.validationMessage).toBe('Pick something.');
    expect(internals.ariaRequired).toBe('true');
    expect(internals.states.has('required')).toBe(true);
    el.setValue(['a']);
    expect(el.validity?.valid).toBe(true);
    el.setValue([]);
    expect(el.validity?.valueMissing).toBe(true);
  });

  it('toggling isRequired re-evaluates on the flush; not required → valid, no aria-required / state', async () => {
    const { el, internals } = mount();
    await el.whenSettled();
    expect(el.validity?.valid).toBe(true);
    expect(internals.ariaRequired).toBeNull();
    el.isRequired = true;
    await el.whenSettled();
    expect(el.validity?.valueMissing).toBe(true);
    el.isRequired = false;
    await el.whenSettled();
    expect(el.validity?.valid).toBe(true);
    expect(internals.states.has('required')).toBe(false);
  });

  it('readonly / disabled is never missing (native semantics); the flag returns when it is editable again', async () => {
    const { el } = mount('required readonly');
    await el.whenSettled();
    expect(el.validity?.valid).toBe(true);
    el.isReadonly = false;
    await el.whenSettled();
    expect(el.validity?.valueMissing).toBe(true);
    el.isDisabled = true;
    await el.whenSettled();
    expect(el.validity?.valid).toBe(true);
  });

  it('keeps the other flags (a format error) and passes the anchor', async () => {
    const { el, internals } = mount('required');
    const anchor = document.createElement('input');
    el.append(anchor);
    el.anchor = anchor;
    el.setValue([]);
    await el.whenSettled();
    expect(internals.setValidity).toHaveBeenLastCalledWith({ valueMissing: true }, 'Pick something.', anchor);
    (el as unknown as { setFormatError(e: unknown): void }).setFormatError.call(el, new Error('bad'));
    el.setValue(['a']);
    expect(el.validity?.customError).toBe(true);
    expect(el.validity?.valueMissing).toBeFalsy();
  });

  it('a class without an isRequired row never touches valueMissing (its own flag stays)', async () => {
    const el = new RequiredFlagField();
    const internals = fakeInternals(el);
    vi.spyOn(el, 'attachInternals').mockReturnValue(internals as unknown as ElementInternals);
    document.body.append(el);
    el.flag('valueMissing', 'Mine.');
    el.setAttribute('data-x', '1');
    (el as unknown as { flush(): void }).flush();
    expect(el.validity?.valueMissing).toBe(true);
    expect(el.validationMessage).toBe('Mine.');
  });
});
