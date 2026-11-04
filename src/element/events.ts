/**
 * The event side of the callback/event model (SPEC §12.5). A component declares
 * its outward notifications in a `static events` table; `BlissElement.emit()`
 * attaches the component context, calls the event's `on<Name>` twin property
 * with the detail, and dispatches a typed `CustomEvent` carrying the same
 * object. Listeners use `addEventListener` / `on()`. Contrast with `*Callback`
 * inputs, which shape behavior and whose return value is used.
 */

/**
 * Compile-time map of event name → its `CustomEvent.detail` type, passed as
 * `BlissElement<TEvents>`. Declare it as a `type` alias, not an `interface` —
 * interfaces lack the implicit index signature this `Record` constraint needs.
 */
export type EventMap = Record<string, unknown>;

/** One declared outward event. A bare string is shorthand for `{ name }`. */
export interface EventDef<D = unknown> {
  /** Dispatched name, kebab or bare — e.g. `'select'`, `'date-select'`. */
  name: string;
  /** Phantom detail type carrier; unused at runtime. */
  detail?: D;
  /**
   * The `on*` twin property to install (`el.onSelect = (detail) => …`). Defaults
   * to `on` + PascalCase(name). Set `false` for an event without a twin.
   */
  property?: string | false;
  /** Per-event dispatch overrides (else the `dispatch()` defaults: bubbles, not composed). */
  bubbles?: boolean;
  composed?: boolean;
  cancelable?: boolean;
  /** Human description for docs / editor IntelliSense (CEM tooling, SPEC §12.4). Ignored at runtime. */
  description?: string;
  /** Doc metadata: mark this event deprecated (`true`) or with a reason string. Ignored at runtime. */
  deprecated?: boolean | string;
}

/** An `EventDef` with its property name resolved (`null` = no managed property). */
export interface NormalizedEventDef {
  name: string;
  property: string | null;
  bubbles?: boolean;
  composed?: boolean;
  cancelable?: boolean;
}

/** `date-select` → `DateSelect`; `change` → `Change`. */
function pascal(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

/**
 * The default managed-property name for an event: `on` + PascalCase(name).
 *
 * @internal BlissElement plumbing — exported, but not part of the stable API.
 */
export function defaultEventProperty(name: string): string {
  return `on${pascal(name)}`;
}

/**
 * Expand the `static events` shorthand into resolved defs (property names filled in).
 *
 * @internal BlissElement plumbing — exported, but not part of the stable API.
 */
export function normalizeEventDefs(
  events: readonly (string | EventDef)[] | undefined,
): NormalizedEventDef[] {
  if (!events) return [];
  return events.map((entry) => {
    const def: EventDef = typeof entry === 'string' ? { name: entry } : entry;
    const property = def.property === false ? null : (def.property ?? defaultEventProperty(def.name));
    return { name: def.name, property, bubbles: def.bubbles, composed: def.composed, cancelable: def.cancelable };
  });
}

/**
 * Events core fires for EVERY component, whatever its table declares: `ready`
 * (twin `onReady`, SPEC §6.3) and `input-rejected` (twin `onInputRejected`, SPEC §6).
 * A subclass entry of the same name wins (its property / flags override), so
 * declaring them for docs is harmless.
 */
const CORE_EVENTS: readonly NormalizedEventDef[] = [
  { name: 'ready', property: 'onReady', bubbles: undefined, composed: undefined, cancelable: undefined },
  { name: 'input-rejected', property: 'onInputRejected', bubbles: undefined, composed: undefined, cancelable: undefined },
];

/**
 * Append the {@link CORE_EVENTS} the subclass table doesn't declare itself.
 *
 * @internal BlissElement plumbing — exported, but not part of the stable API.
 */
export function withCoreEvents(events: NormalizedEventDef[]): NormalizedEventDef[] {
  const missing = CORE_EVENTS.filter((core) => !events.some((ev) => ev.name === core.name));
  return missing.length ? [...events, ...missing.map((ev) => ({ ...ev }))] : events;
}
