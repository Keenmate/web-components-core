import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toBool, toCustom, toEnum, toInt, toText } from '../inputs/converters.js';
import type { Converter, InputDef } from '../inputs/types.js';
import { consoleLines } from '../logging/console-line.test-util.js';

/** A legacy converter that never calls reportInvalid: its fallback applies silently. */
const legacyInt: Converter<number> = {
  fromAttribute: (raw) => (raw !== null && /^\d+$/.test(raw) ? Number(raw) : 3),
  validate: (v): v is number => typeof v === 'number',
};

class InvalidElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'pageSize', attribute: 'page-size', converter: toInt({ min: 1, default: 10 }) },
    { configKey: 'size', attribute: 'size', converter: toEnum(['sm', 'lg'], { default: 'sm' }), shouldReflect: true },
    { configKey: 'isDisabled', attribute: 'is-disabled', converter: toBool('presence'), default: false },
    { configKey: 'isStriped', attribute: 'is-striped', converter: toBool('default-true'), default: true },
    { configKey: 'label', attribute: 'label', converter: toText() },
    { configKey: 'legacy', attribute: 'legacy', converter: legacyInt },
    {
      configKey: 'weekStart',
      attribute: 'week-start',
      converter: toCustom<number | 'auto'>((raw, reportInvalid) => {
        if (raw === null || raw === 'auto') return 'auto';
        const n = Number(raw);
        if (Number.isInteger(n) && n >= 0 && n <= 6) return n;
        reportInvalid?.('expected auto | 0..6');
        return 'auto';
      }),
      default: 'auto',
    },
    {
      configKey: 'explodes',
      attribute: 'explodes',
      converter: {
        fromAttribute: (raw) => {
          if (raw === 'boom') throw new Error('boom');
          return raw ?? 'x';
        },
      },
      default: 'x',
    },
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
define('invalid-element', InvalidElement as unknown as CustomElementConstructor);

type Host = InvalidElement & Record<string, unknown>;
const make = (html = '<invalid-element></invalid-element>'): Host => {
  document.body.innerHTML = html;
  return document.body.firstElementChild as unknown as Host;
};
const warnings = (spy: ReturnType<typeof vi.spyOn>): string[] => consoleLines(spy);

describe('invalid attribute values', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('in markup: warns with the reason and uses the default (the value before any valid one)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element page-size="abc" size="huge"></invalid-element>');
    expect(el.pageSize).toBe(10);
    expect(el.size).toBe('sm');
    expect(warnings(warn)).toEqual([
      // No logging bundle registered for this tag → core's CORE bundle, tag kept in the instance part.
      expect.stringMatching(/^\[CORE:ELEMENT\] invalid-element#\d+ rejected invalid value for attribute page-size="abc" \(not a number\); keeping previous value$/),
      expect.stringMatching(/^\[CORE:ELEMENT\] invalid-element#\d+ rejected invalid value for attribute size="huge" \(expected one of sm \| lg\); keeping previous value$/),
    ]);
  });

  it('at runtime: keeps the current value and triggers no update', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element page-size="25"></invalid-element>');
    await el.whenSettled();
    el.updates = [];
    el.setAttribute('page-size', 'abc');
    el.setAttribute('page-size', '0'); // out of range
    expect(el.pageSize).toBe(25);
    await el.whenSettled();
    expect(el.updates).toEqual([]);
    expect(warnings(warn)).toEqual([
      expect.stringContaining('page-size="abc" (not a number)'),
      expect.stringContaining('page-size="0" (out of range 1..∞)'),
    ]);
  });

  it('removing the attribute still resets to the default, silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element page-size="25"></invalid-element>');
    el.removeAttribute('page-size');
    expect(el.pageSize).toBe(10);
    expect(warn).not.toHaveBeenCalled();
  });

  it('valid edge values never warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element page-size="010" is-disabled="false" is-striped label=""></invalid-element>');
    expect(el.pageSize).toBe(10);
    expect(el.isDisabled).toBe(true); // presence: any value means "on"
    expect(el.isStriped).toBe(true);
    expect(el.label).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a value-reading boolean warns on garbage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element is-striped="false"></invalid-element>');
    el.setAttribute('is-striped', 'maybe');
    expect(el.isStriped).toBe(false);
    expect(warnings(warn)[0]).toContain('is-striped="maybe" (expected true | false)');
  });

  it('a reflected input writes its current value back; a non-reflected one keeps the markup', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element size="lg" page-size="25"></invalid-element>');
    await el.whenSettled();
    el.setAttribute('size', 'huge');
    expect(el.getAttribute('size')).toBe('lg');
    el.setAttribute('page-size', 'abc');
    expect(el.getAttribute('page-size')).toBe('abc');
    expect(el.pageSize).toBe(25);
  });

  it('a reflected input invalid in markup is rewritten at connect', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element size="huge"></invalid-element>');
    expect(el.getAttribute('size')).toBe('sm');
  });

  it('the write-back does not re-enter (one warning, no loop)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element size="lg"></invalid-element>');
    await el.whenSettled();
    el.setAttribute('size', 'huge');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a toCustom parser can report invalid values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element week-start="3"></invalid-element>');
    el.setAttribute('week-start', '9');
    expect(el.weekStart).toBe(3);
    expect(warnings(warn)[0]).toContain('week-start="9" (expected auto | 0..6)');
  });

  it('a throwing converter warns and keeps the current value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element explodes="y"></invalid-element>');
    el.setAttribute('explodes', 'boom');
    expect(el.explodes).toBe('y');
    expect(warnings(warn)[0]).toContain('threw parsing attribute explodes="boom"; keeping previous value');
  });

  it('a converter that never reports keeps the old behaviour: its fallback applies silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element legacy="7"></invalid-element>');
    el.setAttribute('legacy', 'abc');
    expect(el.legacy).toBe(3);
    expect(warn).not.toHaveBeenCalled();
  });

  // Review E-09: a throwing validate used to escape the property setter.
  it('a converter whose validate throws: the property write is rejected like an invalid value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make() as Host;
    const def = (InvalidElement as unknown as { inputs: InputDef[] }).inputs.find((d) => d.configKey === 'explodes')!;
    const original = def.converter!.validate;
    (def.converter as Converter<unknown>).validate = (() => {
      throw new Error('validate boom');
    }) as never;
    try {
      expect(() => (el.explodes = 'z')).not.toThrow();
      expect(el.explodes).toBe('x');
      expect(warnings(warn).some((l) => l.includes('rejected invalid value for property "explodes"'))).toBe(true);
    } finally {
      (def.converter as Converter<unknown>).validate = original as never;
    }
  });

  // Review E-01: a write-back during upgrade drains the browser's queued replay of the
  // remaining initial attributes inside the same call; the guard must skip only its own name.
  it('an invalid core attribute first in markup does not swallow the attributes after it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element motion="bogus" label="hi" page-size="5"></invalid-element>');
    expect(el.label).toBe('hi');
    expect(el.pageSize).toBe(5);
    expect(el.hasAttribute('motion')).toBe(false); // written back to the kept level (auto)
  });

  it('an invalid reflected input first in markup does not swallow the attributes after it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make('<invalid-element size="huge" label="hi"></invalid-element>');
    expect(el.label).toBe('hi');
    expect(el.getAttribute('size')).toBe('sm');
  });
});
