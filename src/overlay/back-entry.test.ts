import { describe, it, expect, afterEach } from 'vitest';
import { claimBackEntry } from './back-entry.js';

// jsdom: pushState / back() / popstate are real (back() traverses asynchronously).
const popped = () => new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  await tick(5);
  history.scrollRestoration = 'auto';
});

describe('claimBackEntry (the phone Back gesture for a sheet)', () => {
  it('pushes one entry; Back runs onBack (the entry is gone, nothing popped again)', async () => {
    const start = history.length;
    let backs = 0;
    claimBackEntry(() => backs++);
    expect(history.length).toBe(start + 1);
    expect(history.state).toEqual({ kmBackEntry: true });
    const p = popped();
    history.back();
    await p;
    expect(backs).toBe(1);
  });

  it('a release gives the entry back one task later; its popstate runs no handler', async () => {
    let backs = 0;
    const release = claimBackEntry(() => backs++);
    release();
    release(); // idempotent
    expect(history.state).toEqual({ kmBackEntry: true }); // deferred
    await popped();
    expect(backs).toBe(0);
    expect(history.state).not.toEqual({ kmBackEntry: true });
  });

  it('a claim right after a release adopts the entry (no back(), no second push)', async () => {
    const release = claimBackEntry(() => {});
    release();
    let backs = 0;
    claimBackEntry(() => backs++);
    await tick(5);
    expect(history.state).toEqual({ kmBackEntry: true }); // still ours: the release's back() never ran
    const p = popped();
    history.back();
    await p;
    expect(backs).toBe(1);
    expect(history.state).not.toEqual({ kmBackEntry: true }); // one Back = the page's entry (one push)
  });

  it("re-arming from onBack keeps the sheet's entry (one level up)", async () => {
    let backs = 0;
    const onBack = () => {
      backs++;
      if (backs === 1) claimBackEntry(onBack);
    };
    claimBackEntry(onBack);
    let p = popped();
    history.back();
    await p;
    expect(history.state).toEqual({ kmBackEntry: true }); // re-pushed
    p = popped();
    history.back();
    await p;
    expect(backs).toBe(2);
  });

  it("the page's scrollRestoration is 'manual' while held and its own mode is back afterwards", async () => {
    history.scrollRestoration = 'auto';
    const release = claimBackEntry(() => {});
    expect(history.scrollRestoration).toBe('manual');
    release();
    await popped();
    await tick();
    expect(history.scrollRestoration).toBe('auto');

    claimBackEntry(() => {});
    expect(history.scrollRestoration).toBe('manual');
    const p = popped();
    history.back(); // Back
    await p;
    expect(history.scrollRestoration).toBe('manual'); // still: the browser restores scroll after popstate
    await tick();
    expect(history.scrollRestoration).toBe('auto');
  });
});
