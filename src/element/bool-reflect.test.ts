import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toBool } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

class BoolReflectElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'isOpen', attribute: 'open', converter: toBool('default-false'), shouldReflect: true, on: 'update' },
    { configKey: 'isStriped', attribute: 'striped', converter: toBool('default-true'), default: true, shouldReflect: true, on: 'update' },
    { configKey: 'isSorted', attribute: 'sorted', converter: toBool('tristate'), shouldReflect: true, on: 'update' },
  ];
}
define('bool-reflect-element', BoolReflectElement as unknown as CustomElementConstructor);

type Host = BoolReflectElement & { isOpen: boolean; isStriped: boolean; isSorted: boolean | null };
const make = (html = '<bool-reflect-element></bool-reflect-element>'): Host => {
  document.body.innerHTML = html;
  return document.body.firstElementChild as unknown as Host;
};

describe('toBool reflection keeps absent == default', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('default-false: true writes "true", false removes the attribute', () => {
    const el = make();
    el.isOpen = true;
    expect(el.getAttribute('open')).toBe('true');
    el.isOpen = false;
    expect(el.hasAttribute('open')).toBe(false);
    expect(el.matches('[open]')).toBe(false);
  });

  it('default-true: false writes "false", true removes the attribute', () => {
    const el = make();
    expect(el.hasAttribute('striped')).toBe(false);
    el.isStriped = false;
    expect(el.getAttribute('striped')).toBe('false');
    el.isStriped = true;
    expect(el.hasAttribute('striped')).toBe(false);
  });

  it('tristate: null removes, true / false are written', () => {
    const el = make();
    el.isSorted = false;
    expect(el.getAttribute('sorted')).toBe('false');
    el.isSorted = null;
    expect(el.hasAttribute('sorted')).toBe(false);
  });

  it('an attribute spelled at the default stays as the author wrote it', () => {
    const el = make('<bool-reflect-element open="false"></bool-reflect-element>');
    expect(el.isOpen).toBe(false);
    expect(el.getAttribute('open')).toBe('false');
  });

  it('an invalid attribute writes the current value back — removed when that value is the default', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make();
    el.setAttribute('open', 'maybe');
    expect(el.isOpen).toBe(false);
    expect(el.hasAttribute('open')).toBe(false);
    el.isOpen = true;
    el.setAttribute('open', 'maybe');
    expect(el.isOpen).toBe(true);
    expect(el.getAttribute('open')).toBe('true');
  });
});
