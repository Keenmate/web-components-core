import { afterEach, describe, expect, it, vi } from 'vitest';

let backHandler: (() => void) | undefined;
vi.mock('./scroll-lock.js', () => ({ lockBodyScroll: () => () => {} }));
vi.mock('./back-entry.js', () => ({
  claimBackEntry: (onBack: () => void) => {
    backHandler = onBack;
    return () => (backHandler = undefined);
  },
}));

import { startModalSession, type ModalDismissReason } from './modal-session.js';
import { __resetOverlays, registerOverlay } from './active-overlay.js';

afterEach(() => {
  __resetOverlays();
  backHandler = undefined;
  document.body.replaceChildren();
});

const escape = (): void => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
};

function setup(): { opener: HTMLButtonElement; page: HTMLElement; panel: HTMLElement } {
  const opener = document.createElement('button');
  const page = document.createElement('main');
  const panel = document.createElement('div');
  panel.innerHTML = '<button id="ok">ok</button>';
  document.body.append(opener, page, panel);
  opener.focus();
  return { opener, page, panel };
}

describe('startModalSession', () => {
  it('ARIA, inert page, focus in; end() restores everything and returns focus', () => {
    const { opener, page, panel } = setup();
    const session = startModalSession(panel, { dismissCallback: () => {} });
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(page.hasAttribute('inert')).toBe(true);
    expect(document.activeElement?.id).toBe('ok');
    session.end();
    session.end();
    expect(panel.hasAttribute('role')).toBe(false);
    expect(panel.hasAttribute('aria-modal')).toBe(false);
    expect(page.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(session.isEnded).toBe(true);
  });

  it('keeps a role the panel already has', () => {
    const { panel } = setup();
    panel.setAttribute('role', 'alertdialog');
    startModalSession(panel, { dismissCallback: () => {} }).end();
    expect(panel.getAttribute('role')).toBe('alertdialog');
  });

  it('backdrop: true creates one before the panel (interactive), a click dismisses, end() removes it', () => {
    const { panel } = setup();
    const reasons: ModalDismissReason[] = [];
    const session = startModalSession(panel, { backdrop: true, dismissCallback: (r) => reasons.push(r) });
    const backdrop = session.backdrop!;
    expect(backdrop.className).toBe('km-modal-backdrop');
    expect(backdrop.nextElementSibling).toBe(panel);
    expect(backdrop.hasAttribute('inert')).toBe(false);
    expect(backdrop.style.zIndex).toContain('--base-z-modal-backdrop');
    backdrop.click();
    expect(reasons).toEqual(['backdrop']);
    session.end();
    expect(backdrop.isConnected).toBe(false);
  });

  it('your own backdrop element: wired, never removed; shouldCloseOnBackdropClick: false ignores clicks', () => {
    const { panel } = setup();
    const own = document.createElement('div');
    document.body.append(own);
    const reasons: ModalDismissReason[] = [];
    const session = startModalSession(panel, { backdrop: own, dismissCallback: (r) => reasons.push(r) });
    own.click();
    session.end();
    expect(own.isConnected).toBe(true);
    expect(reasons).toEqual(['backdrop']);

    const s2 = startModalSession(panel, { backdrop: own, shouldCloseOnBackdropClick: false, dismissCallback: (r) => reasons.push(r) });
    own.click();
    s2.end();
    expect(reasons).toEqual(['backdrop']);
  });

  it('Escape and Back ask to dismiss; a dropdown opened inside closes first on Escape', () => {
    const { panel } = setup();
    const reasons: string[] = [];
    const session = startModalSession(panel, { dismissCallback: (r) => reasons.push(r) });

    const inner = panel.querySelector('button')!;
    const dropdown = document.createElement('div');
    document.body.append(dropdown);
    const child = registerOverlay((r) => reasons.push(`dropdown:${r}`), undefined, {
      getElement: () => dropdown,
      shouldCloseOnEscape: true,
    });
    child.activate({ trigger: inner });
    expect(reasons).toEqual([]); // a child opening never dismisses the modal

    escape();
    expect(reasons).toEqual(['dropdown:escape']);
    escape();
    expect(reasons).toEqual(['dropdown:escape', 'escape']);

    backHandler?.();
    expect(reasons.at(-1)).toBe('back');
    session.end();
  });

  it('a page overlay opening elsewhere does not dismiss it (modal group)', () => {
    const { panel } = setup();
    const reasons: string[] = [];
    startModalSession(panel, { dismissCallback: (r) => reasons.push(r) });
    registerOverlay(() => {}).activate();
    expect(reasons).toEqual([]);
  });

  it('opening dismisses the page (default-group) overlays; opt-out keeps them', () => {
    const { panel } = setup();
    const dismissed: string[] = [];
    registerOverlay(() => dismissed.push('page')).activate();
    registerOverlay(() => dismissed.push('named'), 'toolbar').activate();
    const s = startModalSession(panel, { dismissCallback: () => {} });
    expect(dismissed).toEqual(['page']);
    s.end();

    const kept: string[] = [];
    registerOverlay(() => kept.push('page2')).activate();
    const s2 = startModalSession(panel, { dismissCallback: () => {}, shouldDismissPageOverlays: false });
    expect(kept).toEqual([]);
    s2.end();
  });

  it('keeps the chain it was opened from and overlays opened inside the panel afterwards', () => {
    const { panel } = setup();
    const dropdownPanel = document.createElement('div');
    const item = document.createElement('button');
    dropdownPanel.append(item);
    document.body.append(dropdownPanel);
    const dismissed: string[] = [];
    registerOverlay(() => dismissed.push('opener-dropdown'), undefined, { getElement: () => dropdownPanel }).activate();
    startModalSession(panel, { dismissCallback: () => {}, trigger: item });
    expect(dismissed).toEqual([]); // the dropdown the modal was opened from stays

    const inside = document.createElement('button');
    panel.append(inside);
    registerOverlay(() => dismissed.push('inside')).activate({ trigger: inside });
    expect(dismissed).toEqual([]); // opened after the session, inside the panel: the modal's child
  });

  it('a nested modal keeps its parent modal and the overlay inside it that it was opened from', () => {
    const { panel } = setup();
    const reasons: string[] = [];
    startModalSession(panel, { dismissCallback: (r) => reasons.push(`sheet:${r}`) });
    const dropdownPanel = document.createElement('div');
    const item = document.createElement('button');
    dropdownPanel.append(item);
    panel.append(dropdownPanel);
    const trigger = panel.querySelector('button')!;
    registerOverlay(() => reasons.push('dropdown'), undefined, { getElement: () => dropdownPanel }).activate({ trigger });
    const dialog = document.createElement('div');
    dialog.innerHTML = '<button>x</button>';
    document.body.append(dialog);
    startModalSession(dialog, { dismissCallback: (r) => reasons.push(`dialog:${r}`), trigger: item });
    expect(reasons).toEqual([]);
  });

  it('beforeEscapeCallback false keeps it open; shouldCloseOnEscape false ignores Escape', () => {
    const { panel } = setup();
    const reasons: string[] = [];
    const s = startModalSession(panel, { dismissCallback: (r) => reasons.push(r), beforeEscapeCallback: () => false });
    escape();
    s.end();
    const s2 = startModalSession(panel, { dismissCallback: (r) => reasons.push(r), shouldCloseOnEscape: false });
    escape();
    s2.end();
    expect(reasons).toEqual([]);
  });

  it('shouldCloseOnBack: false claims no Back entry', () => {
    const { panel } = setup();
    startModalSession(panel, { dismissCallback: () => {}, shouldCloseOnBack: false });
    expect(backHandler).toBeUndefined();
  });
});
