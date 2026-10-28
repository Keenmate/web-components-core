import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';

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
  };
  return internals;
}

class FormatField extends BlissElement {
  static formAssociated = true;
  fail(error: unknown | null, message?: string, anchor?: HTMLElement): void {
    this.setFormatError(error, message, anchor);
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
});
