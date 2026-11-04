import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlissElement, INPUT_REJECTED_EVENT, type InputRejection } from './bliss-element.js';
import { define } from './define.js';
import { toEnum, toInt } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

// `input-rejected` (SPEC §6): a refused write is reported to the page, not only logged —
// a wrapper (Svelte / React / LiveView) can surface it or revert its own bound value.

class RejectingElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'limit', attribute: 'limit', converter: toInt({ min: 1, default: 50 }) },
    { configKey: 'size', attribute: 'size', converter: toEnum(['sm', 'lg'], { default: 'sm' }), shouldReflect: true },
  ];
}
define('rejecting-element', RejectingElement as unknown as CustomElementConstructor);

type El = RejectingElement & { limit: number; size: string; onInputRejected: ((d: InputRejection) => void) | null };

function make(): El {
  const el = document.createElement('rejecting-element') as unknown as El;
  document.body.append(el as unknown as Node);
  return el;
}

/** The plain data of an event detail (the non-enumerable controller / element are left out). */
const data = (detail: unknown) => ({ ...(detail as object) });

describe('input-rejected', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('an invalid attribute fires it synchronously, with the reason and the kept value', () => {
    const el = make();
    const seen: unknown[] = [];
    el.addEventListener(INPUT_REJECTED_EVENT, (e) => seen.push(data((e as CustomEvent).detail)));
    el.setAttribute('limit', 'abc');
    expect(seen).toEqual([
      { configKey: 'limit', attribute: 'limit', value: 'abc', reason: 'expected an integer', kept: 50, source: 'attribute' },
    ]);
  });

  it('an invalid property fires it before the assignment returns; the twin gets the same detail', () => {
    const el = make();
    const twin = vi.fn();
    el.onInputRejected = twin;
    let fromEvent: unknown;
    el.addEventListener(INPUT_REJECTED_EVENT, (e) => (fromEvent = (e as CustomEvent).detail));
    el.limit = 20;
    el.limit = -5;
    expect(twin).toHaveBeenCalledOnce();
    expect(data(twin.mock.calls[0]![0])).toEqual({ configKey: 'limit', value: -5, kept: 20, source: 'property' });
    expect(fromEvent).toBe(twin.mock.calls[0]![0]);
  });

  it('bubbles, is not composed, and carries the element', () => {
    const el = make();
    let event: CustomEvent | undefined;
    document.body.addEventListener(INPUT_REJECTED_EVENT, (e) => (event = e as CustomEvent));
    el.size = 'xl';
    expect(event?.bubbles).toBe(true);
    expect(event?.composed).toBe(false);
    expect(event?.detail.element).toBe(el);
  });

  it('a valid write, a removal and an undefined reset fire nothing', () => {
    const el = make();
    const listener = vi.fn();
    el.addEventListener(INPUT_REJECTED_EVENT, listener);
    el.setAttribute('limit', '7');
    el.removeAttribute('limit');
    el.limit = 9;
    el.limit = undefined as never;
    expect(listener).not.toHaveBeenCalled();
  });

  it('core-declared properties report too (motion attribute and property, responsive)', () => {
    const el = make();
    const seen: InputRejection[] = [];
    el.addEventListener(INPUT_REJECTED_EVENT, (e) => seen.push((e as CustomEvent).detail));
    el.setAttribute('motion', 'fast');
    (el as unknown as { motion: unknown }).motion = 'turbo';
    (el as unknown as { responsive: unknown }).responsive = [1];
    el.setAttribute('responsive', '{oops');
    expect(seen.map((r) => [r.configKey, r.source, r.value])).toEqual([
      ['motion', 'attribute', 'fast'],
      ['motion', 'property', 'turbo'],
      ['responsive', 'property', [1]],
      ['responsive', 'attribute', '{oops'],
    ]);
    expect(seen[0]!.kept).toBe('auto');
  });

  it('a value assigned before upgrade fires on the next microtask, after the constructor', async () => {
    const tag = 'rejecting-late-element';
    const el = document.createElement(tag) as unknown as El & Record<string, unknown>;
    el.limit = 0 as never; // an own property on the not-yet-upgraded element
    const listener = vi.fn();
    el.addEventListener(INPUT_REJECTED_EVENT, listener);
    class Late extends RejectingElement {}
    define(tag, Late as unknown as CustomElementConstructor);
    customElements.upgrade(el as unknown as Node);
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledOnce();
    expect(data((listener.mock.calls[0]![0] as CustomEvent).detail)).toMatchObject({ configKey: 'limit', value: 0, kept: 50 });
  });
});

describe('setAttributes() returns what it refused', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('[] when everything applies', () => {
    const el = make();
    expect(el.setAttributes({ limit: 5, size: 'lg' })).toEqual([]);
    expect(el.limit).toBe(5);
  });

  it('invalid values and unknown keys, in order; the valid ones still apply; each also fires the event', () => {
    const el = make();
    const listener = vi.fn();
    el.addEventListener(INPUT_REJECTED_EVENT, listener);
    const rejected = el.setAttributes({ limit: 'abc', size: 'lg', colour: 'red', motion: 'turbo' });
    expect(rejected).toEqual([
      { configKey: 'limit', value: 'abc', kept: 50, source: 'property' },
      { configKey: 'colour', value: 'red', reason: 'not an input of <rejecting-element>', kept: undefined, source: 'property' },
      expect.objectContaining({ configKey: 'motion', value: 'turbo', kept: 'auto', source: 'property' }),
    ]);
    expect(el.size).toBe('lg');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('a nested setAttributes() (from a listener) returns its own rejections only', () => {
    const el = make();
    let inner: InputRejection[] | undefined;
    let isNested = false;
    el.addEventListener(INPUT_REJECTED_EVENT, () => {
      if (isNested) return; // the inner call's own rejection fires this listener too
      isNested = true;
      inner = el.setAttributes({ size: 'xxl' });
    });
    const outer = el.setAttributes({ limit: 0 });
    expect(outer.map((r) => r.configKey)).toEqual(['limit']);
    expect(inner?.map((r) => r.configKey)).toEqual(['size']);
  });
});
