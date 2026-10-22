import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameScheduler } from './frame-scheduler.js';
import { once } from './once.js';
import { createThrottle } from './throttle.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createThrottle', () => {
  it('runs the leading call now and folds the rest of the window into one trailing run', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = createThrottle(fn, 30);
    t.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
    t.schedule();
    t.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('markRun() starts the window without running', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = createThrottle(fn, 30);
    t.markRun();
    t.schedule();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel() drops the trailing run and resets to a leading edge', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = createThrottle(fn, 30);
    t.schedule();
    t.schedule();
    t.cancel();
    vi.advanceTimersByTime(30);
    expect(fn).toHaveBeenCalledTimes(1);
    t.schedule();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('createFrameScheduler', () => {
  it('coalesces to one run per frame, and cancel() drops it', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (frames.set(++id, cb), id));
    vi.stubGlobal('cancelAnimationFrame', (n: number) => frames.delete(n));
    const fn = vi.fn();
    const f = createFrameScheduler(fn);

    f.schedule();
    f.schedule();
    expect(frames.size).toBe(1);
    frames.forEach((cb) => cb(0));
    expect(fn).toHaveBeenCalledTimes(1);

    frames.clear();
    f.schedule();
    f.cancel();
    expect(frames.size).toBe(0);
    f.schedule(); // schedulable again after cancel
    expect(frames.size).toBe(1);
  });

  it('runs synchronously without requestAnimationFrame', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const fn = vi.fn();
    createFrameScheduler(fn).schedule();
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe('once', () => {
  it('runs only the first call', () => {
    const fn = vi.fn();
    const release = once(fn);
    release();
    release();
    expect(fn).toHaveBeenCalledOnce();
  });
});
