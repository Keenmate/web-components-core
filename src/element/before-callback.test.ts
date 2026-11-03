import { describe, expect, it, vi } from 'vitest';
import { runBeforeCallback, runBeforeCallbackEager, runBeforeCallbackSync } from './before-callback.js';
import { consoleLines } from '../logging/console-line.test-util.js';

describe('runBeforeCallback', () => {
  it('unset → continue', async () => {
    await expect(runBeforeCallback(undefined, {})).resolves.toEqual({ isRejected: false, hasValue: false });
  });

  it('false → reject; undefined → continue; a value (incl. null) → continue with it', async () => {
    await expect(runBeforeCallback(() => false, {})).resolves.toEqual({ isRejected: true });
    await expect(runBeforeCallback(() => undefined, {})).resolves.toEqual({ isRejected: false, hasValue: false });
    await expect(runBeforeCallback(() => ['a'], {})).resolves.toEqual({ isRejected: false, hasValue: true, value: ['a'] });
    await expect(runBeforeCallback(() => null, {})).resolves.toEqual({ isRejected: false, hasValue: true, value: null });
  });

  it('true is a value, not "handled" — it continues', async () => {
    await expect(runBeforeCallback(() => true, {})).resolves.toEqual({ isRejected: false, hasValue: true, value: true });
  });

  it('awaits a Promise and passes one ctx', async () => {
    const fn = vi.fn(async (ctx: { n: number }) => (ctx.n > 1 ? false : undefined));
    await expect(runBeforeCallback(fn, { n: 2 })).resolves.toEqual({ isRejected: true });
    expect(fn).toHaveBeenCalledWith({ n: 2 });
  });

  it('a throw (sync or async) rejects and is logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runBeforeCallback(() => { throw new Error('x'); }, {})).resolves.toEqual({ isRejected: true });
    await expect(runBeforeCallback(async () => { throw new Error('y'); }, {}, 'beforeDeleteCallback')).resolves.toEqual({
      isRejected: true,
    });
    expect(error).toHaveBeenCalledTimes(2);
    expect(consoleLines(error)[1]).toContain('beforeDeleteCallback');
    error.mockRestore();
  });
});

describe('runBeforeCallbackSync', () => {
  it('same contract, synchronously', () => {
    expect(runBeforeCallbackSync(() => false, {})).toEqual({ isRejected: true });
    expect(runBeforeCallbackSync(() => undefined, {})).toEqual({ isRejected: false, hasValue: false });
    expect(runBeforeCallbackSync(() => ['p'], {})).toEqual({ isRejected: false, hasValue: true, value: ['p'] });
  });

  it('a returned Promise is warned and treated as continue', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(runBeforeCallbackSync(async () => false, {}, 'beforeDragStartCallback')).toEqual({
      isRejected: false,
      hasValue: false,
    });
    expect(consoleLines(warn)[0]).toContain('beforeDragStartCallback must be synchronous');
    warn.mockRestore();
  });

  // Review I-04.
  it('a returned Promise that rejects is reported, not left unhandled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    runBeforeCallbackSync(() => Promise.reject(new Error('async boom')), {}, 'beforeDragStartCallback');
    await new Promise((r) => setTimeout(r, 0));
    expect(error).toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it('a throw rejects', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runBeforeCallbackSync(() => { throw new Error('x'); }, {})).toEqual({ isRejected: true });
    error.mockRestore();
  });
});

describe('runBeforeCallbackEager', () => {
  it('answers synchronously for a sync hook (and when unset)', () => {
    expect(runBeforeCallbackEager(undefined, {})).toEqual({ isRejected: false, hasValue: false });
    expect(runBeforeCallbackEager(() => false, {})).toEqual({ isRejected: true });
    expect(runBeforeCallbackEager(() => 'x', {})).toEqual({ isRejected: false, hasValue: true, value: 'x' });
  });

  it('returns a Promise for an async hook, same contract', async () => {
    const result = runBeforeCallbackEager(async () => false, {});
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual({ isRejected: true });
  });

  it('a throw or a rejection rejects and is logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runBeforeCallbackEager(() => { throw new Error('x'); }, {})).toEqual({ isRejected: true });
    await expect(runBeforeCallbackEager(async () => { throw new Error('y'); }, {})).resolves.toEqual({ isRejected: true });
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
