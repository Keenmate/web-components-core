import { describe, expect, it, vi } from 'vitest';
import { renderSlot } from './render-slot.js';

describe('renderSlot', () => {
  it('string = HTML, node = mounted, null = default, false = hidden', () => {
    const c = document.createElement('div');
    const renderDefault = vi.fn((el: HTMLElement) => (el.textContent = 'default'));
    expect(renderSlot(c, '<b>x</b>', { renderDefault })).toBe('custom');
    expect(c.innerHTML).toBe('<b>x</b>');
    const node = document.createElement('i');
    expect(renderSlot(c, node, { renderDefault })).toBe('custom');
    expect(c.firstChild).toBe(node);
    expect(renderSlot(c, null, { renderDefault })).toBe('default');
    expect(c.textContent).toBe('default');
    expect(renderSlot(c, false, { renderDefault })).toBe('hidden');
    expect(c.hidden).toBe(true);
    expect(c.childNodes.length).toBe(0);
    renderSlot(c, undefined); // no default: emptied, shown again
    expect(c.hidden).toBe(false);
    expect(c.childNodes.length).toBe(0);
  });

  it('a matching memoKey skips the hook and the DOM; a same string is not rewritten', () => {
    const c = document.createElement('div');
    const hook = vi.fn(() => '<span>a</span>');
    renderSlot(c, hook, { memoKey: 'row-1@v1' });
    const span = c.firstChild;
    renderSlot(c, hook, { memoKey: 'row-1@v1' });
    expect(hook).toHaveBeenCalledTimes(1);
    renderSlot(c, hook, { memoKey: 'row-1@v2' });
    expect(hook).toHaveBeenCalledTimes(2);
    expect(c.firstChild).toBe(span); // same HTML: the span survives (focus, listeners)
  });
});
