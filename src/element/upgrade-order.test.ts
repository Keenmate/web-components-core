import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import { consoleLines } from '../logging/console-line.test-util.js';

// Review 2026-11-03 (WP3): upgrade order and the core-declared properties.

let seq = 0;
const tagName = (): string => `upgrade-order-${seq++}`;

class Labelled extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: '' }), on: 'update' },
  ];
  reinits = 0;
  updates: Array<Record<string, unknown>> = [];
  protected override reinit(): void {
    this.reinits += 1;
  }
  protected override update(partial: Record<string, unknown>): void {
    this.updates.push({ ...partial });
  }
}
type El = Labelled & Record<string, unknown>;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('upgrade order', () => {
  it('motion and themeSource assigned before upgrade are applied (E-04)', () => {
    const tag = tagName();
    const el = document.createElement(tag) as unknown as El;
    el.motion = 'none';
    el.themeSource = '#theme-root';
    document.body.append(el as unknown as Node);
    customElements.define(tag, class extends Labelled {} as unknown as CustomElementConstructor);
    expect(el.motion).toBe('none');
    expect(el.getAttribute('motion')).toBe('none');
    expect(el.getAttribute('theme-source')).toBe('#theme-root');
  });

  it('a pre-upgrade property wins over the initial attribute, but a later setAttribute() still applies (E-11)', () => {
    const tag = tagName();
    const el = document.createElement(tag) as unknown as El;
    el.label = 'from-property';
    el.setAttribute('label', 'from-markup');
    customElements.define(tag, class extends Labelled {} as unknown as CustomElementConstructor);
    customElements.upgrade(el as unknown as Node); // detached: upgraded, not connected yet
    expect(el.label).toBe('from-property');
    el.setAttribute('label', 'later'); // a real write before the first connect
    expect(el.label).toBe('later');
  });

  it('setAttributes({ shouldDefer: false, … }) builds once, with every value (E-10)', () => {
    const tag = tagName();
    customElements.define(tag, class extends Labelled {} as unknown as CustomElementConstructor);
    const el = document.createElement(tag) as unknown as El;
    el.setAttribute('defer', '');
    document.body.append(el as unknown as Node);
    expect(el.reinits).toBe(0);
    el.setAttributes({ shouldDefer: false, label: 'x' });
    expect(el.reinits).toBe(1);
    expect(el.updates).toEqual([]);
    expect(el.label).toBe('x');
  });
});

describe('input table check (E-16)', () => {
  it('warns about an unknown `on` value and a configKey that hides a core member', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = tagName();
    class Bad extends BlissElement {
      protected static override inputs: readonly InputDef[] = [
        { configKey: 'label', attribute: 'label', converter: toText(), on: 'rebuild' as never },
        { configKey: 'controller', converter: toText() },
      ];
    }
    customElements.define(tag, Bad as unknown as CustomElementConstructor);
    document.createElement(tag);
    const lines = consoleLines(warn).join('\n');
    expect(lines).toContain(`"label" has on: "rebuild"`);
    expect(lines).toContain(`configKey "controller" hides BlissElement's own "controller"`);
  });
});
