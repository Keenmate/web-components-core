import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStyleSlot } from './adopt-styles.js';
import { createMicrotaskScheduler } from './microtask-scheduler.js';
import { publishLoaderHook, renderLoader } from './render-loader.js';
import { scrollIntoContainer } from './scroll-container.js';
import { createThrottle } from './throttle.js';

// Review 2026-11-03 D-29: the uncovered dom-helper scenarios (adopt-styles, render-loader,
// microtask-scheduler, throttle, scroll-container). Positioning: src/positioning/review-gaps-positioning.test.ts.

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(() => r()));

afterEach(() => {
  if (window.components) window.components.renderLoadingCallback = undefined;
  document.body.replaceChildren();
  document.head.querySelectorAll('style.d29').forEach((s) => s.remove());
  vi.restoreAllMocks();
});

describe('createStyleSlot — Document root', () => {
  it('a Document root puts the slot into <head>, not the document itself', () => {
    const slot = createStyleSlot(document, { cssClass: 'd29' });
    slot.set('.a {}');
    const style = document.head.querySelector('style.d29');
    expect(style).not.toBeNull();
    expect(style!.parentNode).toBe(document.head);
    expect(style!.textContent).toBe('.a {}');
    slot.set('.b {}');
    expect(document.head.querySelectorAll('style.d29')).toHaveLength(1);
    slot.destroy();
    expect(document.head.querySelector('style.d29')).toBeNull();
  });
});

describe('renderLoader — D-29 gaps', () => {
  let host: HTMLElement;
  let box: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    box = document.createElement('div');
    host.append(box);
    document.body.append(host);
  });

  it('a throwing PAGE hook is logged and the default loader is drawn', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    publishLoaderHook();
    window.components!.renderLoadingCallback = ({ containerElement }) => {
      containerElement.append('partial');
      throw new Error('page boom');
    };
    renderLoader(host, box, 'overlay', { prefix: 'x', label: 'L' });
    expect(error).toHaveBeenCalled();
    expect(box.textContent).toBe('');
    expect(box.querySelector('.x__loader')).not.toBeNull();
  });

  it('a throwing cleanup is logged; the nodes are still removed and role restored', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const remove = renderLoader(host, box, 'overlay', {
      prefix: 'x',
      label: 'L',
      renderLoadingCallback: ({ containerElement }) => {
        containerElement.append(document.createElement('b'));
        return () => {
          throw new Error('cleanup boom');
        };
      },
    });
    expect(() => remove()).not.toThrow();
    expect(error.mock.calls.some((args) => args.some((a) => a instanceof Error && a.message === 'cleanup boom'))).toBe(true);
    expect(box.childNodes.length).toBe(0);
    expect(box.hasAttribute('role')).toBe(false);
  });

  it('an async hook counts as drawn (no default loader); nodes it appends later are its own job', async () => {
    const remove = renderLoader(host, box, 'overlay', {
      prefix: 'x',
      label: 'L',
      // Not the declared shape (returns a Promise, not a cleanup) — but a common thing to write.
      renderLoadingCallback: (async ({ containerElement }: { containerElement: HTMLElement }) => {
        await Promise.resolve();
        containerElement.append(document.createElement('i'));
      }) as unknown as () => void,
    });
    expect(box.querySelector('.x__loader')).toBeNull();
    await tick();
    await tick();
    expect(box.querySelector('i')).not.toBeNull();
    remove();
    // Documented: nodes appended after the hook returned are not renderLoader's to remove.
    expect(box.querySelector('i')).not.toBeNull();
    expect(box.hasAttribute('role')).toBe(false);
  });

  it('a second copy of core publishing after the first shares the page hook (accessor + state)', async () => {
    publishLoaderHook();
    const hook = vi.fn();
    window.components!.renderLoadingCallback = hook;
    vi.resetModules();
    const other = await import('./render-loader.js'); // another bundle's core
    expect(other.renderLoader).not.toBe(renderLoader);
    other.publishLoaderHook(); // must not clobber what the page set through the first copy
    expect(window.components!.renderLoadingCallback).toBe(hook);
    expect(Object.keys(window.components!)).not.toContain('renderLoadingCallback');

    other.renderLoader(host, box, 'a', { prefix: 'x', label: '' });
    expect(hook).toHaveBeenCalledTimes(1);

    const replaced = vi.fn();
    window.components!.renderLoadingCallback = replaced; // assigned after the second publish
    renderLoader(host, box, 'b', { prefix: 'x', label: '' }); // the FIRST copy sees it
    expect(replaced).toHaveBeenCalledTimes(1);
  });
});

describe('createMicrotaskScheduler — D-29 gaps', () => {
  it('a task scheduled while the batch drains is not run by that drain; it runs on the next microtask', async () => {
    const scheduler = createMicrotaskScheduler();
    const ran: string[] = [];
    const late = (): void => {
      ran.push('late');
    };
    scheduler.schedule(() => {
      ran.push('first');
      scheduler.schedule(late);
    });
    scheduler.schedule(() => ran.push('second'));
    scheduler.flush(); // the drain works on a snapshot of the batch
    expect(ran).toEqual(['first', 'second']);
    await tick();
    expect(ran).toEqual(['first', 'second', 'late']);
  });

  it('cancel() then schedule() within the same tick runs the new task exactly once', async () => {
    const scheduler = createMicrotaskScheduler();
    const dropped = vi.fn();
    const kept = vi.fn();
    scheduler.schedule(dropped);
    scheduler.cancel();
    scheduler.schedule(kept);
    await tick();
    await tick();
    expect(dropped).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });
});

