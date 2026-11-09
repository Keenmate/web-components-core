/**
 * Persisted UI state (SPEC §12.17): what the user arranged — a popover's size, column widths /
 * order — kept across page loads. ONE way for every component (rulebook C-CA-17): the input rows
 * `storageKey` (`storage-key`, unset = off), `loadStateCallback`, `saveStateCallback`, and one
 * handle from {@link createStateStore}. Default store: `localStorage['km-state:<tag>:<key>']`; with
 * the callbacks the host keeps it instead (per user, on the server). The component documents its
 * own state shape.
 */
import { coreLog } from '../logging/element-logger.js';

/** `loadStateCallback(ctx)` — the saved state for `ctx.key`, or `null` / `undefined`. May be async. */
export type LoadStateCallback<S> = (ctx: { key: string }) => S | null | undefined | Promise<S | null | undefined>;
/** `saveStateCallback(ctx)` — store `ctx.state` (the whole state) for `ctx.key`. May be async. */
export type SaveStateCallback<S> = (ctx: { key: string; state: S }) => void | Promise<void>;

export interface StateStoreOptions<S> {
  /** The current `storageKey`; empty / `null` = persistence off. Read on every call. */
  getKey(): string | null | undefined;
  /** The current `loadStateCallback` (null → localStorage). */
  getLoadCallback?(): LoadStateCallback<S> | null | undefined;
  /** The current `saveStateCallback` (null → localStorage). */
  getSaveCallback?(): SaveStateCallback<S> | null | undefined;
  /**
   * Wrap the callback data (`{ key }` / `{ key, state }`) in the component's callback context —
   * in a BlissElement `(data) => this.withContext(data)`.
   * Default: the data as is.
   */
  toContext?(data: { key: string; state?: S }): object;
}

export interface StateStore<S> {
  /** The saved state for the current key (`null`: none, off, or unreadable). Cached per key. */
  load(): Promise<S | null>;
  /** Merge `partial` into the state and save the whole of it. No-op when off. */
  save(partial: Partial<S>): Promise<void>;
  /** Forget the saved state for the current key (localStorage entry removed; the callback gets `{}`). */
  clear(): Promise<void>;
}

/** The localStorage entry: `km-state:<tag>:<key>`. */
export function stateStorageKey(tag: string, key: string): string {
  return `km-state:${tag}:${key}`;
}

/**
 * The persisted-state handle of one component instance. Never throws: a failing callback or an
 * unavailable / full / corrupt localStorage is logged and the component keeps working from memory.
 */
export function createStateStore<S extends object>(host: HTMLElement, opts: StateStoreOptions<S>): StateStore<S> {
  const tag = host.localName;
  const log = () => coreLog(host, 'DATA', 'ELEMENT');
  let cache: { key: string; state: S | null } | null = null;
  const currentKey = (): string | null => {
    const key = opts.getKey();
    return typeof key === 'string' && key.length > 0 ? key : null;
  };
  const ctx = (data: { key: string; state?: S }) => (opts.toContext ? opts.toContext(data) : data);

  async function read(key: string): Promise<S | null> {
    const load = opts.getLoadCallback?.();
    if (load) {
      try {
        return ((await load(ctx({ key }) as { key: string })) ?? null) as S | null;
      } catch (err) {
        log().warn('loadStateCallback threw; starting without saved state', err);
        return null;
      }
    }
    try {
      const raw = globalThis.localStorage?.getItem(stateStorageKey(tag, key));
      return raw ? (JSON.parse(raw) as S) : null;
    } catch {
      return null; // no localStorage (private mode, SSR) or a corrupt entry: start fresh
    }
  }

  async function write(key: string, state: S): Promise<void> {
    const save = opts.getSaveCallback?.();
    if (save) {
      try {
        await save(ctx({ key, state }) as { key: string; state: S });
      } catch (err) {
        log().warn('saveStateCallback threw; the state stays in memory', err);
      }
      return;
    }
    try {
      globalThis.localStorage?.setItem(stateStorageKey(tag, key), JSON.stringify(state));
    } catch {
      // quota / private mode: keep working from memory
    }
  }

  return {
    async load() {
      const key = currentKey();
      if (!key) return null;
      if (cache?.key === key) return cache.state;
      const state = await read(key);
      cache = { key, state };
      return state;
    },
    async save(partial) {
      const key = currentKey();
      if (!key) return;
      const current = cache?.key === key ? cache.state : await read(key);
      const next = { ...(current ?? {}), ...partial } as S;
      cache = { key, state: next };
      await write(key, next);
    },
    async clear() {
      const key = currentKey();
      if (!key) return;
      cache = { key, state: null };
      if (opts.getSaveCallback?.()) return write(key, {} as S);
      try {
        globalThis.localStorage?.removeItem(stateStorageKey(tag, key));
      } catch {
        // nothing to remove
      }
    },
  };
}
