import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetTheme,
  getThemeContext,
  getThemeMode,
  observeThemeContext,
  readThemeSignal,
  resolveThemeSource,
  setThemeMode,
  type ColorScheme,
} from './theme.js';
import { BlissElement } from '../element/bliss-element.js';
import { define } from '../element/define.js';

// MutationObserver callbacks run as microtasks.
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const html = (): HTMLElement => document.documentElement;

function host(parent: Element = document.body): HTMLElement {
  const el = document.createElement('div');
  parent.appendChild(el);
  return el;
}

/** Record every scheme a subscription delivers. */
function record(el: Element, source?: Parameters<typeof observeThemeContext>[1]) {
  const seen: (ColorScheme | null)[] = [];
  const unsub = observeThemeContext(el, source, (s) => seen.push(s));
  return { seen, unsub };
}

/** Count MutationObserver constructions (jsdom's is a class, so it can't be spied). */
function countObservers(): { readonly count: number } {
  const Original = globalThis.MutationObserver;
  let count = 0;
  class Counting extends Original {
    constructor(cb: MutationCallback) {
      super(cb);
      count += 1;
    }
  }
  vi.stubGlobal('MutationObserver', Counting);
  return {
    get count() {
      return count;
    },
  };
}

function resetPage(): void {
  for (const el of [html(), document.body]) {
    el.removeAttribute('class');
    el.removeAttribute('data-theme');
    el.removeAttribute('data-bs-theme');
  }
  document.body.innerHTML = '';
}

beforeEach(() => {
  __resetTheme();
  resetPage();
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetTheme();
  vi.unstubAllGlobals();
  resetPage();
});

describe('readThemeSignal', () => {
  it('reads data-theme, then data-bs-theme, then a .dark / .light class', () => {
    const el = document.createElement('div');
    expect(readThemeSignal(el)).toBeNull();
    el.classList.add('dark');
    expect(readThemeSignal(el)).toBe('dark');
    el.setAttribute('data-bs-theme', 'light');
    expect(readThemeSignal(el)).toBe('light');
    el.setAttribute('data-theme', 'dark');
    expect(readThemeSignal(el)).toBe('dark');
  });

  it('ignores named themes that are not a scheme and falls through', () => {
    const el = document.createElement('div');
    el.setAttribute('data-theme', 'corporate');
    el.classList.add('dark');
    expect(readThemeSignal(el)).toBe('dark');
  });
});

describe('page detection', () => {
  it('reads <html> first, then <body>', () => {
    document.body.classList.add('dark');
    expect(getThemeContext()).toBe('dark');
    html().setAttribute('data-theme', 'light');
    expect(getThemeContext()).toBe('light');
  });

  it('delivers the current scheme immediately and then only on change', async () => {
    html().classList.add('dark');
    const { seen } = record(host());
    expect(seen).toEqual(['dark']);

    html().classList.add('unrelated'); // same result: no notification
    await tick();
    expect(seen).toEqual(['dark']);

    html().classList.remove('dark');
    await tick();
    expect(seen).toEqual(['dark', null]);

    html().setAttribute('data-bs-theme', 'dark');
    await tick();
    expect(seen).toEqual(['dark', null, 'dark']);
  });

  it('uses ONE observer for every page subscriber (detect once, reuse)', () => {
    const observers = countObservers();
    const subs = Array.from({ length: 50 }, () => record(host()));
    expect(observers.count).toBe(1);
    for (const s of subs) s.unsub();
  });

  it('stops observing when the last subscriber leaves', async () => {
    const a = record(host());
    const b = record(host());
    a.unsub();
    b.unsub();
    html().classList.add('dark');
    await tick();
    expect(a.seen).toEqual([null]);
    expect(b.seen).toEqual([null]);
  });

  it('re-attaches to a swapped <body> (Turbo / htmx navigation)', async () => {
    const { seen } = record(host());
    const fresh = document.createElement('body');
    html().replaceChild(fresh, document.body);
    await tick();
    fresh.classList.add('dark');
    await tick();
    expect(seen).toEqual([null, 'dark']);
  });
});

describe('setThemeMode', () => {
  it('forces every subscriber and pauses detection; auto re-detects', async () => {
    const { seen } = record(host());
    setThemeMode('dark');
    expect(getThemeMode()).toBe('dark');
    expect(seen).toEqual([null, 'dark']);

    html().classList.add('light'); // ignored while forced
    await tick();
    expect(seen).toEqual([null, 'dark']);

    setThemeMode('auto');
    expect(seen).toEqual([null, 'dark', 'light']);
  });

  it('pausing and resuming reuses the same observer', async () => {
    const observers = countObservers();
    const { seen } = record(host());
    for (let i = 0; i < 5; i++) {
      setThemeMode('dark');
      setThemeMode('auto');
    }
    expect(observers.count).toBe(1);

    html().classList.add('light'); // the re-attached observer still works
    await tick();
    expect(seen.at(-1)).toBe('light');
  });

  it('beats a theme-source element', () => {
    const panel = document.createElement('section');
    panel.classList.add('panel', 'dark');
    document.body.appendChild(panel);
    const { seen } = record(host(panel), '.panel');
    setThemeMode('light');
    expect(seen).toEqual(['dark', 'light']);
  });

  it('warns and ignores an unknown mode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setThemeMode('sepia' as never);
    expect(getThemeMode()).toBe('auto');
    expect(warn).toHaveBeenCalled();
  });
});

