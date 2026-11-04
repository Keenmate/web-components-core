import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { toEnum, toText } from '../inputs/converters.js';
import type { Converter, InputDef } from '../inputs/types.js';
import { consoleLines } from '../logging/console-line.test-util.js';
import { MOTION_CSS } from '../environment/motion.js';
import { sharedStateKey } from '../global/shared-state.js';
import { __resetEnvironment } from '../environment/environment.js';
import { __resetResponsive } from './responsive.js';

// Review 2026-11-03 E-23: element scenarios the suite did not pin yet.

let seq = 0;
const tagName = (base: string): string => `e23-${base}-${seq++}`;

/** A converter whose `validate` throws (a component bug). */
const throwingValidate: Converter<unknown> = {
  fromAttribute: (raw: string | null) => raw ?? '',
  validate: (_v: unknown): _v is unknown => {
    throw new Error('validate boom');
  },
};

/** A reflected converter whose `toAttribute` throws (a value it can't serialise). */
const throwingToAttribute = (allowed: readonly string[]): Converter<string> => ({
  fromAttribute: (raw: string | null, _r: unknown, _n: string, reportInvalid?: (reason?: string) => void) => {
    if (raw === null) return 'a';
    if (!allowed.includes(raw)) {
      reportInvalid?.('not allowed');
      return 'a';
    }
    return raw;
  },
  validate: (v: unknown): v is string => typeof v === 'string',
  toAttribute: () => {
    throw new Error('cannot serialise');
  },
}) as unknown as Converter<string>;

/** Records every hook; optional per-hook side effects. */
class Probe extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: '' }), on: 'update' },
    { configKey: 'note', attribute: 'note', converter: toText({ default: '' }), on: 'update' },
    { configKey: 'size', attribute: 'size', converter: toText({ default: '' }), on: 'reinit' },
  ];
  calls: string[] = [];
  updates: Array<Record<string, unknown>> = [];
  onReinitHook?: (el: Probe) => void;
  onUpdateHook?: (el: Probe) => void;
  onConnectHook?: (el: Probe) => void;
  protected override reinit(): void {
    this.calls.push('reinit');
    this.onReinitHook?.(this);
  }
  protected override update(partial: Record<string, unknown>): void {
    this.calls.push('update');
    this.updates.push({ ...partial });
    this.onUpdateHook?.(this);
  }
  protected override connect(): void {
    this.calls.push('connect');
    this.onConnectHook?.(this);
  }
  protected override disconnect(): void {
    this.calls.push('disconnect');
  }
  protected override destroyCallback(): void {
    this.calls.push('destroy');
  }
  /** Public escape hatch to call the protected flush from a hook. */
  callFlush(): void {
    this.flush();
  }
}
type P = Probe & Record<string, unknown>;

function makeProbe(base: typeof Probe = Probe): P {
  const tag = tagName('probe');
  customElements.define(tag, class extends base {} as unknown as CustomElementConstructor);
  return document.createElement(tag) as unknown as P;
}

