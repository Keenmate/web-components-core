import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same layout-free floating-ui mock as positioning.test.ts.
vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() =>
    Promise.resolve({ x: 10, y: 20, placement: 'bottom-start', strategy: 'fixed', middlewareData: {} }),
  ),
  autoUpdate: vi.fn((_ref: unknown, _float: unknown, update: () => void) => {
    update();
    return vi.fn();
  }),
  offset: vi.fn((value: unknown) => ({ name: 'offset', value })),
  flip: vi.fn((options: unknown) => ({ name: 'flip', options })),
  shift: vi.fn((options: unknown) => ({ name: 'shift', options })),
  size: vi.fn((options: unknown) => ({ name: 'size', options })),
  arrow: vi.fn((options: unknown) => ({ name: 'arrow', options })),
  platform: { __base: true },
}));

import * as fui from '@floating-ui/dom';
import { anchor, createPopover } from './index.js';
import { __resetOverlays } from '../overlay/active-overlay.js';

/** Let the mocked computePosition resolve (onPlaced runs in its `.then`). */
const settle = () => new Promise((r) => setTimeout(r, 0));
/** Past watchScrollClose's opening frames (jsdom: no rAF → its 50 ms fallback). */
const settleOpen = () => new Promise((r) => setTimeout(r, 60));
/** jsdom has no PointerEvent; the overlay router only reads composedPath(). */
/** A full click: the press records, the click (after page handlers) decides. */
const press = (target: EventTarget, onClick?: () => void) => {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
  onClick?.(); // what the clicked element's own handler does
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
};
const escape = () =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

function setup() {
  const reference = document.createElement('button');
  const panel = document.createElement('div');
  document.body.append(reference);
  return { reference, panel };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  __resetOverlays();
  document.body.replaceChildren();
});

describe('anchor — fit additions', () => {
  it('passes fallbackPlacements to flip', () => {
    const { reference, panel } = setup();
    document.body.append(panel);
    anchor(panel, reference, { fallbackPlacements: ['top-start', 'bottom-end'] }).destroy();
    expect(vi.mocked(fui.flip)).toHaveBeenCalledWith({ fallbackPlacements: ['top-start', 'bottom-end'] });
  });

  it('destroy() puts back the inline sizes it wrote, and only those', () => {
    const { reference, panel } = setup();
    document.body.append(panel);
    panel.style.maxHeight = '50px'; // the author's own value, before the anchor
    panel.style.minWidth = '7px'; // never written by the anchor (matchWidth 'exact' writes width)
    const handle = anchor(panel, reference, { matchWidth: 'exact', maxHeight: true });
    type Apply = (state: { rects: { reference: { width: number } }; availableHeight: number }) => void;
    const applies = vi.mocked(fui.size).mock.calls.map((c) => (c[0] as { apply: Apply }).apply);
    for (const apply of applies) apply({ rects: { reference: { width: 120 } }, availableHeight: 300 });
    expect(panel.style.width).toBe('120px');
    expect(panel.style.maxHeight).toBe('300px');

    handle.destroy();
    expect(panel.style.width).toBe('');
    expect(panel.style.maxHeight).toBe('50px');
    expect(panel.style.minWidth).toBe('7px');
  });
});

