import { afterEach, describe, expect, it } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toBool } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

class FieldElement extends BlissElement {
  static formAssociated = true;
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'isDisabled', attribute: 'disabled', converter: toBool('presence'), default: false, on: 'update' },
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

  it('merges a disabled fieldset with the isDisabled input; el.isDisabled keeps the author value', () => {
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
});
