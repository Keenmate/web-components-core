import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { toInt, toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

let seq = 0;

/** Hooks throw while `shouldThrow*` is set — a component bug, not a core one. */
class FlakyElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'height', attribute: 'height', converter: toInt({ default: 10 }), on: 'reinit' },
    { configKey: 'label', attribute: 'label', converter: toText({ default: '' }), on: 'update' },
  ];
  shouldThrowReinit = false;
  shouldThrowUpdate = false;
  reinits = 0;
  connects = 0;
  disconnects = 0;
  protected override reinit(): void {
    this.reinits += 1;
    if (this.shouldThrowReinit) throw new Error('reinit boom');
  }
  protected override update(): void {
    if (this.shouldThrowUpdate) throw new Error('update boom');
  }
  protected override connect(): void {
    this.connects += 1;
  }
  protected override disconnect(): void {
    this.disconnects += 1;
  }
}

type Flaky = FlakyElement & Record<string, unknown>;

function makeEl(): Flaky {
  const tag = `flaky-element-${seq++}`;
  class El extends FlakyElement {}
  customElements.define(tag, El as unknown as CustomElementConstructor);
  return document.createElement(tag) as unknown as Flaky;
}

/**
 * Connect while the first reinit() throws. A custom-element reaction's error is
 * reported to window `error`, not thrown out of append() — swallow that report.
 */
function connectThrowing(el: Flaky): void {
  const onError = (e: ErrorEvent): void => e.preventDefault();
  window.addEventListener('error', onError);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    document.body.append(el as unknown as Node);
  } finally {
    window.removeEventListener('error', onError);
    consoleError.mockRestore();
  }
}

afterEach(() => document.body.replaceChildren());

describe('a hook that throws', () => {
  it('still resolves whenSettled() waiters, and rethrows to the flusher', async () => {
    const el = makeEl();
    document.body.append(el as unknown as Node);
    el.shouldThrowUpdate = true;
    el.label = 'x';
    const settled = el.whenSettled();
    expect(() => el.flush()).toThrow('update boom');
    await expect(settled).resolves.toBeUndefined();
  });

  it('retries a failed first build on the next change, then activates', () => {
    const el = makeEl();
    el.shouldThrowReinit = true;
    connectThrowing(el);
    expect(el.reinits).toBe(1);
    expect(el.connects).toBe(0); // never activated a structure that wasn't built

    el.shouldThrowReinit = false;
    el.label = 'y'; // an update-level change — but the owed rebuild wins
    el.flush();
    expect(el.reinits).toBe(2);
    expect(el.connects).toBe(1);
  });

  it('does not run disconnect() for a connect() that never ran', () => {
    const el = makeEl();
    el.shouldThrowReinit = true;
    connectThrowing(el);
    el.remove();
    expect(el.disconnects).toBe(0);
  });

  it('retries the build on reconnect after a failed first build', () => {
    const el = makeEl();
    el.shouldThrowReinit = true;
    connectThrowing(el);
    el.remove();
    el.shouldThrowReinit = false;
    document.body.append(el as unknown as Node);
    expect(el.reinits).toBe(2);
    expect(el.connects).toBe(1);
    el.remove();
    expect(el.disconnects).toBe(1);
  });
});
