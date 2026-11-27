import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { define } from '../element/define.js';
import { toObject, toText } from '../inputs/converters.js';
import {
  BUILT_IN_ICON_NAMES,
  ICON_CSS,
  isIconMap,
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
      '<span class="km-icon cp__icon cp__icon--settings" style="--_km-icon: var(--_km-icon-settings)" aria-hidden="true"></span>',
    );
    expect(renderIcon('chevron')).toContain('var(--_km-icon-chevron)');
    expect(renderIcon('fa-solid  fa-folder', { prefix: 'tv' })).toBe('<i class="tv__icon fa-solid fa-folder" aria-hidden="true"></i>');
    expect(renderIcon('bi-gear')).toBe('<i class="bi-gear" aria-hidden="true"></i>');
    expect(renderIcon('🚀')).toBe('🚀');
    expect(renderIcon('a"><img src=x onerror=1>')).not.toContain('<img');
    expect(renderIcon('  ')).toBe('');
    expect(renderIcon(null)).toBe('');
  });

  it('ICON_CSS carries every built-in glyph: the page token first, else the contract default', () => {
    const contract = readFileSync(resolve('node_modules/@keenmate/base-css-variables/base-variables.css'), 'utf8');
    const token = (name: string): string => contract.match(new RegExp(`^\\s*--base-icon-${name}:\\s*(.+?);`, 'm'))![1]!.trim();
    for (const name of BUILT_IN_ICON_NAMES) {
      const own = token(name);
      const alias = own.match(/^var\(--base-icon-([a-z-]+)\)$/);
      const fallback = alias ? `var(--base-icon-${alias[1]!}, ${token(alias[1]!)})` : own;
      expect(ICON_CSS, name).toContain(`--_km-icon-${name}: var(--base-icon-${name}, ${fallback});`);
      expect(fallback, name).toContain('url("data:image/svg+xml,');
    }
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

describe('icon maps: el.icons, window.components.icons, defaults (Q12)', () => {
  const setPageIcons = (icons: unknown): void => {
    publishIconHook();
    (window.components as { icons?: unknown }).icons = icons;
  };
  afterEach(() => {
    setHook(undefined);
    setPageIcons(undefined);
  });

  it('the full order: markup → el.icons → page map → built-in → own hook → page hook → defaults → class list → text', () => {
    const host = Object.assign(document.createElement('web-gx'), {
      icons: { a: '<i>instance-a</i>' } as Record<string, string>,
      renderIconCallback: (name: string) => (['a', 'b', 'c', 'close'].includes(name) ? `<i>own-${name}</i>` : null),
    });
    setHook((name) => (['a', 'b', 'c', 'd', 'close'].includes(name) ? `<i>page-${name}</i>` : null));
    setPageIcons({ a: '<i>map-a</i>', b: '<i>map-b</i>' });
    const defaults = { a: '<i>def-a</i>', d: '<i>def-d</i>', e: '<i>def-e</i>', close: '<i>def-close</i>' };
    const r = (name: string): string => renderIcon(name, { host, defaults });
    expect(r('<svg></svg>')).toBe('<svg></svg>'); // markup
    expect(r('a')).toBe('<i>instance-a</i>'); // el.icons
    expect(r('b')).toBe('<i>map-b</i>'); // window.components.icons (before the built-ins and the hooks)
    expect(r('close')).toContain('km-icon'); // built-in: the hooks and the defaults never see it
    expect(r('c')).toBe('<i>own-c</i>'); // el.renderIconCallback
    expect(r('d')).toBe('<i>page-d</i>'); // window.components.renderIconCallback
    expect(r('e')).toBe('<i>def-e</i>'); // defaults
    expect(r('fa-solid fa-x')).toBe('<i class="fa-solid fa-x" aria-hidden="true"></i>'); // class list
    expect(r('🚀')).toBe('🚀'); // text
  });

  it('the maps replace a built-in name (close / delete); a name not in a map falls through to the built-in', () => {
    const host = Object.assign(document.createElement('web-gx'), { icons: { close: 'fa-solid fa-xmark' } });
    setPageIcons({ 'web-gx.delete': '<svg class="trash"></svg>', add: 'fa-solid fa-plus' });
    expect(renderIcon('close', { host, prefix: 'gx' })).toBe('<i class="gx__icon fa-solid fa-xmark" aria-hidden="true"></i>');
    expect(renderIcon('delete', { host })).toBe('<svg class="trash"></svg>');
    expect(renderIcon('delete', { host: document.createElement('web-other') })).toContain('--_km-icon-delete'); // tag-scoped
    expect(renderIcon('add', { host })).toBe('<i class="fa-solid fa-plus" aria-hidden="true"></i>');
    expect(renderIcon('check', { host, prefix: 'gx' })).toContain('gx__icon--check'); // not in a map → built-in
    // A component's own name equal to a built-in name: the built-in draws it (defaults come after), a map still wins.
    expect(renderIcon('delete', { host: document.createElement('web-other'), defaults: { delete: '<i>def</i>' } })).toContain('km-icon');
  });

  it('a map value that names itself or a built-in draws the built-in ({ close: "close" } is no loop)', () => {
    const host = Object.assign(document.createElement('web-gx'), { icons: { close: 'close', x: 'delete', remove: 'x' } });
    expect(renderIcon('close', { host, prefix: 'gx' })).toContain('gx__icon--close');
    expect(renderIcon('x', { host, prefix: 'gx' })).toContain('gx__icon--delete');
    expect(renderIcon('remove', { host, prefix: 'gx' })).toContain('gx__icon--delete'); // remove → x → delete
  });

  it('a map value is an icon string resolved by the same rules (markup / built-in / hooks / class list / text)', () => {
    const host = Object.assign(document.createElement('web-gx'), { icons: { del: 'delete', trash: 'fa-solid fa-trash', go: 'rocket' } });
    setHook((name) => (name === 'rocket' ? '<svg class="rocket"></svg>' : null));
    expect(renderIcon('del', { host, prefix: 'gx' })).toContain('gx__icon--delete');
    expect(renderIcon('trash', { host, prefix: 'gx' })).toBe('<i class="gx__icon fa-solid fa-trash" aria-hidden="true"></i>');
    expect(renderIcon('go', { host })).toBe('<svg class="rocket"></svg>');
    expect(renderIcon('rowDelete', { host, defaults: { rowDelete: 'del' } })).toContain('km-icon'); // defaults → el.icons → built-in
    expect(renderIcon('none', { host, defaults: { none: '' } })).toBe(''); // '' = deliberately no icon
  });

  it('a map loop is skipped (the next rule decides), never recursion', () => {
    const host = Object.assign(document.createElement('web-gx'), { icons: { a: 'b', b: 'a', self: 'self' } });
    // a → b (resolved by the same rules) → b's value 'a' was already met → skipped → b falls to the class list.
    expect(renderIcon('a', { host })).toBe('<i class="b" aria-hidden="true"></i>');
    expect(renderIcon('self', { host })).toBe('<i class="self" aria-hidden="true"></i>');
  });

  it('page map: "<tag>.<name>" before "<name>"; the component option names the tag', () => {
    setPageIcons({ 'web-gx.star': '<i>gx-star</i>', star: '<i>any-star</i>' });
    expect(renderIcon('star', { host: document.createElement('web-gx') })).toBe('<i>gx-star</i>');
    expect(renderIcon('star', { host: document.createElement('web-other') })).toBe('<i>any-star</i>');
    expect(renderIcon('star', { component: 'web-gx' })).toBe('<i>gx-star</i>');
    expect(renderIcon('star')).toBe('<i>any-star</i>');
  });

  it('window.components.icons: non-enumerable, a frozen flat copy; nested / non-string values and a non-object warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source: Record<string, unknown> = { star: '<i>s</i>', nested: { a: 'b' } };
    setPageIcons(source);
    const icons = window.components?.icons;
    expect(icons).toEqual({ star: '<i>s</i>' });
    expect(Object.isFrozen(icons)).toBe(true);
    expect(Object.keys(window.components ?? {})).not.toContain('icons');
    source.star = '<i>changed</i>'; // assigning replaces; a later mutation of the source is not seen
    expect(renderIcon('star')).toBe('<i>s</i>');
    expect(warn).toHaveBeenCalledTimes(1);
    setPageIcons(['x']);
    expect(window.components?.icons).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('an explicit icons option wins over host.icons; null = none; non-string values and inherited keys are ignored', () => {
    const host = Object.assign(document.createElement('web-gx'), { icons: { a: '<i>host</i>', n: 5 } });
    expect(renderIcon('a', { host, icons: { a: '<i>opt</i>' } })).toBe('<i>opt</i>');
    expect(renderIcon('a', { host, icons: null, defaults: { a: '<i>def</i>' } })).toBe('<i>def</i>');
    expect(renderIcon('n', { host })).toBe('<i class="n" aria-hidden="true"></i>');
    expect(renderIcon('toString', { host })).toBe('<i class="toString" aria-hidden="true"></i>');
  });

  it('isIconMap: a plain object of strings', () => {
    expect(isIconMap({ a: 'b' })).toBe(true);
    expect(isIconMap({})).toBe(true);
    expect(isIconMap({ a: 1 })).toBe(false);
    expect(isIconMap(['a'])).toBe(false);
    expect(isIconMap(null)).toBe(false);
  });

  it('a window.components.icons assignment notifies observeIconHook; clearing an unset map does not', () => {
    const listener = vi.fn();
    const off = observeIconHook(listener);
    const before = getIconHookRevision();
    setPageIcons({ a: 'b' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getIconHookRevision()).toBe(before + 1);
    setPageIcons(undefined);
    setPageIcons(undefined);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });
});

describe('BlissElement.iconsChanged() for the icons maps', () => {
  class MapEl extends BlissElement {
    static inputs = [
      { configKey: 'icons', attribute: 'icons', converter: toObject({ validate: isIconMap }), on: 'update' as const },
      { configKey: 'size', attribute: 'size', converter: toText(), on: 'reinit' as const },
    ];
    calls = 0;
    updates: string[][] = [];
    protected override update(partial: Record<string, unknown>): void {
      this.updates.push(Object.keys(partial));
    }
    protected override iconsChanged(): void {
      this.calls++;
    }
  }
  define('icons-map-el', MapEl);
  afterEach(() => {
    publishIconHook();
    (window.components as { icons?: unknown }).icons = undefined;
  });

  it('el.icons (property or JSON attribute) fires iconsChanged() after update(); not on the first build nor in a rebuild batch', async () => {
    const el = document.createElement('icons-map-el') as MapEl & { icons?: unknown };
    el.icons = { a: 'b' };
    document.body.append(el);
    await el.whenSettled();
    expect(el.calls).toBe(0);
    el.icons = { a: 'c' };
    await el.whenSettled();
    expect(el.calls).toBe(1);
    expect(el.updates.at(-1)).toEqual(['icons']);
    el.setAttribute('icons', '{"a":"d"}');
    await el.whenSettled();
    expect(el.calls).toBe(2);
    el.setProperties({ icons: { a: 'e' }, size: 'x' }); // reinit absorbs it
    expect(el.calls).toBe(2);
    el.remove();
  });

  it('window.components.icons assigned while connected fires it; one missed while detached replays on reconnect', async () => {
    const el = document.createElement('icons-map-el') as MapEl;
    document.body.append(el);
    await el.whenSettled();
    publishIconHook();
    (window.components as { icons?: unknown }).icons = { a: '<b>a</b>' };
    expect(el.calls).toBe(1);
    el.remove();
    (window.components as { icons?: unknown }).icons = { a: '<b>b</b>' };
    expect(el.calls).toBe(1);
    document.body.append(el);
    expect(el.calls).toBe(2);
    el.remove();
  });
});
