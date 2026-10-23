/**
 * The component context every event detail and every callback `ctx` carries
 * (SPEC §12.5): the component's public `controller` facade and its host
 * `element`. Both are attached **non-enumerable**, so destructuring
 * (`({ controller }) => …`) works while `JSON.stringify`, `Object.keys`,
 * logs and LiveView `pushEvent(…, e.detail)` see only the data.
 */
export interface ComponentContext<C = unknown, E extends HTMLElement = HTMLElement> {
  /** The component's public facade — the same object as `element.controller`. */
  readonly controller: C;
  /** The host element (escape hatch). */
  readonly element: E;
}

/** Keys {@link withComponentContext} owns; a detail / ctx type can't redeclare them. */
export const COMPONENT_CONTEXT_KEYS = ['controller', 'element'] as const;

/** A detail / ctx type without the fields the component context supplies. */
export type WithoutComponentContext<T> = T extends object ? Omit<T, keyof ComponentContext> : T;

/**
 * Attach `controller` + `element` (non-enumerable) and any `extras` (enumerable,
 * e.g. the presentation flags of a popup component) to `target`, in place, and
 * return it. Fields `target` already has are left alone — a detail that sets
 * its own `presentation` wins over the component-wide one. A frozen / sealed
 * `target` is shallow-copied first (the copy is returned).
 */
export function withComponentContext<T extends object, C, E extends HTMLElement>(
  source: T,
  controller: C,
  element: E,
  extras?: object,
): T & ComponentContext<C, E> {
  const target = Object.isExtensible(source) ? source : ({ ...source } as T);
  for (const [key, value] of [['controller', controller], ['element', element]] as const) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      Object.defineProperty(target, key, { value, enumerable: false, configurable: true, writable: true });
    }
  }
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      if (!Object.prototype.hasOwnProperty.call(target, key)) (target as Record<string, unknown>)[key] = value;
    }
  }
  return target as T & ComponentContext<C, E>;
}

/** Context keys a component (not the caller of `emit`) supplies on an event detail. */
type SuppliedContextKey = keyof ComponentContext | 'presentation' | 'isFullscreen' | 'isModal';

/**
 * What `emit()` takes for an event whose detail type is `T`: the detail
 * without the fields the component context supplies (`controller`,
 * `element`, presentation flags) — those may still be passed to override.
 */
export type EmitDetail<T> = T extends object
  ? Omit<T, SuppliedContextKey> & Partial<Pick<T, Extract<keyof T, SuppliedContextKey>>>
  : T;
