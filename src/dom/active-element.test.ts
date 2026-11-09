import { describe, expect, it } from 'vitest';
import { deepActiveElement } from './active-element.js';
import { deepActiveElement as fromIndex, escapeHtml } from '../index.js';
import { escapeHtml as fromSearch } from '../search/index.js';

describe('deepActiveElement', () => {
  it('descends into open shadow roots to the focused element', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    root.append(input);
    input.focus();
    expect(document.activeElement).toBe(host);
    expect(deepActiveElement()).toBe(input);
    host.remove();
  });

  it('answers document.activeElement in the light DOM', () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    expect(deepActiveElement()).toBe(button);
    button.remove();
  });

  it('is exported from the main index; escapeHtml is the same function from the index and /search', () => {
    expect(fromIndex).toBe(deepActiveElement);
    expect(escapeHtml).toBe(fromSearch);
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('escapeHtml takes any value: null / undefined → empty, numbers and others stringified', () => {
    expect(escapeHtml(3)).toBe('3');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(false)).toBe('false');
  });
});
