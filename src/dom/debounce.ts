/**
 * Trailing debounce: `schedule(...args)` (re)starts the wait; `fn` runs once with the LAST arguments
 * when `ms` passes without another call. `ms <= 0` runs `fn` synchronously (a `searchDebounce` of 0
 * means "no debounce"). `ms` may be a function, read on every `schedule()` — for a delay that is
 * itself a live input.
 */
export interface Debounce<A extends unknown[]> {
  /** (Re)start the wait with these arguments; a pending run is replaced. */
  schedule(...args: A): void;
  /** Run a pending call now (no-op when nothing is pending). */
  flush(): void;
  /** Drop a pending call without running it — call it on teardown. */
  cancel(): void;
  /** `true` while a call is waiting. */
  readonly isPending: boolean;
}

export function createDebounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number | (() => number),
): Debounce<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  const run = (): void => {
    const args = pending!;
    timer = undefined;
    pending = undefined;
    fn(...args);
  };
  return {
    schedule(...args) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = args;
      const wait = typeof ms === 'function' ? ms() : ms;
      if (!(wait > 0)) {
        run();
        return;
      }
      timer = setTimeout(run, wait);
    },
    flush() {
      if (timer === undefined) return;
      clearTimeout(timer);
      run();
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
    get isPending() {
      return timer !== undefined;
    },
  };
}
