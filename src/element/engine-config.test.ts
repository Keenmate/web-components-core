import { afterEach, describe, expect, it } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(() => r()));

/**
 * A stub engine that merges like a real one (TreeController.updateProps): the
 * `!== undefined` guard lets a partial resend omit untouched keys, and each
 * field picks its own null policy — `focusedNodeClass` is clearable (direct
 * assign), `theme` is defaulted (`?? DEFAULT`).
 */
const DEFAULT_THEME = 'light';
class StubEngine {
  focusedNodeClass: string | null = null;
  theme = DEFAULT_THEME;
  readonly received: Record<string, unknown>[] = [];
  updateProps(updates: Record<string, unknown>): void {
    this.received.push(updates);
    if (updates.focusedNodeClass !== undefined) this.focusedNodeClass = updates.focusedNodeClass as string | null;
    if (updates.theme !== undefined) this.theme = (updates.theme as string | null) ?? DEFAULT_THEME;
  }
}

const NON_ENGINE_KEYS = ['theme'] as const;

class EngineHost extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'focusedNodeClass', attribute: 'focused-node-class', converter: toText({ isNullable: true }) },
    { configKey: 'theme', attribute: 'theme', converter: toText({ default: DEFAULT_THEME }) },
  ];

  readonly engine = new StubEngine();

  protected override reinit(): void {
    this.engine.updateProps(this.engineConfig());
  }
  protected override update(partial: Record<string, unknown>): void {
    const cfg = this.engineConfig(NON_ENGINE_KEYS);
    Object.assign(cfg, partial); // partial already carries null for a cleared key
    this.engine.updateProps(cfg);
  }
  configKeysAreClearable(): boolean {
    return this.clearableConfigKeys.has('focusedNodeClass') && !this.clearableConfigKeys.has('theme');
  }
}
define('engine-host', EngineHost as unknown as CustomElementConstructor);

describe('BlissElement.engineConfig — null-clear contract (integration)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('derives the right clearable keys from the table', () => {
    expect(new EngineHost().configKeysAreClearable()).toBe(true);
  });

  it('forwards a cleared nullable input to the engine as present-null, not an absent key', async () => {
    const el = new EngineHost();
    document.body.appendChild(el);
    await el.whenSettled();
    el.engine.received.length = 0;

    el.setAttribute('focused-node-class', 'ring');
    await el.whenSettled();
    expect(el.engine.focusedNodeClass).toBe('ring');

    el.removeAttribute('focused-node-class'); // the clear
    await el.whenSettled();

    const lastUpdate = el.engine.received.at(-1)!;
    expect('focusedNodeClass' in lastUpdate).toBe(true); // present…
    expect(lastUpdate.focusedNodeClass).toBe(null); // …and null, not absent
    expect(el.engine.focusedNodeClass).toBe(null); // the clear landed
  });

  it('a non-engine key (theme) never reaches the engine config', async () => {
    const el = new EngineHost();
    document.body.appendChild(el);
    await el.whenSettled();
    el.engine.received.length = 0;

    el.setAttribute('focused-node-class', 'ring');
    await el.whenSettled();
    expect('theme' in el.engine.received.at(-1)!).toBe(false);
  });

  it('a defaulted field resolves a forwarded null back to its default (?? DEFAULT)', () => {
    const el = new EngineHost();
    // Drive the engine merge directly: theme would never be null via the table
    // (it is defaulted), but the contract must hold if a null arrives.
    el.engine.updateProps({ theme: null });
    expect(el.engine.theme).toBe(DEFAULT_THEME);
  });
});