const microtask = (): Promise<void> => new Promise((r) => queueMicrotask(r));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── #2: flush() / release() / destroy() from inside a hook (E-02, E-12) ────────────
describe('E-23 #2 — re-entrant calls from inside a hook', () => {
  it('flush() inside update() is a no-op (no recursion)', () => {
    const el = makeProbe();
    document.body.append(el as unknown as Node);
    el.onUpdateHook = (self) => self.callFlush();
    el.label = 'a';
    el.flush();
    expect(el.updates).toEqual([{ label: 'a' }]);
  });

  // E-23 #2 (fixed): #flushNow() used to cancel the microtask before #flush() bailed out on
  // #isApplying, stranding the write.
  it('a write the hook stages before its own flush() still applies on the next microtask', async () => {
    const el = makeProbe();
    document.body.append(el as unknown as Node);
    el.onUpdateHook = (self) => {
      self.onUpdateHook = undefined;
      (self as P).note = 'from-hook';
      self.callFlush(); // an imperative method called from the hook
    };
    el.label = 'a';
    el.flush();
    expect(el.updates).toEqual([{ label: 'a' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(el.updates).toEqual([{ label: 'a' }, { note: 'from-hook' }]);
  });

  it('flush() inside connect() applies a write the hook staged, connect() runs once', () => {
    const el = makeProbe();
    el.onConnectHook = (self) => {
      (self as P).label = 'in-connect';
      self.callFlush();
    };
    document.body.append(el as unknown as Node);
    expect(el.calls).toEqual(['reinit', 'connect', 'update']);
    expect(el.updates).toEqual([{ label: 'in-connect' }]);
  });

  it('release() inside the released reinit() builds nothing twice', () => {
    const el = makeProbe();
    el.setAttribute('defer', '');
    document.body.append(el as unknown as Node);
    el.onReinitHook = (self) => self.release();
    el.release();
    expect(el.calls).toEqual(['reinit', 'connect']);
  });

  it('destroy() inside the first reinit(): no connect(), no ready; whenSettled() / whenReady() settle', async () => {
    const el = makeProbe();
    el.onReinitHook = (self) => self.destroy();
    document.body.append(el as unknown as Node);
    expect(el.isDestroyed).toBe(true);
    expect(el.calls).toEqual(['reinit', 'destroy']);
    await expect(el.whenSettled()).resolves.toBeUndefined();
    await expect(el.whenReady()).resolves.toBeUndefined();
    await microtask();
    expect(el.isReady).toBe(false);
    expect(el.hasAttribute('ready')).toBe(false);
  });

  it('destroy() inside update(): disconnect → destroyCallback; later writes are inert', async () => {
    const el = makeProbe();
    document.body.append(el as unknown as Node);
    el.onUpdateHook = (self) => self.destroy();
    el.label = 'a';
    el.flush();
    expect(el.calls).toEqual(['reinit', 'connect', 'update', 'disconnect', 'destroy']);
    el.label = 'b';
    await el.whenSettled();
    expect(el.updates).toEqual([{ label: 'a' }]);
  });
});

// ── #4: event twin assigned before upgrade (E-04) ──────────────────────────────────
describe('E-23 #4 — onReady assigned before upgrade', () => {
  it('a pre-upgrade el.onReady becomes the twin and is called once', async () => {
    const tag = tagName('pre-ready');
    const el = document.createElement(tag) as unknown as P;
    const onReady = vi.fn();
    el.onReady = onReady;
    document.body.append(el as unknown as Node);
    customElements.define(tag, class extends Probe {} as unknown as CustomElementConstructor);
    await el.whenReady();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(typeof el.onReady).toBe('function');
  });
});

// ── #5: destroy() while held / while detached with pending writes (E-08) ────────────
describe('E-23 #5 — destroy() before a build could happen', () => {
  it('while held by defer: never builds, release() does nothing, whenReady() settles', async () => {
    const el = makeProbe();
    el.setAttribute('defer', '');
    document.body.append(el as unknown as Node);
    el.label = 'held';
    const ready = el.whenReady();
    el.destroy();
    el.release();
    el.removeAttribute('defer');
    await expect(ready).resolves.toBeUndefined();
    expect(el.calls).toEqual(['destroy']);
    expect(el.isReady).toBe(false);
  });

  it('while detached with pending writes: whenSettled() resolves, the writes never apply, a reconnect stays inert', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = makeProbe();
    document.body.append(el as unknown as Node);
    el.remove();
    el.label = 'detached';
    el.size = 'big'; // a reinit-level write, held until reconnect
    const settled = el.whenSettled();
    el.destroy();
    await expect(settled).resolves.toBeUndefined();
    document.body.append(el as unknown as Node);
    expect(el.calls).toEqual(['reinit', 'connect', 'disconnect', 'destroy']);
    expect(el.updates).toEqual([]);
  });
});

// ── #6: throwing validate / toAttribute off the plain property path (E-06, E-09) ────
describe('E-23 #6 — throwing converters on the batch-value, deferred-reflect and responsive paths', () => {
  class BatchProbe extends BlissElement {
    protected static override inputs: readonly InputDef[] = [
      {
        configKey: 'mode',
        attribute: 'mode',
        converter: toEnum(['plain', 'preset'] as const, { default: 'plain' }),
        getBatchValuesCallback: (mode: unknown) => (mode === 'preset' ? { broken: 'x', shown: 'b', label: 'set' } : null),
      } as InputDef,
      { configKey: 'broken', attribute: 'broken', converter: throwingValidate },
      { configKey: 'shown', attribute: 'shown', converter: throwingToAttribute(['a', 'b']), shouldReflect: true },
      { configKey: 'label', attribute: 'label', converter: toText({ default: '' }) },
    ];
    updates: Array<Record<string, unknown>> = [];
    protected override update(partial: Record<string, unknown>): void {
      this.updates.push({ ...partial });
    }
  }
  const makeBatch = (html?: string): BatchProbe & Record<string, unknown> => {
    const tag = tagName('batch');
    customElements.define(tag, class extends BatchProbe {} as unknown as CustomElementConstructor);
    if (html) {
      const host = document.createElement('div');
      document.body.append(host);
      host.innerHTML = html.replaceAll('TAG', tag);
      return host.firstElementChild as unknown as BatchProbe & Record<string, unknown>;
    }
    const el = document.createElement(tag) as unknown as BatchProbe & Record<string, unknown>;
    document.body.append(el as unknown as Node);
    return el;
  };

  it('a batch value whose validate throws is skipped with a warning; the others apply', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = makeBatch();
    expect(() => el.setAttributes({ mode: 'preset' })).not.toThrow();
    expect(el.label).toBe('set');
    expect(el.broken).toBe('');
    expect(el.shown).toBe('b'); // staged, though its attribute could not be written
    expect(el.hasAttribute('shown')).toBe(false);
    const lines = consoleLines(warn).join('\n');
    expect(lines).toContain('returned an invalid value for "broken"');
    expect(lines).toContain('threw serialising it to attribute shown');
  });

  it('a batch value in markup reflected at connect: a throwing toAttribute does not abort the build', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = makeBatch('<TAG mode="preset"></TAG>');
    expect(el.isConnected).toBe(true);
    expect(el.shown).toBe('b');
    expect(el.label).toBe('set');
  });

  it('an invalid reflected attribute in markup (deferred write-back) with a throwing toAttribute: connect still builds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = makeBatch('<TAG shown="zzz" label="after"></TAG>');
    expect(el.shown).toBe('a');
    expect(el.label).toBe('after');
    expect(el.getAttribute('shown')).toBe('zzz'); // could not be written back — left as it was
    expect(consoleLines(warn).join('\n')).toContain('threw serialising it to attribute shown');
  });

  it('a responsive rule value whose validate throws is skipped with a warning; the other keys apply', () => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const el = makeBatch();
      expect(() => {
        el.responsiveCallback = () => ({ broken: 'x', label: 'responsive' });
        el.flush();
      }).not.toThrow();
      expect(el.label).toBe('responsive');
      expect(el.broken).toBe('');
      expect(consoleLines(warn).join('\n')).toContain('invalid value for "broken" skipped');
    } finally {
      document.body.replaceChildren();
      __resetResponsive();
      __resetEnvironment();
    }
  });
});

