import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetElementSizeObservers, observeElementSize, type ElementSize } from './element-size.js';

// Review 2026-11-03 V-19 #2 (element-size test gaps). jsdom has no ResizeObserver: a mock that
// records every instance, so two copies of core (two observers) can be driven separately.
class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  readonly cb: ResizeObserverCallback;
  readonly observed = new Set<Element>();
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    MockResizeObserver.instances.push(this);
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.observed.clear();
  }
  /** Deliver one entry with a logical borderBoxSize, like a real observer. */
  emitBox(target: Element, inlineSize: number, blockSize: number): void {
    this.cb([{ target, borderBoxSize: [{ inlineSize, blockSize }] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

function sized(width: number, height = 100): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperties(el, {
    offsetWidth: { value: width, configurable: true },
    offsetHeight: { value: height, configurable: true },
  });
  return el;
}

const last = (): MockResizeObserver => MockResizeObserver.instances[MockResizeObserver.instances.length - 1]!;

beforeEach(() => {
  MockResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

afterEach(() => {
  __resetElementSizeObservers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('V-19 #2 — a throwing listener (V-06)', () => {
  it('a throw on the immediate fire is logged; the subscription stands and unsubscribes', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = sized(100);
    const seen: number[] = [];
    let unsub: (() => void) | undefined;
    expect(() => {
      unsub = observeElementSize(el, (size) => {
        seen.push(size.width);
        throw new Error('boom');
      }, { throttleMs: 0 });
    }).not.toThrow();
    expect(error.mock.calls.flat().join(' ')).toContain('element size listener threw');
    last().emitBox(el, 200, 100);
    expect(seen).toEqual([100, 200]);
    unsub!();
    expect(last().observed.has(el)).toBe(false);
  });

  it('a throw in the fan-out does not keep the other subscribers (same and other targets) from firing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = sized(100);
    const b = sized(100);
    const seen: string[] = [];
    observeElementSize(a, () => {
      throw new Error('boom');
    }, { shouldFireImmediately: false, throttleMs: 0 });
    observeElementSize(a, (s) => seen.push(`a:${s.width}`), { shouldFireImmediately: false, throttleMs: 0 });
    observeElementSize(b, (s) => seen.push(`b:${s.width}`), { shouldFireImmediately: false, throttleMs: 0 });
    const ro = last();
    expect(() =>
      ro.cb(
        [
          { target: a, borderBoxSize: [{ inlineSize: 300, blockSize: 100 }] },
          { target: b, borderBoxSize: [{ inlineSize: 400, blockSize: 100 }] },
        ] as unknown as ResizeObserverEntry[],
        ro as unknown as ResizeObserver,
      ),
    ).not.toThrow();
    expect(seen).toEqual(['a:300', 'b:400']);
  });
});

describe('V-19 #2 — unsubscribe from inside a listener during the fan-out', () => {
  it('a listener unsubscribing itself stops firing; the others on that element still fire', () => {
    const el = sized(100);
    const seen: string[] = [];
    const unsubSelf: (() => void) = observeElementSize(el, (s) => {
      seen.push(`self:${s.width}`);
      unsubSelf();
    }, { shouldFireImmediately: false, throttleMs: 0 });
    observeElementSize(el, (s) => seen.push(`other:${s.width}`), { shouldFireImmediately: false, throttleMs: 0 });
    last().emitBox(el, 200, 100);
    last().emitBox(el, 300, 100);
    expect(seen).toEqual(['self:200', 'other:200', 'other:300']);
  });

  // FIXED (V-19 #2): onResize() fans out over a COPY of the target's subscriptions and never re-checks
  // membership, so a subscription unsubscribed by an earlier listener in the same delivery still gets
  // dispatch() -> its listener fires AFTER its unsubscribe returned.
  it('a listener unsubscribing a LATER sibling in the same delivery: the sibling does not fire', () => {
    const el = sized(100);
    const seen: string[] = [];
    let unsubLater: () => void = () => {};
    observeElementSize(el, (s) => {
      seen.push(`first:${s.width}`);
      unsubLater();
    }, { shouldFireImmediately: false, throttleMs: 0 });
    unsubLater = observeElementSize(el, (s) => seen.push(`later:${s.width}`), { shouldFireImmediately: false, throttleMs: 0 });
    last().emitBox(el, 200, 100);
    expect(seen).toEqual(['first:200']);
  });

  it('the last subscriber unsubscribing inside the fan-out releases the shared observer', () => {
    const el = sized(100);
    const unsub: () => void = observeElementSize(el, () => unsub(), { shouldFireImmediately: false, throttleMs: 0 });
    const ro = last();
    ro.emitBox(el, 200, 100);
    expect(ro.observed.size).toBe(0);
    // A new subscription builds a fresh observer.
    observeElementSize(sized(10), () => {}, { shouldFireImmediately: false });
    expect(last()).not.toBe(ro);
  });
});

describe('V-19 #2 — two copies of core observing the same element', () => {
  it('each copy has its own observer; both fire, and one copy unsubscribing leaves the other observing', async () => {
    const el = sized(100);
    const seenA: ElementSize[] = [];
    const seenB: ElementSize[] = [];
    const unsubA = observeElementSize(el, (s) => seenA.push(s), { shouldFireImmediately: false, throttleMs: 0 });
    const roA = last();
    vi.resetModules();
    const other = await import('./element-size.js'); // another bundle
    expect(other.observeElementSize).not.toBe(observeElementSize);
    const unsubB = other.observeElementSize(el, (s) => seenB.push(s), { shouldFireImmediately: false, throttleMs: 0 });
    const roB = last();
    expect(roB).not.toBe(roA);
    expect(roA.observed.has(el) && roB.observed.has(el)).toBe(true);

    roA.emitBox(el, 200, 100);
    roB.emitBox(el, 200, 100);
    expect(seenA).toEqual([{ width: 200, height: 100 }]);
    expect(seenB).toEqual([{ width: 200, height: 100 }]);

    unsubA();
    expect(roA.observed.has(el)).toBe(false);
    expect(roB.observed.has(el)).toBe(true);
    roB.emitBox(el, 300, 100);
    expect(seenB.at(-1)).toEqual({ width: 300, height: 100 });
    unsubB();
    other.__resetElementSizeObservers();
  });
});
