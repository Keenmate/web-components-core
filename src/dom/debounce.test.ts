import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebounce } from './debounce.js';

describe('createDebounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once with the last arguments after the quiet period', () => {
    const fn = vi.fn();
    const d = createDebounce(fn, 100);
    d.schedule('a');
    vi.advanceTimersByTime(60);
    d.schedule('b');
    vi.advanceTimersByTime(60);
    expect(fn).not.toHaveBeenCalled();
    expect(d.isPending).toBe(true);
    vi.advanceTimersByTime(40);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('b');
    expect(d.isPending).toBe(false);
  });

  it('ms <= 0 runs synchronously', () => {
    const fn = vi.fn();
    createDebounce(fn, 0).schedule(1, 2);
    expect(fn).toHaveBeenCalledWith(1, 2);
  });

  it('reads a function delay on every schedule', () => {
    let wait = 0;
    const fn = vi.fn();
    const d = createDebounce(fn, () => wait);
    d.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
    wait = 50;
    d.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('flush runs the pending call now; cancel drops it', () => {
    const fn = vi.fn();
    const d = createDebounce(fn, 100);
    d.schedule('x');
    d.flush();
    expect(fn).toHaveBeenCalledWith('x');
    d.flush();
    expect(fn).toHaveBeenCalledOnce();
    d.schedule('y');
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledOnce();
  });
});
