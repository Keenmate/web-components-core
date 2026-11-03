/**
 * Coalescing microtask scheduler (lifted from dropzone). Scheduling the same
 * task reference repeatedly within one tick runs it exactly once on the next
 * microtask — the mechanism BlissElement uses to fold a burst of attribute /
 * property changes into a single reinit/update.
 */
export interface MicrotaskScheduler {
  /** Queue `task` for the next microtask. Repeated identical references coalesce to one run. */
  schedule(task: () => void): void;
  /** Run all pending tasks synchronously now. */
  flush(): void;
  /** Discard pending tasks without running them. */
  cancel(): void;
}

export function createMicrotaskScheduler(): MicrotaskScheduler {
  const tasks = new Set<() => void>();
  let scheduled = false;

  const drain = (): void => {
    scheduled = false;
    const batch = [...tasks];
    tasks.clear();
    // Every task runs even when one throws (a throw used to drop the rest of the
    // batch); the first error is rethrown once the batch is done.
    let firstError: { error: unknown } | undefined;
    for (const task of batch) {
      try {
        task();
      } catch (error) {
        firstError ??= { error };
      }
    }
    if (firstError) throw firstError.error;
  };

  return {
    schedule(task) {
      tasks.add(task);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(drain);
      }
    },
    flush() {
      if (tasks.size > 0) drain();
    },
    cancel() {
      tasks.clear();
      scheduled = false;
    },
  };
}
