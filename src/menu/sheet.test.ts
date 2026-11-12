import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The phone bottom sheet of openMenu() (SPEC §12.13): the presentation switch, drill-in
// submenus, the close reasons (backdrop / close button / Back / Escape), scroll lock, the
// history entry, focus.

// jsdom has no layout — record anchor() calls instead of positioning.
const anchors: unknown[] = [];
vi.mock('../positioning/anchor.js', () => ({
  anchor: vi.fn((floating: HTMLElement) => {
    anchors.push(floating);
    return { update: vi.fn(), destroy: vi.fn() };
  }),
}));

// The device the presentation switch sees.
const env = vi.hoisted(() => ({ isPhone: false }));
vi.mock('../environment/environment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../environment/environment.js')>();
  return {
    ...actual,
    getEnvironment: () =>
      env.isPhone
        ? { ...actual.getEnvironment(), isTouchPrimary: true, viewportWidth: 390, viewportHeight: 844, screenShortSide: 390 }
        : { ...actual.getEnvironment(), isTouchPrimary: false, viewportWidth: 1440, viewportHeight: 900 },
  };
});

import type { MenuEntry } from '../actions/types.js';
import { __resetOverlays } from '../overlay/active-overlay.js';
import { openMenu, type MenuCloseReason, type MenuHandle, type OpenMenuOptions } from './index.js';

interface Ctx {
  name: string;
}
const ctx: Ctx = { name: 'row' };

let host: HTMLElement;
let shadow: ShadowRoot;
let opener: HTMLButtonElement;
let handle: MenuHandle | null = null;
let backSpy: ReturnType<typeof vi.spyOn>;
let pushSpy: ReturnType<typeof vi.spyOn>;

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  anchors.length = 0;
  env.isPhone = true;
  host = document.createElement('div');
  shadow = host.attachShadow({ mode: 'open' });
  opener = document.createElement('button');
  shadow.append(opener);
  document.body.append(host);
  opener.focus();
  backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
  pushSpy = vi.spyOn(history, 'pushState');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // jsdom: not implemented (the scroll-lock restore)
});
afterEach(async () => {
  handle?.close();
  handle = null;
  await flush(); // the deferred history.back() of the released entry
  document.body.replaceChildren();
  __resetOverlays();
  vi.restoreAllMocks();
});

const sheet = () => shadow.querySelector<HTMLElement>('.km-menu-sheet');
const backdrop = () => shadow.querySelector<HTMLElement>('.km-menu-sheet-backdrop');
const levels = () => Array.from(shadow.querySelectorAll<HTMLElement>('.km-menu'));
const visibleLevel = () => levels().find((l) => !l.hidden)!;
const byId = (id: string) => shadow.querySelector<HTMLElement>(`.km-menu__item[data-id="${id}"]`)!;
const backRow = () => visibleLevel().querySelector<HTMLElement>('.km-menu__item--back');
const title = () => shadow.querySelector('.km-menu-sheet__title')!.textContent;
const active = () => shadow.activeElement;
const key = (k: string) => {
  const target = (shadow.activeElement as HTMLElement | null) ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true }));
};

const entries: MenuEntry<Ctx>[] = [
  { id: 'open', text: 'Open' },
  { text: 'Share', id: 'share', children: [{ id: 'copy', text: 'Copy link' }, { text: 'More', id: 'more', children: [{ id: 'qr', text: 'QR' }] }] },
  { text: 'Move to', id: 'move', getChildrenCallback: async () => [{ id: 'docs', text: 'Documents' }] },
];

function open(extra: Partial<OpenMenuOptions<Ctx>> = {}) {
  const runAction = vi.fn();
  const onClose = vi.fn<(reason: MenuCloseReason) => void>();
  handle = openMenu<Ctx>(entries, ctx, { at: { x: 10, y: 20 }, host: shadow, runAction, onClose, returnFocusTo: opener, title: 'File', ...extra });
  return { handle, runAction, onClose };
}

