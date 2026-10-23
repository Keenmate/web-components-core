import { describe, expect, it, vi } from 'vitest';
import { runBeforeCallback, runBeforeCallbackSync } from './before-callback.js';

describe('runBeforeCallback', () => {
  it('unset → continue', async () => {
    await expect(runBeforeCallback(undefined, {})).resolves.toEqual({ isCancelled: false, hasValue: false });
  });

  it('false → cancel; undefined → continue; a value (incl. null) → continue with it', async () => {
    await expect(runBeforeCallback(() => false, {})).resolves.toEqual({ isCancelled: true });
    await expect(runBeforeCallback(() => undefined, {})).resolves.toEqual({ isCancelled: false, hasValue: false });
    await expect(runBeforeCallback(() => ['a'], {})).resolves.toEqual({ isCancelled: false, hasValue: true, value: ['a'] });
    await expect(runBeforeCallback(() => null, {})).resolves.toEqual({ isCancelled: false, hasValue: true, value: null });
  });

  it('true is a value, not "handled" — it continues', async () => {
    await expect(runBeforeCallback(() => true, {})).resolves.toEqual({ isCancelled: false, hasValue: true, value: true });
  });

  it('awaits a Promise and passes one ctx', async () => {
    const fn = vi.fn(async (ctx: { n: number }) => (ctx.n > 1 ? false : undefined));
    await expect(runBeforeCallback(fn, { n: 2 })).resolves.toEqual({ isCancelled: true });
    expect(fn).toHaveBeenCalledWith({ n: 2 });
  });

  it('a throw (sync or async) cancels and is logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runBeforeCallback(() => { throw new Error('x'); }, {})).resolves.toEqual({ isCancelled: true });
    await expect(runBeforeCallback(async () => { throw new Error('y'); }, {}, 'beforeDeleteCallback')).resolves.toEqual({
      isCancelled: true,
    });
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[1]![0])).toContain('beforeDeleteCallback');
    error.mockRestore();
  });
});

describe('runBeforeCallbackSync', () => {
  it('same contract, synchronously', () => {
    expect(runBeforeCallbackSync(() => false, {})).toEqual({ isCancelled: true });
    expect(runBeforeCallbackSync(() => undefined, {})).toEqual({ isCancelled: false, hasValue: false });
    expect(runBeforeCallbackSync(() => ['p'], {})).toEqual({ isCancelled: false, hasValue: true, value: ['p'] });
  });

  it('a returned Promise is warned and treated as continue', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(runBeforeCallbackSync(async () => false, {}, 'beforeDragStartCallback')).toEqual({
      isCancelled: false,
      hasValue: false,
    });
    expect(String(warn.mock.calls[0]![0])).toContain('beforeDragStartCallback must be synchronous');
    warn.mockRestore();
  });

  it('a throw cancels', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runBeforeCallbackSync(() => { throw new Error('x'); }, {})).toEqual({ isCancelled: true });
    error.mockRestore();
  });
});
