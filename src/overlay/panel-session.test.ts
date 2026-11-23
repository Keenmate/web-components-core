import { afterEach, describe, expect, it, vi } from 'vitest';

let backHandler: (() => void) | undefined;
vi.mock('./back-entry.js', () => ({
  claimBackEntry: (onBack: () => void) => {
    backHandler = onBack;
    return () => (backHandler = undefined);
  },
}));

import { startPanelSession, type PanelDismissReason } from './panel-session.js';
import { __resetOverlays, registerOverlay } from './active-overlay.js';

afterEach(() => {
  __resetOverlays();
  backHandler = undefined;
  document.body.replaceChildren();
});

const escape = (): void => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
};
const press = (target: EventTarget): void => {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
};

function setup(): { opener: HTMLButtonElement; page: HTMLElement; panel: HTMLElement } {
  const opener = document.createElement('button');
  const page = document.createElement('main');
  page.innerHTML = '<input id="field">';
  const panel = document.createElement('div');
  panel.innerHTML = '<button id="ok">ok</button>';
  document.body.append(opener, page, panel);
  opener.focus();
  return { opener, page, panel };
}

describe('startPanelSession', () => {
  it('non-modal: role dialog without aria-modal, nothing inert, focus stays; end() restores', () => {
    const { opener, page, panel } = setup();
    const session = startPanelSession(panel, { dismissCallback: () => {} });
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.hasAttribute('aria-modal')).toBe(false);
    expect(page.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
    session.end();
    expect(panel.hasAttribute('role')).toBe(false);
    expect(session.isEnded).toBe(true);
  });

  it('Escape, a click outside and Back ask to close; a click inside does not', async () => {
    const { page, panel } = setup();
    const reasons: PanelDismissReason[] = [];
    let session = startPanelSession(panel, { dismissCallback: (r) => reasons.push(r) });
    press(panel.querySelector('#ok')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(reasons).toEqual([]);
    press(page);
    await new Promise((r) => setTimeout(r, 0));
    expect(reasons).toEqual(['outside-click']); // the component closes and ends it
    session.end();
    session = startPanelSession(panel, { dismissCallback: (r) => reasons.push(r) });
    escape();
    session.end();
    startPanelSession(panel, { dismissCallback: (r) => reasons.push(r) });
    backHandler?.();
    expect(reasons).toEqual(['outside-click', 'escape', 'back']);
  });

  it('a dropdown opened inside closes first on Escape; a page dropdown opening elsewhere does not dismiss the panel', () => {
    const { panel } = setup();
    const reasons: string[] = [];
    startPanelSession(panel, { dismissCallback: (r) => reasons.push(`panel:${r}`) });
    const inner = panel.querySelector<HTMLElement>('#ok')!;
    const dropdown = registerOverlay((r) => reasons.push(`dropdown:${r}`), 'page', { shouldCloseOnEscape: true });
    dropdown.activate({ trigger: inner });
    escape();
    expect(reasons).toEqual(['dropdown:escape']);
    const other = registerOverlay(() => {}, undefined);
    other.activate();
    expect(reasons).toEqual(['dropdown:escape']);
  });

  it('options: no outside click / no Back; initialFocus; end({ shouldReturnFocus }) returns to the trigger', async () => {
    const { opener, page, panel } = setup();
    const reasons: PanelDismissReason[] = [];
    const session = startPanelSession(panel, {
      dismissCallback: (r) => reasons.push(r),
      shouldCloseOnOutsideClick: false,
      shouldCloseOnBack: false,
      initialFocus: true,
      trigger: opener,
    });
    expect(document.activeElement).toBe(panel);
    expect(backHandler).toBeUndefined();
    press(page);
    await new Promise((r) => setTimeout(r, 0));
    expect(reasons).toEqual([]);
    session.end({ shouldReturnFocus: true });
    expect(document.activeElement).toBe(opener);
    expect(panel.hasAttribute('tabindex')).toBe(false);
  });
});
