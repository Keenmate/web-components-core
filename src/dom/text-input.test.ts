import { afterEach, describe, expect, it, vi } from 'vitest';
import { isImeEnter, observeTextInput } from './text-input.js';

afterEach(() => {
  vi.useRealTimers();
});

const type = (el: HTMLInputElement, value: string, isComposing = false): void => {
  el.value = value;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing }));
};
const compositionEnd = (el: HTMLInputElement, value: string): void => {
  el.value = value;
  el.dispatchEvent(new CompositionEvent('compositionend', { data: value }));
};

describe('observeTextInput', () => {
  it('plain typing: one call per input', () => {
    const el = document.createElement('input');
    const cb = vi.fn();
    observeTextInput(el, cb);
    type(el, 'a');
    type(el, 'ab');
    expect(cb.mock.calls.map((c) => c[0])).toEqual(['a', 'ab']);
  });

  it('Chromium order: composing inputs skipped, compositionend delivers once', () => {
    const el = document.createElement('input');
    const cb = vi.fn();
    observeTextInput(el, cb);
    type(el, 'k', true);
    type(el, 'か', true);
    compositionEnd(el, '漢');
    expect(cb.mock.calls.map((c) => c[0])).toEqual(['漢']);
  });

  it('Firefox order: compositionend then a plain input of the same value — delivered once; a later same-value input is real', () => {
    vi.useFakeTimers();
    const el = document.createElement('input');
    const cb = vi.fn();
    observeTextInput(el, cb);
    type(el, 'か', true);
    compositionEnd(el, '漢');
    type(el, '漢');
    expect(cb.mock.calls.map((c) => c[0])).toEqual(['漢']);
    vi.advanceTimersByTime(1);
    el.value = '';
    type(el, '漢'); // the component cleared it; typed again
    expect(cb.mock.calls.map((c) => c[0])).toEqual(['漢', '漢']);
  });

  it('delegated ({ selector }): one subscription on a shadow root covers re-rendered inputs; the target comes along', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const cb = vi.fn();
    const stop = observeTextInput(root, cb, { selector: 'input.filter' });
    root.innerHTML = '<input class="filter" data-col="a"><input class="other">';
    type(root.querySelector('.filter')!, 'x');
    type(root.querySelector('.other')!, 'ignored');
    root.innerHTML = '<input class="filter" data-col="b">'; // re-rendered
    const fresh = root.querySelector<HTMLInputElement>('.filter')!;
    type(fresh, 'か', true);
    fresh.value = '漢';
    fresh.dispatchEvent(new CompositionEvent('compositionend', { data: '漢', bubbles: true, composed: true }));
    expect(cb.mock.calls.map((c) => [c[0], (c[2] as HTMLElement).dataset.col])).toEqual([['x', 'a'], ['漢', 'b']]);
    stop();
    host.remove();
  });

  it('unsubscribe stops it', () => {
    const el = document.createElement('input');
    const cb = vi.fn();
    const stop = observeTextInput(el, cb);
    stop();
    type(el, 'x');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('isImeEnter', () => {
  it('isComposing or keyCode 229', () => {
    expect(isImeEnter(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).toBe(true);
    expect(isImeEnter(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 }))).toBe(true);
    expect(isImeEnter(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);
  });
});
