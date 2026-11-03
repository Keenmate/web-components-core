import { describe, expect, it } from 'vitest';
import { resolveEnumAttribute } from './resolve-enum-attribute.js';
import { createMicrotaskScheduler } from './microtask-scheduler.js';

describe('resolveEnumAttribute', () => {
  const MODES = ['top', 'bottom'] as const;

  it('matches against the set with a fallback', () => {
    expect(resolveEnumAttribute('top', MODES, 'bottom')).toBe('top');
    expect(resolveEnumAttribute('nope', MODES, 'bottom')).toBe('bottom');
    expect(resolveEnumAttribute(null, MODES, 'bottom')).toBe('bottom');
  });

  it('supports case-insensitive matching', () => {
    expect(resolveEnumAttribute('TOP', MODES, 'bottom', { isCaseInsensitive: true })).toBe('top');
    expect(resolveEnumAttribute('TOP', MODES, 'bottom')).toBe('bottom');
  });
});

describe('createMicrotaskScheduler', () => {
  it('coalesces repeated scheduling of the same task into one run', async () => {
    const scheduler = createMicrotaskScheduler();
    let runs = 0;
    const task = (): void => {
      runs += 1;
    };
    scheduler.schedule(task);
    scheduler.schedule(task);
    scheduler.schedule(task);
    expect(runs).toBe(0);
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    expect(runs).toBe(1);
  });

  it('runs pending work synchronously on flush', () => {
    const scheduler = createMicrotaskScheduler();
    let runs = 0;
    scheduler.schedule(() => {
      runs += 1;
    });
    scheduler.flush();
    expect(runs).toBe(1);
  });

  it('discards pending work on cancel', async () => {
    const scheduler = createMicrotaskScheduler();
    let runs = 0;
    scheduler.schedule(() => {
      runs += 1;
    });
    scheduler.cancel();
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    expect(runs).toBe(0);
  });

  // Review D-05: a throwing task used to drop every task after it in the batch.
  it('a throwing task does not drop the others; the error is rethrown after the batch', () => {
    const scheduler = createMicrotaskScheduler();
    const ran: string[] = [];
    scheduler.schedule(() => ran.push('a'));
    scheduler.schedule(() => {
      throw new Error('task boom');
    });
    scheduler.schedule(() => ran.push('c'));
    expect(() => scheduler.flush()).toThrow('task boom');
    expect(ran).toEqual(['a', 'c']);
  });
});