describe('theme-source', () => {
  it('a selector resolves to the nearest matching ancestor', async () => {
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('data-bs-theme', 'dark');
    document.body.appendChild(panel);
    const { seen } = record(host(panel), '.panel');
    expect(seen).toEqual(['dark']);

    panel.setAttribute('data-bs-theme', 'light');
    await tick();
    expect(seen).toEqual(['dark', 'light']);
  });

  it('a selector falls back to the first match in the document', () => {
    const panel = document.createElement('aside');
    panel.id = 'theme-root';
    panel.classList.add('dark');
    document.body.appendChild(panel);
    expect(record(host(), '#theme-root').seen).toEqual(['dark']);
  });

  it('"closest" finds the nearest ancestor that carries a signal', () => {
    const outer = document.createElement('div');
    outer.classList.add('light');
    const inner = document.createElement('div');
    inner.setAttribute('data-theme', 'dark');
    outer.appendChild(inner);
    document.body.appendChild(outer);
    const el = host(inner);
    expect(resolveThemeSource(el, 'closest')).toBe(inner);
    expect(record(el, 'closest').seen).toEqual(['dark']);
  });

  it('walks out of shadow roots', () => {
    const wrapper = document.createElement('div');
    wrapper.classList.add('dark');
    const shadowHost = document.createElement('div');
    wrapper.appendChild(shadowHost);
    document.body.appendChild(wrapper);
    const root = shadowHost.attachShadow({ mode: 'open' });
    const el = document.createElement('div');
    root.appendChild(el);
    expect(resolveThemeSource(el, 'closest')).toBe(wrapper);
  });

  it('accepts an Element', () => {
    const panel = document.createElement('div');
    panel.classList.add('dark');
    document.body.appendChild(panel);
    expect(record(host(), panel).seen).toEqual(['dark']);
  });

  it('a source without a signal falls back to the page', async () => {
    html().classList.add('dark');
    const panel = document.createElement('div');
    panel.className = 'panel';
    document.body.appendChild(panel);
    const { seen } = record(host(panel), '.panel');
    expect(seen).toEqual(['dark']);
    panel.classList.add('light');
    await tick();
    expect(seen).toEqual(['dark', 'light']);
  });

  it('<html> / <body> as a source share the page watch', () => {
    const observers = countObservers();
    expect(resolveThemeSource(host(), 'body')).toBeNull();
    record(host(), 'html');
    record(host());
    expect(observers.count).toBe(1);
  });

  it('subscribers of one source share one observer', () => {
    const panel = document.createElement('div');
    panel.className = 'panel dark';
    document.body.appendChild(panel);
    const observers = countObservers();
    record(host(panel), '.panel');
    record(host(panel), '.panel');
    record(host(panel), '.panel');
    expect(observers.count).toBe(2); // the page + this source
  });

  it('an invalid selector warns and uses the page', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveThemeSource(host(), '[[nope')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('shared state', () => {
  it('lives on globalThis so separate copies of core share it', () => {
    setThemeMode('dark');
    const key = Symbol.for('@keenmate/web-components-core/theme@1');
    const shared = (globalThis as unknown as Record<symbol, { mode: string }>)[key];
    expect(shared?.mode).toBe('dark');
  });
});

// ── BlissElement integration ────────────────────────────────────────────────

class ThemedElement extends BlissElement {
  readonly schemes: (ColorScheme | null)[] = [];
  protected override themeChanged(scheme: ColorScheme | null): void {
    this.schemes.push(scheme);
  }
}
define('themed-element', ThemedElement as unknown as CustomElementConstructor);

class UnthemedElement extends BlissElement {
  protected static override themeContext = false;
}
define('unthemed-element', UnthemedElement as unknown as CustomElementConstructor);

describe('BlissElement theme context', () => {
  it('mirrors the page scheme onto the host as data-context-theme', async () => {
    html().classList.add('dark');
    const el = document.createElement('themed-element') as ThemedElement;
    document.body.appendChild(el);
    expect(el.getAttribute('data-context-theme')).toBe('dark');
    expect(el.schemes).toEqual(['dark']);

    html().classList.remove('dark');
    await tick();
    expect(el.hasAttribute('data-context-theme')).toBe(false);
    expect(el.schemes).toEqual(['dark', null]);
  });

  it('honours the theme-source attribute and re-resolves when it changes', async () => {
    const a = document.createElement('div');
    a.id = 'a';
    a.classList.add('dark');
    const b = document.createElement('div');
    b.id = 'b';
    b.classList.add('light');
    document.body.append(a, b);
    const el = document.createElement('themed-element') as ThemedElement;
    el.setAttribute('theme-source', '#a');
    document.body.appendChild(el);
    expect(el.getAttribute('data-context-theme')).toBe('dark');

    el.setAttribute('theme-source', '#b');
    expect(el.getAttribute('data-context-theme')).toBe('light');
    expect(el.themeSource).toBe('#b');
  });

  it('themeSource accepts an Element and a string (reflected)', () => {
    const panel = document.createElement('div');
    panel.classList.add('dark');
    document.body.appendChild(panel);
    const el = document.createElement('themed-element') as ThemedElement;
    document.body.appendChild(el);

    el.themeSource = panel;
    expect(el.getAttribute('data-context-theme')).toBe('dark');
    expect(el.hasAttribute('theme-source')).toBe(false);

    el.themeSource = 'closest';
    expect(el.getAttribute('theme-source')).toBe('closest');

    el.themeSource = null;
    expect(el.hasAttribute('theme-source')).toBe(false);
  });

  it('unsubscribes on disconnect', async () => {
    const el = document.createElement('themed-element') as ThemedElement;
    document.body.appendChild(el);
    el.remove();
    html().classList.add('dark');
    await tick();
    expect(el.schemes).toEqual([null]);
  });

  it('static themeContext = false opts out entirely', () => {
    html().classList.add('dark');
    const el = document.createElement('unthemed-element');
    document.body.appendChild(el);
    expect(el.hasAttribute('data-context-theme')).toBe(false);
  });
});
