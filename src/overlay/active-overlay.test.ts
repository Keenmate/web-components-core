import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  registerOverlay,
  notifyOverlayActivated,
  dismissAllOverlays,
  onOverlayActivated,
  OVERLAY_ACTIVATE_EVENT,
  __resetOverlays,
} from './active-overlay.js';

describe('active-overlay coordination', () => {
  afterEach(() => __resetOverlays());

  it('activating one participant dismisses the others but not itself', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const ha = registerOverlay(a);
    registerOverlay(b);
    registerOverlay(c);

    ha.activate();

    expect(a).not.toHaveBeenCalled(); // the opener keeps itself open
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it('two activations in a row each dismiss the other (one-open-at-a-time)', () => {
    const a = vi.fn();
    const b = vi.fn();
    const ha = registerOverlay(a);
    const hb = registerOverlay(b);

    ha.activate();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(0);

    hb.activate();
    expect(a).toHaveBeenCalledTimes(1); // opening B closes A
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('notifyOverlayActivated() with no source dismisses everyone', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlay(a);
    registerOverlay(b);

    notifyOverlayActivated();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('notifyOverlayActivated(source) spares a participant sharing that source token', () => {
    const token = { id: 'svelte-popover' };
    const a = vi.fn();
    registerOverlay(a);

    // External code shares the token of nobody registered → everyone dismisses.
    notifyOverlayActivated(token);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('dismissAllOverlays() closes every participant', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlay(a);
    registerOverlay(b);

    dismissAllOverlays();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a disposed participant is no longer dismissed', () => {
    const a = vi.fn();
    const b = vi.fn();
    const ha = registerOverlay(a);
    registerOverlay(b);

    ha.destroy();
    notifyOverlayActivated();

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('external DOM dispatch (no import) drives dismissal', () => {
    const a = vi.fn();
    registerOverlay(a);

    // A Svelte/plain-DOM opener that never imported core:
    document.dispatchEvent(
      new CustomEvent(OVERLAY_ACTIVATE_EVENT, { detail: { source: 'external' } }),
    );

    expect(a).toHaveBeenCalledTimes(1);
  });

  it('onOverlayActivated lets outside code react to KM activations', () => {
    const seen: unknown[] = [];
    const off = onOverlayActivated((source) => seen.push(source));

    const ha = registerOverlay(() => {});
    ha.activate();

    expect(seen).toHaveLength(1); // observed the KM activation, with the opener's token
    off();

    ha.activate();
    expect(seen).toHaveLength(1); // unsubscribed
  });

  it('groups coordinate independently — activating group A leaves group B open', () => {
    const a1 = vi.fn();
    const a2 = vi.fn();
    const b1 = vi.fn();
    const ha1 = registerOverlay(a1, 'A');
    registerOverlay(a2, 'A');
    registerOverlay(b1, 'B');

    ha1.activate();

    expect(a1).not.toHaveBeenCalled(); // opener itself
    expect(a2).toHaveBeenCalledTimes(1); // same group → dismissed
    expect(b1).not.toHaveBeenCalled(); // other group → untouched
  });

  it('the ungrouped (default) group is separate from a named group', () => {
    const def = vi.fn();
    const grouped = vi.fn();
    const hDef = registerOverlay(def); // no group
    registerOverlay(grouped, 'A');

    hDef.activate();
    expect(grouped).not.toHaveBeenCalled(); // named group untouched by a default-group opener
    expect(def).not.toHaveBeenCalled();
  });

  it('notifyOverlayActivated(source, group) only dismisses that group', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlay(a, 'A');
    registerOverlay(b, 'B');

    notifyOverlayActivated('external', 'A');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('dismissAllOverlays() crosses every group; dismissAllOverlays(group) scopes', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlay(a, 'A');
    registerOverlay(b, 'B');

    dismissAllOverlays('A');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    dismissAllOverlays(); // no arg → all groups
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('activate() does not fire a participant whose dismiss disposes mid-iteration', () => {
    const order: string[] = [];
    const ha = registerOverlay(() => order.push('a'));
    // b disposes itself when dismissed — must not throw or skip c.
    const hb = registerOverlay(() => {
      order.push('b');
      hb.destroy();
    });
    registerOverlay(() => order.push('c'));

    ha.activate();
    expect(order).toEqual(['b', 'c']);
  });

  it('dismissAllOverlays() from another copy of core reaches this copy (Symbol.for)', async () => {
    const a = vi.fn();
    registerOverlay(a, 'A');
    vi.resetModules();
    const other = await import('./active-overlay.js'); // a second module instance = another bundle
    expect(other.dismissAllOverlays).not.toBe(dismissAllOverlays);
    other.dismissAllOverlays();
    expect(a).toHaveBeenCalledTimes(1);
    other.__resetOverlays();
  });
});

// Review 2026-11-03 V-09 / V-12 (WP7): the overlay tree.
describe('active-overlay nesting', () => {
  afterEach(() => {
    __resetOverlays();
    document.body.replaceChildren();
  });

  /** A panel element with a trigger inside (where a nested overlay is opened from). */
  function panel(): { el: HTMLElement; trigger: HTMLElement } {
    const el = document.createElement('div');
    const trigger = document.createElement('button');
    el.append(trigger);
    document.body.append(el);
    return { el, trigger };
  }

  it('a child opened from inside its parent does not dismiss the parent; siblings still close', () => {
    const modal = panel();
    const dismissModal = vi.fn();
    const dismissSibling = vi.fn();
    const hModal = registerOverlay(dismissModal, undefined, { getElement: () => modal.el });
    registerOverlay(dismissSibling); // another, unrelated dropdown
    hModal.activate();
    expect(dismissSibling).toHaveBeenCalledTimes(1);

    const dropdown = registerOverlay(vi.fn());
    dropdown.activate({ trigger: modal.trigger });
    expect(dismissModal).not.toHaveBeenCalled();
    expect(dismissSibling).toHaveBeenCalledTimes(2);
  });

  it('recursive: modal → dropdown → context menu; closing the dropdown closes the menu, not the modal', () => {
    const modal = panel();
    const dropdown = panel();
    modal.el.append(dropdown.el);
    const order: string[] = [];
    // Registered as each one opens (a closed participant also hears dismissals — a no-op for it).
    const hModal = registerOverlay(() => order.push('modal'), undefined, { getElement: () => modal.el });
    hModal.activate();
    const hDropdown = registerOverlay(() => order.push('dropdown'), undefined, { getElement: () => dropdown.el });
    hDropdown.activate({ trigger: modal.trigger });
    const hMenu = registerOverlay(() => order.push('menu'));
    hMenu.activate({ trigger: dropdown.trigger });
    expect(order).toEqual([]); // nobody dismissed an ancestor

    hDropdown.deactivate();
    expect(order).toEqual(['menu']);
    hModal.deactivate();
    expect(order).toEqual(['menu']); // the dropdown already closed itself
  });

  it('closing a parent closes its whole subtree, deepest first', () => {
    const modal = panel();
    const dropdown = panel();
    modal.el.append(dropdown.el);
    const order: string[] = [];
    const hModal = registerOverlay(() => order.push('modal'), undefined, { getElement: () => modal.el });
    hModal.activate();
    registerOverlay(() => order.push('dropdown'), undefined, { getElement: () => dropdown.el }).activate({ trigger: modal.trigger });
    registerOverlay(() => order.push('menu')).activate({ trigger: dropdown.trigger });
    hModal.deactivate();
    expect(order).toEqual(['menu', 'dropdown']);
  });

  it('the parent is found across shadow roots and across copies of core', async () => {
    const modal = panel();
    const host = document.createElement('div');
    modal.el.append(host);
    const shadowTrigger = document.createElement('button');
    host.attachShadow({ mode: 'open' }).append(shadowTrigger);
    const dismissModal = vi.fn();
    registerOverlay(dismissModal, undefined, { getElement: () => modal.el }).activate();

    vi.resetModules();
    const other = await import('./active-overlay.js'); // another component's copy of core
    other.registerOverlay(vi.fn()).activate({ trigger: shadowTrigger });
    expect(dismissModal).not.toHaveBeenCalled();
  });

  it('an activation from outside code can name ancestors itself', () => {
    const modal = panel();
    const dismissModal = vi.fn();
    const hModal = registerOverlay(dismissModal, undefined, { getElement: () => modal.el });
    hModal.activate();
    const seen: unknown[] = [];
    onOverlayActivated((_source, _group, ancestors) => seen.push(...ancestors));
    notifyOverlayActivated('pure-css-menu', undefined, seen); // empty — dismisses the modal
    expect(dismissModal).toHaveBeenCalledTimes(1);
  });

  it('dismissAllOverlays(undefined) crosses every group, like no argument', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlay(a, 'A');
    registerOverlay(b);
    dismissAllOverlays(undefined);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('an overlay dismissed by another activation leaves the tree even if it never deactivates', () => {
    const first = panel();
    const second = panel();
    const hFirst = registerOverlay(vi.fn(), undefined, { getElement: () => first.el });
    const hSecond = registerOverlay(vi.fn(), undefined, { getElement: () => second.el });
    hFirst.activate();
    hSecond.activate(); // dismisses `first`, whose handler does nothing
    const seen: unknown[][] = [];
    onOverlayActivated((_source, _group, ancestors) => seen.push([...ancestors]));
    registerOverlay(vi.fn()).activate({ trigger: first.trigger }); // `first` is closed: not a parent any more
    expect(seen).toEqual([[]]);
  });
});

// Review 2026-11-03 (WP8): overlay tree step 2 — Escape / outside-press routing.
describe('active-overlay routing (step 2)', () => {
  afterEach(() => {
    __resetOverlays();
    document.body.replaceChildren();
  });

  function openPanel(opts: { parentTrigger?: HTMLElement; reasons: string[]; name: string }) {
    const el = document.createElement('div');
    const trigger = document.createElement('button');
    const inner = document.createElement('button'); // where a child overlay is opened from
    el.append(inner);
    (opts.parentTrigger?.parentElement ?? document.body).append(trigger);
    document.body.append(el);
    const handle = registerOverlay((reason) => opts.reasons.push(`${opts.name}:${reason}`), undefined, {
      getElement: () => el,
      shouldCloseOnEscape: true,
      shouldCloseOnOutsideClick: true,
    });
    handle.activate({ trigger: opts.parentTrigger ?? trigger });
    return { el, trigger, inner, handle };
  }

  const escape = () => {
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return e;
  };
  // jsdom has no PointerEvent; the router only reads composedPath().
  /** A full click: the press records, the click (after page handlers) decides. */
  const press = (target: EventTarget, onClick?: () => void) => {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    onClick?.(); // what the clicked element's own handler does
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  };

  it('Escape closes only the deepest open overlay, one level per press', () => {
    const reasons: string[] = [];
    const modal = openPanel({ name: 'modal', reasons });
    const dropdown = openPanel({ name: 'dropdown', reasons, parentTrigger: modal.inner });
    openPanel({ name: 'menu', reasons, parentTrigger: dropdown.inner });
    expect(escape().defaultPrevented).toBe(true);
    expect(reasons).toEqual(['menu:escape']);
    escape();
    expect(reasons).toEqual(['menu:escape', 'dropdown:escape']);
    escape();
    expect(reasons).toEqual(['menu:escape', 'dropdown:escape', 'modal:escape']);
    expect(escape().defaultPrevented).toBe(false); // nothing left to close
  });

  it('a press inside the modal (outside the dropdown) closes the dropdown and its menu, not the modal', () => {
    const reasons: string[] = [];
    const modal = openPanel({ name: 'modal', reasons });
    const dropdown = openPanel({ name: 'dropdown', reasons, parentTrigger: modal.inner });
    openPanel({ name: 'menu', reasons, parentTrigger: dropdown.inner });
    const spot = document.createElement('span');
    modal.el.append(spot);
    press(spot);
    expect(reasons).toEqual(['menu:outside-click', 'dropdown:outside-click']); // deepest first
  });

  it('a press outside every overlay closes the whole chain, deepest first', () => {
    const reasons: string[] = [];
    const modal = openPanel({ name: 'modal', reasons });
    openPanel({ name: 'dropdown', reasons, parentTrigger: modal.inner });
    const outside = document.createElement('p');
    document.body.append(outside);
    press(outside);
    expect(reasons[0]).toBe('dropdown:outside-click');
    expect(reasons).toContain('modal:outside-click');
    expect(reasons).toHaveLength(2);
  });

  it('a press on an overlay’s own trigger does not close it (the trigger toggles it)', () => {
    const reasons: string[] = [];
    const { trigger } = openPanel({ name: 'dropdown', reasons });
    press(trigger);
    expect(reasons).toEqual([]);
  });

  it('Escape returns focus to the trigger when focus was inside the closed panel', () => {
    const reasons: string[] = [];
    const { inner, trigger } = openPanel({ name: 'dropdown', reasons });
    inner.focus();
    escape();
    expect(document.activeElement).toBe(trigger);
  });

  it('a click whose propagation a page handler stops still closes, once its task is done', async () => {
    const reasons: string[] = [];
    openPanel({ name: 'dropdown', reasons });
    const checkbox = document.createElement('input');
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    document.body.append(checkbox);
    press(checkbox);
    expect(reasons).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(reasons).toEqual(['dropdown:outside-click']);
  });

  it('a stopped click that re-activates the overlay (claims it) leaves it open', async () => {
    const reasons: string[] = [];
    const { handle } = openPanel({ name: 'dropdown', reasons });
    const button = document.createElement('button');
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      handle.claimCurrentClick();
    });
    document.body.append(button);
    press(button);
    await new Promise((r) => setTimeout(r, 0));
    expect(reasons).toEqual([]);
  });

  it('a press that never gets its click (a drag) is forgotten: a later keyboard click closes nothing', async () => {
    const reasons: string[] = [];
    openPanel({ name: 'dropdown', reasons });
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    outside.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 0));
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); // Enter on the button
    await new Promise((r) => setTimeout(r, 0));
    expect(reasons).toEqual([]);
  });

  it('overlays that do not opt in are left alone by the router', () => {
    const dismiss = vi.fn();
    const el = document.createElement('div');
    document.body.append(el);
    registerOverlay(dismiss, undefined, { getElement: () => el }).activate();
    escape();
    press(document.body);
    expect(dismiss).not.toHaveBeenCalled();
  });
});
