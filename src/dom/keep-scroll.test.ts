import { afterEach, describe, expect, it } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { define } from '../element/define.js';
import { keepScrollAcrossMove } from './keep-scroll.js';

/** jsdom has no layout: a scroller with a settable offset; `reset()` is what a browser does to a detached one. */
function fakeScroller(): HTMLElement & { reset(): void } {
  const el = document.createElement('div') as unknown as HTMLElement & { reset(): void };
  let top = 0;
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) });
  el.reset = () => (top = 0);
  return el;
}

class ScrollHost extends BlissElement {
  static inputs = [];
  list = fakeScroller();
  other = fakeScroller();
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).append(this.list, this.other);
    keepScrollAcrossMove(this, () => [this.list]);
  }
  /** Detached: the browser drops every scroll offset inside. */
  protected override disconnect(): void {
    this.list.reset();
    this.other.reset();
  }
}
define('keep-scroll-host', ScrollHost);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('keepScrollAcrossMove', () => {
  it('a move (disconnect → connect) puts the recorded position back', async () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    const host = document.createElement('keep-scroll-host') as ScrollHost;
    a.append(host);
    await host.whenSettled();
    host.list.scrollTop = 240;
    host.list.dispatchEvent(new Event('scroll'));
    b.append(host); // the move: detached for a moment, the browser resets it
    expect(host.list.scrollTop).toBe(240);
  });

  it('only the listed scrollers, only reported scrolls', async () => {
    const host = document.createElement('keep-scroll-host') as ScrollHost;
    document.body.append(host);
    await host.whenSettled();
    host.other.scrollTop = 50;
    host.other.dispatchEvent(new Event('scroll'));
    host.list.scrollTop = 30; // no scroll event: nothing recorded
    document.body.append(host); // move to the end
    expect(host.other.scrollTop).toBe(0);
    expect(host.list.scrollTop).toBe(0);
  });
});
