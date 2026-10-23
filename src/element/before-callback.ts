/**
 * The one `before*Callback` contract (SPEC §12.5): one `ctx` argument; the
 * return value decides —
 *
 * | returns | meaning |
 * |---|---|
 * | `false` | cancel — nothing continues |
 * | nothing (`undefined`) | continue unchanged |
 * | any other value (incl. `null`) | continue with that value — what it replaces is the hook's documented contract |
 *
 * Unset → continue. A throw cancels (a crashed guard must not let a delete
 * through) and is reported with `console.error`.
 */
export type BeforeCallbackResult<V = unknown> =
  | { readonly isCancelled: true }
  | { readonly isCancelled: false; readonly hasValue: false }
  | { readonly isCancelled: false; readonly hasValue: true; readonly value: V };

type BeforeFn<Ctx> = ((ctx: Ctx) => unknown) | null | undefined;

const CANCELLED = Object.freeze({ isCancelled: true as const });
const CONTINUE = Object.freeze({ isCancelled: false as const, hasValue: false as const });

function interpret<V>(result: unknown): BeforeCallbackResult<V> {
  if (result === false) return CANCELLED;
  if (result === undefined) return CONTINUE;
  return { isCancelled: false, hasValue: true, value: result as V };
}

function report(name: string, error: unknown): void {
  console.error(`[web-components-core] ${name} threw — treated as cancel`, error);
}

/** Run an async-capable `before*Callback` (sync or `Promise` results both work). */
export async function runBeforeCallback<Ctx, V = unknown>(
  fn: BeforeFn<Ctx>,
  ctx: Ctx,
  name = 'before*Callback',
): Promise<BeforeCallbackResult<V>> {
  if (typeof fn !== 'function') return CONTINUE;
  try {
    return interpret<V>(await fn(ctx));
  } catch (error) {
    report(name, error);
    return CANCELLED;
  }
}

/**
 * Run a `before*Callback` that must answer synchronously because its native
 * trigger needs the answer now (`dragstart`, `keydown`). A returned `Promise`
 * is a usage error: warned, and treated as "continue".
 */
export function runBeforeCallbackSync<Ctx, V = unknown>(
  fn: BeforeFn<Ctx>,
  ctx: Ctx,
  name = 'before*Callback',
): BeforeCallbackResult<V> {
  if (typeof fn !== 'function') return CONTINUE;
  try {
    const result = fn(ctx);
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      console.warn(`[web-components-core] ${name} must be synchronous; a returned Promise is ignored (continuing)`);
      return CONTINUE;
    }
    return interpret<V>(result);
  } catch (error) {
    report(name, error);
    return CANCELLED;
  }
}
