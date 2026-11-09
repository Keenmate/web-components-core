import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStateStore, stateStorageKey } from './state-store.js';

type S = { width?: number; height?: number };

function host(): HTMLElement {
  const el = document.createElement('web-thing');
  document.body.append(el);
  return el;
}

afterEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe('createStateStore', () => {
  it('off without a storage key: load → null, save writes nothing', async () => {
    const store = createStateStore<S>(host(), { getKey: () => '' });
    await store.save({ width: 10 });
    expect(await store.load()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('default store is localStorage under km-state:<tag>:<key>; save merges into the whole state', async () => {
    const store = createStateStore<S>(host(), { getKey: () => 'a' });
    await store.save({ width: 300 });
    await store.save({ height: 200 });
    expect(JSON.parse(localStorage.getItem(stateStorageKey('web-thing', 'a'))!)).toEqual({ width: 300, height: 200 });
    const fresh = createStateStore<S>(host(), { getKey: () => 'a' });
    expect(await fresh.load()).toEqual({ width: 300, height: 200 });
  });

  it('the key is read per call: a new key loads its own state', async () => {
    let key = 'a';
    localStorage.setItem(stateStorageKey('web-thing', 'b'), JSON.stringify({ width: 7 }));
    const store = createStateStore<S>(host(), { getKey: () => key });
    await store.save({ width: 1 });
    key = 'b';
    expect(await store.load()).toEqual({ width: 7 });
  });

  it('callbacks replace localStorage; they get the component context, the key and the WHOLE state', async () => {
    const saved: unknown[] = [];
    const store = createStateStore<S>(host(), {
      getKey: () => 'k',
      getLoadCallback: () => async ({ key }) => (key === 'k' ? { width: 5 } : null),
      getSaveCallback: () => (ctx) => void saved.push(ctx),
      toContext: (data) => Object.defineProperty({ ...data }, 'controller', { value: 'ctl', enumerable: false }),
    });
    expect(await store.load()).toEqual({ width: 5 });
    await store.save({ height: 9 });
    expect(saved).toEqual([{ key: 'k', state: { width: 5, height: 9 } }]);
    expect((saved[0] as { controller: string }).controller).toBe('ctl'); // the component's context reaches the callback
    expect(localStorage.length).toBe(0);
  });

  it('never throws: a failing callback or a corrupt entry is logged / ignored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(stateStorageKey('web-thing', 'bad'), '{not json');
    expect(await createStateStore<S>(host(), { getKey: () => 'bad' }).load()).toBeNull();
    const store = createStateStore<S>(host(), {
      getKey: () => 'k',
      getLoadCallback: () => () => { throw new Error('offline'); },
      getSaveCallback: () => async () => { throw new Error('offline'); },
    });
    expect(await store.load()).toBeNull();
    await expect(store.save({ width: 1 })).resolves.toBeUndefined();
    expect(await store.load()).toEqual({ width: 1 }); // kept in memory
    warn.mockRestore();
  });

  it('one callback alone still means the host keeps the state: no localStorage, a warning once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved: unknown[] = [];
    localStorage.setItem(stateStorageKey('web-thing', 'k'), JSON.stringify({ width: 99 }));
    const store = createStateStore<S>(host(), { getKey: () => 'k', getSaveCallback: () => (ctx) => void saved.push(ctx.state) });
    expect(await createStateStore<S>(host(), { getKey: () => 'k', getSaveCallback: () => () => {} }).load()).toBeNull(); // not the stale localStorage
    await store.save({ width: 1 });
    await store.save({ height: 2 });
    expect(saved).toEqual([{ width: 1 }, { width: 1, height: 2 }]);
    expect(JSON.parse(localStorage.getItem(stateStorageKey('web-thing', 'k'))!)).toEqual({ width: 99 }); // untouched
    expect(warn.mock.calls.filter((c) => String(c.join(' ')).includes('saveStateCallback is set without loadStateCallback'))).toHaveLength(2); // once per store
    warn.mockRestore();
  });

  it('clear() removes the saved state', async () => {
    const store = createStateStore<S>(host(), { getKey: () => 'a' });
    await store.save({ width: 1 });
    await store.clear();
    expect(localStorage.getItem(stateStorageKey('web-thing', 'a'))).toBeNull();
    expect(await store.load()).toBeNull();
  });
});
