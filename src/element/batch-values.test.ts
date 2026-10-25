import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toBool, toEnum } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

const MODES = ['none', 'excel', 'bogus-preset', 'throws'] as const;
const TRIGGERS = ['click', 'dblclick', 'navigate'] as const;

class PresetElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    {
      configKey: 'mode',
      attribute: 'mode',
      converter: toEnum(MODES, { default: 'none' }),
      getBatchValuesCallback: (mode: unknown) => {
        if (mode === 'excel') return { editTrigger: 'navigate', isEditable: true };
        if (mode === 'none') return { editTrigger: 'dblclick', isEditable: false };
        if (mode === 'bogus-preset') return { editTrigger: 'nope', isEditable: true, unknownKey: 1, mode: 'excel' };
        if (mode === 'throws') throw new Error('boom');
        return null;
      },
    } as InputDef,
    {
      configKey: 'editTrigger',
      attribute: 'edit-trigger',
      converter: toEnum(TRIGGERS, { default: 'dblclick' }),
      shouldReflect: true,
      // one level only — a returned value must never run this
      getBatchValuesCallback: () => ({ isEditable: false }),
    } as InputDef,
    { configKey: 'isEditable', attribute: 'is-editable', converter: toBool(), default: false, on: 'reinit' },
  ];
  reinits = 0;
  updates: Array<Record<string, unknown>> = [];
  protected override reinit(): void {
    this.reinits++;
  }
  protected override update(partial: Record<string, unknown>): void {
    this.updates.push(partial);
  }
}
define('preset-element', PresetElement as unknown as CustomElementConstructor);

type Host = PresetElement & { mode: string; editTrigger: string; isEditable: boolean };
const make = (html = '<preset-element></preset-element>'): Host => {
  document.body.innerHTML = html;
  return document.body.firstElementChild as Host;
};
const tick = (): Promise<void> => new Promise((r) => queueMicrotask(() => r()));

describe('getBatchValuesCallback', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('sets the returned inputs synchronously, in one batch', async () => {
    const el = make();
    await el.whenSettled();
    el.reinits = 0;

    el.mode = 'excel';
    expect(el.editTrigger).toBe('navigate'); // readable immediately
    expect(el.isEditable).toBe(true);
    expect(el.getAttribute('edit-trigger')).toBe('navigate'); // reflected like a property write
    await tick();
    expect(el.reinits).toBe(1); // one rebuild for the whole change
  });

  it('does not run at construction (defaults are seeded as-is)', () => {
    const el = make();
    expect(el.editTrigger).toBe('dblclick');
    expect(el.hasAttribute('edit-trigger')).toBe(false);
  });

  it('an explicit attribute wins in markup, whatever the attribute order', () => {
    expect(make('<preset-element mode="excel" edit-trigger="click"></preset-element>').editTrigger).toBe('click');
    expect(make('<preset-element edit-trigger="click" mode="excel"></preset-element>').editTrigger).toBe('click');
    const el = make('<preset-element mode="excel" edit-trigger="click"></preset-element>');
    expect(el.getAttribute('edit-trigger')).toBe('click'); // markup untouched
  });

  it('in markup, a batch value is reflected at connect', () => {
    const el = make('<preset-element mode="excel"></preset-element>');
    expect(el.editTrigger).toBe('navigate');
    expect(el.isEditable).toBe(true);
    expect(el.getAttribute('edit-trigger')).toBe('navigate');
  });

  it('an explicit property wins within the batch, whatever the order', () => {
    const el = make();
    el.batch(() => {
      el.editTrigger = 'click';
      el.mode = 'excel';
    });
    expect(el.editTrigger).toBe('click');
    el.batch(() => {
      el.mode = 'none';
      el.editTrigger = 'navigate';
    });
    expect(el.editTrigger).toBe('navigate');
    expect(el.isEditable).toBe(false);
  });

  it('across batches the last write wins', async () => {
    const el = make();
    el.editTrigger = 'click';
    await tick();
    el.mode = 'excel';
    expect(el.editTrigger).toBe('navigate');
  });

  it('a rejected explicit write is not explicit — the batch value applies', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make();
    el.batch(() => {
      el.editTrigger = 'bogus';
      el.mode = 'excel';
    });
    expect(el.editTrigger).toBe('navigate');
  });

  it('a rejected attribute is not explicit either — in markup, whatever the order', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const html of [
      '<preset-element edit-trigger="clik" mode="excel"></preset-element>',
      '<preset-element mode="excel" edit-trigger="clik"></preset-element>',
    ]) {
      const el = make(html);
      expect(el.editTrigger).toBe('navigate');
      expect(el.getAttribute('edit-trigger')).toBe('navigate'); // reflected: the bad markup is rewritten
    }
  });

  it('a rejected mode value does not run the callback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make();
    el.mode = 'excel';
    await tick();
    el.editTrigger = 'click';
    await tick();
    el.mode = 'nope';
    expect(el.mode).toBe('excel');
    expect(el.editTrigger).toBe('click');
  });

  it('removing the attribute runs it with the default', async () => {
    const el = make('<preset-element mode="excel"></preset-element>');
    expect(el.isEditable).toBe(true);
    el.removeAttribute('mode');
    expect(el.mode).toBe('none');
    expect(el.editTrigger).toBe('dblclick');
    expect(el.isEditable).toBe(false);
  });

  it('is one level only — returned values do not run their own callback', () => {
    const el = make();
    el.mode = 'excel'; // sets editTrigger, whose own callback would force isEditable false
    expect(el.isEditable).toBe(true);
  });

  it('invalid values, unknown keys and its own key warn and are skipped; the rest apply', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make();
    el.mode = 'bogus-preset';
    expect(el.mode).toBe('bogus-preset');
    expect(el.editTrigger).toBe('dblclick');
    expect(el.isEditable).toBe(true);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('a throwing callback warns and sets nothing else', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make();
    el.mode = 'throws';
    expect(el.mode).toBe('throws');
    expect(el.editTrigger).toBe('dblclick');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('setAttributes() keys count as explicit', () => {
    const el = make();
    el.setAttributes({ mode: 'excel', editTrigger: 'click' });
    expect(el.editTrigger).toBe('click');
    expect(el.getAttribute('edit-trigger')).toBe('click');
  });
});
