import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeVirtualRange, createVirtualWindow, type VirtualRenderContext } from './virtual-window.js';

/** jsdom has no layout: a scroller with a fake viewport height and scrollTop. */
function fakeScroller(height: number): HTMLElement & { setScroll(top: number): void } {
  const el = document.createElement('div') as unknown as HTMLElement & { setScroll(top: number): void };
  let top = 0;
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 100_000 });
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) });
  el.getBoundingClientRect = () => ({ top: 100, bottom: 100 + height, left: 0, right: 200, width: 200, height, x: 0, y: 100, toJSON: () => ({}) });
  el.setScroll = (v) => {
    top = v;
    el.dispatchEvent(new Event('scroll'));
  };
  document.body.append(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createVirtualWindow', () => {
  const setup = (count = 1000, opts: Record<string, unknown> = {}) => {
    const scroller = fakeScroller(200);
    let n = count;
    const calls: VirtualRenderContext[] = [];
    const vw = createVirtualWindow(scroller, {
      getCount: () => n,
      rowHeight: 20,
      overscan: 2,
      render: (ctx) => calls.push(ctx),
      ...opts,
    });
    // the spacer sits at the content top: its rect follows the scroll
    const spacer = scroller.querySelector<HTMLElement>('.km-virtual-spacer');
    if (spacer) {
      spacer.getBoundingClientRect = () => ({ top: 100 - scroller.scrollTop }) as DOMRect;
      vw.refresh(); // the first paint measured jsdom's zero rect
    }
    return { scroller, vw, calls, setCount: (c: number) => (n = c), spacer };
  };

  it('renders the visible rows + overscan into the window; the spacer holds the full height', () => {
    const { vw, calls, spacer } = setup();
    expect(calls.at(-1)).toMatchObject({ start: 0, end: 12, offsetTop: 0, totalHeight: 20_000 });
    expect(calls.at(-1)!.window).toBe(vw.window);
    expect(spacer!.style.blockSize).toBe('20000px');
    expect(vw.window!.parentElement).toBe(spacer);
  });

  it('scrolling renders a new range only when it changes', () => {
    const { scroller, calls, vw } = setup();
    scroller.setScroll(10);
    const before = calls.length;
    scroller.setScroll(15); // rows 0-10 still visible: same range, no render
    expect(calls.length).toBe(before);
    scroller.setScroll(1000); // rows 50-60
    expect(vw.range).toEqual({ start: 48, end: 62 });
    expect(calls.at(-1)!.offsetTop).toBe(960);
    expect(vw.window!.style.transform).toBe('translateY(960px)');
  });

  it('getPinned keeps an edited row rendered while scrolled away; a change of the pins re-renders', () => {
    let pinned: number[] = [];
    const { scroller, calls, vw } = setup(1000, { getPinned: () => pinned });
    expect(calls.at(-1)!.pinned).toEqual([]);
    pinned = [3, 3, 5000, -1];
    scroller.setScroll(1010); // rows 48-62: row 3 is outside, 5000 / -1 invalid
    expect(calls.at(-1)!.pinned).toEqual([3]);
    const before = calls.length;
    scroller.setScroll(1015); // same range, same pins: no render
    expect(calls.length).toBe(before);
    pinned = [3, 50]; // 50 is inside the range: not listed
    scroller.setScroll(1016);
    expect(calls.length).toBe(before); // pins as listed didn't change ([3])
    pinned = [];
    scroller.setScroll(1017); // the pin was released: re-render without it
    expect(calls.at(-1)!.pinned).toEqual([]);
    expect(calls.length).toBe(before + 1);
    vw.destroy();
  });

  it('computeVirtualRange: the pure math', () => {
    expect(computeVirtualRange({ scrollTop: 1000, viewport: 200, count: 1000, rowHeight: 20, overscan: 2 })).toEqual({ start: 48, end: 62 });
    expect(computeVirtualRange({ scrollTop: -50, viewport: 100, count: 3, rowHeight: 20 })).toEqual({ start: 0, end: 3 });
    expect(computeVirtualRange({ scrollTop: 0, viewport: 0, count: 0, rowHeight: 0 })).toEqual({ start: 0, end: 0 });
  });

  it('refresh always renders; the count is clamped', () => {
    const { calls, vw, setCount } = setup(5);
    expect(vw.range).toEqual({ start: 0, end: 5 });
    const before = calls.length;
    setCount(3);
    vw.refresh();
    expect(calls.length).toBe(before + 1);
    expect(calls.at(-1)).toMatchObject({ start: 0, end: 3, totalHeight: 60 });
  });

  it('scrollToIndex: nearest, start, inset for a sticky header; renders at once', () => {
    const { scroller, vw } = setup();
    vw.scrollToIndex(100); // nearest: row bottom at the viewport bottom
    expect(scroller.scrollTop).toBe(100 * 20 + 20 - 200);
    expect(vw.range.start).toBeLessThanOrEqual(100);
    expect(vw.range.end).toBeGreaterThan(100);
    vw.scrollToIndex(5, { block: 'start' });
    expect(scroller.scrollTop).toBe(100);
    const withHeader = setup(1000, { insetTop: 30 });
    withHeader.vw.scrollToIndex(10, { block: 'start' });
    expect(withHeader.scroller.scrollTop).toBe(200 - 30);
  });

  it('indexAt maps a viewport y to a row; outside → -1', () => {
    const { scroller, vw } = setup();
    scroller.setScroll(400);
    expect(vw.indexAt(100)).toBe(20);
    expect(vw.indexAt(145)).toBe(22);
    expect(vw.indexAt(50)).toBe(-1);
    expect(vw.indexAt(400)).toBe(-1);
  });

  it('hasStructure: false + listTop: the range, scrollToIndex and indexAt count the rows from below a header', () => {
    const { scroller, calls, vw } = setup(1000, { hasStructure: false, listTop: 40 });
    scroller.setScroll(1040); // 1040 - 40 = row 50 at the top
    expect(vw.range).toEqual({ start: 48, end: 62 });
    expect(vw.indexAt(100 + 5)).toBe(50); // the scroller's top edge (rect top 100)
    vw.scrollToIndex(10, { block: 'start' });
    expect(scroller.scrollTop).toBe(40 + 10 * 20);
    expect(calls.at(-1)!.window).toBeNull();
  });

  it('hasStructure: false builds nothing and passes window null', () => {
    const { scroller, calls, vw } = setup(100, { hasStructure: false });
    expect(scroller.children.length).toBe(0);
    expect(vw.window).toBeNull();
    expect(calls.at(-1)).toMatchObject({ start: 0, end: 12, window: null, totalHeight: 2000 });
  });

  it('a hidden scroller (no height) renders a small first window; a throwing render is logged; destroy removes everything', () => {
    const scroller = document.createElement('div');
    document.body.append(scroller);
    const render = vi.fn(() => {
      throw new Error('x');
    });
    const vw = createVirtualWindow(scroller, { getCount: () => 100, rowHeight: () => 20, overscan: 3, render });
    expect(render).toHaveBeenCalledTimes(1);
    expect(vw.range).toEqual({ start: 0, end: 7 });
    vw.destroy();
    expect(scroller.children.length).toBe(0);
    scroller.dispatchEvent(new Event('scroll'));
    expect(render).toHaveBeenCalledTimes(1);
  });
});
