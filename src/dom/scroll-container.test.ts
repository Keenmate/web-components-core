import { afterEach, describe, expect, it, vi } from 'vitest';
import { findScrollContainer, scrollIntoContainer } from './scroll-container.js';

// jsdom has no layout: geometry is faked per element. scroll-padding / scroll-margin, borders
// and real scrollbars are covered in the real browser (e2e/scroll.spec.ts).

interface Geometry {
  top?: number;
  left?: number;
  width?: number;
  height?: number;
  clientTop?: number;
  clientLeft?: number;
  clientWidth?: number;
  clientHeight?: number;
  scrollWidth?: number;
  scrollHeight?: number;
}

function geometry(el: Element, g: Geometry): void {
  const { top = 0, left = 0, width = 100, height = 100 } = g;
  el.getBoundingClientRect = () =>
    ({ top, left, width, height, bottom: top + height, right: left + width, x: left, y: top }) as DOMRect;
  const define = (key: string, value: number | undefined) => {
    if (value !== undefined) Object.defineProperty(el, key, { configurable: true, value });
  };
  define('clientTop', g.clientTop ?? 0);
  define('clientLeft', g.clientLeft ?? 0);
  define('clientWidth', g.clientWidth ?? width);
  define('clientHeight', g.clientHeight ?? height);
  define('scrollWidth', g.scrollWidth ?? width);
  define('scrollHeight', g.scrollHeight ?? height);
}

/** A 200px-tall scroller (1000px of content) at top 100, holding a 20px row. */
function scroller(overflow = 'auto', rowTop = 150): { box: HTMLDivElement; row: HTMLDivElement } {
  const box = document.createElement('div');
  box.style.overflowY = overflow;
  const row = document.createElement('div');
  box.appendChild(row);
  document.body.appendChild(box);
  geometry(box, { top: 100, height: 200, scrollHeight: 1000 });
  geometry(row, { top: rowTop, height: 20 });
  box.scrollTo = vi.fn() as unknown as typeof box.scrollTo;
  return { box, row };
}

afterEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
});

describe('findScrollContainer', () => {
  it('finds the nearest ancestor that actually scrolls', () => {
    const { box, row } = scroller();
    expect(findScrollContainer(row)).toBe(box);
  });

  it('skips an overflow:auto ancestor whose content fits, and keeps walking', () => {
    const { box, row } = scroller();
    const inner = document.createElement('div');
    inner.style.overflowY = 'auto';
    box.appendChild(inner);
    inner.appendChild(row);
    geometry(inner, { height: 50, scrollHeight: 50 });
    expect(findScrollContainer(row)).toBe(box);
  });

  it('skips overflow:hidden / visible ancestors', () => {
    const { row } = scroller('hidden');
    expect(findScrollContainer(row)).toBeNull();
  });

  it('accepts overflow:scroll', () => {
    const { box, row } = scroller('scroll');
    expect(findScrollContainer(row)).toBe(box);
  });

  it('walks out of a shadow root to a light-DOM scroller around the host', () => {
    const { box } = scroller();
    const host = document.createElement('div');
    box.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    root.appendChild(inner);
    expect(findScrollContainer(inner)).toBe(box);
  });

  it('walks a slotted element through its slot (a scroller inside the shadow root)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const shadowScroller = document.createElement('div');
    shadowScroller.style.overflowY = 'auto';
    geometry(shadowScroller, { height: 100, scrollHeight: 500 });
    shadowScroller.appendChild(document.createElement('slot'));
    root.appendChild(shadowScroller);
    const slotted = document.createElement('span');
    host.appendChild(slotted);
    expect(findScrollContainer(slotted)).toBe(shadowScroller);
  });

  it('returns null when only the page scrolls — never <body> / <html>', () => {
    document.body.style.overflowY = 'auto';
    geometry(document.body, { height: 100, scrollHeight: 5000 });
    const row = document.createElement('div');
    document.body.appendChild(row);
    expect(findScrollContainer(row)).toBeNull();
  });

  it('stopAt ends the walk before a scroller outside it', () => {
    const { box, row } = scroller();
    const wrapper = document.createElement('div');
    box.appendChild(wrapper);
    wrapper.appendChild(row);
    expect(findScrollContainer(row, { stopAt: wrapper })).toBeNull();
    expect(findScrollContainer(row, { stopAt: box })).toBeNull();
  });

  it('axis picks which overflow counts', () => {
    const box = document.createElement('div');
    box.style.overflowX = 'auto';
    const row = document.createElement('div');
    box.appendChild(row);
    document.body.appendChild(box);
    geometry(box, { width: 100, scrollWidth: 400 });
    expect(findScrollContainer(row)).toBeNull();
    expect(findScrollContainer(row, { axis: 'x' })).toBe(box);
    expect(findScrollContainer(row, { axis: 'both' })).toBe(box);
  });
});

