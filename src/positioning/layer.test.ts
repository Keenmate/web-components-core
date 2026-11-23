import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from './layer.js';
import { createCustomStyles } from '../dom/custom-styles.js';
import { registerComponent } from '../global/register-component.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createLayer', () => {
  it('mounts a fixed layer on <body> with its own shadow root, the CSS adopted, the theme copied', () => {
    const section = document.createElement('section');
    section.setAttribute('data-theme', 'dark');
    const host = document.createElement('div');
    host.attachShadow({ mode: 'open' });
    section.append(host);
    document.body.append(section);

    const layer = createLayer(host, { css: '.pads { color: red; }', className: 'pads', isInteractive: false });
    expect(layer.layer.parentElement).toBe(document.body);
    expect(layer.layer.style.position).toBe('fixed');
    expect(layer.layer.style.pointerEvents).toBe('none');
    expect(layer.layer.style.zIndex).toContain('--base-z-dropdown');
    expect(layer.layer.getAttribute('data-theme')).toBe('dark');
    expect(layer.element.classList.contains('pads')).toBe(true);
    expect(layer.element.getRootNode()).toBe(layer.layer.shadowRoot);
    const root = layer.layer.shadowRoot!;
    const css = [
      ...(root.adoptedStyleSheets ?? []).map((s) => [...s.cssRules].map((r) => r.cssText).join('\n')),
      ...[...root.querySelectorAll('style')].map((s) => s.textContent),
    ].join('\n');
    expect(css).toContain('.pads');

    layer.place({ top: 10, left: 20, width: 100, height: 50 });
    expect([layer.layer.style.top, layer.layer.style.left, layer.layer.style.width, layer.layer.style.height]).toEqual(['10px', '20px', '100px', '50px']);

    section.setAttribute('data-theme', 'light');
    layer.syncTheme();
    expect(layer.layer.getAttribute('data-theme')).toBe('light');
    layer.destroy();
    expect(layer.layer.isConnected).toBe(false);
  });

  it('cssVars: the host’s instance tokens are copied onto the layer, again on syncTheme()', () => {
    const host = document.createElement('div');
    host.style.setProperty('--xx-bg', 'red');
    document.body.append(host);
    const layer = createLayer(host, { cssVars: ['--xx-bg', '--xx-unset'] });
    expect(layer.layer.style.getPropertyValue('--xx-bg')).toBe('red');
    expect(layer.layer.style.getPropertyValue('--xx-unset')).toBe('');
    host.style.setProperty('--xx-bg', 'blue');
    layer.syncTheme();
    expect(layer.layer.style.getPropertyValue('--xx-bg')).toBe('blue');
    layer.destroy();
  });

  it('the host\u2019s text look and writing direction come along (inherited inside the host, not in the overlay)', () => {
    const section = document.createElement('section');
    section.dir = 'rtl';
    const host = document.createElement('div');
    host.style.fontFamily = 'monospace';
    host.style.lineHeight = '2';
    section.append(host);
    document.body.append(section);
    const layer = createLayer(host);
    expect(layer.layer.style.fontFamily).toBe('monospace');
    expect(layer.layer.style.lineHeight).toBe('2');
    expect(layer.layer.dir).toBe('rtl');
    section.dir = 'ltr';
    layer.syncTheme();
    expect(layer.layer.dir).toBe('ltr');
    layer.destroy();
  });

  it('a host inside an open modal <dialog> mounts in the dialog (top layer)', () => {
    const dialog = document.createElement('dialog');
    const host = document.createElement('div');
    dialog.append(host);
    document.body.append(dialog);
    // jsdom: no showModal / :modal — the container option is the escape hatch, and the default is <body>.
    const layer = createLayer(host, { container: dialog });
    expect(layer.layer.parentElement).toBe(dialog);
    layer.destroy();
  });

  it('customStylesOptions: the host’s page-wide + instance custom CSS in the layer root, kept live, gone on destroy()', () => {
    const tag = 'layer-cs-test';
    (window.components ??= {})[tag] = { customStyles: '.page {}' } as never;
    registerComponent(tag, class extends HTMLElement {}, { config: { name: 'x', version: '0.0.0' } });
    const host = document.createElement(tag);
    document.body.append(host);
    const hostRoot = host.attachShadow({ mode: 'open' });
    let instanceCss = '.inst-1 {}';
    const sameOptions = { cssClass: 'x-custom', getContext: () => ({}), getInstanceStyles: () => ({ css: instanceCss }) };
    const main = createCustomStyles(host, hostRoot, sameOptions);
    const layer = createLayer(host, { css: '.pads {}', customStylesOptions: sameOptions });
    const root = layer.layer.shadowRoot!;
    const custom = (): string[] => [...root.querySelectorAll('style[class^="x-custom"]')].map((s) => `${s.className}: ${s.textContent}`);
    expect(custom()).toEqual(['x-custom--page: .page {}', 'x-custom: .inst-1 {}']);
    // the component refreshes only its main handle (instance inputs changed): the layer follows
    instanceCss = '.inst-2 {}';
    main.refresh();
    expect(custom()).toEqual(['x-custom--page: .page {}', 'x-custom: .inst-2 {}']);
    // a page write for the tag reaches the layer
    (window.components as unknown as Record<string, { customStyles?: string }>)[tag]!.customStyles = '.page-2 {}';
    expect(custom()).toEqual(['x-custom--page: .page-2 {}', 'x-custom: .inst-2 {}']);
    // syncTheme() re-resolves too
    instanceCss = '.inst-3 {}';
    layer.syncTheme();
    expect(custom()).toContain('x-custom: .inst-3 {}');
    layer.destroy();
    expect(custom()).toEqual([]);
    // after destroy(): neither the main refresh nor a page write touch it; the host's own root is intact
    main.refresh();
    (window.components as unknown as Record<string, { customStyles?: string }>)[tag]!.customStyles = '.page-3 {}';
    expect(custom()).toEqual([]);
    expect([...hostRoot.querySelectorAll('style[class^="x-custom"]')].map((s) => s.textContent)).toEqual(['.page-3 {}', '.inst-3 {}']);
    main.destroy();
  });

  it('customStylesOptions with lintCssVars: the layer reusing the options never repeats the main handle’s warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = 'layer-lint-test';
    registerComponent(tag, class extends HTMLElement {}, { config: { name: 'x', version: '0.0.0' } });
    const host = document.createElement(tag);
    document.body.append(host);
    const sameOptions = {
      getContext: () => ({}),
      getInstanceStyles: () => ({ css: ':host { --ll-day-background: red; }' }),
      lintCssVars: { prefix: '--ll-', componentCss: '.d { background: var(--ll-day-bg); }' },
    };
    const main = createCustomStyles(host, host.attachShadow({ mode: 'open' }), sameOptions);
    const layer = createLayer(host, { customStylesOptions: sameOptions });
    layer.syncTheme();
    main.refresh();
    expect(warn.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes('"--ll-day-background"'))).toHaveLength(1);
    layer.destroy();
    main.destroy();
    warn.mockRestore();
  });

  it('customStylesOptions: the layer handle is unshared — a managed child of the host still reads the MAIN handle', () => {
    const tag = 'layer-cs-owner';
    const childTag = 'layer-cs-child';
    registerComponent(tag, class extends HTMLElement {}, { config: { name: 'x', version: '0.0.0' } });
    registerComponent(childTag, class extends HTMLElement {}, { config: { name: 'x', version: '0.0.0' } });
    const host = document.createElement(tag);
    const child = document.createElement(childTag);
    document.body.append(host, child);
    const hostRoot = host.attachShadow({ mode: 'open' });
    const childRoot = child.attachShadow({ mode: 'open' });
    createCustomStyles(host, hostRoot, { cssClass: 'o', getContext: () => ({}), getInstanceStyles: () => ({ css: '.main {}' }) });
    createCustomStyles(child, childRoot, { cssClass: 'c', getContext: () => ({}), getInstanceStyles: () => ({}), getOwner: () => host });
    const layer = createLayer(host, { customStylesOptions: { cssClass: 'o', getContext: () => ({}), getInstanceStyles: () => ({ css: '.layer-only {}' }) } });
    const ownerSlot = (): string | null | undefined => childRoot.querySelector('style.c--owner')?.textContent;
    expect(ownerSlot()).toBe('.main {}');
    layer.destroy();
    expect(ownerSlot()).toBe('.main {}');
  });
});
