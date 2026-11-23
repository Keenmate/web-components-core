import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActiveDescendant, createRovingFocus, createTypeahead } from './index.js';

const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createActiveDescendant', () => {
  const setup = (opts: Record<string, unknown> = {}) => {
    document.body.innerHTML = `<input id="in"><ul id="lb"><li>Apple</li><li aria-disabled="true">Banana</li><li>Cherry</li></ul>`;
    const input = document.getElementById('in')!;
    const listbox = document.getElementById('lb')!;
    const items = () => [...listbox.querySelectorAll('li')];
    const activateCallback = vi.fn();
    const activeChangeCallback = vi.fn();
    const ad = createActiveDescendant(input, listbox, { getItems: items, activateCallback, activeChangeCallback, ...opts });
    return { input, listbox, items, ad, activateCallback, activeChangeCallback };
  };

  it('arrows move aria-activedescendant over the not-disabled items; ids and aria-controls are set', () => {
    const { input, items, ad, activeChangeCallback } = setup();
    expect(input.getAttribute('aria-controls')).toBe('lb');
    expect(key(input, 'ArrowDown').defaultPrevented).toBe(true);
    expect(input.getAttribute('aria-activedescendant')).toBe(items()[0]!.id);
    expect(items()[0]!.id).toMatch(/^km-option/);
    key(input, 'ArrowDown');
    expect(ad.active).toBe(items()[2]); // Banana skipped
    expect(activeChangeCallback).toHaveBeenLastCalledWith(items()[2], 2);
    key(input, 'ArrowDown'); // no wrap
    expect(ad.activeIndex).toBe(2);
    key(input, 'ArrowUp');
    expect(ad.activeIndex).toBe(0);
  });

  it('wraps when asked; Home / End only with hasHomeEnd; Enter activates', () => {
    const { input, items, ad, activateCallback } = setup({ isWrapping: true });
    key(input, 'ArrowUp'); // nothing active: Up starts at the last
    expect(ad.activeIndex).toBe(2);
    key(input, 'ArrowDown');
    expect(ad.activeIndex).toBe(0);
    expect(key(input, 'End').defaultPrevented).toBe(false); // the caret's
    const enter = key(input, 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(activateCallback).toHaveBeenCalledWith(items()[0], 0, enter);
  });

  it('refresh keeps the active item by id across a re-render, else clears; destroy detaches', () => {
    const { input, listbox, ad } = setup();
    key(input, 'ArrowDown');
    const id = input.getAttribute('aria-activedescendant')!;
    listbox.innerHTML = `<li>Zed</li><li id="${id}">Apple again</li>`;
    ad.refresh();
    expect(ad.activeIndex).toBe(1);
    listbox.innerHTML = `<li>Zed</li>`;
    ad.refresh();
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    ad.destroy();
    expect(key(input, 'ArrowDown').defaultPrevented).toBe(false);
  });

  it('shouldHandleKeys: false = ARIA only — keys are the component’s, move() / setActive() still write the attribute', () => {
    const { input, items, ad, activateCallback } = setup({ shouldHandleKeys: false });
    expect(key(input, 'ArrowDown').defaultPrevented).toBe(false);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    ad.move(1);
    expect(input.getAttribute('aria-activedescendant')).toBe(items()[0]!.id);
    key(input, 'Enter');
    expect(activateCallback).not.toHaveBeenCalled();
  });

  it('one element as input and listbox (a tree body): no self aria-controls, its tab stop untouched', () => {
    document.body.innerHTML = '<div id="tree" role="tree"><div role="treeitem">a</div><div role="treeitem">b</div></div>';
    const tree = document.getElementById('tree')!;
    const ad = createActiveDescendant(tree, tree, { getItems: () => [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')], shouldHandleKeys: false });
    expect(tree.hasAttribute('aria-controls')).toBe(false);
    expect(tree.hasAttribute('tabindex')).toBe(false);
    ad.setActive(1);
    expect(tree.getAttribute('aria-activedescendant')).toBe(tree.children[1]!.id);
    ad.destroy();
  });

  it('ignores composing / modified keys and a throwing activeChangeCallback', () => {
    const { input, ad } = setup({ activeChangeCallback: () => { throw new Error('paint'); } });
    expect(key(input, 'ArrowDown', { isComposing: true }).defaultPrevented).toBe(false);
    expect(key(input, 'ArrowDown', { altKey: true }).defaultPrevented).toBe(false);
    key(input, 'ArrowDown');
    expect(ad.activeIndex).toBe(0);
  });
});

describe('createRovingFocus', () => {
  const setup = (html: string, opts: Record<string, unknown> = {}) => {
    document.body.innerHTML = `<div id="c">${html}</div>`;
    const container = document.getElementById('c')!;
    const items = () => [...container.querySelectorAll<HTMLElement>('button')];
    const focusItemCallback = vi.fn();
    const rf = createRovingFocus(container, { getItems: items, focusItemCallback, ...opts });
    return { container, items, rf, focusItemCallback };
  };
  const tabIndexes = (items: HTMLElement[]) => items.map((i) => i.tabIndex);

  it('one tab stop; Up / Down move real focus; Home / End', () => {
    const { items, rf, focusItemCallback } = setup('<button>a</button><button>b</button><button>c</button>');
    expect(tabIndexes(items())).toEqual([0, -1, -1]);
    items()[0]!.focus();
    key(items()[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    expect(tabIndexes(items())).toEqual([-1, 0, -1]);
    expect(focusItemCallback).toHaveBeenLastCalledWith(items()[1], 1);
    key(items()[1]!, 'End');
    expect(rf.currentIndex).toBe(2);
    key(items()[2]!, 'ArrowDown'); // no wrap
    expect(rf.currentIndex).toBe(2);
    key(items()[2]!, 'Home');
    expect(document.activeElement).toBe(items()[0]);
    expect(key(items()[0]!, 'ArrowRight').defaultPrevented).toBe(false); // vertical: not ours
  });

  it('horizontal follows the writing direction and wraps when asked', () => {
    const { items, rf } = setup('<button>a</button><button>b</button>', { orientation: 'horizontal', isWrapping: true });
    key(items()[0]!, 'ArrowLeft');
    expect(rf.currentIndex).toBe(1); // wrapped
    document.getElementById('c')!.setAttribute('dir', 'rtl');
    key(items()[1]!, 'ArrowLeft'); // RTL: Left = forward → wraps to 0
    expect(rf.currentIndex).toBe(0);
  });

  it('grid: columns, Home / End per row, Ctrl+Home / End, no vertical wrap', () => {
    const cells = Array.from({ length: 7 }, (_, i) => `<button>${i}</button>`).join('');
    const { items, rf } = setup(cells, { orientation: 'grid', columns: 3 });
    rf.focusItem(4);
    key(items()[4]!, 'ArrowUp');
    expect(rf.currentIndex).toBe(1);
    key(items()[1]!, 'ArrowUp');
    expect(rf.currentIndex).toBe(1);
    key(items()[1]!, 'ArrowDown');
    key(items()[4]!, 'ArrowDown');
    expect(rf.currentIndex).toBe(4); // 7 doesn't exist
    key(items()[4]!, 'End');
    expect(rf.currentIndex).toBe(5);
    key(items()[5]!, 'ArrowRight');
    expect(rf.currentIndex).toBe(5); // row edge
    key(items()[5]!, 'End', { ctrlKey: true });
    expect(rf.currentIndex).toBe(6);
    key(items()[6]!, 'Home', { ctrlKey: true });
    expect(rf.currentIndex).toBe(0);
  });

  it('boundaryCallback: list edge, grid row / column edge, all-skipped; true vs not; wrapping finds a target', () => {
    const boundaryCallback = vi.fn((key: string) => key === 'ArrowDown');
    const { items, rf } = setup('<button>a</button><button>b</button>', { boundaryCallback });
    rf.focusItem(1);
    const down = key(items()[1]!, 'ArrowDown');
    expect(boundaryCallback).toHaveBeenLastCalledWith('ArrowDown', items()[1], down);
    expect(down.defaultPrevented).toBe(true); // true = handled
    expect(rf.currentIndex).toBe(1);
    rf.focusItem(0);
    const up = key(items()[0]!, 'ArrowUp');
    expect(boundaryCallback).toHaveBeenLastCalledWith('ArrowUp', items()[0], up);
    expect(up.defaultPrevented).toBe(true); // not handled: today's behaviour (consumed, focus stays)
    expect(rf.currentIndex).toBe(0);
    boundaryCallback.mockClear();
    key(items()[0]!, 'ArrowDown'); // moves — no boundary
    key(items()[1]!, 'Home'); // not an arrow
    expect(boundaryCallback).not.toHaveBeenCalled();

    // grid 3 columns, 7 cells; cell 4 skipped
    const grid = vi.fn();
    const cells = Array.from({ length: 7 }, (_, i) => `<button${i === 4 ? ' disabled' : ''}>${i}</button>`).join('');
    const g = setup(cells, { orientation: 'grid', columns: 3, boundaryCallback: grid, isSkipped: (i: HTMLElement) => i.hasAttribute('disabled') });
    g.rf.focusItem(5);
    key(g.items()[5]!, 'ArrowRight'); // row end
    expect(grid).toHaveBeenLastCalledWith('ArrowRight', g.items()[5], expect.any(KeyboardEvent));
    key(g.items()[5]!, 'ArrowLeft'); // 4 skipped → 3, same row
    expect(g.rf.currentIndex).toBe(3);
    expect(grid).toHaveBeenCalledTimes(1);
    g.rf.focusItem(1);
    key(g.items()[1]!, 'ArrowDown'); // 4 skipped, 7 doesn't exist → column edge
    expect(grid).toHaveBeenLastCalledWith('ArrowDown', g.items()[1], expect.any(KeyboardEvent));
    expect(g.rf.currentIndex).toBe(1);
    g.rf.focusItem(3);
    key(g.items()[3]!, 'ArrowUp'); // 0 ✓
    expect(g.rf.currentIndex).toBe(0);
    key(g.items()[0]!, 'ArrowUp'); // top
    expect(grid).toHaveBeenCalledTimes(3);
    document.getElementById('c')!.setAttribute('dir', 'rtl');
    g.rf.focusItem(5);
    key(g.items()[5]!, 'ArrowLeft'); // RTL: Left = forward → row end; key passed as pressed
    expect(grid).toHaveBeenLastCalledWith('ArrowLeft', g.items()[5], expect.any(KeyboardEvent));

    // every candidate skipped (not the edge itself); wrapping that finds a target never asks
    const skipped = vi.fn();
    const s = setup('<button>a</button><button disabled>b</button><button disabled>c</button>', {
      boundaryCallback: skipped, isSkipped: (i: HTMLElement) => i.hasAttribute('disabled'),
    });
    key(s.items()[0]!, 'ArrowDown');
    expect(skipped).toHaveBeenLastCalledWith('ArrowDown', s.items()[0], expect.any(KeyboardEvent));
    expect(s.rf.currentIndex).toBe(0);
    const w = vi.fn();
    const ws = setup('<button>a</button><button>b</button>', { orientation: 'horizontal', isWrapping: true, boundaryCallback: w });
    ws.rf.focusItem(1);
    key(ws.items()[1]!, 'ArrowRight');
    expect(ws.rf.currentIndex).toBe(0);
    expect(w).not.toHaveBeenCalled();
  });

  it('boundaryCallback: a throwing hook is logged, the key still consumed', () => {
    const { items } = setup('<button>a</button>', { boundaryCallback: () => { throw new Error('boom'); } });
    expect(key(items()[0]!, 'ArrowDown').defaultPrevented).toBe(true);
  });

  it('typeahead: prefix search, repeated letter cycles', () => {
    vi.useFakeTimers();
    const { items, rf } = setup('<button>Copy</button><button>Cut</button><button>Paste</button><button>Clear</button>', { hasTypeahead: true });
    key(items()[0]!, 'p');
    expect(rf.currentIndex).toBe(2);
    key(items()[2]!, 'a'); // "pa" — still Paste
    expect(rf.currentIndex).toBe(2);
    vi.advanceTimersByTime(600);
    key(items()[2]!, 'c');
    expect(rf.currentIndex).toBe(3); // the next "c…" after Paste
    key(items()[3]!, 'c');
    expect(rf.currentIndex).toBe(0); // cycles
    vi.useRealTimers();
  });

  it('a click makes the item the tab stop; refresh after a re-render; skipped items', () => {
    const { container, items, rf } = setup('<button>a</button><button disabled>b</button><button>c</button>', {
      isSkipped: (i: HTMLElement) => i.hasAttribute('disabled'),
    });
    items()[2]!.focus();
    expect(rf.currentIndex).toBe(2);
    key(items()[2]!, 'ArrowUp');
    expect(rf.currentIndex).toBe(0);
    container.innerHTML = '<button disabled>x</button><button>y</button>';
    rf.refresh();
    expect(tabIndexes(items())).toEqual([-1, 0]);
    rf.destroy();
    expect(key(items()[1]!, 'ArrowUp').defaultPrevented).toBe(false);
  });
});

describe('createTypeahead', () => {
  it('times out back to a fresh search', () => {
    vi.useFakeTimers();
    const t = createTypeahead(500);
    const texts = ['alpha', 'beta', 'bravo'];
    const press = (k: string, current: number) => t.handle(new KeyboardEvent('keydown', { key: k }), texts, current);
    expect(press('b', 0)).toBe(1);
    expect(press('r', 1)).toBe(2);
    vi.advanceTimersByTime(600);
    expect(press('a', 2)).toBe(0);
    expect(press('Enter', 0)).toBe(-1);
    vi.useRealTimers();
  });
});
