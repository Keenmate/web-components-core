/**
 * Typed `CustomEvent` dispatch. Defaults to `bubbles: true`, `composed: false`:
 * a component's events fire on its host and bubble through the page, but one
 * dispatched inside another component's shadow root can't leak out and be
 * mistaken for the outer component's (an editor inside a grid cell).
 */
export interface DispatchOptions {
  bubbles?: boolean;
  composed?: boolean;
  cancelable?: boolean;
}

/**
 * Dispatch a typed `CustomEvent<T>` from `target`. Returns `false` when a
 * cancelable event was `preventDefault()`-ed, mirroring `dispatchEvent`.
 */
export function dispatch<T>(
  target: EventTarget,
  name: string,
  detail?: T,
  opts: DispatchOptions = {},
): boolean {
  return target.dispatchEvent(
    new CustomEvent<T>(name, {
      detail,
      bubbles: opts.bubbles ?? true,
      composed: opts.composed ?? false,
      cancelable: opts.cancelable ?? false,
    }),
  );
}
