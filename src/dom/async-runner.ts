/**
 * `createAsyncRunner()` (SPEC §12.22): one "latest request wins" runner for search-as-you-type, lazy
 * options, editor pipelines — the debounce / abort / stale-drop / delayed-loader logic web-multiselect,
 * web-commandpalette, web-grid and web-editor each wrote themselves.
 *
 * - `run(task, onResult)` replaces the previous run: its debounce is dropped, its `AbortSignal` aborts, and
 *   a late answer from it is ignored — only the LATEST run reaches `onResult`.
 * - A synchronous result is handed over at once (after the debounce) and never shows the loader.
 * - The loader (`loadingChangeCallback(true)`) starts with the async task — after `loaderDelayMs` when set, so a
 *   fast answer never flashes it — and stays up while a newer run replaces a loading one (no flicker).
 * - An `AbortError` is never an error (the task gave up on our signal, or its own timeout signal);
 *   any other rejection goes to `errorCallback`, or the logger when there is none.
 */
import { runSafely } from '../logging/safe-call.js';

export interface AsyncRunnerOptions {
  /** Wait this long after the last `run()` before starting the task (`0` = start at once). A function is read per run. */
  debounceMs?: number | (() => number);
  /** Show the loader only when the task is still running after this long. Default `0` (at once). */
  loaderDelayMs?: number;
  /** The loading state changed (one call per change). */
  loadingChangeCallback?(isLoading: boolean): void;
  /** The latest run failed (never for an abort). Without it the error is logged. */
  errorCallback?(error: unknown): void;
  /** The element behind the runner — its logger reports thrown callbacks. */
  logSource?: Element | null;
}

export interface AsyncRunner {
  /** Start `task` (after the debounce), replacing the previous run; `onResult` gets its result if it is still the latest. */
  run<T>(task: (signal: AbortSignal) => T | PromiseLike<T>, onResult: (result: T) => void): void;
  /** Drop the pending / running task (abort it, ignore its result) and turn the loader off — close, disconnect. */
  cancel(): void;
  /** `true` while the loader is shown. */
  readonly isLoading: boolean;
  /** `true` from `run()` until the latest run settles (debounce wait included). */
  readonly isPending: boolean;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  !!value && (typeof value === 'object' || typeof value === 'function') && typeof (value as PromiseLike<unknown>).then === 'function';

const isAbortError = (error: unknown): boolean =>
  !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';

export function createAsyncRunner(opts: AsyncRunnerOptions = {}): AsyncRunner {
  let generation = 0;
  let controller: AbortController | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let loaderTimer: ReturnType<typeof setTimeout> | undefined;
  let isLoading = false;
  let isPending = false;
  const source = opts.logSource ?? null;

  const setLoading = (value: boolean): void => {
    if (value === isLoading) return;
    isLoading = value;
    if (opts.loadingChangeCallback) runSafely(() => opts.loadingChangeCallback!(value), { source, message: 'async runner loadingChangeCallback threw' });
  };

  const stop = (): void => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    if (loaderTimer !== undefined) clearTimeout(loaderTimer);
    debounceTimer = loaderTimer = undefined;
    controller?.abort();
    controller = undefined;
  };

  const settle = (): void => {
    if (loaderTimer !== undefined) clearTimeout(loaderTimer);
    loaderTimer = undefined;
    controller = undefined;
    isPending = false;
    setLoading(false);
  };

  const fail = (error: unknown): void => {
    settle();
    if (isAbortError(error)) return;
    if (opts.errorCallback) runSafely(() => opts.errorCallback!(error), { source, message: 'async runner errorCallback threw' });
    else runSafely(() => { throw error; }, { source, message: 'async task failed' });
  };

  const start = <T>(gen: number, task: (signal: AbortSignal) => T | PromiseLike<T>, onResult: (result: T) => void): void => {
    debounceTimer = undefined;
    const ctrl = new AbortController();
    controller = ctrl;
    const deliver = (value: T): void => {
      settle();
      runSafely(() => onResult(value), { source, message: 'async runner onResult threw' });
    };
    let result: T | PromiseLike<T>;
    try {
      result = task(ctrl.signal);
    } catch (error) {
      fail(error);
      return;
    }
    if (!isThenable(result)) {
      deliver(result);
      return;
    }
    const delay = opts.loaderDelayMs ?? 0;
    if (isLoading || !(delay > 0)) setLoading(true);
    else loaderTimer = setTimeout(() => {
      loaderTimer = undefined;
      if (gen === generation) setLoading(true);
    }, delay);
    const isCurrent = (): boolean => gen === generation && !ctrl.signal.aborted;
    result.then(
      (value) => {
        if (isCurrent()) deliver(value);
      },
      (error: unknown) => {
        if (isCurrent()) fail(error);
      },
    );
  };

  return {
    run(task, onResult) {
      stop();
      const gen = ++generation;
      isPending = true;
      const wait = typeof opts.debounceMs === 'function' ? opts.debounceMs() : (opts.debounceMs ?? 0);
      if (wait > 0) debounceTimer = setTimeout(() => start(gen, task, onResult), wait);
      else start(gen, task, onResult);
    },
    cancel() {
      stop();
      generation++;
      isPending = false;
      setLoading(false);
    },
    get isLoading() {
      return isLoading;
    },
    get isPending() {
      return isPending;
    },
  };
}
