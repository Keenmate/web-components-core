import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { define } from '../element/define.js';
import {
  BUILT_IN_ICON_NAMES,
  getIconHookRevision,
  observeIconHook,
  publishIconHook,
  renderIcon,
  type RenderIconCallback,
} from './render-icon.js';

const setHook = (cb: RenderIconCallback | undefined): void => {
  publishIconHook();
  (window.components as { renderIconCallback?: RenderIconCallback }).renderIconCallback = cb;
};

describe('renderIcon', () => {
  afterEach(() => setHook(undefined));

  it('markup raw, a built-in name masked from its token, class names an icon font, anything else escaped text', () => {
    expect(renderIcon('<svg viewBox="0 0 1 1"></svg>')).toBe('<svg viewBox="0 0 1 1"></svg>');
    expect(renderIcon('settings', { prefix: 'cp' })).toBe(
      '<span class="km-icon cp__icon cp__icon--settings" style="--_km-icon: var(--base-icon-settings, linear-gradient(transparent 0 0))" aria-hidden="true"></span>',
    );
    expect(renderIcon('chevron')).toContain('var(--base-icon-chevron,');
    expect(renderIcon('fa-solid  fa-folder', { prefix: 'tv' })).toBe('<i class="tv__icon fa-solid fa-folder" aria-hidden="true"></i>');
    expect(renderIcon('bi-gear')).toBe('<i class="bi-gear" aria-hidden="true"></i>');
    expect(renderIcon('🚀')).toBe('🚀');
    expect(renderIcon('a"><img src=x onerror=1>')).not.toContain('<img');
    expect(renderIcon('  ')).toBe('');
    expect(renderIcon(null)).toBe('');
  });

  it('the built-in names are the base-css-variables glyphs', () => {
    expect(BUILT_IN_ICON_NAMES).toContain('close');
    expect(BUILT_IN_ICON_NAMES).not.toContain('check-size');
    expect(Object.isFrozen(BUILT_IN_ICON_NAMES)).toBe(true);
  });

  it('window.components.renderIconCallback maps the other names; null falls through; built-ins and markup never reach it', () => {
    const host = document.createElement('web-ms');
    const hook = vi.fn<RenderIconCallback>((name) => (name === 'star' ? '<svg class="star"></svg>' : name === 'none' ? '' : null));
    setHook(hook);
    expect(window.components?.renderIconCallback).toBe(hook);
    expect(Object.keys(window.components ?? {})).not.toContain('renderIconCallback');
    expect(renderIcon('star', { prefix: 'ms', host })).toBe('<svg class="star"></svg>');
    expect(hook).toHaveBeenLastCalledWith('star', { component: 'web-ms', element: host, prefix: 'ms' });
    expect(renderIcon('none')).toBe('');
    expect(renderIcon('fa-solid fa-x')).toBe('<i class="fa-solid fa-x" aria-hidden="true"></i>');
    expect(renderIcon('lucide:rocket')).toBe('lucide:rocket');
    hook.mockClear();
    renderIcon('close');
    renderIcon('<b>x</b>');
    expect(hook).not.toHaveBeenCalled();
  });

  it("the element's own renderIconCallback comes first; null passes the name on to the page hook", () => {
    setHook((name) => (name === 'star' || name === 'moon' ? `<page-${name}>` : null));
    const host = Object.assign(document.createElement('web-ms'), {
      renderIconCallback: vi.fn<RenderIconCallback>((name, ctx) => (name === 'star' ? `<own-star ${String(ctx.item)}>` : null)),
    });
    expect(renderIcon('star', { host, context: { item: 7 } })).toBe('<own-star 7>');
    expect(host.renderIconCallback).toHaveBeenLastCalledWith('star', { item: 7, component: 'web-ms', element: host, prefix: '' });
    expect(renderIcon('moon', { host })).toBe('<page-moon>');
    expect(renderIcon('bi-x', { host })).toBe('<i class="bi-x" aria-hidden="true"></i>');
    expect(renderIcon('star', { host, renderIconCallback: null })).toBe('<page-star>'); // an explicit option wins over the host
    setHook(undefined);
    expect(renderIcon('star', { host })).toBe('<own-star undefined>'); // no page setup needed
    host.renderIconCallback.mockClear();
    renderIcon('close', { host });
    expect(host.renderIconCallback).not.toHaveBeenCalled();
  });

  it('the component option names a host that is not the component element (a framework component in a <div>)', () => {
    const hook = vi.fn<RenderIconCallback>(() => '<own>');
    const host = document.createElement('div');
    expect(renderIcon('star', { host, component: 'svelte-treeview', prefix: 'stv', renderIconCallback: hook })).toBe('<own>');
    expect(hook).toHaveBeenLastCalledWith('star', { component: 'svelte-treeview', element: host, prefix: 'stv' });
    renderIcon('star', { component: 'svelte-treeview', renderIconCallback: hook });
    expect(hook).toHaveBeenLastCalledWith('star', { component: 'svelte-treeview', element: null, prefix: '' });
  });

  it('a throwing hook is logged and the default rendering follows', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    setHook(() => {
      throw new Error('boom');
    });
    expect(renderIcon('bi-gear')).toBe('<i class="bi-gear" aria-hidden="true"></i>');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('observeIconHook / getIconHookRevision', () => {
  afterEach(() => setHook(undefined));

  it('notifies on a change (set, replace, clear), not on the same value or a non-function that stays "none"', () => {
    const listener = vi.fn();
    const off = observeIconHook(listener);
    const start = getIconHookRevision();
    const a: RenderIconCallback = () => '<b>a</b>';
    setHook(a);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getIconHookRevision()).toBe(start + 1);
    setHook(a); // same function
    expect(listener).toHaveBeenCalledTimes(1);
    setHook(() => null); // replaced
    expect(listener).toHaveBeenCalledTimes(2);
    setHook(undefined); // cleared
    expect(listener).toHaveBeenCalledTimes(3);
    (window.components as Record<string, unknown>).renderIconCallback = 'nope'; // still none
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    setHook(a);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('a throwing listener is logged, the others still hear the change', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();
    const offA = observeIconHook(() => {
      throw new Error('boom');
    });
    const offB = observeIconHook(second);
    setHook(() => 'x');
    expect(second).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    offA();
    offB();
    error.mockRestore();
  });

  it('cross-copy: the state lives on globalThis; an older copy accessor (no notify) is taken over, keeping its callback', () => {
    const shared = (globalThis as unknown as Record<symbol, { callback?: unknown }>)[Symbol.for('@keenmate/web-components-core:icon')]!;
    expect(shared).toBeDefined();
    // Simulate core rc24: its own accessor, setter only stores the callback.
    const old: RenderIconCallback = () => '<i>old</i>';
    const components = window.components as Record<string, unknown>;
    delete components.renderIconCallback;
    Object.defineProperty(components, 'renderIconCallback', {
      enumerable: false,
      configurable: true,
      get: () => shared.callback,
      set: (v: unknown) => {
        shared.callback = typeof v === 'function' ? v : undefined;
      },
    });
    components.renderIconCallback = old;
    const listener = vi.fn();
    const off = observeIconHook(listener); // publishes: takes the old accessor over
    expect(components.renderIconCallback).toBe(old);
    expect(renderIcon('star')).toBe('<i>old</i>');
    components.renderIconCallback = () => '<i>new</i>';
    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.keys(components)).not.toContain('renderIconCallback');
    off();
  });

  it('a plain value the page assigned before core loaded is adopted', () => {
    const components = window.components as Record<string, unknown>;
    delete components.renderIconCallback;
    const early: RenderIconCallback = () => '<i>early</i>';
    components.renderIconCallback = early;
    publishIconHook();
    expect(renderIcon('star')).toBe('<i>early</i>');
    expect(Object.keys(components)).not.toContain('renderIconCallback');
  });
});

describe('BlissElement.iconsChanged()', () => {
  class IconEl extends BlissElement {
    static inputs = [];
    calls = 0;
    protected override iconsChanged(): void {
      this.calls++;
    }
  }
  define('icons-hook-el', IconEl);
  afterEach(() => setHook(undefined));

  it('fires on a change while connected (not on the first connect, not for the same value); replays a change missed while detached', async () => {
    const el = document.createElement('icons-hook-el') as IconEl;
    document.body.append(el);
    await el.whenSettled();
    expect(el.calls).toBe(0);
    const a: RenderIconCallback = () => '<b>a</b>';
    setHook(a);
    expect(el.calls).toBe(1);
    setHook(a);
    expect(el.calls).toBe(1);
    el.remove();
    setHook(() => '<b>b</b>');
    expect(el.calls).toBe(1);
    document.body.append(el);
    expect(el.calls).toBe(2);
    el.remove();
    document.body.append(el); // nothing changed meanwhile
    expect(el.calls).toBe(2);
    el.destroy();
    el.remove();
    setHook(a);
    expect(el.calls).toBe(2); // unsubscribed
  });

  it('a class that does not override iconsChanged() subscribes nothing', async () => {
    class PlainEl extends BlissElement {
      static inputs = [];
    }
    define('icons-plain-el', PlainEl);
    const el = document.createElement('icons-plain-el');
    document.body.append(el);
    const listener = vi.fn();
    const off = observeIconHook(listener);
    setHook(() => 'x');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    el.remove();
  });
});
