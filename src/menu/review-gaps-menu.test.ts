import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Review 2026-11-03 A-27 (test gaps): the menu scenarios menu.test.ts did not cover yet.

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
import { __resetOverlays } from '../overlay/active-overlay.js';
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
  vi.restoreAllMocks();
});

const levels = () => Array.from(shadow.querySelectorAll<HTMLElement>('.km-menu'));
const byId = (id: string) => shadow.querySelector<HTMLElement>(`.km-menu__item[data-id="${id}"]`);
const active = () => shadow.activeElement;
const key = (k: string, init: KeyboardEventInit = {}) => {
  const target = (shadow.activeElement as HTMLElement | null) ?? document.body;
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const enter = (el: HTMLElement | null) => el!.dispatchEvent(new MouseEvent('mouseenter'));

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
const nested: MenuEntry<Ctx>[] = [
  { id: 'p', text: 'P', children: [{ id: 'p1', text: 'P1' }] },
  { id: 'q', text: 'Q', children: [{ id: 'q1', text: 'Q1' }] },
  { id: 'r', text: 'R' },
];

describe('A-27 menu — submenus', () => {
  // A-27 #1 (A-01), lazy variant: the static one is in menu.test.ts.
  it('a lazy submenu resolving to nothing destroys its positioning and resets aria-expanded', async () => {
    open([{ id: 'lazy', text: 'Lazy', getChildrenCallback: async () => [{ id: 'h', text: 'H', isVisible: false }] }]);
    byId('lazy')!.click();
    expect(byId('lazy')!.getAttribute('aria-expanded')).toBe('true');
    await flush();
    expect(levels()).toHaveLength(1);
    expect(byId('lazy')!.getAttribute('aria-expanded')).toBe('false');
    expect(anchors).toHaveLength(2);
    expect(anchors[1]!.destroy).toHaveBeenCalledOnce();
  });

  // A-27 #10: keep-open item inside a lazy submenu.
  it('a keep-open item in a lazy submenu re-fetches its level (loading row meanwhile), menu stays open', async () => {
    let n = 0;
    let calls = 0;
    let releaseRefetch!: () => void;
    const list = (): MenuEntry<Ctx>[] => [{ id: 'k', shouldCloseOnClick: false, getTextCallback: () => `K ${n}` }];
    const getChildrenCallback = vi.fn(() =>
      calls++ === 0 ? Promise.resolve(list()) : new Promise<MenuEntry<Ctx>[]>((r) => (releaseRefetch = () => r(list()))),
    );
    const runAction = vi.fn(() => void n++);
    const { handle } = open([{ id: 'p', text: 'P', getChildrenCallback }], { runAction });
    byId('p')!.click();
    await flush();
    expect(byId('k')!.textContent).toBe('K 0');
    byId('k')!.click();
    expect(runAction).toHaveBeenCalledOnce();
    await flush();
    // The level is re-read from the source: the callback runs again, the loading row shows.
    expect(getChildrenCallback).toHaveBeenCalledTimes(2);
    const sub = levels()[1]!;
    expect(sub.querySelector('.km-menu__loading')).not.toBeNull();
    expect(sub.getAttribute('aria-busy')).toBe('true');
    expect(handle.isOpen).toBe(true);
    releaseRefetch();
    await flush();
    expect(sub.querySelector('.km-menu__loading')).toBeNull();
    expect(sub.hasAttribute('aria-busy')).toBe(false);
    expect(byId('k')!.textContent).toBe('K 1');
    expect(handle.isOpen).toBe(true);
  });

  // A-27 #11: a stale lazy load is dropped.
  it('a lazy submenu resolving after the pointer moved to a sibling submenu is dropped (stale)', async () => {
    vi.useFakeTimers();
    let resolveP!: (e: MenuEntry<Ctx>[]) => void;
    open([
      { id: 'p', text: 'P', getChildrenCallback: () => new Promise<MenuEntry<Ctx>[]>((r) => (resolveP = r)) },
      { id: 'q', text: 'Q', children: [{ id: 'q1', text: 'Q1' }] },
    ]);
    enter(byId('p'));
    expect(levels()).toHaveLength(2); // loading
    enter(byId('q'));
    await vi.advanceTimersByTimeAsync(200); // hover intent elapsed → Q's submenu replaces P's
    expect(byId('q1')).not.toBeNull();
    expect(byId('p')!.getAttribute('aria-expanded')).toBe('false');
    resolveP([{ id: 'p1', text: 'P1' }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(byId('p1')).toBeNull();
    expect(levels()).toHaveLength(2);
    expect(byId('q1')).not.toBeNull();
    expect(anchors[1]!.destroy).toHaveBeenCalledOnce(); // P's level positioning
    expect(anchors[2]!.destroy).not.toHaveBeenCalled(); // Q's level is live
  });

  it('a lazy submenu resolving after the pointer moved to a sibling leaf is dropped (stale)', async () => {
    vi.useFakeTimers();
    let resolveP!: (e: MenuEntry<Ctx>[]) => void;
    open([
      { id: 'p', text: 'P', getChildrenCallback: () => new Promise<MenuEntry<Ctx>[]>((r) => (resolveP = r)) },
      { id: 'r', text: 'R' },
    ]);
    enter(byId('p'));
    enter(byId('r'));
    await vi.advanceTimersByTimeAsync(200);
    expect(levels()).toHaveLength(1);
    resolveP([{ id: 'p1', text: 'P1' }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(levels()).toHaveLength(1);
    expect(byId('p1')).toBeNull();
  });

  // A-27 #13.
  it('a disabled item with children opens no submenu on hover, click, → or Enter', () => {
    const { runAction } = open([
      { id: 'p', text: 'P', isDisabled: true, children: [{ id: 'p1', text: 'P1' }] },
      { id: 'q', text: 'Q' },
    ]);
    enter(byId('p'));
    expect(levels()).toHaveLength(1);
    byId('p')!.click();
    expect(levels()).toHaveLength(1);
    byId('p')!.focus(); // arrows skip it, so put focus there by hand
    key('ArrowRight');
    key('Enter');
    key(' ');
    expect(levels()).toHaveLength(1);
    expect(byId('p')!.getAttribute('aria-expanded')).toBe('false');
    expect(runAction).not.toHaveBeenCalled();
    expect(anchors).toHaveLength(1);
  });

  // A-27 #14.
  it('inheritThemeFrom is passed to the root and to every submenu level', () => {
    open(nested, { inheritThemeFrom: host });
    enter(byId('p'));
    expect(anchors).toHaveLength(2);
    expect(anchors[0]!.opts.inheritThemeFrom).toBe(host);
    expect(anchors[1]!.opts.inheritThemeFrom).toBe(host);
  });

  // A-27 #15.
  it('a scroll or wheel inside a (long) submenu does not close the menu', () => {
    const many: MenuEntry<Ctx>[] = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, text: `S${i}` }));
    const { handle, onClose } = open([{ id: 'p', text: 'P', children: many }]);
    enter(byId('p'));
    const sub = levels()[1]!;
    sub.dispatchEvent(new Event('scroll'));
    sub.dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true }));
    expect(handle.isOpen).toBe(true);
    expect(levels()).toHaveLength(2);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('A-27 menu — keyboard', () => {
  // A-27 #3 (A-03): Space / Home / ↑ too (menu.test.ts covers Enter, ↓ and a letter shortcut).
  it('focus in an unrelated input: Space, ↑, Home and End are not consumed', () => {
    const { runAction, handle } = open(basic);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    for (const k of [' ', 'ArrowUp', 'Home', 'End', 'ArrowRight']) {
      const e = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true });
      input.dispatchEvent(e);
      expect(e.defaultPrevented, k).toBe(false);
    }
    expect(runAction).not.toHaveBeenCalled();
    expect(handle.isOpen).toBe(true);
  });

  // A-27 #12.
  it('a shortcut on an item with children opens its submenu and focuses the first item', () => {
    const { runAction } = open([
      { id: 'p', text: 'P', shortcut: 'p', children: [{ id: 'p1', text: 'P1' }] },
      { id: 'r', text: 'R' },
    ]);
    opener.focus();
    const e = key('p');
    expect(e.defaultPrevented).toBe(true);
    expect(levels()).toHaveLength(2);
    expect(active()).toBe(byId('p1'));
    expect(runAction).not.toHaveBeenCalled();
  });

  it('inside a submenu, an ancestor-level shortcut runs; the current level wins a tie', () => {
    const entries: MenuEntry<Ctx>[] = [
      { id: 'p', text: 'P', children: [{ id: 'p1', text: 'P1', shortcut: 'd' }] },
      { id: 'x', text: 'X', shortcut: 'x' },
      { id: 'd', text: 'D', shortcut: 'd' },
    ];
    const first = open(entries, { shouldFocusFirst: true });
    key('ArrowRight');
    expect(active()).toBe(byId('p1'));
    key('d');
    expect(first.runAction).toHaveBeenCalledOnce();
    expect(first.runAction.mock.calls[0]![0].id).toBe('p1');

    const second = open(entries, { shouldFocusFirst: true });
    key('ArrowRight');
    key('x');
    expect(second.runAction).toHaveBeenCalledOnce();
    expect(second.runAction.mock.calls[0]![0].id).toBe('x');
    expect(second.handle.isOpen).toBe(false);
  });
});

describe('A-27 menu — failures and the overlay group', () => {
  // A-27 #8 (A-15): a SYNCHRONOUSLY throwing runAction (the rejection is in menu.test.ts).
  it('a throwing runAction is logged; the menu still closes with reason "action"', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handle, onClose } = open(basic, {
      runAction: () => {
        throw new Error('sync boom');
      },
    });
    byId('a')!.click();
    expect(handle.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledWith('action');
    expect(error.mock.calls.some((args) => args.some((x) => x instanceof Error && x.message === 'sync boom'))).toBe(true);
  });

  it('a throwing / rejecting runAction on a keep-open item is logged; the level still refreshes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let n = 0;
    const entries: MenuEntry<Ctx>[] = [{ id: 'k', shouldCloseOnClick: false, getTextCallback: () => `K ${n}` }];
    const sync = open(entries, {
      runAction: () => {
        n++;
        throw new Error('sync boom');
      },
    });
    byId('k')!.click();
    await flush();
    expect(sync.handle.isOpen).toBe(true);
    expect(byId('k')!.textContent).toBe('K 1');
    expect(error).toHaveBeenCalled();
    sync.handle.close();

    const rejecting = open(entries, { runAction: () => (n++, Promise.reject(new Error('async boom'))) });
    byId('k')!.click();
    await flush();
    expect(rejecting.handle.isOpen).toBe(true);
    expect(byId('k')!.textContent).toBe('K 2');
  });

  // A-27 #9.
  it('re-opening in the same overlayGroup: the old menu closes ("overlay") before the new handle returns', () => {
    const order: string[] = [];
    const first = openMenu<Ctx>(basic, ctx, {
      at: { x: 1, y: 1 },
      host: shadow,
      returnFocusTo: opener,
      overlayGroup: 'menus',
      onClose: (reason) => order.push(`first closed: ${reason}`),
    });
    const second = openMenu<Ctx>(basic, ctx, { at: { x: 2, y: 2 }, host: shadow, returnFocusTo: opener, overlayGroup: 'menus' });
    order.push('second returned');
    expect(order).toEqual(['first closed: overlay', 'second returned']);
    expect(first.isOpen).toBe(false);
    expect(second.isOpen).toBe(true);
    expect(levels()).toHaveLength(1);
    expect(levels()[0]).toBe(second.element);
  });
});
