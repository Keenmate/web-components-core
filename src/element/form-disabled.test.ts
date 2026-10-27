import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toBool } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

class FieldElement extends BlissElement {
  static formAssociated = true;
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'isDisabled', attribute: 'disabled', converter: toBool('presence'), default: false, on: 'update', shouldReflect: true },
    { configKey: 'isWide', attribute: 'wide', converter: toBool('presence'), default: false, on: 'reinit' },
  ];
  readonly flips: boolean[] = [];
  builtDisabled?: boolean;
  get effective(): boolean {
    return this.isEffectivelyDisabled;
  }
  get fromFieldset(): boolean {
    return this.isFormDisabled;
  }
  protected override reinit(): void {
    this.builtDisabled = this.isEffectivelyDisabled;
  }
  protected override disabledChanged(isDisabled: boolean): void {
    this.flips.push(isDisabled);
  }
}
define('form-disabled-element', FieldElement as unknown as CustomElementConstructor);

type Field = FieldElement & { isDisabled: boolean; isWide: boolean };

describe('fieldset disabled (formDisabledCallback)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('merges a disabled fieldset with the isDisabled input; the fieldset never writes el.isDisabled', () => {
    const el = document.createElement('form-disabled-element') as Field;
    document.body.appendChild(el);
    expect(el.effective).toBe(false);
    el.formDisabledCallback(true);
    expect(el.fromFieldset).toBe(true);
    expect(el.effective).toBe(true);
    expect(el.isDisabled).toBe(false);
    expect(el.flips).toEqual([true]);
    el.formDisabledCallback(true); // unchanged → nothing
    el.formDisabledCallback(false);
    expect(el.flips).toEqual([true, false]);
  });

  it('fires disabledChanged only on a flip of the merged state', async () => {
    const el = document.createElement('form-disabled-element') as Field;
    document.body.appendChild(el);
    el.isDisabled = true;
    await el.whenSettled();
    expect(el.flips).toEqual([true]);
    el.formDisabledCallback(true); // still disabled
    el.isDisabled = false; // fieldset keeps it disabled
    await el.whenSettled();
    expect(el.flips).toEqual([true]);
    el.formDisabledCallback(false);
    expect(el.flips).toEqual([true, false]);
  });

  it('a rebuild reads the state itself (no disabledChanged), and nothing fires before the first build', () => {
    const el = document.createElement('form-disabled-element') as Field;
    el.formDisabledCallback(true);
    expect(el.flips).toEqual([]);
    document.body.appendChild(el);
    expect(el.builtDisabled).toBe(true);
    expect(el.flips).toEqual([]);
    el.batch(() => {
      el.isDisabled = true;
      el.isWide = true;
    });
    el.formDisabledCallback(false);
    el.batch(() => {
      el.isDisabled = false;
      el.isWide = false;
    });
    expect(el.builtDisabled).toBe(false);
    expect(el.flips).toEqual([]);
  });

  it('a change while detached is reported at reconnect', () => {
    const el = document.createElement('form-disabled-element') as Field;
    document.body.appendChild(el);
    el.remove();
    el.formDisabledCallback(true);
    expect(el.flips).toEqual([]);
    document.body.appendChild(el);
    expect(el.flips).toEqual([true]);
  });

  /**
   * jsdom never calls formDisabledCallback; mirror the browser: after a change,
   * report the COMBINED state (own `disabled` attribute OR disabled fieldset)
   * whenever it flips.
   */
  function browserSync(el: Field, last: { value: boolean }): void {
    const fieldset = el.closest('fieldset');
    const next = el.hasAttribute('disabled') || !!fieldset?.disabled;
    if (next !== last.value) {
      last.value = next;
      el.formDisabledCallback(next);
    }
  }

  it('own disabled attribute → property false → enabled (isDisabled reflects; not stuck)', async () => {
    const el = document.createElement('form-disabled-element') as Field;
    const last = { value: false };
    el.setAttribute('disabled', '');
    document.body.appendChild(el);
    browserSync(el, last); // the browser reports the OWN attribute too
    expect(el.isDisabled).toBe(true);
    expect(el.fromFieldset).toBe(false); // not the fieldset
    expect(el.effective).toBe(true);
    el.isDisabled = false;
    expect(el.hasAttribute('disabled')).toBe(false); // reflected away
    browserSync(el, last);
    await el.whenSettled();
    expect(el.effective).toBe(false);
    expect(el.flips).toEqual([false]);
  });

  it('fieldset toggle while the own attribute is set, then cleared', async () => {
    const fieldset = document.createElement('fieldset');
    const el = document.createElement('form-disabled-element') as Field;
    const last = { value: false };
    fieldset.appendChild(el);
    document.body.appendChild(fieldset);
    fieldset.disabled = true;
    browserSync(el, last);
    expect(el.fromFieldset).toBe(true);
    expect(el.flips).toEqual([true]);
    el.isDisabled = true; // own attribute too — the browser state doesn't change
    browserSync(el, last);
    await el.whenSettled();
    fieldset.disabled = false; // no callback in a browser (still disabled by own attr)
    browserSync(el, last);
    expect(el.fromFieldset).toBe(false); // read from the ancestors
    el.isDisabled = false;
    browserSync(el, last);
    await el.whenSettled();
    expect(el.effective).toBe(false);
    expect(el.flips).toEqual([true, false]);
    fieldset.disabled = true;
    browserSync(el, last);
    expect(el.effective).toBe(true);
    expect(el.isDisabled).toBe(false);
    expect(el.flips).toEqual([true, false, true]);
  });

  it('a control inside the first <legend> of a fieldset is not fieldset-disabled', () => {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    const el = document.createElement('form-disabled-element') as Field;
    legend.appendChild(el);
    fieldset.appendChild(legend);
    document.body.appendChild(fieldset);
    fieldset.disabled = true;
    el.setAttribute('disabled', '');
    el.formDisabledCallback(true);
    expect(el.fromFieldset).toBe(false);
  });

  it('warns when a form-associated element declares a non-reflecting disabled input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class Bad extends BlissElement {
      static formAssociated = true;
      protected static override inputs: readonly InputDef[] = [
        { configKey: 'isDisabled', attribute: 'disabled', converter: toBool('presence'), default: false, on: 'update' },
      ];
    }
    define('form-disabled-bad-element', Bad as unknown as CustomElementConstructor);
    document.createElement('form-disabled-bad-element');
    expect(warn.mock.calls.some((c) => c.join(' ').includes('must have shouldReflect:true'))).toBe(true);
    warn.mockRestore();
  });
});
