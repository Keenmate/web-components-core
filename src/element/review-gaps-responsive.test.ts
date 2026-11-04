// Review 2026-11-03 I-18 #13 — responsive-rule gaps (SPEC §6.7) not covered by
// responsive.test.ts / responsive-merge.test.ts / batch-values.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toEnum, toInt, toObject, toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import { __resetEnvironment } from '../environment/environment.js';
import { registerComponent } from '../global/register-component.js';
import { __resetResponsive } from './responsive.js';
import { consoleLines } from '../logging/console-line.test-util.js';

// ── a desktop environment (jsdom has no matchMedia) ─────────────────────────
const DESKTOP: Record<string, boolean> = {
  '(pointer: coarse)': false,
  '(pointer: fine)': true,
  '(any-pointer: coarse)': false,
  '(hover: hover)': true,
  '(orientation: portrait)': false,
};

function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: !!DESKTOP[query],
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
}

class GapElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'x' }), default: 'x' },
    { configKey: 'note', attribute: 'note', converter: toText({ default: 'n' }), default: 'n', on: 'none' },
    { configKey: 'treeId', attribute: 'tree-id', converter: toText({ default: 'id0' }), default: 'id0', field: '_treeId' },
    { configKey: 'columns', attribute: 'columns', converter: toInt({ min: 1 }), default: 2, on: 'reinit' },
    { configKey: 'labels', converter: toObject(), default: {} },
  ];
  _treeId = '';
  readonly calls: string[] = [];
  protected override reinit(): void {
    this.calls.push('reinit');
  }
  protected override update(partial: Record<string, unknown>): void {
    this.calls.push(`update:${Object.keys(partial).sort().join(',')}`);
  }
  get cfg(): Readonly<Record<string, unknown>> {
    return this.config;
  }
}
const TAG = 'resp-gap-element';
define(TAG, GapElement as unknown as CustomElementConstructor);

type G = GapElement & { label: string; note: string; treeId: string; columns: number; labels: Record<string, string> };

function make(html = `<${TAG}></${TAG}>`): G {
  const host = document.createElement('div');
  host.innerHTML = html;
  const el = host.firstElementChild as G;
  document.body.appendChild(el);
  return el;
}

const comps = () => (window.components ??= {}) as Record<string, any>;

beforeEach(() => {
  installMatchMedia();
});

afterEach(() => {
  document.body.innerHTML = '';
  __resetResponsive();
  for (const key of Object.keys(window.components ?? {})) delete comps()[key];
  __resetEnvironment();
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.restoreAllMocks();
});

describe('responsive rules — input kinds', () => {
  it("a rule on an on:'none' input changes the effective value but runs no hook", async () => {
    const el = make();
    el.calls.length = 0;
    el.responsive = { device: { desktop: { note: 'mobile-note' } } };
    await el.whenSettled();
    expect(el.note).toBe('mobile-note');
    expect(el.cfg.note).toBe('mobile-note');
    expect(el.calls).toEqual([]);
    el.responsive = null;
    expect(el.note).toBe('n');
  });

  it('a rule on a field-backed input writes the field too, and restores it when the rule goes', () => {
    const el = make(`<${TAG} tree-id="base"></${TAG}>`);
    expect(el._treeId).toBe('base');
    el.responsive = { device: { desktop: { treeId: 'override' } } };
    expect(el.treeId).toBe('override');
    expect(el._treeId).toBe('override');
    expect(el.getAttribute('tree-id')).toBe('base'); // never reflects
    el.responsive = null;
    expect(el._treeId).toBe('base');
  });

  it('a property-only input is explicit after a write, and undefined makes the page rule apply again (I-08)', () => {
    comps().responsive = { device: { desktop: { labels: { ok: 'page' } } } };
    const el = make();
    expect(el.labels).toEqual({ ok: 'page' });
    el.labels = { ok: 'mine' };
    expect(el.labels).toEqual({ ok: 'mine' });
    comps().responsive = { device: { desktop: { labels: { ok: 'page-2' } } } };
    expect(el.labels).toEqual({ ok: 'mine' }); // still explicit
    (el as unknown as Record<string, unknown>).labels = undefined;
    expect(el.labels).toEqual({ ok: 'page-2' });
  });
});

