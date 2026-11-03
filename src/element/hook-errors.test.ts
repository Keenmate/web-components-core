import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { toInt, toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import { configureBreakpoints, __resetEnvironment } from '../environment/environment.js';

let seq = 0;

/** Hooks throw while `shouldThrow*` is set — a component bug, not a core one. */
class FlakyElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'height', attribute: 'height', converter: toInt({ default: 10 }), on: 'reinit' },
    { configKey: 'label', attribute: 'label', converter: toText({ default: '' }), on: 'update' },
  ];
  shouldThrowReinit = false;
  shouldThrowUpdate = false;
  reinits = 0;
  connects = 0;
  disconnects = 0;
  protected override reinit(): void {
    this.reinits += 1;
    if (this.shouldThrowReinit) throw new Error('reinit boom');
  }
  protected override update(): void {
    if (this.shouldThrowUpdate) throw new Error('update boom');
  }
  protected override connect(): void {
    this.connects += 1;
  }
  protected override disconnect(): void {
    this.disconnects += 1;
  }
}

type Flaky = FlakyElement & Record<string, unknown>;

function makeEl(): Flaky {
  const tag = `flaky-element-${seq++}`;
  class El extends FlakyElement {}
  customElements.define(tag, El as unknown as CustomElementConstructor);
  return document.createElement(tag) as unknown as Flaky;
}

/**
 * Connect while the first reinit() throws. A custom-element reaction's error is
 * reported to window `error`, not thrown out of append() — swallow that report.
 */
function connectThrowing(el: Flaky): void {
  const onError = (e: ErrorEvent): void => e.preventDefault();
  window.addEventListener('error', onError);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    document.body.append(el as unknown as Node);
  } finally {
    window.removeEventListener('error', onError);
    consoleError.mockRestore();
  }
}

afterEach(() => document.body.replaceChildren());

describe('a hook that throws', () => {
  it('still resolves whenSettled() waiters, and rethrows to the flusher', async () => {
    const el = makeEl();
    document.body.append(el as unknown as Node);
    el.shouldThrowUpdate = true;
    el.label = 'x';
    const settled = el.whenSettled();
    expect(() => el.flush()).toThrow('update boom');
    await expect(settled).resolves.toBeUndefined();
  });

  it('retries a failed first build on the next change, then activates', () => {
    const el = makeEl();
    el.shouldThrowReinit = true;
    connectThrowing(el);
    expect(el.reinits).toBe(1);
    expect(el.connects).toBe(0); // never activated a structure that wasn't built

    el.shouldThrowReinit = false;
    el.label = 'y'; // an update-level change — but the owed rebuild wins
    el.flush();
    expect(el.reinits).toBe(2);
    expect(el.connects).toBe(1);
  });

  it('does not run disconnect() for a connect() that never ran', () => {
    const el = makeEl();
    el.shouldThrowReinit = true;
    connectThrowing(el);
    el.remove();
    expect(el.disconnects).toBe(0);
  });

  it('retries the build on reconnect after a failed first build', () => {
    const el = makeEl();
    el.shouldThrowReinit = true;
    connectThrowing(el);
    el.remove();
    el.shouldThrowReinit = false;
    document.body.append(el as unknown as Node);
    expect(el.reinits).toBe(2);
    expect(el.connects).toBe(1);
    el.remove();
    expect(el.disconnects).toBe(1);
  });
});

// ── review 2026-11-03 (E-02/03/06/07/08/12, V-01) ─────────────────────────────

/** Throws from whichever hook `shouldThrow` names; counts what ran. */
class Trouble extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'height', attribute: 'height', converter: toInt({ default: 10 }), on: 'reinit' },
    { configKey: 'label', attribute: 'label', converter: toText({ default: '' }), on: 'update' },
    { configKey: 'note', attribute: 'note', converter: toText({ default: '' }), on: 'update' },
    {
      configKey: 'data',
      attribute: 'data',
      converter: {
        fromAttribute: (raw: string | null) => raw,
        validate: (_v: unknown): _v is unknown => true,
        toAttribute: () => {
          throw new Error('cannot serialise');
        },
      },
      shouldReflect: true,
      on: 'update',
    },
  ];
  shouldThrow: 'connect' | 'env' | 'update' | 'reinit' | null = null;
  shouldFlushInReinit = false;
  shouldDestroyInConnect = false;
  reinits = 0;
  envCalls = 0;
  updates: Array<Record<string, unknown>> = [];
  protected override reinit(): void {
    this.reinits += 1;
    if (this.reinits > 5) throw new Error('runaway reinit');
    if (this.shouldFlushInReinit) this.flush();
    if (this.shouldThrow === 'reinit') throw new Error('reinit boom');
  }
  protected override update(partial: Record<string, unknown>): void {
    if (this.shouldThrow === 'update') throw new Error('update boom');
    this.updates.push({ ...partial });
  }
  protected override connect(): void {
    if (this.shouldDestroyInConnect) this.destroy();
    if (this.shouldThrow === 'connect') throw new Error('connect boom');
  }
  protected override environmentChanged(): void {
    this.envCalls += 1;
    if (this.shouldThrow === 'env' && this.envCalls === 1) throw new Error('env boom');
  }
}