describe('presentation switch', () => {
  it("'auto' on a phone opens the bottom sheet (no anchor), locks page scroll, pushes one history entry", () => {
    open();
    expect(sheet()).not.toBeNull();
    expect(sheet()!.getAttribute('role')).toBe('dialog');
    expect(sheet()!.getAttribute('aria-modal')).toBe('true');
    expect(sheet()!.getAttribute('aria-label')).toBe('File');
    expect(backdrop()).not.toBeNull();
    expect(levels()[0]!.classList.contains('km-menu--sheet')).toBe(true);
    expect(levels()[0]!.getAttribute('aria-label')).toBe('File');
    expect(anchors).toHaveLength(0);
    expect(document.body.style.position).toBe('fixed');
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(title()).toBe('File');
    // Modal: focus moved into the sheet.
    expect(active()).toBe(levels()[0]);
  });

  it("'auto' on a desktop stays floating (anchored, no sheet, no lock, no history entry)", () => {
    env.isPhone = false;
    open();
    expect(sheet()).toBeNull();
    expect(backdrop()).toBeNull();
    expect(anchors).toHaveLength(1);
    expect(levels()[0]!.classList.contains('km-menu--sheet')).toBe(false);
    expect(document.body.style.position).toBe('');
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("'floating' opts out on a phone; 'sheet' forces the sheet on a desktop", () => {
    open({ presentation: 'floating' });
    expect(sheet()).toBeNull();
    expect(anchors).toHaveLength(1);
    handle!.close();
    env.isPhone = false;
    open({ presentation: 'sheet' });
    expect(sheet()).not.toBeNull();
    expect(anchors).toHaveLength(1);
  });
});

describe('drill-in submenus', () => {
  it('a submenu replaces its parent (Back row on top, header names it); Back goes up and refocuses the item', () => {
    const { runAction, onClose } = open();
    byId('share').click();
    const [root, sub] = levels();
    expect(root!.hidden).toBe(true);
    expect(sub!.hidden).toBe(false);
    expect(sheet()!.contains(sub!)).toBe(true);
    expect(anchors).toHaveLength(0); // never anchored in a sheet
    expect(title()).toBe('Share');
    expect(backRow()).toBe(sub!.firstElementChild);
    expect(backRow()!.textContent).toBe('Back');
    expect(active()).toBe(backRow());

    // Deeper: More → QR.
    byId('more').click();
    expect(levels()).toHaveLength(3);
    expect(title()).toBe('More');
    backRow()!.click();
    expect(levels()).toHaveLength(2);
    expect(visibleLevel()).toBe(sub);
    expect(active()).toBe(byId('more'));
    expect(title()).toBe('Share');

    backRow()!.click();
    expect(levels()).toHaveLength(1);
    expect(root!.hidden).toBe(false);
    expect(active()).toBe(byId('share'));
    expect(title()).toBe('File');
    expect(runAction).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hover never opens a submenu in a sheet; a leaf in a submenu runs and closes ("action")', () => {
    const { runAction, onClose } = open();
    byId('share').dispatchEvent(new MouseEvent('mouseenter'));
    expect(levels()).toHaveLength(1);
    byId('share').click();
    byId('copy').click();
    expect(onClose).toHaveBeenCalledWith('action');
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction.mock.calls[0]![0].id).toBe('copy');
    expect(sheet()).toBeNull();
    expect(backdrop()).toBeNull();
    expect(document.body.style.position).toBe('');
    expect(active()).toBe(opener);
  });

  it('a mouse leaving the item that drilled in (its level is now hidden) keeps the submenu open', () => {
    vi.useFakeTimers();
    try {
      open();
      byId('share').click();
      expect(levels()).toHaveLength(2);
      byId('share').dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(1000);
      expect(levels()).toHaveLength(2);
      expect(title()).toBe('Share');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a lazy submenu shows the loading row under its Back row, then the items', async () => {
    open();
    byId('move').click();
    expect(visibleLevel().getAttribute('aria-busy')).toBe('true');
    expect(backRow()).not.toBeNull();
    expect(visibleLevel().querySelector('.km-menu__loading')).not.toBeNull();
    await flush();
    expect(backRow()).toBe(visibleLevel().firstElementChild);
    expect(byId('docs')).not.toBeNull();
  });

  it('keyboard: Enter drills in to the first item, ↑ reaches the Back row, Escape goes up, then closes', () => {
    const { onClose } = open({ shouldFocusFirst: true });
    expect(active()).toBe(byId('open'));
    key('ArrowDown');
    expect(active()).toBe(byId('share'));
    key('Enter');
    expect(active()).toBe(byId('copy'));
    key('ArrowUp');
    expect(active()).toBe(backRow());
    key('Enter'); // the Back row
    expect(levels()).toHaveLength(1);
    expect(active()).toBe(byId('share'));
    key('ArrowRight');
    expect(levels()).toHaveLength(2);
    key('Escape');
    expect(levels()).toHaveLength(1);
    expect(handle!.isOpen).toBe(true);
    key('Escape');
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(active()).toBe(opener);
  });
});

describe('closing', () => {
  it('a tap on the backdrop closes on click (not on pointerdown) with "outside-click"; focus returns', () => {
    const { onClose } = open();
    backdrop()!.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(handle!.isOpen).toBe(true);
    backdrop()!.click();
    expect(onClose).toHaveBeenCalledWith('outside-click');
    expect(active()).toBe(opener);
    expect(document.body.style.position).toBe('');
  });

  it('a press inside the sheet (header) does not close it; the close button closes with "close-button"', () => {
    const { onClose } = open({ labels: { close: 'Zavřít' } });
    const closeButton = shadow.querySelector<HTMLButtonElement>('.km-menu-sheet__close')!;
    expect(closeButton.getAttribute('aria-label')).toBe('Zavřít');
    closeButton.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(handle!.isOpen).toBe(true);
    closeButton.focus();
    closeButton.click();
    expect(onClose).toHaveBeenCalledWith('close-button');
    expect(active()).toBe(opener);
  });

  it('Back (popstate) goes up one submenu level and re-arms the entry; at the root it closes with "back"', async () => {
    const { onClose } = open();
    byId('share').click();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(levels()).toHaveLength(1);
    expect(handle!.isOpen).toBe(true);
    expect(pushSpy).toHaveBeenCalledTimes(2); // re-armed
    expect(active()).toBe(byId('share'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onClose).toHaveBeenCalledWith('back');
    expect(sheet()).toBeNull();
    expect(active()).toBe(opener);
    await flush();
    expect(backSpy).not.toHaveBeenCalled(); // Back already consumed the entry
  });

  it('closed any other way, the entry is given back with history.back() one task later', async () => {
    open();
    handle!.close();
    expect(backSpy).not.toHaveBeenCalled();
    await flush();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('a sheet re-opened right away adopts the entry (no back(), no second push)', async () => {
    open();
    handle!.close();
    open();
    await flush();
    expect(backSpy).not.toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('copies the theme onto the sheet and the backdrop (inheritThemeFrom)', () => {
    host.setAttribute('data-theme', 'dark');
    open({ inheritThemeFrom: host, labels: { back: 'Zpět' } });
    expect(sheet()!.getAttribute('data-theme')).toBe('dark');
    expect(backdrop()!.getAttribute('data-theme')).toBe('dark');
    expect(levels()[0]!.getAttribute('data-theme')).toBe('dark');
    byId('share').click();
    expect(backRow()!.textContent).toBe('Zpět');
  });
});