// ── #10: whenSettled() when the hook itself stages more writes ─────────────────────
describe('E-23 #10 — whenSettled() and writes staged by the hook', () => {
  it('a waiter resolves after the flush it awaited; by then the hook\'s own write has been applied too', async () => {
    const el = makeProbe();
    document.body.append(el as unknown as Node);
    el.onUpdateHook = (self) => {
      self.onUpdateHook = undefined;
      (self as P).note = 'chained';
    };
    el.label = 'a';
    await el.whenSettled();
    // The chained write's microtask was queued inside update(), before the waiter resolved.
    expect(el.updates).toEqual([{ label: 'a' }, { note: 'chained' }]);
    await expect(el.whenSettled()).resolves.toBeUndefined();
  });

  it('a waiter taken while the chained write is pending resolves after that write', async () => {
    const el = makeProbe();
    document.body.append(el as unknown as Node);
    let chained: Promise<void> | undefined;
    el.onUpdateHook = (self) => {
      self.onUpdateHook = undefined;
      (self as P).note = 'chained';
      chained = self.whenSettled();
    };
    el.label = 'a';
    el.flush();
    expect(el.updates).toEqual([{ label: 'a' }]);
    await chained;
    expect(el.updates).toEqual([{ label: 'a' }, { note: 'chained' }]);
  });
});