describe('createPopover — fit additions', () => {
  it('mounts in a ShadowRoot container', () => {
    const { reference, panel } = setup();
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const pop = createPopover({ reference, panel, container: root });
    pop.open();
    expect(panel.parentNode).toBe(root);
    pop.close();
    expect(panel.isConnected).toBe(false);
  });

  it('visibleClass on open; hidden (visibility) until the first placement; both gone on close', async () => {
    const { reference, panel } = setup();
    panel.style.visibility = 'collapse'; // the author's own inline value comes back
    const onPlaced = vi.fn();
    const pop = createPopover({ reference, panel, visibleClass: 'is-open', onPlaced });
    pop.open();
    expect(panel.classList.contains('is-open')).toBe(true); // measurable (a display:none panel shows)
    expect(panel.style.visibility).toBe('hidden'); // but not seen at 0,0
    await settle();
    expect(panel.style.visibility).toBe('collapse');
    expect(onPlaced).toHaveBeenCalledWith('bottom-start'); // the caller's own onPlaced still runs
    pop.close();
    expect(panel.classList.contains('is-open')).toBe(false);
  });

  it('a failed computation still shows the panel after the fallback delay', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fui.computePosition).mockReturnValueOnce(Promise.reject(new Error('no layout')));
    const { reference, panel } = setup();
    const pop = createPopover({ reference, panel });
    pop.open();
    expect(panel.style.visibility).toBe('hidden');
    await vi.advanceTimersByTimeAsync(250);
    expect(panel.style.visibility).toBe('');
    pop.close();
    error.mockRestore();
    vi.useRealTimers();
  });

  describe('open / mounted / anchored kept apart (group B)', () => {
    it('shouldKeepMounted: open / close toggle the class, never move the panel', () => {
      const { reference, panel } = setup();
      const home = document.createElement('div');
      home.append(panel);
      document.body.append(home);
      const pop = createPopover({ reference, panel, shouldKeepMounted: true, visibleClass: 'is-open' });
      pop.open();
      expect(panel.parentNode).toBe(home);
      expect(panel.classList.contains('is-open')).toBe(true);
      pop.close();
      expect(panel.parentNode).toBe(home);
      expect(panel.classList.contains('is-open')).toBe(false);
    });

    it('shouldKeepMounted without a visibleClass toggles hidden', () => {
      const { reference, panel } = setup();
      document.body.append(panel);
      panel.hidden = true;
      const pop = createPopover({ reference, panel, shouldKeepMounted: true });
      pop.open();
      expect(panel.hidden).toBe(false);
      pop.close();
      expect(panel.hidden).toBe(true);
      expect(panel.isConnected).toBe(true);
    });

    it('setAnchored(false) keeps it open and registered, and puts back its own placement styles', async () => {
      const { reference, panel } = setup();
      panel.style.position = 'relative';
      const elsewhere = document.createElement('div');
      document.body.append(elsewhere);
      const pop = createPopover({ reference, panel, shouldCloseOnOutsideClick: true, matchWidth: 'exact' });
      pop.open();
      await settle();
      expect(pop.isAnchored).toBe(true);
      expect(panel.style.position).toBe('fixed');

      pop.setAnchored(false); // e.g. switch to fullscreen
      expect(pop.isOpen).toBe(true);
      expect(pop.isAnchored).toBe(false);
      expect(panel.style.position).toBe('relative');
      expect(panel.style.left).toBe('');
      const cleanups = vi.mocked(fui.autoUpdate).mock.results.map((r) => r.value as ReturnType<typeof vi.fn>);
      expect(cleanups.every((c) => c.mock.calls.length === 1)).toBe(true); // positioning stopped

      press(elsewhere); // still in the overlay tree
      expect(pop.isOpen).toBe(false);
    });

    it('isAnchored: false opens unpositioned; setAnchored(true) while open anchors it', () => {
      const { reference, panel } = setup();
      const pop = createPopover({ reference, panel, isAnchored: false });
      pop.open();
      expect(vi.mocked(fui.autoUpdate)).not.toHaveBeenCalled();
      expect(pop.isAnchored).toBe(false);
      pop.setAnchored(true);
      expect(vi.mocked(fui.autoUpdate)).toHaveBeenCalledOnce();
      expect(pop.isAnchored).toBe(true);
      pop.close();
    });

    it('reanchor() re-reads the reference and starts a fresh anchor (a frozen placement picks again)', () => {
      const first = document.createElement('button');
      const second = document.createElement('button');
      document.body.append(first, second);
      let current = first;
      const pop = createPopover({ reference: () => current, panel: document.createElement('div'), lockPlacement: 'freeze' });
      pop.open();
      expect(vi.mocked(fui.autoUpdate).mock.calls[0]![0]).toBe(first);
      current = second;
      pop.reanchor();
      expect(vi.mocked(fui.autoUpdate)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(fui.autoUpdate).mock.calls[1]![0]).toBe(second);
      pop.close();
      pop.reanchor(); // closed: no-op
      expect(vi.mocked(fui.autoUpdate)).toHaveBeenCalledTimes(2);
    });
  });

  it('inheritThemeFrom: false copies no theme', () => {
    const { reference, panel } = setup();
    document.body.setAttribute('data-theme', 'dark');
    createPopover({ reference, panel, inheritThemeFrom: false }).open();
    expect(panel.hasAttribute('data-theme')).toBe(false);
    const themed = document.createElement('div');
    createPopover({ reference, panel: themed }).open(); // default: from the reference
    expect(themed.getAttribute('data-theme')).toBe('dark');
    document.body.removeAttribute('data-theme');
  });

  it("onClose fires for close() and destroy() with 'api'", () => {
    const { reference, panel } = setup();
    const onClose = vi.fn();
    const pop = createPopover({ reference, panel, onClose });
    pop.open();
    pop.close();
    expect(onClose).toHaveBeenLastCalledWith('api');
    pop.open();
    pop.destroy();
    expect(onClose).toHaveBeenCalledTimes(2);
    pop.destroy(); // idempotent, no third call
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a throwing onClose is logged and the popover is still closed', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { reference, panel } = setup();
    const pop = createPopover({ reference, panel, onClose: () => { throw new Error('boom'); } });
    pop.open();
    pop.close();
    expect(pop.isOpen).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  describe('shouldCloseOnScroll / shouldCloseOnResize', () => {
    /** jsdom has no layout: a real scroll moves the reference, so tests move it themselves. */
    const moveBy = (el: Element, dy: number) => {
      const top = el.getBoundingClientRect().top + dy;
      el.getBoundingClientRect = () => ({ top, left: 0, right: 0, bottom: top, width: 0, height: 0, x: 0, y: top, toJSON() {} }) as DOMRect;
    };

    it('a page scroll closes it; a scroll inside the panel does not', async () => {
      const { reference, panel } = setup();
      const onClose = vi.fn();
      const pop = createPopover({ reference, panel, shouldCloseOnScroll: true, onClose });
      pop.open();
      const list = document.createElement('div');
      panel.append(list);
      moveBy(reference, -40);
      list.dispatchEvent(new Event('scroll'));
      expect(pop.isOpen).toBe(true);
      document.dispatchEvent(new Event('scroll'));
      expect(pop.isOpen).toBe(false);
      expect(onClose).toHaveBeenCalledWith('scroll');
    });

    it('an unrelated scroller elsewhere does not close it; one around the reference does', async () => {
      const wrapper = document.createElement('div');
      const reference = document.createElement('button');
      wrapper.append(reference);
      const logPanel = document.createElement('div'); // e.g. a log that auto-scrolls on events
      document.body.append(wrapper, logPanel);
      const pop = createPopover({ reference, panel: document.createElement('div'), shouldCloseOnScroll: true });
      pop.open();
      moveBy(reference, -40);
      logPanel.dispatchEvent(new Event('scroll'));
      expect(pop.isOpen).toBe(true);
      wrapper.dispatchEvent(new Event('scroll'));
      expect(pop.isOpen).toBe(false);
    });

    it('hears a scroller inside the shadow root around the reference', async () => {
      const host = document.createElement('div');
      document.body.append(host);
      const root = host.attachShadow({ mode: 'open' });
      const body = document.createElement('div');
      const reference = document.createElement('button');
      body.append(reference);
      root.append(body);
      const pop = createPopover({ reference, panel: document.createElement('div'), shouldCloseOnScroll: true });
      pop.open();
      moveBy(reference, -40);
      body.dispatchEvent(new Event('scroll')); // doesn't bubble, doesn't leave the shadow root
      expect(pop.isOpen).toBe(false);
    });

    it('a late scroll event that did not move the reference does not close it', async () => {
      // A scroll-into-view (or a wheel scroll) that ended just before the click that opened the
      // popover delivers its event a frame later: the reference is where it was at open.
      const { reference, panel } = setup();
      const pop = createPopover({ reference, panel, shouldCloseOnScroll: true });
      pop.open();
      document.dispatchEvent(new Event('scroll'));
      expect(pop.isOpen).toBe(true);
      moveBy(reference, 1);
      document.dispatchEvent(new Event('scroll'));
      expect(pop.isOpen).toBe(false);
    });

    it('a scroll the browser makes while opening (WebKit: focus opens, THEN scrolls the input into view) does not close it', async () => {
      const { reference, panel } = setup();
      moveBy(reference, 2103); // below the fold
      reference.focus(); // focus opens the layer before the browser scrolls the input into view
      const pop = createPopover({ reference, panel, shouldCloseOnScroll: true });
      pop.open();
      moveBy(reference, -2103); // WebKit's scroll-into-view of the focused input, a frame after open
      document.dispatchEvent(new Event('scroll'));
      expect(pop.isOpen).toBe(true);
      await settleOpen();
      document.dispatchEvent(new Event('scroll')); // the new place is the baseline
      expect(pop.isOpen).toBe(true);
      moveBy(reference, -40); // the user scrolls afterwards
      document.dispatchEvent(new Event('scroll'));
      expect(pop.isOpen).toBe(false);
    });

    it('a scroll right after opening closes it when the browser has no focus scroll to make (rc21 regression)', () => {
      // The reference is focused but fully visible (a clicked button): there is no opening window, so a
      // page that scrolls at once still closes the layer (web-treeview's info popover).
      const { reference, panel } = setup();
      reference.focus();
      const pop = createPopover({ reference, panel, shouldCloseOnScroll: true });
      pop.open();
      moveBy(reference, -40);
      document.dispatchEvent(new Event('scroll'));
      expect(pop.isOpen).toBe(false);
    });

    it('an off-screen reference that is not focused gets no opening window either', () => {
      const { reference, panel } = setup();
      moveBy(reference, 2103);
      const pop = createPopover({ reference, panel, shouldCloseOnScroll: true });
      pop.open();
      moveBy(reference, -2103);
      document.dispatchEvent(new Event('scroll'));
      expect(pop.isOpen).toBe(false);
    });

    it('a function vetoes; listeners go away on close', () => {
      const { reference, panel } = setup();
      let isAllowed = false;
      const pop = createPopover({ reference, panel, shouldCloseOnScroll: () => isAllowed, shouldCloseOnResize: () => isAllowed });
      pop.open();
      moveBy(reference, -40);
      document.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
      expect(pop.isOpen).toBe(true);
      isAllowed = true;
      window.dispatchEvent(new Event('resize'));
      expect(pop.isOpen).toBe(false);

      const remove = vi.spyOn(window, 'removeEventListener');
      pop.open();
      pop.close();
      expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
      remove.mockRestore();
    });

    it('a throwing rule counts as false (logged)', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { reference, panel } = setup();
      const pop = createPopover({ reference, panel, shouldCloseOnResize: () => { throw new Error('x'); } });
      pop.open();
      window.dispatchEvent(new Event('resize'));
      expect(pop.isOpen).toBe(true);
      expect(error).toHaveBeenCalled();
      pop.close();
      error.mockRestore();
    });
  });

  describe('overlay tree options', () => {
    it('getInsideElements: a press on one does not close, a press elsewhere does', () => {
      const { reference, panel } = setup();
      const hint = document.createElement('div');
      const elsewhere = document.createElement('div');
      document.body.append(hint, elsewhere);
      const onClose = vi.fn();
      const pop = createPopover({ reference, panel, shouldCloseOnOutsideClick: true, getInsideElements: () => [hint, null], onClose });
      pop.open();
      press(hint);
      expect(pop.isOpen).toBe(true);
      press(elsewhere);
      expect(pop.isOpen).toBe(false);
      expect(onClose).toHaveBeenCalledWith('outside-click');
    });

    it('shouldCloseOnOutsideClick as a function is asked at each press', () => {
      const { reference, panel } = setup();
      let isAllowed = false;
      const pop = createPopover({ reference, panel, shouldCloseOnOutsideClick: () => isAllowed });
      pop.open();
      press(document.body);
      expect(pop.isOpen).toBe(true);
      isAllowed = true;
      press(document.body);
      expect(pop.isOpen).toBe(false);
    });

    describe('outside click is decided when the click ends (B7)', () => {
      const open = () => {
        const { reference, panel } = setup();
        const outside = document.createElement('button');
        document.body.append(outside);
        const pop = createPopover({ reference, panel, shouldCloseOnOutsideClick: true });
        pop.open();
        return { pop, panel, outside };
      };

      it('a press alone does not close it (nothing decided before the click)', () => {
        const { pop, outside } = open();
        outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
        expect(pop.isOpen).toBe(true);
        outside.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        expect(pop.isOpen).toBe(false);
      });

      it('a page button that drives the popover through its API keeps it open (claimCurrentClick)', () => {
        const { pop, outside } = open();
        press(outside, () => pop.claimCurrentClick()); // e.g. ms.scrollToIndex(20) from a page button
        expect(pop.isOpen).toBe(true);
        press(outside); // the next plain click outside closes it
        expect(pop.isOpen).toBe(false);
      });

      it('a page button that closes and reopens it during the click leaves it open', () => {
        const { pop, outside } = open();
        press(outside, () => {
          pop.close();
          pop.open(); // re-activated during this click: the click is its own
        });
        expect(pop.isOpen).toBe(true);
      });

      it('a drag that starts in the panel and ends outside does not close it', () => {
        const { pop, panel, outside } = open();
        panel.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
        outside.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        expect(pop.isOpen).toBe(true);
      });

      it('a keyboard click (no press) and a cancelled touch do not close it', () => {
        const { pop, outside } = open();
        outside.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); // Enter on a button
        expect(pop.isOpen).toBe(true);
        outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
        document.dispatchEvent(new Event('pointercancel')); // the touch became a scroll
        outside.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        expect(pop.isOpen).toBe(true);
      });
    });

    it('returnFocusTo: Escape sends focus there, or nowhere with null', () => {
      const { reference, panel } = setup();
      const input = document.createElement('input');
      document.body.append(input);
      const item = document.createElement('button');
      panel.append(item);

      const pop = createPopover({ reference, panel, shouldCloseOnEscape: true, returnFocusTo: input });
      pop.open();
      item.focus();
      escape();
      expect(pop.isOpen).toBe(false);
      expect(document.activeElement).toBe(input);

      const pop2 = createPopover({ reference, panel, shouldCloseOnEscape: true, returnFocusTo: null });
      pop2.open();
      item.focus();
      escape();
      expect(pop2.isOpen).toBe(false);
      expect(document.activeElement).not.toBe(reference);
    });

    it('shouldCloseOnEscape as a function: false lets Escape pass', () => {
      const { reference, panel } = setup();
      const pop = createPopover({ reference, panel, shouldCloseOnEscape: () => false });
      pop.open();
      escape();
      expect(pop.isOpen).toBe(true);
      pop.close();
    });
  });
});

describe('createPopover — reference removed while open (sweep OV-5)', () => {
  it('closes with "reference-removed" at the next position update, and the panel goes', () => {
    const { reference, panel } = setup();
    const reasons: string[] = [];
    const popover = createPopover({ reference, panel, onClose: (r) => reasons.push(r) });
    popover.open();
    expect(panel.isConnected).toBe(true);
    reference.remove(); // a virtualised row re-rendered
    popover.update();
    expect(popover.isOpen).toBe(false);
    expect(panel.isConnected).toBe(false);
    expect(reasons).toEqual(['reference-removed']);
  });

  it('the caller\'s own beforeComputeCallback still runs while the reference is there', () => {
    const { reference, panel } = setup();
    const calls = vi.fn();
    const popover = createPopover({ reference, panel, beforeComputeCallback: calls });
    popover.open();
    expect(calls).toHaveBeenCalled();
    popover.destroy();
  });
});
