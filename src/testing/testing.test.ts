import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { toInt, toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import { captureConsole, cleanup, defineOnce, listen, mount, mountBeforeUpgrade, resetPageState, uniqueTag, waitForEvent } from './index.js';

class Widget extends BlissElement<{ ping: { n: number } }> {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'height', attribute: 'height', converter: toInt({ default: 10 }), on: 'reinit' },
    { configKey: 'label', attribute: 'label', converter: toText({ default: '' }), on: 'update' },
  ];
  protected static override events = ['ping'];
  reinits = 0;
  connects = 0;
  protected override reinit(): void {
    this.reinits += 1;
  }
  protected override connect(): void {
    this.connects += 1;
  }
  firePing(n: number): void {
    this.emit('ping', { n });
  }
}

/** A fresh subclass per tag — jsdom rejects registering one constructor under two tags. */
const freshWidget = (): CustomElementConstructor => class extends Widget {} as unknown as CustomElementConstructor;

afterEach(cleanup);

describe('uniqueTag / defineOnce', () => {
  it('uniqueTag returns distinct valid tags', () => {
    const a = uniqueTag('w');
    const b = uniqueTag('w');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^w-\d+$/);
  });

  it('defineOnce does not throw on a repeat define', () => {
    const tag = uniqueTag();
    const ctor = freshWidget();
    defineOnce(tag, ctor);
    expect(() => defineOnce(tag, ctor)).not.toThrow();
  });

  // Review L-12.
  it('defineOnce throws when the tag is taken by a different class', () => {
    const tag = defineOnce(uniqueTag(), freshWidget());
    expect(() => defineOnce(tag, freshWidget())).toThrow(/already defined by a different class/);
  });

  it('uniqueTag never repeats across copies of core', async () => {
    const a = uniqueTag('x');
    vi.resetModules();
    const other = await import('./fixtures.js'); // a second module instance = another bundle
    expect(other.uniqueTag('x')).not.toBe(a);
  });
});

describe('mount', () => {
  it('mounts an HTML string, connects it, and returns the element', async () => {
    const tag = defineOnce(uniqueTag(), freshWidget());
    const el = mount<Widget>(`<${tag} height="20"></${tag}>`);
    expect(el.connects).toBe(1); // connected → connect() ran
    await el.whenSettled();
    expect(el.reinits).toBe(1);
    expect((el as unknown as Record<string, unknown>).height).toBe(20);
  });

  it('returns the new element when mounting into a non-empty container', () => {
    const tag = defineOnce(uniqueTag(), freshWidget());
    const container = document.createElement('section');
    container.innerHTML = '<p id="old"></p>';
    document.body.append(container);
    const el = mount<Widget>(`<${tag} id="new"></${tag}>`, { container });
    expect(el.id).toBe('new');
    expect(el.connects).toBe(1);
    container.remove();
  });

  it('cleanup removes mounted elements', () => {
    const tag = defineOnce(uniqueTag(), freshWidget());
    mount(`<${tag}></${tag}>`);
    expect(document.querySelector(tag)).not.toBeNull();
    cleanup();
    expect(document.querySelector(tag)).toBeNull();
  });
});

describe('mountBeforeUpgrade', () => {
  it('captures properties set before the class is defined', async () => {
    const tag = uniqueTag();
    const el = mountBeforeUpgrade<Widget>(
      tag,
      freshWidget(),
      (e) => {
        e.height = 33; // set while still a plain HTMLElement
      },
    );
    await el.whenSettled();
    expect((el as unknown as Record<string, unknown>).height).toBe(33); // routed through the setter on upgrade
    expect(el.reinits).toBe(1);
  });
});

describe('listen', () => {
  it('records emitted CustomEvents and exposes the latest detail', () => {
    const tag = defineOnce(uniqueTag(), freshWidget());
    const el = mount<Widget>(`<${tag}></${tag}>`);
    const spy = listen<CustomEvent<{ n: number }>>(el, 'ping');

    el.firePing(1);
    el.firePing(2);
    expect(spy.count).toBe(2);
    expect(spy.lastDetail).toEqual({ n: 2 });
    expect(spy.events.map((e) => e.detail.n)).toEqual([1, 2]);

    spy.stop();
    el.firePing(3);
    expect(spy.count).toBe(2); // stopped
  });
});

// Review 2026-11-03 L-13 / L-20 / L-21 (WP12).
describe('/testing — review fixes', () => {
  it('mount({ container }): cleanup() removes the element; a detached container is connected', () => {
    const container = document.createElement('section');
    const el = mount(`<div class="x"></div>`, { container });
    expect(el.isConnected).toBe(true);
    cleanup();
    expect(el.isConnected).toBe(false);
  });

  it('mountBeforeUpgrade on an already-defined tag throws instead of skipping the pre-upgrade path', () => {
    const tag = defineOnce(uniqueTag(), freshWidget());
    expect(() => mountBeforeUpgrade(tag, freshWidget(), () => {})).toThrow(/already defined/);
  });

  it('captureConsole records readable lines and restores the console', () => {
    const original = console.warn;
    const capture = captureConsole(['warn']);
    console.warn('%c[NS:INIT]%c #x', 'color:red', 'color:grey', 'hello', { detail: 1 });
    capture.restore();
    expect(capture.lines('warn')).toEqual(['[NS:INIT] #x hello']);
    expect(console.warn).toBe(original);
  });

  it('waitForEvent resolves with the next event and rejects on timeout', async () => {
    const target = new EventTarget();
    const next = waitForEvent(target, 'ping');
    target.dispatchEvent(new CustomEvent('ping', { detail: 1 }));
    await expect(next).resolves.toMatchObject({ detail: 1 });
    await expect(waitForEvent(target, 'never', { timeout: 5 })).rejects.toThrow(/no "never" event/);
  });

  it('resetPageState() releases a held scroll lock', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // jsdom has no scrolling
    const { lockBodyScroll } = await import('../overlay/scroll-lock.js');
    lockBodyScroll();
    expect(document.body.style.position).toBe('fixed');
    resetPageState();
    expect(document.body.style.position).toBe('');
    scrollTo.mockRestore();
  });
});