describe('createThrottle — D-29 gaps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('the trailing run fires exactly at lastRun + ms', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 30);
    t.schedule(); // leading at 1_000_000
    vi.advanceTimersByTime(12);
    t.schedule(); // queued for 1_000_030
    vi.advanceTimersByTime(17); // 1_000_029
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); // 1_000_030
    expect(fn).toHaveBeenCalledTimes(2);
    expect(Date.now()).toBe(1_000_030);
  });

  it('schedule() from inside fn (re-entrancy) queues one trailing run, no recursion', () => {
    let calls = 0;
    const t = createThrottle(() => {
      calls += 1;
      if (calls < 5) t.schedule();
    }, 30);
    t.schedule();
    expect(calls).toBe(1); // the re-entrant call queued, it did not run synchronously
    vi.advanceTimersByTime(30);
    expect(calls).toBe(2);
    vi.advanceTimersByTime(30);
    expect(calls).toBe(3);
  });
});

describe('scrollIntoContainer — D-29 gaps', () => {
  function geometry(el: Element, g: { top?: number; left?: number; width?: number; height?: number; scrollWidth?: number; scrollHeight?: number }): void {
    const { top = 0, left = 0, width = 100, height = 100 } = g;
    el.getBoundingClientRect = () =>
      ({ top, left, width, height, bottom: top + height, right: left + width, x: left, y: top }) as DOMRect;
    const define = (key: string, value: number): void => {
      Object.defineProperty(el, key, { configurable: true, value });
    };
    define('clientTop', 0);
    define('clientLeft', 0);
    define('clientWidth', width);
    define('clientHeight', height);
    define('scrollWidth', g.scrollWidth ?? width);
    define('scrollHeight', g.scrollHeight ?? height);
  }

  /** A 200px-wide horizontal scroller at left 100 holding a 50px cell at `cellLeft`. */
  function rowScroller(dir: 'ltr' | 'rtl', cellLeft: number): { box: HTMLDivElement; cell: HTMLDivElement } {
    const box = document.createElement('div');
    box.style.overflowX = 'auto';
    box.style.direction = dir;
    const cell = document.createElement('div');
    box.append(cell);
    document.body.append(box);
    geometry(box, { left: 100, width: 200, height: 40, scrollWidth: 1000 });
    geometry(cell, { left: cellLeft, width: 50, height: 20 });
    box.scrollTo = vi.fn() as unknown as typeof box.scrollTo;
    return { box, cell };
  }

  it("RTL: inline 'start' aligns the cell's RIGHT edge with the view's right edge, 'end' its left", () => {
    const { box, cell } = rowScroller('rtl', -200); // cell -200..-150, view 100..300
    scrollIntoContainer(cell, { inline: 'start', axis: 'x' });
    expect(box.scrollTo).toHaveBeenLastCalledWith({ top: 0, left: -450, behavior: 'auto' }); // -150 - 300
    scrollIntoContainer(cell, { inline: 'end', axis: 'x' });
    expect(box.scrollTo).toHaveBeenLastCalledWith({ top: 0, left: -300, behavior: 'auto' }); // -200 - 100
  });

  it("LTR: the same request is not swapped ('start' → left edge)", () => {
    const { box, cell } = rowScroller('ltr', 500);
    scrollIntoContainer(cell, { inline: 'start', axis: 'x' });
    expect(box.scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 400, behavior: 'auto' }); // 500 - 100
  });

  it("axis 'both' finds a scroller that only scrolls horizontally, and scrolls it", () => {
    const { box, cell } = rowScroller('ltr', 500);
    expect(scrollIntoContainer(cell, { axis: 'both' })).toBe(box);
    expect(box.scrollTo).toHaveBeenCalledWith({ top: 0, left: 250, behavior: 'auto' }); // nearest: 550 - 300
  });

  it("axis 'y' (default) ignores a horizontal-only scroller → no container, the page is asked instead", () => {
    const { box, cell } = rowScroller('ltr', 500);
    const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    expect(scrollIntoContainer(cell)).toBeNull();
    expect(box.scrollTo).not.toHaveBeenCalled();
    pageScroll.mockRestore();
  });

  it('stopAt below a real scroller: the scroller inside stopAt is used', () => {
    const outer = document.createElement('div');
    const box = document.createElement('div');
    box.style.overflowY = 'auto';
    const row = document.createElement('div');
    box.append(row);
    outer.append(box);
    document.body.append(outer);
    geometry(box, { top: 100, height: 200, scrollHeight: 1000 });
    geometry(row, { top: 400, height: 20 });
    box.scrollTo = vi.fn() as unknown as typeof box.scrollTo;
    expect(scrollIntoContainer(row, { stopAt: outer })).toBe(box);
    expect(box.scrollTo).toHaveBeenCalledWith({ top: 120, left: 0, behavior: 'auto' }); // 420 - 300
  });

  it('a container option OUTSIDE the element’s ancestry is scrolled by the same geometry (no ancestry check)', () => {
    const box = document.createElement('div');
    const elsewhere = document.createElement('div');
    document.body.append(box, elsewhere);
    geometry(box, { top: 100, height: 200, scrollHeight: 1000 });
    geometry(elsewhere, { top: 400, height: 20 });
    box.scrollTo = vi.fn() as unknown as typeof box.scrollTo;
    expect(scrollIntoContainer(elsewhere, { container: box })).toBe(box);
    expect(box.scrollTo).toHaveBeenCalledWith({ top: 120, left: 0, behavior: 'auto' });
  });
});
