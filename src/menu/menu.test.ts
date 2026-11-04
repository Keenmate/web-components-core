import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no layout — record anchor() calls instead of positioning.
const anchors: { floating: HTMLElement; reference: unknown; opts: Record<string, unknown>; destroy: ReturnType<typeof vi.fn> }[] = [];
vi.mock('../positioning/anchor.js', () => ({
  anchor: vi.fn((floating: HTMLElement, reference: unknown, opts: Record<string, unknown>) => {
    const destroy = vi.fn();
    anchors.push({ floating, reference, opts, destroy });
    return { update: vi.fn(), destroy };
  }),
}));

import { createMenuDivider } from '../actions/resolve.js';
import type { MenuEntry } from '../actions/types.js';
import { __resetOverlays, registerOverlay } from '../overlay/active-overlay.js';
import { openMenu, type MenuCloseReason, type OpenMenuOptions } from './index.js';

interface Ctx {
  name: string;
}
const ctx: Ctx = { name: 'node' };

let host: HTMLElement;
let shadow: ShadowRoot;
let opener: HTMLButtonElement;

beforeEach(() => {
  anchors.length = 0;
  host = document.createElement('div');
  shadow = host.attachShadow({ mode: 'open' });
  opener = document.createElement('button');
  shadow.append(opener);
  document.body.append(host);
});
afterEach(() => {
  document.body.replaceChildren();
  __resetOverlays();
  vi.useRealTimers();
});

