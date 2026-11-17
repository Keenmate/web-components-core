import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAsyncRunner } from './async-runner.js';

const deferred = <T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const tick = (): Promise<void> => Promise.resolve().then(() => undefined);

describe('createAsyncRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a synchronous result is delivered at once and never shows the loader', () => {
    const onLoadingChange = vi.fn();
    const runner = createAsyncRunner({ onLoadingChange });
    const onResult = vi.fn();
    runner.run(() => [1, 2], onResult);
    expect(onResult).toHaveBeenCalledWith([1, 2]);
    expect(onLoadingChange).not.toHaveBeenCalled();
    expect(runner.isPending).toBe(false);
  });

  it('async: loader on at once by default, off before the result', async () => {
    const calls: string[] = [];
    const runner = createAsyncRunner({ onLoadingChange: (v) => calls.push(`loading:${v}`) });
    const d = deferred<string>();
    runner.run(() => d.promise, (r) => calls.push(`result:${r}`));
    expect(runner.isLoading).toBe(true);
    d.resolve('x');
    await tick();
    expect(calls).toEqual(['loading:true', 'loading:false', 'result:x']);
    expect(runner.isLoading).toBe(false);
  });

  it('the latest run wins: the previous signal aborts and its late result is dropped', async () => {
    const runner = createAsyncRunner();
    const first = deferred<string>();
    const second = deferred<string>();
    const signals: AbortSignal[] = [];
    const onResult = vi.fn();
    runner.run((s) => (signals.push(s), first.promise), onResult);
    runner.run((s) => (signals.push(s), second.promise), onResult);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    first.resolve('old');
    await tick();
    expect(onResult).not.toHaveBeenCalled();
    second.resolve('new');
    await tick();
    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith('new');
  });

  it('a replaced loading run keeps the loader up (no off/on flicker)', async () => {
    const onLoadingChange = vi.fn();
    const runner = createAsyncRunner({ onLoadingChange, loaderDelayMs: 200 });
    runner.run(() => new Promise(() => {}), () => {});
    vi.advanceTimersByTime(200);
    expect(onLoadingChange.mock.calls).toEqual([[true]]);
    const d = deferred<number>();
    runner.run(() => d.promise, () => {});
    expect(onLoadingChange.mock.calls).toEqual([[true]]);
    d.resolve(1);
    await tick();
    expect(onLoadingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('debounce: only the last run of a burst starts', () => {
    const runner = createAsyncRunner({ debounceMs: 250 });
    const task = vi.fn((_s: AbortSignal) => 'r');
    const onResult = vi.fn();
    runner.run(() => task(new AbortController().signal) + '1', onResult);
    runner.run(() => task(new AbortController().signal) + '2', onResult);
    expect(task).not.toHaveBeenCalled();
    expect(runner.isPending).toBe(true);
    vi.advanceTimersByTime(250);
    expect(task).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith('r2');
  });

  it('loaderDelayMs: a fast answer never shows the loader', async () => {
    const onLoadingChange = vi.fn();
    const runner = createAsyncRunner({ onLoadingChange, loaderDelayMs: 200 });
    const d = deferred<number>();
    const onResult = vi.fn();
    runner.run(() => d.promise, onResult);
    vi.advanceTimersByTime(100);
    d.resolve(1);
    await tick();
    vi.advanceTimersByTime(500);
    expect(onLoadingChange).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(1);
  });

  it('errors go to onError; an AbortError never does', async () => {
    const onError = vi.fn();
    const runner = createAsyncRunner({ onError });
    const boom = new Error('boom');
    runner.run(() => Promise.reject(boom), () => {});
    await tick();
    await tick();
    expect(onError).toHaveBeenCalledWith(boom);
    expect(runner.isLoading).toBe(false);
    onError.mockClear();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    runner.run(() => Promise.reject(abort), () => {});
    await tick();
    await tick();
    runner.run(() => { throw abort; }, () => {});
    expect(onError).not.toHaveBeenCalled();
    expect(runner.isLoading).toBe(false);
  });

  it('a synchronous throw goes to onError too', () => {
    const onError = vi.fn();
    const runner = createAsyncRunner({ onError });
    runner.run(() => { throw new Error('sync'); }, () => {});
    expect(onError).toHaveBeenCalledOnce();
  });

  it('cancel() aborts, drops the result and the pending debounce, loader off', async () => {
    const onLoadingChange = vi.fn();
    const runner = createAsyncRunner({ onLoadingChange });
    const d = deferred<number>();
    let signal!: AbortSignal;
    const onResult = vi.fn();
    runner.run((s) => ((signal = s), d.promise), onResult);
    runner.cancel();
    expect(signal.aborted).toBe(true);
    expect(runner.isLoading).toBe(false);
    expect(onLoadingChange.mock.calls).toEqual([[true], [false]]);
    d.resolve(1);
    await tick();
    expect(onResult).not.toHaveBeenCalled();

    const debounced = createAsyncRunner({ debounceMs: 100 });
    const task = vi.fn(() => 1);
    debounced.run(task, onResult);
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(task).not.toHaveBeenCalled();
    expect(debounced.isPending).toBe(false);
  });

  it('a throwing onResult is logged, the runner keeps working', () => {
    const runner = createAsyncRunner();
    runner.run(() => 1, () => { throw new Error('consumer'); });
    const onResult = vi.fn();
    runner.run(() => 2, onResult);
    expect(onResult).toHaveBeenCalledWith(2);
  });
});
