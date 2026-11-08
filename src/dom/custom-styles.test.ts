import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerComponent } from '../global/register-component.js';
import { createCustomStyles, type CustomStylesSource } from './custom-styles.js';

let seq = 0;
/** A fresh registered tag per test (the registry and customElements are page-global). */
function registeredTag(preset?: Record<string, unknown>): string {
  const tag = `cs-test-${seq++}`;
  if (preset) (window.components ??= {})[tag] = preset as never;
  class El extends HTMLElement {}
  registerComponent(tag, El, { config: { name: 'x', version: '0.0.0' } });
  return tag;
}

function host(tag: string): { el: HTMLElement; root: ShadowRoot } {
  const el = document.createElement(tag);
  document.body.append(el);
  return { el, root: el.attachShadow({ mode: 'open' }) };
}

/** The `<style>` elements in `root`, as `class: text`. */
function styles(root: ShadowRoot): string[] {
  return [...root.querySelectorAll('style')].map((s) => `${s.className}: ${s.textContent}`);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('createCustomStyles', () => {
  it('instance layer: the callback wins over the CSS and gets the context', () => {
    const tag = registeredTag();
    const { el, root } = host(tag);
    let source: CustomStylesSource<{ id: number }> = { css: '.a { color: red }' };
    const handle = createCustomStyles(el, root, { cssClass: 'x-custom', getContext: () => ({ id: 7 }), getInstanceStyles: () => source });
    expect(styles(root)).toEqual(['x-custom: .a { color: red }']);

    source = { css: '.a { color: red }', callback: (ctx) => `.b { order: ${ctx.id} }` };
    handle.refresh();
    expect(styles(root)).toEqual(['x-custom: .b { order: 7 }']);

    source = {};
    handle.refresh();
    expect(styles(root)).toEqual([]);
  });

  it('page layer: window.components[tag].customStyles reaches live instances, before the instance CSS', () => {
    const tag = registeredTag();
    const a = host(tag);
    const b = host(tag);
    createCustomStyles(a.el, a.root, { cssClass: 'x-custom', getContext: () => ({}), getInstanceStyles: () => ({ css: '.mine {}' }) });
    createCustomStyles(b.el, b.root, { cssClass: 'x-custom', getContext: () => ({}), getInstanceStyles: () => ({}) });

    window.components![tag]!.customStyles = "@import url('/css/days.css');";
    expect(styles(a.root)).toEqual(["x-custom--page: @import url('/css/days.css');", 'x-custom: .mine {}']);
    expect(styles(b.root)).toEqual(["x-custom--page: @import url('/css/days.css');"]);

    window.components![tag]!.customStyles = undefined;
    expect(styles(a.root)).toEqual(['x-custom: .mine {}']);
  });

  it("position 'first' keeps both slots at the top, page before instance", () => {
    const tag = registeredTag({ customStyles: '.page {}' });
    const { el, root } = host(tag);
    root.append(document.createElement('div'));
    createCustomStyles(el, root, { cssClass: 'x', position: 'first', getContext: () => ({}), getInstanceStyles: () => ({ css: '.inst {}' }) });
    expect([...root.children].map((n) => n.className || n.localName)).toEqual(['x--page', 'x', 'div']);
  });

  it('a value set on the entry before registration is adopted', () => {
    const tag = registeredTag({ customStyles: '.early {}' });
    const { el, root } = host(tag);
    createCustomStyles(el, root, { cssClass: 'x', getContext: () => ({}), getInstanceStyles: () => ({}) });
    expect(styles(root)).toEqual(['x--page: .early {}']);
  });

  it('page callback wins over page CSS and gets each instance its own context', () => {
    const tag = registeredTag({ customStyles: '.static {}' });
    const a = host(tag);
    const b = host(tag);
    createCustomStyles(a.el, a.root, { cssClass: 'x', getContext: () => ({ n: 1 }), getInstanceStyles: () => ({}) });
    createCustomStyles(b.el, b.root, { cssClass: 'x', getContext: () => ({ n: 2 }), getInstanceStyles: () => ({}) });
    window.components![tag]!.getCustomStylesCallback = (ctx: { n: number }) => `.n${ctx.n} {}`;
    expect(styles(a.root)).toEqual(['x--page: .n1 {}']);
    expect(styles(b.root)).toEqual(['x--page: .n2 {}']);
  });

  it('a wrong page value warns and keeps the previous one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = registeredTag({ customStyles: '.keep {}' });
    (window.components![tag] as unknown as Record<string, unknown>).customStyles = 42;
    (window.components![tag] as unknown as Record<string, unknown>).getCustomStylesCallback = 'nope';
    expect(window.components![tag]!.customStyles).toBe('.keep {}');
    expect(window.components![tag]!.getCustomStylesCallback).toBeUndefined();
    expect(warn.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes('keeping previous value'))).toHaveLength(2);
    warn.mockRestore();
  });

  it('a throwing callback leaves that layer empty and warns; the other layer still applies', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = registeredTag();
    window.components![tag]!.getCustomStylesCallback = () => {
      throw new Error('boom');
    };
    const { el, root } = host(tag);
    createCustomStyles(el, root, { cssClass: 'x', getContext: () => ({}), getInstanceStyles: () => ({ css: '.inst {}' }) });
    expect(styles(root)).toEqual(['x: .inst {}']);
    expect(warn.mock.calls.some((c) => c.join(' ').includes('getCustomStylesCallback threw'))).toBe(true);
    warn.mockRestore();
  });

  it('onApply sees each non-empty layer; destroy() removes both and stops following the page', () => {
    const tag = registeredTag({ customStyles: '.page {}' });
    const { el, root } = host(tag);
    const applied: string[] = [];
    const handle = createCustomStyles(el, root, {
      cssClass: 'x',
      getContext: () => ({}),
      getInstanceStyles: () => ({ css: '.inst {}' }),
      onApply: (css, layer) => applied.push(`${layer}: ${css}`),
    });
    expect(applied).toEqual(['page: .page {}', 'instance: .inst {}']);

    handle.destroy();
    expect(styles(root)).toEqual([]);
    window.components![tag]!.customStyles = '.later {}';
    expect(styles(root)).toEqual([]);
  });

  describe('@import links in the document head (fonts)', () => {
    const hoisted = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[data-km-custom-styles]')].map((l) => l.getAttribute('href'));
    const hoistedStyles = () => [...document.head.querySelectorAll('style[data-km-custom-styles]')].map((s) => s.textContent);
    const abs = (path: string) => new URL(path, document.baseURI).href;

    it('each @import URL is linked once in the head, shared by instances, removed with the last one', () => {
      const tag = registeredTag();
      const a = host(tag);
      const b = host(tag);
      const css = "@import url('/fonts/fa-1.css'); .x {}";
      const ha = createCustomStyles(a.el, a.root, { getContext: () => ({}), getInstanceStyles: () => ({ css }) });
      const hb = createCustomStyles(b.el, b.root, { getContext: () => ({}), getInstanceStyles: () => ({ css }) });
      expect(hoisted()).toEqual([new URL('/fonts/fa-1.css', document.baseURI).href]);
      expect(styles(a.root)).toEqual([`custom-styles: ${css}`]); // the @import stays in the shadow too
      ha.destroy();
      expect(hoisted()).toHaveLength(1);
      hb.destroy();
      expect(hoisted()).toEqual([]);
    });

    it('a changed CSS drops the URL it no longer imports; @import "x" and the page layer count too', () => {
      const tag = registeredTag();
      const { el, root } = host(tag);
      let css = '@import url("/fonts/fa-2.css");';
      const handle = createCustomStyles(el, root, { getContext: () => ({}), getInstanceStyles: () => ({ css }) });
      css = "@import '/fonts/fa-3.css';";
      handle.refresh();
      expect(hoisted()).toEqual([new URL('/fonts/fa-3.css', document.baseURI).href]);
      window.components![tag]!.customStyles = '@import url(/fonts/fa-4.css);';
      expect(hoisted()).toHaveLength(2);
      handle.destroy();
      expect(hoisted()).toEqual([]);
    });

    it('a stylesheet the page links itself is reused and never removed', () => {
      const own = document.createElement('link');
      own.rel = 'stylesheet';
      own.href = '/fonts/fa-5.css';
      document.head.append(own);
      const tag = registeredTag();
      const { el, root } = host(tag);
      const handle = createCustomStyles(el, root, { getContext: () => ({}), getInstanceStyles: () => ({ css: "@import url('/fonts/fa-5.css');" }) });
      expect(hoisted()).toEqual([]);
      handle.destroy();
      expect(own.isConnected).toBe(true);
      own.remove();
    });

    it('nothing is linked for a light-DOM root or with shouldHoistImports: false', () => {
      const tag = registeredTag();
      const { el, root } = host(tag);
      const light = document.createElement('div');
      document.body.append(light);
      const css = "@import url('/fonts/fa-6.css');";
      const h1 = createCustomStyles(el, light, { getContext: () => ({}), getInstanceStyles: () => ({ css }) });
      const h2 = createCustomStyles(el, root, { getContext: () => ({}), getInstanceStyles: () => ({ css }), shouldHoistImports: false });
      expect(hoisted()).toEqual([]);
      h1.destroy();
      h2.destroy();
    });

    it('conditions are kept: a layered / media / supports import is a head <style> with the whole statement', () => {
      const tag = registeredTag();
      const { el, root } = host(tag);
      const css = "@import url('/fonts/l.css') layer(theme);\n@import '/fonts/p.css' print;\n@import url(/fonts/s.css) supports(display: grid) screen and (min-width: 600px);";
      const handle = createCustomStyles(el, root, { getContext: () => ({}), getInstanceStyles: () => ({ css }) });
      expect(hoisted()).toEqual([]);
      expect(hoistedStyles()).toEqual([
        `@import url("${abs('/fonts/l.css')}") layer(theme);`,
        `@import url("${abs('/fonts/p.css')}") print;`,
        `@import url("${abs('/fonts/s.css')}") supports(display: grid) screen and (min-width: 600px);`,
      ]);
      handle.destroy();
      expect(hoistedStyles()).toEqual([]);
    });

    it('only the leading imports count: commented-out ones and ones after a rule are not loaded, so not hoisted', () => {
      const tag = registeredTag();
      const { el, root } = host(tag);
      const css = '/* @import url(/fonts/old.css); */ @charset "utf-8"; @layer a, b; @import url(/fonts/ok.css); .x {} @import url(/fonts/late.css);';
      const handle = createCustomStyles(el, root, { getContext: () => ({}), getInstanceStyles: () => ({ css }) });
      expect(hoisted()).toEqual([abs('/fonts/ok.css')]);
      handle.destroy();
    });

    it('each layer is its own sheet: an instance import after page rules still counts', () => {
      const tag = registeredTag({ customStyles: '.page {}' });
      const { el, root } = host(tag);
      const handle = createCustomStyles(el, root, { getContext: () => ({}), getInstanceStyles: () => ({ css: '@import url(/fonts/inst.css);' }) });
      expect(hoisted()).toEqual([abs('/fonts/inst.css')]);
      handle.destroy();
    });
  });
});
