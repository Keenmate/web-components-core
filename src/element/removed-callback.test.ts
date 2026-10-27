import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';

class RemovableElement extends BlissElement {
  readonly events: string[] = [];
  protected override reinit(): void {
    this.events.push('reinit');
  }
  protected override connect(): void {
    this.events.push('connect');
  }
  protected override disconnect(): void {
    this.events.push('disconnect');
  }
  protected override removedCallback(): void {
    this.events.push('removed');
  }
}
define('removable-element', RemovableElement as unknown as CustomElementConstructor);

class PlainElement extends BlissElement {}
define('plain-removable-element', PlainElement as unknown as CustomElementConstructor);

/** Past the next animation frame (or the macrotask fallback). */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 20);
  });

describe('removedCallback()', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('fires after disconnect() when the element stays detached', async () => {
    const el = new RemovableElement();
    document.body.appendChild(el);
    el.events.length = 0;
    el.remove();
    expect(el.events).toEqual(['disconnect']); // not synchronous
    await nextFrame();
    expect(el.events).toEqual(['disconnect', 'removed']);
  });

  it('does NOT fire for a synchronous DOM move', async () => {
    const el = new RemovableElement();
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    a.appendChild(el);
    el.events.length = 0;
    b.appendChild(el); // disconnect → connect in one task
    await nextFrame();
    expect(el.events).toEqual(['disconnect', 'connect']);
  });

  it('does NOT fire when re-added before the next frame', async () => {
    const el = new RemovableElement();
    document.body.appendChild(el);
    el.events.length = 0;
    el.remove();
    await Promise.resolve(); // a microtask later — still before the frame
    document.body.appendChild(el);
    await nextFrame();
    expect(el.events).toEqual(['disconnect', 'connect']);
  });

  it('re-adding after it fired is a fresh activation: connect() as usual, no forced reinit()', async () => {
    const el = new RemovableElement();
    document.body.appendChild(el);
    el.remove();
    await nextFrame();
    el.events.length = 0;
    document.body.appendChild(el);
    expect(el.events).toEqual(['connect']);
    await expect(el.whenSettled()).resolves.toBeUndefined();
    // and a later removal fires it again
    el.remove();
    await nextFrame();
    expect(el.events).toEqual(['connect', 'disconnect', 'removed']);
  });

  it('falls back to a macrotask when requestAnimationFrame is unavailable', async () => {
    const raf = globalThis.requestAnimationFrame;
    // @ts-expect-error — simulate an environment without rAF
    delete globalThis.requestAnimationFrame;
    try {
      const el = new RemovableElement();
      document.body.appendChild(el);
      el.events.length = 0;
      el.remove();
      await new Promise((r) => setTimeout(r, 10));
      expect(el.events).toEqual(['disconnect', 'removed']);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });

  it('schedules nothing when the hook is not overridden', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const rafSpy = typeof requestAnimationFrame === 'function' ? vi.spyOn(globalThis, 'requestAnimationFrame') : null;
    const el = new PlainElement();
    document.body.appendChild(el);
    el.remove();
    expect(spy).not.toHaveBeenCalled();
    if (rafSpy) expect(rafSpy).not.toHaveBeenCalled();
  });
});
