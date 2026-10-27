import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toBool, toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

class GatedElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText(), default: '', on: 'reinit' },
    { configKey: 'isCompact', attribute: 'compact', converter: toBool('presence'), default: false, on: 'update' },
  ];
  readonly calls: string[] = [];
  seenLabel: unknown;
  protected override reinit(): void {
    this.calls.push('reinit');
    this.seenLabel = this.config.label;
  }
  protected override update(partial: Record<string, unknown>): void {
    this.calls.push(`update:${Object.keys(partial).join(',')}`);
  }
  protected override connect(): void {
    this.calls.push('connect');
  }
  protected override disconnect(): void {
    this.calls.push('disconnect');
  }
}
define('gated-element', GatedElement as unknown as CustomElementConstructor);

type Gated = GatedElement & { label: string; isCompact: boolean; onReady: ((d: unknown) => void) | null };

function make(isDeferred: boolean): Gated {
  const el = document.createElement('gated-element') as Gated;
  if (isDeferred) el.setAttribute('defer', '');
  el.addEventListener('ready', () => el.calls.push('ready'));
  return el;
}

describe('defer / release() / ready', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('without defer: builds on connect, then announces ready once (attribute, event, twin, isReady)', async () => {
    const el = make(false);
    const twin = vi.fn();
    el.onReady = twin;
    expect(el.isReady).toBe(false);
    document.body.appendChild(el);
    // ready is announced on a microtask after the build — a listener added right
    // after append / createElement still catches it.
    expect(el.calls).toEqual(['reinit', 'connect']);
    expect(el.isReady).toBe(false);
    expect(el.hasAttribute('ready')).toBe(false);
    await Promise.resolve();
    expect(el.calls).toEqual(['reinit', 'connect', 'ready']);
    expect(el.isReady).toBe(true);
    expect(el.hasAttribute('ready')).toBe(true);
    expect(twin).toHaveBeenCalledTimes(1);
    expect((twin.mock.calls[0]![0] as { element: unknown }).element).toBe(el);
    // A rebuild or a DOM move never re-announces.
    el.label = 'x';
    await el.whenSettled();
    el.remove();
    document.body.appendChild(el);
    expect(el.calls.filter((c) => c === 'ready')).toHaveLength(1);
    await expect(el.whenReady()).resolves.toBeUndefined();
  });

  it('defer holds the first build (no reinit/update/connect) and release() builds once with everything set', async () => {
    const el = make(true);
    document.body.appendChild(el);
    el.label = 'a';
    el.isCompact = true;
    el.label = 'b';
    await Promise.resolve();
    el.flush();
    expect(el.calls).toEqual([]);
    expect(el.isReady).toBe(false);
    expect(el.hasAttribute('ready')).toBe(false);
    const ready = el.whenReady();
    el.release();
    expect(el.calls).toEqual(['reinit', 'connect']);
    expect(el.seenLabel).toBe('b');
    await ready;
    expect(el.calls).toEqual(['reinit', 'connect', 'ready']);
    el.release(); // no-op
    expect(el.calls).toHaveLength(3);
  });

  it('removing the defer attribute releases; re-adding it later never re-holds', async () => {
    const el = make(true);
    document.body.appendChild(el);
    el.removeAttribute('defer');
    await Promise.resolve();
    expect(el.calls).toEqual(['reinit', 'connect', 'ready']);
    el.shouldDefer = true;
    el.isCompact = true;
    await el.whenSettled();
    expect(el.calls).toEqual(['reinit', 'connect', 'ready', 'update:isCompact']);
  });

  it('el.shouldDefer property reflects to the attribute; false releases', async () => {
    const el = make(false);
    el.shouldDefer = true;
    expect(el.hasAttribute('defer')).toBe(true);
    document.body.appendChild(el);
    expect(el.calls).toEqual([]);
    el.shouldDefer = false;
    await Promise.resolve();
    expect(el.calls).toEqual(['reinit', 'connect', 'ready']);
  });

  it('a held element moved in the DOM stays inactive (no connect/disconnect)', () => {
    const el = make(true);
    document.body.appendChild(el);
    el.remove();
    document.body.appendChild(el);
    expect(el.calls).toEqual([]);
  });

  it('release() while detached builds at the next connect', async () => {
    const el = make(true);
    el.label = 'z';
    el.release();
    expect(el.calls).toEqual([]);
    document.body.appendChild(el);
    await Promise.resolve();
    expect(el.calls).toEqual(['reinit', 'connect', 'ready']);
    expect(el.seenLabel).toBe('z');
  });

  it('whenSettled() waits for the release while held', async () => {
    const el = make(true);
    document.body.appendChild(el);
    let isSettled = false;
    void el.whenSettled().then(() => (isSettled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(isSettled).toBe(false);
    el.release();
    await Promise.resolve();
    expect(isSettled).toBe(true);
  });

  it('a throwing first build delays ready until a later build succeeds', async () => {
    class FlakyElement extends BlissElement {
      shouldFail = true;
      protected override reinit(): void {
        if (this.shouldFail) throw new Error('boom');
      }
    }
    define('flaky-ready-element', FlakyElement as unknown as CustomElementConstructor);
    const el = document.createElement('flaky-ready-element') as FlakyElement;
    // A reaction's error is reported to window `error`, not thrown out of append().
    const onError = (e: ErrorEvent): void => e.preventDefault();
    window.addEventListener('error', onError);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      document.body.appendChild(el);
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(el.isReady).toBe(false);
    el.shouldFail = false;
    el.flush();
    await Promise.resolve();
    expect(el.isReady).toBe(true);
  });

  it('sets :state(ready) when CustomStateSet is available', async () => {
    const el = make(false);
    document.body.appendChild(el);
    await el.whenReady();
    const states = (el as unknown as { internals: ElementInternals | null }).internals?.states;
    if (states) expect(states.has('ready')).toBe(true);
  });
  it('a listener added right after createElement + append of an upgraded tag catches ready', async () => {
    const el = document.createElement('gated-element') as Gated;
    document.body.appendChild(el);
    const listener = vi.fn();
    el.addEventListener('ready', listener);
    expect(el.isReady).toBe(false);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(el.isReady).toBe(true);
  });

  it('a DOM move before the microtask announces ready once', async () => {
    const el = make(false);
    document.body.appendChild(el);
    el.remove();
    document.body.appendChild(el);
    await Promise.resolve();
    expect(el.calls.filter((c) => c === 'ready')).toHaveLength(1);
  });

  it('destroy() before the microtask suppresses ready', async () => {
    const el = make(false);
    document.body.appendChild(el);
    el.destroy();
    await Promise.resolve();
    expect(el.isReady).toBe(false);
    expect(el.calls).not.toContain('ready');
  });

  it('a pre-upgrade el.shouldDefer = true becomes the defer attribute and holds', () => {
    const el = document.createElement('gated-late-element') as Gated;
    (el as unknown as { shouldDefer: boolean }).shouldDefer = true;
    class GatedLate extends GatedElement {}
    define('gated-late-element', GatedLate as unknown as CustomElementConstructor);
    document.body.appendChild(el);
    expect(el.hasAttribute('defer')).toBe(true);
    expect(el.calls).toEqual([]);
    expect(el.shouldDefer).toBe(true);
    el.release();
    expect(el.calls).toEqual(['reinit', 'connect']);
  });

  it('a subclass declaring its own shouldDefer / defer input takes the gate over', () => {
    class OwnDefer extends BlissElement {
      protected static override inputs: readonly InputDef[] = [
        { configKey: 'shouldDefer', attribute: 'defer', converter: toBool('presence'), default: false, on: 'none' },
      ];
      builds = 0;
      protected override reinit(): void {
        this.builds++;
      }
    }
    define('own-defer-element', OwnDefer as unknown as CustomElementConstructor);
    const el = document.createElement('own-defer-element') as OwnDefer & { shouldDefer: boolean };
    el.setAttribute('defer', '');
    document.body.appendChild(el);
    expect(el.builds).toBe(1);
    expect(el.shouldDefer).toBe(true);
    expect((OwnDefer as unknown as { observedAttributes: string[] }).observedAttributes.filter((a) => a === 'defer')).toHaveLength(1);
  });
});