function makeTrouble(setup: (el: Trouble & Record<string, unknown>) => void = () => {}): Trouble & Record<string, unknown> {
  const tag = `trouble-element-${seq++}`;
  class El extends Trouble {}
  customElements.define(tag, El as unknown as CustomElementConstructor);
  const el = document.createElement(tag) as unknown as Trouble & Record<string, unknown>;
  setup(el);
  return el;
}

/** Append, swallowing the reported reaction error (and the core error log). */
function appendQuietly(el: unknown): void {
  const onError = (e: ErrorEvent): void => e.preventDefault();
  window.addEventListener('error', onError);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    document.body.append(el as Node);
  } finally {
    window.removeEventListener('error', onError);
    consoleError.mockRestore();
  }
}

describe('a hook that throws — activation and recovery', () => {
  afterEach(() => {
    __resetEnvironment();
    vi.restoreAllMocks();
  });

  it('a throwing connect() still announces ready and makes the subscriptions', async () => {
    const el = makeTrouble((e) => (e.shouldThrow = 'connect'));
    appendQuietly(el);
    await el.whenReady();
    expect(el.isReady).toBe(true);
    expect(el.envCalls).toBe(1); // environmentChanged() subscribed and fired
  });

  it('a throwing first environmentChanged() still announces ready, and remove() unsubscribes it', async () => {
    // jsdom has no matchMedia: a stub that counts the shared listeners core attaches.
    let attached = 0;
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: false,
      addEventListener: () => attached++,
      removeEventListener: () => attached--,
    }));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    const el = makeTrouble((e) => (e.shouldThrow = 'env'));
    appendQuietly(el);
    await el.whenReady();
    configureBreakpoints({ mobile: 5000, desktop: Infinity }); // a breakpoint flip notifies subscribers
    expect(el.envCalls).toBe(2);
    el.remove();
    configureBreakpoints({ mobile: 768, tablet: 1024, desktop: Infinity });
    expect(el.envCalls).toBe(2); // no leaked listener
    expect(attached).toBe(0); // the shared media-query listeners were torn down
    vi.unstubAllGlobals();
  });

  it('a retried reinit() that calls flush() does not recurse', () => {
    const el = makeTrouble((e) => (e.shouldThrow = 'reinit'));
    appendQuietly(el);
    el.shouldThrow = null;
    el.shouldFlushInReinit = true;
    el.height = 20;
    el.flush();
    expect(el.reinits).toBe(2);
  });

  it('the keys of a throwing update() are applied again by the next flush', () => {
    const el = makeTrouble();
    document.body.append(el as unknown as Node);
    el.shouldThrow = 'update';
    el.label = 'a';
    expect(() => el.flush()).toThrow('update boom');
    el.shouldThrow = null;
    el.note = 'n';
    el.flush();
    expect(el.updates.at(-1)).toEqual({ label: 'a', note: 'n' });
  });

  it('whenSettled() does not wait after a throwing update()', async () => {
    const el = makeTrouble();
    document.body.append(el as unknown as Node);
    el.shouldThrow = 'update';
    el.label = 'a';
    expect(() => el.flush()).toThrow('update boom');
    await expect(el.whenSettled()).resolves.toBeUndefined();
  });

  it('a converter whose toAttribute throws: the property is set, the attribute is left, nothing throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = makeTrouble();
    document.body.append(el as unknown as Node);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => (el.data = circular)).not.toThrow();
    expect(el.data).toBe(circular);
    expect(el.hasAttribute('data')).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('destroy() inside connect() makes no subscriptions', async () => {
    const el = makeTrouble((e) => (e.shouldDestroyInConnect = true));
    document.body.append(el as unknown as Node);
    expect(el.isDestroyed).toBe(true);
    expect(el.envCalls).toBe(0);
  });

  it('whenReady() settles when the element is destroyed before it was ready', async () => {
    const el = makeTrouble();
    el.setAttribute('defer', '');
    document.body.append(el as unknown as Node);
    const ready = el.whenReady();
    el.destroy();
    await expect(ready).resolves.toBeUndefined();
    await expect(el.whenReady()).resolves.toBeUndefined();
  });
});
