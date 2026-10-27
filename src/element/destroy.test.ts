import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toBool } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import { consoleLines } from '../logging/console-line.test-util.js';

class DestroyableElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'isCompact', attribute: 'compact', converter: toBool('presence'), default: false, on: 'update' },
    { configKey: 'isWide', attribute: 'wide', converter: toBool('presence'), default: false, on: 'reinit' },
  ];
  readonly calls: string[] = [];
  protected override reinit(): void {
    this.calls.push('reinit');
  }
  protected override update(partial: Record<string, unknown>): void {
    this.calls.push(`update:${Object.keys(partial).join(',')}`);
  }
  protected override connect(): void {
    this.calls.push('connect');
  }
  protected override disconnect(): void {
    this.calls.push('disconnect');
  }
  protected override removedCallback(): void {
    this.calls.push('removed');
  }
  protected override destroyCallback(): void {
    this.calls.push('destroy');
  }
  protected override directionChanged(): void {
    this.calls.push('dir');
  }
}
define('destroyable-element', DestroyableElement as unknown as CustomElementConstructor);

type El = DestroyableElement & { isCompact: boolean; isWide: boolean };
const make = (): El => document.createElement('destroyable-element') as El;

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 20);
  });

describe('destroy()', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('on an active element: disconnect() then destroyCallback(), sets isDestroyed', () => {
    const el = make();
    document.body.appendChild(el);
    expect(el.isDestroyed).toBe(false);
    el.destroy();
    expect(el.calls).toEqual(['reinit', 'connect', 'disconnect', 'destroy']);
    expect(el.isDestroyed).toBe(true);
  });

  it('is idempotent and a later removal fires neither disconnect() nor removedCallback()', async () => {
    const el = make();
    document.body.appendChild(el);
    el.destroy();
    el.destroy();
    el.remove();
    await nextFrame();
    expect(el.calls).toEqual(['reinit', 'connect', 'disconnect', 'destroy']);
  });

  it('cancels a pending flush; whenSettled() resolves; later writes never apply', async () => {
    const el = make();
    document.body.appendChild(el);
    el.isCompact = true;
    el.destroy();
    await el.whenSettled();
    el.isWide = true;
    el.flush();
    await el.whenSettled();
    expect(el.calls).toEqual(['reinit', 'connect', 'disconnect', 'destroy']);
  });

  it('cancels a scheduled removedCallback check (destroy after detach)', async () => {
    const el = make();
    document.body.appendChild(el);
    el.remove();
    el.destroy();
    await nextFrame();
    expect(el.calls).toEqual(['reinit', 'connect', 'disconnect', 'destroy']);
  });

  it('a reconnect after destroy warns and stays inert (no rebuild, no connect, no dir hook)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make();
    document.body.appendChild(el);
    el.destroy();
    el.remove();
    document.body.appendChild(el);
    el.setAttribute('dir', 'rtl');
    expect(el.calls).toEqual(['reinit', 'connect', 'disconnect', 'destroy']);
    expect(consoleLines(warn).some((l) => l.includes('was destroyed'))).toBe(true);
  });

  it('before the first connect: no disconnect(), only destroyCallback(); never builds', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = make();
    el.destroy();
    document.body.appendChild(el);
    el.release();
    expect(el.calls).toEqual(['destroy']);
  });

  it('a throwing disconnect() still runs destroyCallback() once and rethrows', () => {
    class Throwing extends DestroyableElement {
      protected override disconnect(): void {
        throw new Error('boom');
      }
    }
    define('destroyable-throwing', Throwing as unknown as CustomElementConstructor);
    const el = document.createElement('destroyable-throwing') as El;
    document.body.appendChild(el);
    expect(() => el.destroy()).toThrow('boom');
    expect(el.calls).toEqual(['reinit', 'connect', 'destroy']);
    expect(() => el.destroy()).not.toThrow();
    expect(el.calls).toEqual(['reinit', 'connect', 'destroy']);
  });
});