describe('scrollIntoContainer', () => {
  it('nearest: a fully visible element does not scroll — no scrollTo call at all', () => {
    const { box, row } = scroller('auto', 150);
    expect(scrollIntoContainer(row)).toBe(box);
    expect(box.scrollTo).not.toHaveBeenCalled();
  });

  it('nearest: an element below the view aligns its bottom edge', () => {
    const { box, row } = scroller('auto', 400); // bottom 420, view bottom 300
    box.scrollTop = 50;
    scrollIntoContainer(row);
    expect(box.scrollTo).toHaveBeenCalledWith({ top: 170, left: 0, behavior: 'auto' });
  });

  it('nearest: an element above the view aligns its top edge', () => {
    const { box, row } = scroller('auto', 60); // view top 100
    box.scrollTop = 300;
    scrollIntoContainer(row);
    expect(box.scrollTo).toHaveBeenCalledWith({ top: 260, left: 0, behavior: 'auto' });
  });

  it('start / end / center align the element (inside the borders)', () => {
    const { box, row } = scroller('auto', 400);
    geometry(box, { top: 100, height: 204, clientTop: 2, clientHeight: 200, scrollHeight: 1000 });
    scrollIntoContainer(row, { block: 'start' });
    expect(box.scrollTo).toHaveBeenLastCalledWith({ top: 298, left: 0, behavior: 'auto' }); // 400 - 102
    scrollIntoContainer(row, { block: 'end' });
    expect(box.scrollTo).toHaveBeenLastCalledWith({ top: 118, left: 0, behavior: 'auto' }); // 420 - 302
    scrollIntoContainer(row, { block: 'center' });
    expect(box.scrollTo).toHaveBeenLastCalledWith({ top: 208, left: 0, behavior: 'auto' }); // 410 - 202
  });

  it('inline aligns horizontally', () => {
    const { box, row } = scroller('auto', 150);
    geometry(row, { top: 150, height: 20, left: 300, width: 50 });
    scrollIntoContainer(row, { inline: 'start' });
    expect(box.scrollTo).toHaveBeenCalledWith({ top: 0, left: 300, behavior: 'auto' });
  });

  it('passes behavior through', () => {
    const { box, row } = scroller('auto', 400);
    scrollIntoContainer(row, { behavior: 'smooth' });
    expect(box.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  });

  it('uses the given container without searching', () => {
    const { row } = scroller('hidden', 400); // not a scroller by itself
    const box = row.parentElement as HTMLDivElement;
    expect(scrollIntoContainer(row, { container: box })).toBe(box);
    expect(box.scrollTo).toHaveBeenCalled();
  });

  it('no container → scrollIntoView nearest on the element, returns null', () => {
    const row = document.createElement('div');
    document.body.appendChild(row);
    row.scrollIntoView = vi.fn();
    expect(scrollIntoContainer(row, { block: 'center', behavior: 'smooth' })).toBeNull();
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  });

  it('revealContainer brings an off-screen container into the viewport first', () => {
    const { box, row } = scroller('auto', 150);
    geometry(box, { top: 5000, height: 200, scrollHeight: 1000 });
    box.scrollIntoView = vi.fn();
    scrollIntoContainer(row, { revealContainer: true });
    expect(box.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'auto' });

    (box.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    scrollIntoContainer(row); // off by default
    expect(box.scrollIntoView).not.toHaveBeenCalled();
  });

  it('SSR: no document → null, no throw', () => {
    const el = document.createElement('div');
    vi.stubGlobal('document', undefined);
    try {
      expect(findScrollContainer(el)).toBeNull();
      expect(scrollIntoContainer(el)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
