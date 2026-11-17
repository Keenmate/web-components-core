import { afterEach, describe, expect, it } from 'vitest';
import { createFormInputs, formatFormValue } from './form-inputs.js';

describe('createFormInputs', () => {
  let host: HTMLElement;
  const names = (): (string | null)[] => [...host.querySelectorAll('input')].map((i) => i.getAttribute('name'));
  const values = (): string[] => [...host.querySelectorAll('input')].map((i) => i.value);

  afterEach(() => host?.remove());

  it('a string is one hidden input named `name`, no id', () => {
    host = document.createElement('div');
    const form = createFormInputs(host);
    form.write('country', '["cz"]');
    const input = host.querySelector('input')!;
    expect(input.type).toBe('hidden');
    expect(input.name).toBe('country');
    expect(input.value).toBe('["cz"]');
    expect(input.hasAttribute('id')).toBe(false);
  });

  it('an array is one `name[]` input per item; an empty array writes none', () => {
    host = document.createElement('div');
    const form = createFormInputs(host);
    form.write('tags', ['a', 'b', 'c']);
    expect(names()).toEqual(['tags[]', 'tags[]', 'tags[]']);
    expect(values()).toEqual(['a', 'b', 'c']);
    form.write('tags', []);
    expect(host.querySelectorAll('input').length).toBe(0);
  });

  it('reuses the inputs it wrote and drops the extras', () => {
    host = document.createElement('div');
    const form = createFormInputs(host);
    form.write('tags', ['a', 'b', 'c']);
    const first = host.querySelector('input');
    form.write('tags', ['x']);
    expect(host.querySelector('input')).toBe(first);
    expect(values()).toEqual(['x']);
    form.write('tags', 'one');
    expect(host.querySelector('input')).toBe(first);
    expect(names()).toEqual(['tags']);
  });

  it('no name removes the inputs; clear() removes them too', () => {
    host = document.createElement('div');
    const form = createFormInputs(host);
    form.write('a', 'x');
    form.write(null, 'x');
    expect(host.querySelectorAll('input').length).toBe(0);
    form.write('a', ['x', 'y']);
    form.clear();
    expect(host.querySelectorAll('input').length).toBe(0);
    expect(form.inputs).toEqual([]);
  });

  it('disabled follows the control and the inputs submit nothing', () => {
    host = document.createElement('div');
    const formEl = document.createElement('form');
    formEl.append(host);
    document.body.append(formEl);
    const form = createFormInputs(host);
    form.write('a', 'x', { isDisabled: true });
    expect(host.querySelector('input')!.disabled).toBe(true);
    expect(new FormData(formEl).has('a')).toBe(false);
    form.write('a', 'x', { isDisabled: false });
    expect(new FormData(formEl).get('a')).toBe('x');
    formEl.remove();
  });

  it('re-appends an input a framework removed from the host', () => {
    host = document.createElement('div');
    const form = createFormInputs(host);
    form.write('a', 'x');
    host.replaceChildren();
    form.write('a', 'y');
    expect(values()).toEqual(['y']);
  });
});

describe('formatFormValue', () => {
  it('json (default), text with a separator, array', () => {
    expect(formatFormValue(['a', 1], undefined)).toEqual({ value: '["a",1]' });
    expect(formatFormValue(['a', 1], 'json')).toEqual({ value: '["a",1]' });
    expect(formatFormValue(['a', 'b'], 'text')).toEqual({ value: 'a,b' });
    expect(formatFormValue(['a', 'b'], 'text', { separator: ';' })).toEqual({ value: 'a;b' });
    expect(formatFormValue(['a', 2], 'array')).toEqual({ value: ['a', '2'] });
  });

  it('the callback wins (also over array); null → empty string', () => {
    expect(formatFormValue(['a'], 'array', { callback: (v) => `X${v.length}` })).toEqual({ value: 'X1' });
    expect(formatFormValue(['a'], 'json', { callback: () => null })).toEqual({ value: '' });
  });

  it('a throwing callback yields "" and the error', () => {
    const boom = new Error('boom');
    expect(formatFormValue(['a'], 'json', { callback: () => { throw boom; } })).toEqual({ value: '', error: boom });
    const r = formatFormValue(['a'], 'json', { callback: () => { throw undefined; } });
    expect(r.value).toBe('');
    expect(r.error).toBeInstanceOf(Error);
  });
});
