/**
 * Call code core doesn't own (a component hook, a page listener, a scheduled task)
 * without letting it throw through core. A throw is logged through the core logger
 * ({@link coreLog}) and reported back, so the caller can finish its own bookkeeping
 * (register an unsubscribe, run the remaining listeners, schedule `ready`) first.
 */

import { coreLog, type CoreLogCategory } from './element-logger.js';

/** Where a caught error is logged: `coreLog(source, category, coreCategory).error(message, error)`. */
export interface SafeCallLog {
  /** The element behind the call (its instance logger), or `null` for core's own logger. */
  source?: unknown;
  category?: string;
  coreCategory?: CoreLogCategory;
  message: string;
}

/** `{ isOk: true, value }` when `fn` returned, `{ isOk: false, error }` when it threw (already logged). */
export type SafeCallResult<T> = { isOk: true; value: T } | { isOk: false; error: unknown };

function logError(log: SafeCallLog, error: unknown): void {
  try {
    coreLog(log.source ?? null, log.category ?? 'UI', log.coreCategory ?? 'ELEMENT').error(log.message, error);
  } catch {
    // Logging must never be the thing that throws.
  }
}

/** Run `fn`; a throw is logged and returned instead of propagating. */
export function callSafely<T>(fn: () => T, log: SafeCallLog): SafeCallResult<T> {
  try {
    return { isOk: true, value: fn() };
  } catch (error) {
    logError(log, error);
    return { isOk: false, error };
  }
}

/**
 * Call every listener with `value`. A throwing listener is logged and skipped, so one
 * bad subscriber can't keep the others from hearing the change. Iterates a copy, so a
 * listener may unsubscribe itself (or others) while being notified.
 */
export function notifyEach<T>(listeners: Iterable<(value: T) => void>, value: T, log: SafeCallLog): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      logError(log, error);
    }
  }
}
