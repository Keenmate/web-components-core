import { afterEach, describe, expect, it } from 'vitest';
import { createFocusTrap, getTabbables } from './focus-trap.js';
import { deepActiveElement } from './active-element.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function tab(from: Element, shiftKey = false): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, composed: true, cancelable: true });
  from.dispatchEvent(e);
  return e;
}

function setup(): { opener: HTMLButtonElement; page: HTMLElement; panel: HTMLElement } {
  document.body.innerHTML = `
    <button id="opener">open</button>
    <main id="page"><input id="behind"></main>
    <section id="wrap"><p id="sib">sibling</p><div id="panel"><button id="a">a</button><input id="b"><button id="c" disabled>c</button><span tabindex="-1">x</span><button id="d">d</button></div></section>`;
  const opener = document.getElementById('opener') as HTMLButtonElement;
  opener.focus();
  return { opener, page: document.getElementById('page')!, panel: document.getElementById('panel')! };
}

describe('getTabbables', () => {
  it('skips disabled, negative tabindex, hidden inputs and inert subtrees', () => {
    const { panel } = setup();
    expect(getTabbables(panel).map((el) => el.id)).toEqual(['a', 'b', 'd']);
    panel.querySelector('#b')!.parentElement!.setAttribute('inert', '');
    expect(getTabbables(panel)).toEqual([]);
  });

  it('walks open shadow roots and slotted content in flat-tree order', () => {
    const host = document.createElement('div');
    host.innerHTML = '<button id="slotted">s</button>';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="inner1">1</button><slot></slot><button id="inner2">2</button>';
    document.body.append(host);
    expect(getTabbables(host).map((el) => el.id)).toEqual(['inner1', 'slotted', 'inner2']);
  });
});

describe('createFocusTrap', () => {
  it('focuses the first tabbable, makes the background inert, restores both on release', () => {
    const { opener, page, panel } = setup();
    const sib = document.getElementById('sib')!;
    const trap = createFocusTrap(panel);
    expect(document.activeElement?.id).toBe('a');
    expect(page.hasAttribute('inert')).toBe(true);
    expect(opener.hasAttribute('inert')).toBe(true);
    expect(sib.hasAttribute('inert')).toBe(true);
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(panel.parentElement!.hasAttribute('inert')).toBe(false); // ancestors never

    trap.release();
    expect(page.hasAttribute('inert')).toBe(false);
    expect(sib.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(trap.isReleased).toBe(true);
  });

  it('keeps an element that was already inert inert', () => {
    const { page, panel } = setup();
    page.setAttribute('inert', '');
    createFocusTrap(panel).release();
    expect(page.hasAttribute('inert')).toBe(true);
  });

  it('cycles Tab at the edges', () => {
    const { panel } = setup();
    createFocusTrap(panel);
    const d = document.getElementById('d')!;
    d.focus();
    expect(tab(d).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
    expect(tab(document.activeElement!, true).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('d');
    // in the middle the browser moves focus itself
    const b = document.getElementById('b')!;
    b.focus();
    expect(tab(b).defaultPrevented).toBe(false);
  });

  it('honours initialFocus, [autofocus], and focuses the panel when nothing is tabbable', () => {
    const { panel } = setup();
    createFocusTrap(panel, { initialFocus: () => document.getElementById('d') }).release({ shouldReturnFocus: false });
    expect(document.activeElement?.id).toBe('d');

    document.getElementById('b')!.setAttribute('autofocus', '');
    createFocusTrap(panel).release({ shouldReturnFocus: false });
    expect(document.activeElement?.id).toBe('b');

    const empty = document.createElement('div');
    document.body.append(empty);
    const trap = createFocusTrap(empty);
    expect(document.activeElement).toBe(empty);
    expect(empty.getAttribute('tabindex')).toBe('-1');
    trap.release();
    expect(empty.hasAttribute('tabindex')).toBe(false);
  });

  it('inerts across shadow roots: the panel siblings in the root, then the host siblings', () => {
    document.body.innerHTML = '<p id="outside">x</p><div id="host"></div>';
    const host = document.getElementById('host')!;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="field"><div id="panel"><button>ok</button></div>';
    const panel = root.getElementById('panel')!;
    const trap = createFocusTrap(panel, { keepInteractive: [] });
    expect(root.getElementById('field')!.hasAttribute('inert')).toBe(true);
    expect(document.getElementById('outside')!.hasAttribute('inert')).toBe(true);
    expect(host.hasAttribute('inert')).toBe(false);
    expect(deepActiveElement()?.textContent).toBe('ok');
    trap.release();
    expect(root.getElementById('field')!.hasAttribute('inert')).toBe(false);
  });

  it('returns focus only when it is still inside the panel; returnFocusTo: null = nowhere', () => {
    const { opener, panel } = setup();
    const trap = createFocusTrap(panel);
    const other = document.getElementById('behind') as HTMLInputElement;
    other.removeAttribute('inert');
    other.focus(); // focus moved out on its own (a page script)
    trap.release();
    expect(document.activeElement).toBe(other);

    opener.focus();
    createFocusTrap(panel, { returnFocusTo: null }).release();
    expect(document.activeElement?.id).toBe('a');
  });
});
