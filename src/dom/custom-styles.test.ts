import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerComponent } from '../global/register-component.js';
import { createCustomStyles, type CustomStylesSource } from './custom-styles.js';
import { BlissElement } from '../element/bliss-element.js';

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

  it('a page value for a component that never applies it warns once (at ready, or on assignment)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unused = () => warn.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes("doesn't apply page-wide custom CSS"));
    const tag = `cs-unused-${seq++}`;
    class El extends BlissElement {}
    registerComponent(tag, El, { config: { name: 'x', version: '0.0.0' } });
    document.body.append(document.createElement(tag), document.createElement(tag));
    await Promise.resolve();
    await Promise.resolve();
    expect(unused()).toHaveLength(0); // nothing set yet
    window.components![tag]!.customStyles = '.x {}';
    expect(unused()).toHaveLength(1);
    window.components![tag]!.customStyles = '.y {}';
    expect(unused()).toHaveLength(1); // once per tag

    // a component that does apply it never warns
    const tag2 = `cs-used-${seq++}`;
    class Used extends BlissElement {
      constructor() {
        super();
        createCustomStyles(this, this.attachShadow({ mode: 'open' }), { getContext: () => ({}), getInstanceStyles: () => ({}) });
      }
    }
    registerComponent(tag2, Used, { config: { name: 'x', version: '0.0.0' } });
    window.components![tag2]!.customStyles = '.z {}';
    document.body.append(document.createElement(tag2));
    await Promise.resolve();
    await Promise.resolve();
    expect(unused()).toHaveLength(1);

    // set before any instance exists → the first instance warns at ready
    const tag3 = `cs-early-${seq++}`;
    class Early extends BlissElement {}
    registerComponent(tag3, Early, { config: { name: 'x', version: '0.0.0' } });
    window.components![tag3]!.customStyles = '.e {}';
    expect(unused()).toHaveLength(1);
    document.body.append(document.createElement(tag3));
    await Promise.resolve();
    await Promise.resolve();
    expect(unused()).toHaveLength(2);
    warn.mockRestore();
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

  describe('managed child (getOwner): the owner layers sit between the child own layers', () => {
    const plain = (instance: string | null) => ({ getContext: () => ({}), getInstanceStyles: () => ({ css: instance }) });

    it('order: child page → owner page → owner instance → child instance', () => {
      const ownerTag = registeredTag({ customStyles: '.owner-page {}' });
      const childTag = registeredTag({ customStyles: '.child-page {}' });
      const owner = host(ownerTag);
      const child = host(childTag);
      createCustomStyles(owner.el, owner.root, { cssClass: 'o', ...plain('.owner-inst {}') });
      createCustomStyles(child.el, child.root, { cssClass: 'c', ...plain('.child-inst {}'), getOwner: () => owner.el });
      expect(styles(child.root)).toEqual(['c--page: .child-page {}', 'c--owner-page: .owner-page {}', 'c--owner: .owner-inst {}', 'c: .child-inst {}']);
      expect(styles(owner.root)).toEqual(['o--page: .owner-page {}', 'o: .owner-inst {}']); // the owner is unchanged
    });

    it("position 'first' keeps the four slots in order at the top", () => {
      const ownerTag = registeredTag({ customStyles: '.op {}' });
      const childTag = registeredTag({ customStyles: '.cp {}' });
      const owner = host(ownerTag);
      const child = host(childTag);
      child.root.append(document.createElement('div'));
      createCustomStyles(owner.el, owner.root, { cssClass: 'o', ...plain('.oi {}') });
      createCustomStyles(child.el, child.root, { cssClass: 'c', position: 'first', ...plain('.ci {}'), getOwner: () => owner.el });
      expect([...child.root.children].map((n) => n.className || n.localName)).toEqual(['c--page', 'c--owner-page', 'c--owner', 'c', 'div']);
    });

    it('live: a page write for either tag, the owner refresh(), and an owner handle created after the child', () => {
      const ownerTag = registeredTag();
      const childTag = registeredTag();
      const owner = host(ownerTag);
      const child = host(childTag);
      createCustomStyles(child.el, child.root, { cssClass: 'c', ...plain(null), getOwner: () => owner.el });
      expect(styles(child.root)).toEqual([]);

      let ownerCss = '.oi-1 {}';
      const ownerHandle = createCustomStyles(owner.el, owner.root, { cssClass: 'o', getContext: () => ({}), getInstanceStyles: () => ({ css: ownerCss }) });
      expect(styles(child.root)).toEqual(['c--owner: .oi-1 {}']);

      ownerCss = '.oi-2 {}';
      ownerHandle.refresh();
      expect(styles(child.root)).toEqual(['c--owner: .oi-2 {}']);

      window.components![ownerTag]!.customStyles = '.op {}';
      expect(styles(child.root)).toEqual(['c--owner-page: .op {}', 'c--owner: .oi-2 {}']);

      window.components![childTag]!.customStyles = '.cp {}';
      expect(styles(child.root)).toEqual(['c--page: .cp {}', 'c--owner-page: .op {}', 'c--owner: .oi-2 {}']);
    });

    it("the owner page callback runs with the owner's context (the child shows what the owner shows)", () => {
      const ownerTag = registeredTag();
      const childTag = registeredTag();
      const owner = host(ownerTag);
      const child = host(childTag);
      window.components![ownerTag]!.getCustomStylesCallback = (ctx: { who: string }) => `.by-${ctx.who} {}`;
      createCustomStyles(owner.el, owner.root, { cssClass: 'o', getContext: () => ({ who: 'owner' }), getInstanceStyles: () => ({}) });
      createCustomStyles(child.el, child.root, { cssClass: 'c', getContext: () => ({ who: 'child' }), getInstanceStyles: () => ({}), getOwner: () => owner.el });
      expect(styles(child.root)).toEqual(['c--owner-page: .by-owner {}']);
    });

    it('no owner / the owner unbound / destroyed / removed from the page = no owner layers', async () => {
      const ownerTag = `cs-owner-${seq++}`;
      class Owner extends BlissElement {}
      registerComponent(ownerTag, Owner, { config: { name: 'x', version: '0.0.0' } });
      const childTag = registeredTag();
      const ownerEl = document.createElement(ownerTag) as Owner;
      document.body.append(ownerEl);
      const ownerRoot = ownerEl.attachShadow({ mode: 'open' });
      const child = host(childTag);
      let bound: HTMLElement | null = null;
      const childHandle = createCustomStyles(child.el, child.root, { cssClass: 'c', ...plain('.ci {}'), getOwner: () => bound });
      const ownerHandle = createCustomStyles(ownerEl, ownerRoot, { cssClass: 'o', ...plain('.oi {}') });
      expect(styles(child.root)).toEqual(['c: .ci {}']); // no owner

      bound = ownerEl;
      childHandle.refresh();
      expect(styles(child.root)).toEqual(['c--owner: .oi {}', 'c: .ci {}']);

      // really removed from the page → dropped; re-attached → back
      ownerEl.remove();
      await new Promise((r) => setTimeout(r, 30));
      expect(styles(child.root)).toEqual(['c: .ci {}']);
      document.body.append(ownerEl);
      expect(styles(child.root)).toEqual(['c--owner: .oi {}', 'c: .ci {}']);

      // destroyed → dropped
      ownerHandle.destroy();
      expect(styles(child.root)).toEqual(['c: .ci {}']);

      // unbound → dropped
      const again = createCustomStyles(ownerEl, ownerRoot, { cssClass: 'o', ...plain('.oi2 {}') });
      expect(styles(child.root)).toEqual(['c--owner: .oi2 {}', 'c: .ci {}']);
      bound = null;
      childHandle.refresh();
      expect(styles(child.root)).toEqual(['c: .ci {}']);
      again.refresh(); // no longer followed
      expect(styles(child.root)).toEqual(['c: .ci {}']);
    });

    it('a throwing getOwner is logged and applies no owner layers; the host itself is not its own owner', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ownerTag = registeredTag({ customStyles: '.op {}' });
      const owner = host(ownerTag);
      createCustomStyles(owner.el, owner.root, { cssClass: 'o', ...plain(null) });
      const child = host(registeredTag());
      createCustomStyles(child.el, child.root, {
        cssClass: 'c',
        ...plain('.ci {}'),
        getOwner: () => {
          throw new Error('boom');
        },
      });
      expect(styles(child.root)).toEqual(['c: .ci {}']);
      expect(warn.mock.calls.some((c) => c.join(' ').includes('getOwner threw'))).toBe(true);

      const self = host(registeredTag());
      createCustomStyles(self.el, self.root, { cssClass: 's', ...plain('.si {}'), getOwner: () => self.el });
      expect(styles(self.root)).toEqual(['s: .si {}']);
      warn.mockRestore();
    });

    it('an owner ↔ child cycle does not loop', () => {
      const a = host(registeredTag());
      const b = host(registeredTag());
      const ha = createCustomStyles(a.el, a.root, { cssClass: 'a', ...plain('.a {}'), getOwner: () => b.el });
      createCustomStyles(b.el, b.root, { cssClass: 'b', ...plain('.b {}'), getOwner: () => a.el });
      ha.refresh();
      expect(styles(b.root)).toEqual(['b--owner: .a {}', 'b: .b {}']);
      expect(styles(a.root)).toEqual(['a--owner: .b {}', 'a: .a {}']);
    });

    it('@import hoisting covers the owner layers; destroying the child releases them', () => {
      const hoisted = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[data-km-custom-styles]')].map((l) => l.getAttribute('href'));
      const abs = (path: string) => new URL(path, document.baseURI).href;
      const ownerTag = registeredTag({ customStyles: '@import url(/fonts/own-page.css);' });
      const owner = host(ownerTag);
      const ownerHandle = createCustomStyles(owner.el, owner.root, { ...plain('@import url(/fonts/own-inst.css);'), shouldHoistImports: false });
      expect(hoisted()).toEqual([]); // the owner opted out itself
      const child = host(registeredTag());
      const childHandle = createCustomStyles(child.el, child.root, { ...plain(null), getOwner: () => owner.el });
      expect(hoisted()).toEqual([abs('/fonts/own-page.css'), abs('/fonts/own-inst.css')]);
      childHandle.destroy();
      expect(hoisted()).toEqual([]);
      ownerHandle.destroy();
    });

    it('onApply sees only the child own layers', () => {
      const owner = host(registeredTag({ customStyles: '.op {}' }));
      createCustomStyles(owner.el, owner.root, plain('.oi {}'));
      const child = host(registeredTag());
      const applied: string[] = [];
      createCustomStyles(child.el, child.root, { ...plain('.ci {}'), getOwner: () => owner.el, onApply: (css, layer) => applied.push(`${layer}: ${css}`) });
      expect(applied).toEqual(['instance: .ci {}']);
    });
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

    it('the page decides: window.components.shouldHoistImports = false drops the links; the tag value beats it', () => {
      const tag = registeredTag();
      const { el, root } = host(tag);
      const handle = createCustomStyles(el, root, { getContext: () => ({}), getInstanceStyles: () => ({ css: '@import url(/fonts/pg.css);' }) });
      expect(hoisted()).toHaveLength(1);
      window.components!.shouldHoistImports = false;
      expect(hoisted()).toEqual([]);
      window.components![tag]!.shouldHoistImports = true;
      expect(hoisted()).toHaveLength(1);
      window.components![tag]!.shouldHoistImports = undefined;
      expect(hoisted()).toEqual([]);
      window.components!.shouldHoistImports = undefined;
      expect(hoisted()).toHaveLength(1);
      expect(Object.keys(window.components!)).not.toContain('shouldHoistImports'); // page setting: non-enumerable
      handle.destroy();
    });

    it('a BlissElement host releases its links when really removed and takes them back when re-attached', async () => {
      const tag = `cs-bliss-${seq++}`;
      class El extends BlissElement {}
      customElements.define(tag, El);
      const el = document.createElement(tag) as El;
      document.body.append(el);
      const root = el.attachShadow({ mode: 'open' });
      const handle = createCustomStyles(el, root, { getContext: () => ({}), getInstanceStyles: () => ({ css: '@import url(/fonts/rm.css);' }) });
      expect(hoisted()).toHaveLength(1);
      const wait = () => new Promise((r) => setTimeout(r, 30));
      // a move (detach + re-attach in one task) keeps them
      el.remove();
      document.body.append(el);
      await wait();
      expect(hoisted()).toHaveLength(1);
      // a real removal releases them
      el.remove();
      await wait();
      expect(hoisted()).toEqual([]);
      document.body.append(el);
      expect(hoisted()).toHaveLength(1);
      handle.destroy();
      expect(hoisted()).toEqual([]);
    });
  });
});
