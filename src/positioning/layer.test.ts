import { afterEach, describe, expect, it } from 'vitest';
import { createLayer } from './layer.js';

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
});