describe('responsive attribute — null / array JSON', () => {
  it('responsive="null" means no instance map (page rules still apply)', () => {
    comps().responsive = { device: { desktop: { label: 'page' } } };
    const el = make(`<${TAG} responsive='{"device":{"desktop":{"label":"attr"}}}'></${TAG}>`);
    expect(el.label).toBe('attr');
    el.setAttribute('responsive', 'null');
    expect(el.responsive).toBeNull();
    expect(el.label).toBe('page');
  });

  it('responsive="[]" is not a map: warns and keeps the previous map', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make(`<${TAG} responsive='{"device":{"desktop":{"label":"attr"}}}'></${TAG}>`);
    el.setAttribute('responsive', '[]');
    expect(el.label).toBe('attr');
    expect(el.responsive).toEqual({ device: { desktop: { label: 'attr' } } });
    expect(consoleLines(warn).join('\n')).toMatch(/responsive="\[\]"/);
  });

  it('responsive="[]" in markup: warns, no map', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make(`<${TAG} responsive="[]"></${TAG}>`);
    expect(el.responsive ?? null).toBeNull();
    expect(el.label).toBe('x');
    expect(warn).toHaveBeenCalled();
  });
});

describe('page rules changed while the element is detached', () => {
  it('the new page rules apply on reconnect, before connect-time hooks run', () => {
    registerComponent(TAG, GapElement as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' }, shouldAutoDefine: false });
    const el = make();
    el.remove();
    comps().responsive = { device: { desktop: { label: 'global' } } };
    comps()[TAG].responsive = { device: { desktop: { columns: 4 } } };
    el.calls.length = 0;
    document.body.appendChild(el);
    expect(el.label).toBe('global');
    expect(el.columns).toBe(4);
    expect(el.calls).toEqual(['reinit']); // columns is on:'reinit'; one batch
  });

  it('a page rule removed while detached is gone on reconnect', async () => {
    comps().responsive = { device: { desktop: { label: 'global' } } };
    const el = make();
    expect(el.label).toBe('global');
    el.remove();
    comps().responsive = undefined;
    document.body.appendChild(el);
    await el.whenSettled();
    expect(el.label).toBe('x');
  });
});

describe('a second core copy on the page', () => {
  it('shares the page rules and listeners; re-registering the tag keeps the per-tag rule', async () => {
    registerComponent(TAG, GapElement as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' }, shouldAutoDefine: false });
    comps()[TAG].responsive = { device: { desktop: { label: 'tag-1' } } };
    const el = make();
    expect(el.label).toBe('tag-1');

    vi.resetModules();
    const copy2 = {
      element: await import('./bliss-element.js'),
      register: await import('../global/register-component.js'),
      converters: await import('../inputs/converters.js'),
    };
    expect(copy2.element.BlissElement).not.toBe(BlissElement); // really a second copy

    class Copy2Element extends copy2.element.BlissElement {
      protected static override inputs: readonly InputDef[] = [
        { configKey: 'label', attribute: 'label', converter: copy2.converters.toText({ default: 'y' }), default: 'y' },
      ];
    }
    const tag2 = 'resp-gap-copy2';
    copy2.register.registerComponent(tag2, Copy2Element as unknown as CustomElementConstructor, { config: { name: 'y', version: '1' } });
    // copy 2 re-registers copy 1's tag: the per-tag hooks are re-installed, the rule adopted
    copy2.register.registerComponent(TAG, GapElement as unknown as CustomElementConstructor, { config: { name: 'x', version: '1' }, shouldAutoDefine: false });
    expect(comps()[TAG].responsive).toEqual({ device: { desktop: { label: 'tag-1' } } });

    const el2 = document.createElement(tag2) as unknown as HTMLElement & { label: string };
    document.body.append(el2);

    // a page-wide rule set through whichever accessor reaches both copies' elements
    comps().responsive = { device: { desktop: { label: 'global' } } };
    expect(el2.label).toBe('global');
    expect(el.label).toBe('tag-1'); // the per-tag rule still beats the global one

    // a per-tag change through copy 2's re-installed accessor reaches copy 1's element
    comps()[TAG].responsive = { device: { desktop: { label: 'tag-2' } } };
    await el.whenSettled();
    expect(el.label).toBe('tag-2');
    comps()[TAG].responsive = undefined;
    expect(el.label).toBe('global');
  });
});
