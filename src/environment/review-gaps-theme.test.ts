import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetTheme, observeThemeContext, setThemeMode, type ColorScheme } from './theme.js';

// Review 2026-11-03 V-19 #4 (theme test gaps).

// MutationObserver callbacks run as microtasks.
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function host(parent: Element = document.body): HTMLElement {
  const el = document.createElement('div');
  parent.appendChild(el);
  return el;
}

function resetPage(): void {
  for (const el of [document.documentElement, document.body]) {
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
  __resetTheme();
  vi.restoreAllMocks();
  resetPage();
});

describe('V-19 #4 — cross-copy observer', () => {
  it('a subscriber of copy B is notified by a mutation seen through copy A’s observer', async () => {
    let observers = 0;
    const Original = globalThis.MutationObserver;
    class Counting extends Original {
      constructor(cb: MutationCallback) {
        super(cb);
        observers++;
      }
    }
    vi.stubGlobal('MutationObserver', Counting);
    try {
      const seenA: (ColorScheme | null)[] = [];
      const offA = observeThemeContext(host(), undefined, (s) => seenA.push(s)); // copy A starts the page watch
      vi.resetModules();
      const other = await import('./theme.js'); // another bundle
      expect(other.observeThemeContext).not.toBe(observeThemeContext);
      const seenB: (ColorScheme | null)[] = [];
      const offB = other.observeThemeContext(host(), undefined, (s) => seenB.push(s));
      expect(observers).toBe(1); // copy B reuses the running page watch (shared state)

      document.documentElement.setAttribute('data-theme', 'dark');
      await tick();
      expect(seenA).toEqual([null, 'dark']);
      expect(seenB).toEqual([null, 'dark']); // delivered by copy A's observer callback

      offA(); // copy A leaves; B still subscribed — the page watch must keep running
      document.documentElement.setAttribute('data-theme', 'light');
      await tick();
      expect(seenB).toEqual([null, 'dark', 'light']);
      offB();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('V-19 #4 — a theme-source element removed from the DOM while subscribed', () => {
  it('does not throw; the subscriber keeps the last scheme and unsubscribing cleans up', async () => {
    const source = host();
    source.className = 'panel';
    source.setAttribute('data-theme', 'dark');
    const el = host(source);
    const seen: (ColorScheme | null)[] = [];
    const off = observeThemeContext(el, '.panel', (s) => seen.push(s));
    expect(seen).toEqual(['dark']);

    expect(() => source.remove()).not.toThrow();
    await tick();
    expect(seen).toEqual(['dark']); // removal alone is not a signal change

    // A page flip still reaches it only as the fallback — the (detached) source still answers dark.
    document.documentElement.setAttribute('data-theme', 'light');
    await tick();
    expect(seen).toEqual(['dark']);

    expect(() => off()).not.toThrow();
    // After unsubscribe, a fresh subscriber on the page sees the page scheme.
    const seen2: (ColorScheme | null)[] = [];
    const off2 = observeThemeContext(host(), undefined, (s) => seen2.push(s));
    expect(seen2).toEqual(['light']);
    off2();
  });
});

describe('V-19 #4 — setThemeMode with a subscriber only on a source watch', () => {
  it('forces the source subscriber, then auto re-detects the source (and its page fallback)', async () => {
    const source = host();
    source.className = 'panel';
    source.setAttribute('data-theme', 'light');
    const el = host(source);
    const seen: (ColorScheme | null)[] = [];
    const off = observeThemeContext(el, '.panel', (s) => seen.push(s));
    expect(seen).toEqual(['light']);

    setThemeMode('dark');
    expect(seen).toEqual(['light', 'dark']);
    source.setAttribute('data-theme', 'light'); // paused while forced
    await tick();
    expect(seen).toEqual(['light', 'dark']);

    source.removeAttribute('data-theme'); // the source loses its signal while forced
    document.documentElement.setAttribute('data-theme', 'dark');
    setThemeMode('auto');
    expect(seen).toEqual(['light', 'dark']); // auto: page fallback is dark → unchanged, no repeat

    // Detection resumed on both watches.
    document.documentElement.setAttribute('data-theme', 'light');
    await tick();
    expect(seen).toEqual(['light', 'dark', 'light']);
    source.setAttribute('data-theme', 'dark');
    await tick();
    expect(seen).toEqual(['light', 'dark', 'light', 'dark']);
    off();
  });
});