const levels = () => Array.from(shadow.querySelectorAll<HTMLElement>('.km-menu'));
const items = (level = levels()[0]!) => Array.from(level.querySelectorAll<HTMLElement>('.km-menu__item'));
const byId = (id: string) => shadow.querySelector<HTMLElement>(`.km-menu__item[data-id="${id}"]`)!;
const active = () => shadow.activeElement;
const key = (k: string, init: KeyboardEventInit = {}) => {
  const target = (shadow.activeElement as HTMLElement | null) ?? document.body;
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

function open(entries: readonly (MenuEntry<Ctx> | string)[], extra: Partial<OpenMenuOptions<Ctx>> = {}) {
  const runAction = vi.fn();
  const onClose = vi.fn<(reason: MenuCloseReason) => void>();
  const handle = openMenu<Ctx>(entries, ctx, { at: { x: 10, y: 20 }, host: shadow, runAction, onClose, returnFocusTo: opener, ...extra });
  return { handle, runAction, onClose };
}

const basic: MenuEntry<Ctx>[] = [
  { id: 'a', text: 'Alpha', shortcut: 'a' },
  { id: 'b', text: 'Beta', isDisabled: true, shortcut: 'b' },
  createMenuDivider(),
  { id: 'c', text: 'Gamma' },
];

describe('rendering', () => {
  it('renders items, dividers, roles and states; positions at the point', () => {
    const { handle } = open([
      { id: 'x', text: 'X', icon: '<svg data-i="1"></svg>', shortcut: 'Ctrl+X', isDanger: true, cssClass: 'extra more' },
      createMenuDivider('Group'),
      { id: 'y', text: 'Y', isToggled: true, tooltip: 'tip' },
      { id: 'z', text: 'Z', isDisabled: true, children: [{ id: 'z1' }] },
      { id: 'hidden', isVisible: false },
    ]);
    expect(handle.isOpen).toBe(true);
    const [root] = levels();
    expect(root!.getAttribute('role')).toBe('menu');
    expect(root!.classList.contains('km-menu--has-icons')).toBe(true);
    const [x, y, z] = items();
    expect(items()).toHaveLength(3);
    expect(x!.getAttribute('role')).toBe('menuitem');
    expect(x!.tabIndex).toBe(-1);
    expect(x!.dataset).toMatchObject({ action: 'custom', id: 'x' });
    expect(x!.className).toBe('km-menu__item km-menu__item--danger extra more');
    expect(x!.querySelector('.km-menu__icon svg')).not.toBeNull();
    expect(x!.querySelector('.km-menu__shortcut')!.textContent).toBe('Ctrl+X');
    expect(x!.hasAttribute('aria-checked')).toBe(false);
    expect(y!.classList.contains('km-menu__item--toggled')).toBe(true);
    expect(y!.getAttribute('role')).toBe('menuitemcheckbox');
    expect(y!.getAttribute('aria-checked')).toBe('true');
    expect(y!.hasAttribute('aria-pressed')).toBe(false);
    expect(y!.title).toBe('tip');
    expect(y!.querySelector('.km-menu__icon')!.innerHTML).toBe(''); // the icon column is reserved
    expect(z!.getAttribute('aria-disabled')).toBe('true');
    expect(z!.getAttribute('aria-haspopup')).toBe('menu');
    expect(z!.getAttribute('aria-expanded')).toBe('false');
    expect(z!.classList.contains('km-menu__item--has-submenu')).toBe(true);
    const divider = root!.querySelector('.km-menu__divider')!;
    expect(divider.getAttribute('role')).toBe('separator');
    expect(divider.classList.contains('km-menu__divider--named')).toBe(true);
    expect(divider.textContent).toBe('Group');
    expect(anchors[0]!.opts).toMatchObject({ placement: 'bottom-start', offset: 0 });
    expect(root!.style.left).toBe('10px');
  });

  it('icon is HTML; label and shortcut are escaped text', () => {
    open([{ id: 'x', text: '<b>bold</b>', shortcut: '<i>', icon: '<b class="ic">!</b>' }]);
    const x = byId('x');
    expect(x.querySelector('.km-menu__icon b.ic')).not.toBeNull();
    expect(x.querySelector('.km-menu__label')!.textContent).toBe('<b>bold</b>');
    expect(x.querySelector('.km-menu__label b')).toBeNull();
    expect(x.querySelector('.km-menu__shortcut')!.innerHTML).toBe('&lt;i&gt;');
  });

  it('renderItemCallback fills an item; left empty, the default content renders', () => {
    const renderItemCallback = vi.fn((item: MenuEntry<Ctx>, el: HTMLElement, c: Ctx) => {
      if ((item as { id?: string }).id === 'a') el.textContent = `custom ${c.name}`;
    });
    open(basic, { renderItemCallback });
    expect(byId('a').textContent).toBe('custom node');
    expect(byId('c').querySelector('.km-menu__label')!.textContent).toBe('Gamma');
    expect(renderItemCallback).toHaveBeenCalledTimes(3);
  });

  it('adopts the stylesheet into the host root; extra cssClass on every level', () => {
    open([{ id: 's', text: 'S', children: [{ id: 's1', text: 'S1' }] }], { cssClass: 'wtv-menu' });
    const adopted = (shadow as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets?.length ?? 0;
    expect(adopted + shadow.querySelectorAll('style').length).toBeGreaterThan(0);
    byId('s').click();
    expect(levels().every((l) => l.classList.contains('wtv-menu'))).toBe(true);
    expect(levels()[1]!.classList.contains('km-menu--submenu')).toBe(true);
  });

  it('no visible item → nothing rendered, handle closed, onClose not called', () => {
    const { handle, onClose } = open([{ id: 'h', isVisible: false }, createMenuDivider()]);
    expect(handle.isOpen).toBe(false);
    expect(handle.element).toBeNull();
    expect(levels()).toHaveLength(0);
    handle.close();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('defaults + prepareItemCallback apply at every level', () => {
    open(['copy', { id: 'more', text: 'More', children: [{ action: 'copy' }] }], {
      defaults: (item) => (item.action === 'copy' ? { text: 'Copy!' } : undefined),
      prepareItemCallback: (item) => (item.action === 'copy' ? { ...item, shortcut: 'c' } : item),
    });
    expect(items()[0]!.querySelector('.km-menu__label')!.textContent).toBe('Copy!');
    expect(items()[0]!.querySelector('.km-menu__shortcut')!.textContent).toBe('c');
    byId('more').click();
    expect(items(levels()[1])[0]!.querySelector('.km-menu__shortcut')!.textContent).toBe('c');
  });

  it('renderMenuCallback takes over the root; core still positions and dismisses it', () => {
    const { handle, onClose } = open(basic, {
      renderMenuCallback: (el, close) => {
        el.innerHTML = '<button class="mine">x</button>';
        el.querySelector('button')!.addEventListener('click', close);
      },
    });
    const root = levels()[0]!;
    expect(root.classList.contains('km-menu--custom')).toBe(true);
    expect(root.hasAttribute('role')).toBe(false);
    expect(items()).toHaveLength(0);
    expect(anchors).toHaveLength(1);
    root.querySelector<HTMLButtonElement>('.mine')!.click();
    expect(handle.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledWith('api');
  });
});

describe('activation', () => {
  it('a click closes first, then runs the item with the invocation', () => {
    const order: string[] = [];
    const { runAction, onClose } = open(basic, {
      runAction: vi.fn(() => void order.push('run')),
      onClose: vi.fn(() => void order.push('close')),
    });
    const a = byId('a');
    a.click();
    expect(order).toEqual(['close', 'run']);
    expect(levels()).toHaveLength(0);
    void runAction;
    void onClose;
  });

  it('hands the item, trigger and event to runAction; a disabled item does nothing', () => {
    const { runAction, handle } = open(basic);
    byId('b').click();
    expect(runAction).not.toHaveBeenCalled();
    expect(handle.isOpen).toBe(true);
    byId('c').click();
    expect(runAction).toHaveBeenCalledOnce();
    const [item, inv] = runAction.mock.calls[0]!;
    expect(item).toBe(basic[3]);
    expect(inv.triggerElement.dataset.id).toBe('c');
    expect(inv.sourceEvent.type).toBe('click');
  });

  it('shouldCloseOnClick:false keeps it open and re-renders the level after the run', async () => {
    let n = 0;
    const entries: MenuEntry<Ctx>[] = [{ id: 'bump', shouldCloseOnClick: false, getTextCallback: () => `Bump ${n}` }];
    let release!: () => void;
    const { handle } = open(entries, { runAction: () => new Promise<void>((r) => (release = () => (n++, r()))) });
    byId('bump').click();
    expect(handle.isOpen).toBe(true);
    expect(byId('bump').textContent).toBe('Bump 0');
    release();
    await flush();
    expect(byId('bump').textContent).toBe('Bump 1');
  });
});

describe('submenus', () => {
  it('opens on hover, positions right of the owner, collapses after leaving', () => {
    vi.useFakeTimers();
    open([{ id: 'p', text: 'P', children: [{ id: 'p1', text: 'P1' }] }, { id: 'q', text: 'Q' }]);
    const p = byId('p');
    p.dispatchEvent(new MouseEvent('mouseenter'));
    expect(levels()).toHaveLength(2);
    expect(p.getAttribute('aria-expanded')).toBe('true');
    expect(anchors[1]!.reference).toBe(p);
    expect(anchors[1]!.opts).toMatchObject({ placement: 'right-start' });
    byId('q').dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    expect(levels()).toHaveLength(1);
    expect(anchors[1]!.destroy).toHaveBeenCalled();
    expect(p.getAttribute('aria-expanded')).toBe('false');
  });

  // Review A-01: the anchor used to be created after the empty level had already collapsed.
  it('a submenu whose children are all hidden opens nothing and leaks no positioning', () => {
    open([{ id: 'p', text: 'P', children: [{ id: 'h', text: 'H', isVisible: false }] }]);
    const p = byId('p');
    p.dispatchEvent(new MouseEvent('mouseenter'));
    p.dispatchEvent(new MouseEvent('mouseenter'));
    expect(levels()).toHaveLength(1);
    expect(p.getAttribute('aria-expanded')).toBe('false');
    expect(anchors).toHaveLength(1); // only the root level is positioned
  });

  it('entering the submenu cancels the collapse', () => {
    vi.useFakeTimers();
    open([{ id: 'p', text: 'P', children: [{ id: 'p1', text: 'P1' }] }]);
    const p = byId('p');
    p.dispatchEvent(new MouseEvent('mouseenter'));
    p.dispatchEvent(new MouseEvent('mouseleave'));
    levels()[1]!.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    expect(levels()).toHaveLength(2);
  });

  it('a lazy getChildrenCallback shows a loading row, then the items (with ctx)', async () => {
    let resolve!: (e: MenuEntry<Ctx>[]) => void;
    const getChildrenCallback = vi.fn((_c: Ctx) => new Promise<MenuEntry<Ctx>[]>((r) => (resolve = r)));
    open([{ id: 'lazy', text: 'Lazy', getChildrenCallback }], { labels: { loading: 'Loading…' } });
    byId('lazy').click();
    const sub = levels()[1]!;
    expect(sub.querySelector('.km-menu__loading')!.textContent).toBe('Loading…');
    expect(getChildrenCallback).toHaveBeenCalledWith(ctx);
    resolve([{ id: 'l1', text: 'L1' }]);
    await flush();
    expect(sub.querySelector('.km-menu__loading')).toBeNull();
    expect(byId('l1').textContent).toBe('L1');
  });

  it('a lazy submenu resolving to nothing closes again', async () => {
    open([{ id: 'lazy', text: 'Lazy', getChildrenCallback: async () => [] }]);
    byId('lazy').click();
    expect(levels()).toHaveLength(2);
    await flush();
    expect(levels()).toHaveLength(1);
  });
});

describe('keyboard', () => {
  it('↓/↑ wrap and skip dividers + disabled; Home / End', () => {
    open(basic);
    key('ArrowDown');
    expect(active()).toBe(byId('a'));
    key('ArrowDown');
    expect(active()).toBe(byId('c')); // skipped disabled b and the divider
    key('ArrowDown');
    expect(active()).toBe(byId('a')); // wrapped
    key('ArrowUp');
    expect(active()).toBe(byId('c'));
    key('Home');
    expect(active()).toBe(byId('a'));
    key('End');
    expect(active()).toBe(byId('c'));
  });

  it('↑ with nothing focused goes to the last item; handled keys are consumed', () => {
    open(basic);
    const e = key('ArrowUp');
    expect(active()).toBe(byId('c'));
    expect(e.defaultPrevented).toBe(true);
  });

  it('shouldFocusFirst / focusFirst() focus the first enabled item', () => {
    open([{ id: 'off', isDisabled: true }, { id: 'on', text: 'On' }], { shouldFocusFirst: true });
    expect(active()).toBe(byId('on'));
  });

  it('→ / Enter open a submenu focusing its first item; ← and Esc close it and refocus the owner', () => {
    open([{ id: 'p', text: 'P', children: [{ id: 'p1', text: 'P1', isDisabled: true }, { id: 'p2', text: 'P2' }] }], {
      shouldFocusFirst: true,
    });
    key('ArrowRight');
    expect(levels()).toHaveLength(2);
    expect(active()).toBe(byId('p2'));
    key('ArrowLeft');
    expect(levels()).toHaveLength(1);
    expect(active()).toBe(byId('p'));
    key('Enter');
    expect(active()).toBe(byId('p2'));
    key('Escape');
    expect(levels()).toHaveLength(1);
    expect(active()).toBe(byId('p'));
  });

  it('→ on a lazy submenu focuses its first item once loaded', async () => {
    open([{ id: 'p', text: 'P', getChildrenCallback: async () => [{ id: 'p1', text: 'P1' }] }], { shouldFocusFirst: true });
    key('ArrowRight');
    await flush();
    expect(active()).toBe(byId('p1'));
  });

  it('Enter / Space run a leaf; focus returns to returnFocusTo', () => {
    const { runAction, onClose } = open(basic, { shouldFocusFirst: true });
    key(' ');
    expect(runAction).toHaveBeenCalledOnce();
    expect(runAction.mock.calls[0]![1].sourceEvent.type).toBe('keydown');
    expect(onClose).toHaveBeenCalledWith('action');
    expect(active()).toBe(opener);
  });

  it('a toggle (isToggled / getIsToggledCallback / a toggled default) is a menuitemcheckbox; Enter / Space run it', () => {
    const { runAction } = open(
      [
        { id: 'off', text: 'Off', isToggled: false },
        { id: 'cb', text: 'Cb', getIsToggledCallback: (c) => c.name === 'node' },
        { id: 'def', text: 'Def' },
        { id: 'plain', text: 'Plain' },
      ],
      { shouldFocusFirst: true, defaults: (item) => (item.id === 'def' ? { isToggled: false } : undefined) },
    );
    expect(byId('off').getAttribute('role')).toBe('menuitemcheckbox');
    expect(byId('off').getAttribute('aria-checked')).toBe('false');
    expect(byId('off').classList.contains('km-menu__item--toggled')).toBe(false);
    expect(byId('cb').getAttribute('aria-checked')).toBe('true');
    expect(byId('def').getAttribute('role')).toBe('menuitemcheckbox');
    expect(byId('plain').getAttribute('role')).toBe('menuitem');
    expect(byId('plain').hasAttribute('aria-checked')).toBe(false);
    key('ArrowDown');
    expect(active()).toBe(byId('cb'));
    key('Enter');
    expect(runAction).toHaveBeenCalledOnce();
    expect(runAction.mock.calls[0]![0].id).toBe('cb');
  });

  it('Esc on the root closes and returns focus; Tab closes without preventing default', () => {
    const first = open(basic, { shouldFocusFirst: true });
    key('Escape');
    expect(first.onClose).toHaveBeenCalledWith('escape');
    expect(active()).toBe(opener);
    const second = open(basic, { shouldFocusFirst: true });
    const e = key('Tab');
    expect(second.onClose).toHaveBeenCalledWith('tab');
    expect(e.defaultPrevented).toBe(false);
    expect(active()).toBe(opener);
  });

  it('an item shortcut runs it even when focus is outside the menu; a disabled one does not', () => {
    const { runAction } = open(basic);
    opener.focus();
    key('b');
    expect(runAction).not.toHaveBeenCalled();
    key('A');
    expect(runAction).toHaveBeenCalledOnce();
    expect(runAction.mock.calls[0]![0]).toBe(basic[0]);
  });

  it('a key-name shortcut (F2) matches exactly', () => {
    const { runAction } = open([{ id: 'r', text: 'Rename', shortcut: 'F2' }]);
    key('F2');
    expect(runAction).toHaveBeenCalledOnce();
  });

  it('modified keys and unknown keys pass through', () => {
    const { runAction } = open(basic);
    expect(key('a', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key('z').defaultPrevented).toBe(false);
    expect(runAction).not.toHaveBeenCalled();
  });
});

describe('dismiss + cleanup', () => {
  it('an outside pointerdown closes; inside does not; focus is not pulled back', () => {
    const { handle, onClose } = open(basic, { shouldFocusFirst: true });
    byId('a').dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(handle.isOpen).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(handle.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledWith('outside-click');
    expect(active()).not.toBe(opener);
  });

  it('scroll outside (document or the host shadow root) and window blur close', () => {
    const a = open(basic);
    const scroller = document.createElement('div');
    shadow.append(scroller);
    scroller.dispatchEvent(new Event('scroll')); // not composed — seen via the shadow root
    expect(a.onClose).toHaveBeenCalledWith('scroll');
    const b = open(basic);
    levels()[0]!.dispatchEvent(new Event('scroll'));
    expect(b.handle.isOpen).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(b.onClose).toHaveBeenCalledWith('blur');
  });

  it('another KM overlay opening closes it', () => {
    const { onClose } = open(basic);
    registerOverlay(() => {}).activate();
    expect(onClose).toHaveBeenCalledWith('overlay');
  });

  it('shouldCloseOnOutsideInteraction:false ignores outside presses but Escape still closes', () => {
    const { handle, onClose } = open(basic, { shouldCloseOnOutsideInteraction: false });
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    window.dispatchEvent(new Event('blur'));
    expect(handle.isOpen).toBe(true);
    key('Escape');
    expect(onClose).toHaveBeenCalledWith('escape');
  });

  // Review A-16.
  it('a throwing onClose is logged and does not escape close()', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handle } = open(basic, {
      onClose: () => {
        throw new Error('close boom');
      },
    });
    expect(() => handle.close()).not.toThrow();
    expect(levels()).toHaveLength(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  // Review A-15.
  it('a rejected runAction on a closing item is logged, not left unhandled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    open(basic, { runAction: () => Promise.reject(new Error('action failed')) });
    byId('a').click();
    await flush();
    expect(error.mock.calls.some((args) => args.some((x) => x instanceof Error && x.message === 'action failed'))).toBe(true);
    error.mockRestore();
  });

  it('close() removes every level, destroys positioning and all document / window listeners', () => {
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const winAdd = vi.spyOn(window, 'addEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');
    const { handle, onClose } = open([{ id: 'p', text: 'P', children: [{ id: 'p1', text: 'P1' }] }]);
    byId('p').click();
    expect(levels()).toHaveLength(2);
    handle.close();
    handle.close();
    expect(levels()).toHaveLength(0);
    expect(anchors.every((a) => a.destroy.mock.calls.length === 1)).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith('api');
    expect(docRemove.mock.calls.length).toBe(docAdd.mock.calls.length);
    expect(winRemove.mock.calls.length).toBe(winAdd.mock.calls.length);
    const e = key('ArrowDown');
    expect(e.defaultPrevented).toBe(false);
    docAdd.mockRestore();
    docRemove.mockRestore();
    winAdd.mockRestore();
    winRemove.mockRestore();
  });

  it('an element `at` anchors to it with a 4px gap', () => {
    open(basic, { at: opener, placement: 'top-start' });
    expect(anchors[0]!.reference).toBe(opener);
    expect(anchors[0]!.opts).toMatchObject({ placement: 'top-start', offset: 4 });
  });
});

// Review 2026-11-03 (WP7): A-02 / A-03 / A-05 / A-08 / A-09 / A-10 and the overlay tree.
describe('menu — review fixes', () => {
  const nested: MenuEntry<Ctx>[] = [
    { id: 'p', text: 'P', children: [{ id: 'p1', text: 'P1' }] },
    { id: 'q', text: 'Q', children: [{ id: 'q1', text: 'Q1' }] },
    { id: 'r', text: 'R' },
  ];

  it('focus in an unrelated input keeps its keys; Escape still closes', () => {
    const { runAction, handle } = open(basic);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const press = (k: string) => {
      const e = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true });
      input.dispatchEvent(e);
      return e;
    };
    expect(press('Enter').defaultPrevented).toBe(false);
    expect(press('ArrowDown').defaultPrevented).toBe(false);
    press('a'); // item "a" has shortcut "a" — typing in the input must not run it
    expect(runAction).not.toHaveBeenCalled();
    expect(handle.isOpen).toBe(true);
    press('Escape');
    expect(handle.isOpen).toBe(false);
  });

  it('Tab inside a custom (renderMenuCallback) menu moves between its fields instead of closing', () => {
    const { handle } = open(basic, {
      renderMenuCallback: (el) => {
        el.innerHTML = '<input class="f1"><input class="f2">';
      },
    });
    levels()[0]!.querySelector<HTMLInputElement>('.f1')!.focus();
    key('Tab');
    expect(handle.isOpen).toBe(true);
  });

  it('right-to-left: submenus open to the left, and ← / → are mirrored', () => {
    host.setAttribute('dir', 'rtl');
    open(nested);
    key('ArrowDown');
    expect(active()).toBe(byId('p'));
    key('ArrowLeft'); // ← opens in RTL
    expect(levels()).toHaveLength(2);
    expect(anchors.at(-1)!.opts).toMatchObject({ placement: 'left-start' });
    key('ArrowRight'); // → goes back in RTL
    expect(levels()).toHaveLength(1);
    host.removeAttribute('dir');
  });

  it('hover intent: crossing a sibling with its own submenu does not collapse the open one at once', () => {
    vi.useFakeTimers();
    open(nested);
    byId('p').dispatchEvent(new MouseEvent('mouseenter'));
    expect(levels()).toHaveLength(2);
    byId('q').dispatchEvent(new MouseEvent('mouseenter')); // on the way to P's submenu
    expect(levels()[1]!.querySelector('[data-id="p1"]')).not.toBeNull(); // P's submenu still open
    levels()[1]!.dispatchEvent(new MouseEvent('mouseenter')); // reached it — cancels Q
    vi.advanceTimersByTime(500);
    expect(levels()[1]!.querySelector('[data-id="p1"]')).not.toBeNull();
  });

  it('hover intent: resting on the sibling opens its submenu after the delay', () => {
    vi.useFakeTimers();
    open(nested);
    byId('p').dispatchEvent(new MouseEvent('mouseenter'));
    byId('q').dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    expect(levels()[1]!.querySelector('[data-id="q1"]')).not.toBeNull();
  });

  it('a keep-open refresh that hides every item closes the menu (reason "empty")', async () => {
    let isVisible = true;
    const entries: MenuEntry<Ctx>[] = [{ id: 'once', shouldCloseOnClick: false, getIsVisibleCallback: () => isVisible }];
    const { handle, onClose } = open(entries, { runAction: () => void (isVisible = false) });
    byId('once').click();
    await flush();
    expect(handle.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledWith('empty');
  });

  it('two open menus: one Escape closes only the topmost', () => {
    const first = open(basic, { shouldCloseOnOutsideInteraction: false });
    const second = open(basic);
    key('Escape');
    expect(second.handle.isOpen).toBe(false);
    expect(first.handle.isOpen).toBe(true);
    key('Escape');
    expect(first.handle.isOpen).toBe(false);
  });

  it('a menu opened from inside another overlay does not dismiss it (overlay tree)', () => {
    const panelEl = document.createElement('div');
    const trigger = document.createElement('button');
    panelEl.append(trigger);
    document.body.append(panelEl);
    const dismissDropdown = vi.fn();
    registerOverlay(dismissDropdown, undefined, { getElement: () => panelEl }).activate();
    open(basic, { returnFocusTo: trigger });
    expect(dismissDropdown).not.toHaveBeenCalled();
  });
});