// ── #11: the page motion level is not an element subscription (V-10) ──────────────
describe('E-23 #11 — page-level motion listeners', () => {
  it('connect / disconnect / destroy never add a page-motion listener (the page level lives on <html>)', () => {
    const listenerCount = (): number =>
      (globalThis as unknown as Record<symbol, { listeners: Set<unknown> }>)[Symbol.for(sharedStateKey('motion'))]!.listeners.size;
    const el = makeProbe();
    document.body.append(el as unknown as Node);
    const before = listenerCount();
    const other = document.createElement(el.localName);
    document.body.append(other);
    el.remove();
    document.body.append(el as unknown as Node);
    (other as unknown as BlissElement).destroy();
    expect(listenerCount()).toBe(before);
  });
});

// ── #12: a move into another document (iframe) ─────────────────────────────────────
describe('E-23 #12 — adoptNode into an iframe document', () => {
  const hasMotionCss = (doc: Document): boolean =>
    [...doc.querySelectorAll('style')].some((s) => s.textContent === MOTION_CSS) ||
    (doc.adoptedStyleSheets ?? []).some((s) => [...s.cssRules].some((r) => r.cssText.includes('data-motion')));

  it('motion presets are adopted into the new document; a synchronous move fires no removedCallback', async () => {
    class Movable extends Probe {
      removed = 0;
      protected override removedCallback(): void {
        this.removed += 1;
      }
    }
    const el = makeProbe(Movable) as unknown as Movable & P;
    el.motion = 'none';
    document.body.append(el as unknown as Node);
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const doc = frame.contentDocument!;
    expect(hasMotionCss(doc)).toBe(false);

    doc.body.append(doc.adoptNode(el as unknown as Node));
    expect(el.ownerDocument).toBe(doc);
    expect(el.isConnected).toBe(true);
    expect(el.calls).toEqual(['reinit', 'connect', 'disconnect', 'connect']); // re-activated, not rebuilt
    expect(hasMotionCss(doc)).toBe(true);
    expect(el.getAttribute('data-motion')).toBe('none');

    await new Promise((r) => setTimeout(r, 30));
    expect(el.removed).toBe(0);
    el.remove();
    await new Promise((r) => setTimeout(r, 30));
    expect(el.removed).toBe(1);
  });
});

// ── e2e #3 (unit part): removedCallback in a hidden tab ─────────────────────────────
describe('E-23 e2e #3 — removedCallback while the document is hidden', () => {
  it('uses the macrotask fallback when the document is hidden (rAF would never run)', async () => {
    class Watched extends Probe {
      removed = 0;
      protected override removedCallback(): void {
        this.removed += 1;
      }
    }
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const el = makeProbe(Watched) as unknown as Watched & P;
    document.body.append(el as unknown as Node);
    el.remove();
    await new Promise((r) => setTimeout(r, 0));
    expect(raf).not.toHaveBeenCalled();
    expect(el.removed).toBe(1);
    visibility.mockRestore();
  });
});
