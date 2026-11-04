/**
 * `BlissElement` — the reactive base class. SSR-safe (the `typeof HTMLElement`
 * stub every repo used to copy), it wires attributes AND properties through the
 * one {@link resolveFromAttribute}/{@link resolveFromProperty} pipeline, folds
 * bursts into a single {@link reinit}/{@link update}, and reflects when asked.
 * Lifecycle follows a build-once + activate/deactivate model: {@link reinit}
 * builds structure (first connect + `on:'reinit'` changes), while
 * {@link connect}/{@link disconnect} start and stop live resources on every
 * connect/disconnect — a plain DOM move re-activates without rebuilding.
 * The input table is OPT-IN: a subclass without `static inputs` still gets the
 * SSR base plus `emit` / the lifecycle (every KeenMate component has a table today).
 * See docs/SPEC.md §6.
 */
import { resolveFromAttribute, resolveFromProperty, type Resolved } from '../inputs/apply.js';
import { deriveClearableKeys } from '../inputs/clearable.js';
import { collectEngineConfig } from '../inputs/engine-config.js';
import type { AttrReader, InputDef } from '../inputs/types.js';

/** A reader for "no attribute present" — probing a converter's absent value. */
const ABSENT_ATTRIBUTES: AttrReader = { getAttribute: () => null, hasAttribute: () => false };

/** Same value: identical, or arrays / plain objects with the same JSON (a fresh `[]` equals `[]`). */
function isSameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function describeValue(value: unknown): string {
  if (typeof value === 'function') return 'a function';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
import { createMicrotaskScheduler, type MicrotaskScheduler } from '../dom/microtask-scheduler.js';
import {
  classifyDevice,
  getEnvironment,
  observeEnvironment,
  observeViewport,
  type EnvironmentSnapshot,
} from '../environment/environment.js';
import { observeElementSize, type ElementSize } from '../environment/element-size.js';
import {
  observeThemeContext,
  THEME_CONTEXT_ATTRIBUTE,
  THEME_SOURCE_ATTRIBUTE,
  type ColorScheme,
  type ThemeSource,
} from '../environment/theme.js';
import {
  adoptMotionStyles,
  isMotion,
  MOTION_ATTRIBUTE,
  MOTION_DATA_ATTRIBUTE,
  MOTION_VALUES,
  publishMotionHook,
  type Motion,
} from '../environment/motion.js';
import { trackInstance, untrackInstance } from '../global/instances.js';
import { sharedState, sharedStateKey } from '../global/shared-state.js';
import { coreLog, getElementLoggers, setInstanceLogLevelSource } from '../logging/element-logger.js';
import type { InstanceLogger, LogLevelDesc } from '../logging/create-loggers.js';
import { DEFAULT_ENABLED_LEVEL, LOG_LEVELS, isLogLevel, toLogLevelNumber } from '../logging/log-core.js';
import { dispatch, type DispatchOptions } from './dispatch.js';
import { withComponentContext, type ComponentContext, type EmitDetail } from './context.js';
import {
  normalizeEventDefs,
  withCoreEvents,
  type EventDef,
  type EventMap,
  type NormalizedEventDef,
} from './events.js';
import {
  hasPageRules,
  isResponsiveMap,
  onResponsiveChange,
  RESPONSIVE_MAP_AXES,
  readPageRules,
  responsiveValueEqual,
  RESPONSIVE_ATTRIBUTE,
  RESPONSIVE_RESERVED_KEYS,
  type ResponsiveCallback,
  type ResponsiveContext,
  type ResponsiveMap,
  type ResponsiveMapAxis,
} from './responsive.js';

/**
 * A plain-object event detail is shallow-copied before `emit()` attaches the component
 * context, so the caller's object (a cached value, a data row) never gains the context
 * fields or a stale copy of them (review I-03). The copy keeps every own property
 * descriptor — non-enumerable fields and getters an engine already attached survive.
 * Arrays and class instances are left as they are (a copy would lose their type).
 */
function copyPlainDetail(detail: object): object {
  const proto = Object.getPrototypeOf(detail);
  if (proto !== Object.prototype && proto !== null) return detail;
  return Object.create(proto, Object.getOwnPropertyDescriptors(detail));
}

/**
 * Native event names that are `composed` — fired inside a shadow root they
 * also reach the host's listeners, so a component event must never reuse one
 * (rulebook C-NC-2).
 */
const COMPOSED_NATIVE_EVENT = /^(click|dblclick|auxclick|contextmenu|focus|blur|focusin|focusout|keydown|keyup|keypress|beforeinput|input|copy|cut|paste|drop|wheel|(pointer|mouse|touch|drag|composition)[a-z]*)$/;

const Base = (typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown)) as typeof HTMLElement;

/** Constructors whose input table has already been sanity-checked (once per class). */
const VALIDATED = new WeakSet<object>();

/** Shared empty set for elements without an input table (opt-in). */
const EMPTY_SET: ReadonlySet<string> = new Set();

/** Global attribute holding the first build until {@link BlissElement.release} (SPEC §6.3). */
export const DEFER_ATTRIBUTE = 'defer';
/** Host attribute (and `:state(ready)` custom state) set once the first build is live (SPEC §6.3). */
export const READY_ATTRIBUTE = 'ready';
/** The core-provided event fired once the first build is live; twin `onReady`. */
const READY_EVENT = 'ready';

/**
 * The properties core declares on every element (besides the input table), in ONE
 * place: `observedAttributes`, {@link BlissElement.setAttributes} (by property or
 * attribute name), and the pre-upgrade lift (a value assigned before the element
 * upgraded) are all derived from it. A subclass that declares the same name as its
 * own input owns it instead. Each attribute's reaction lives in `attributeChangedCallback`.
 */
const CORE_PROPERTIES: ReadonlyArray<{
  property: string;
  attribute?: string;
  /** The setter writes the attribute and lets attributeChangedCallback apply it. */
  isAttributeRouted?: boolean;
}> = [
  { property: 'themeSource', attribute: THEME_SOURCE_ATTRIBUTE, isAttributeRouted: true }, // SPEC §12.10
  { property: 'shouldDefer', attribute: DEFER_ATTRIBUTE }, // SPEC §6.3
  { property: 'responsive', attribute: RESPONSIVE_ATTRIBUTE }, // SPEC §6.7
  { property: 'responsiveCallback' }, // SPEC §6.7
  { property: 'motion', attribute: MOTION_ATTRIBUTE, isAttributeRouted: true }, // SPEC §12.16
];

/** The `on` values an input row may declare. */
const REACTIVITY_VALUES: ReadonlySet<unknown> = new Set(['update', 'reinit', 'none']);

/** {@link CORE_PROPERTIES} by property or attribute name → the property it assigns. */
const CORE_PROPERTY_BY_KEY: ReadonlyMap<string, string> = new Map(
  CORE_PROPERTIES.flatMap(({ property, attribute }) => [
    [property, property] as const,
    ...(attribute ? [[attribute, property] as const] : []),
  ]),
);


export abstract class BlissElement<TEvents extends EventMap = EventMap, TController = unknown> extends Base {
  /** The opt-in input table. Subclasses set this to enable attribute/property reactivity. */
  protected static inputs?: readonly InputDef[];

  /**
   * The opt-in event table (SPEC §12.5). Each entry (a bare name, or an
   * {@link EventDef} for overrides) declares an outward notification that
   * {@link emit} can fire and installs a managed `on<Name>` handler property.
   */
  protected static events?: readonly (string | EventDef)[];

  /**
   * Mirror the shared theme context onto the host as `data-context-theme`
   * (SPEC §12.10). On by default; a subclass that doesn't theme by color scheme
   * sets `static hasThemeContext = false` to skip the subscription entirely.
   */
  protected static hasThemeContext = true;

  static get observedAttributes(): string[] {
    const attrs = (this.inputs ?? []).filter((d) => d.attribute).map((d) => d.attribute!);
    // Always observe the global `dir` attribute (never an input) so a runtime
    // writing-direction switch reaches the directionChanged() hook, plus the
    // attributes of the core-declared properties (CORE_PROPERTIES). Deduped in case
    // a subclass declares one as an input attribute.
    const core = CORE_PROPERTIES.flatMap((p) => (p.attribute ? [p.attribute] : []));
    for (const global of ['dir', ...core]) {
      if (!attrs.includes(global)) attrs.push(global);
    }
    return attrs;
  }

  /** The EFFECTIVE config — {@link #base} with the responsive overrides applied (SPEC §6.7). */
  readonly #config: Record<string, unknown> = {};
  /** The BASE config: defaults + attributes + properties + batch values, no responsive override. */
  readonly #base: Record<string, unknown> = {};
  /**
   * configKeys set explicitly on this instance — attribute present or property
   * assigned (persistent, unlike the per-batch {@link #explicitKeys}). Removing the
   * attribute clears it. An explicit key beats the page responsive rules.
   */
  readonly #explicit = new Set<string>();
  /** The instance responsive map (`el.responsive` / the `responsive` attribute). */
  #responsiveMap?: ResponsiveMap;
  /** The instance responsive callback (`el.responsiveCallback`). */
  #responsiveCallback?: ResponsiveCallback;
  /** Validated keys the instance rules (map → callback) returned at the last evaluation. */
  #ruleInstance: Record<string, unknown> = {};
  /** Validated keys the page rules (global → per-tag) returned at the last evaluation. */
  #rulePage: Record<string, unknown> = {};
  /** An instance rule returned `null` — the page rules are ignored. */
  #isRuleOptOut = false;
  /** Unsubscribe from page-rule change notifications; set while connected. */
  #responsiveUnsub?: () => void;
  /** Unsubscribe from the environment for the rules; set while connected AND some rule layer is set. */
  #responsiveEnvUnsub?: () => void;
  /**
   * Unsubscribe from the CONTINUOUS viewport channel; set while connected AND some
   * callback layer applies (a callback may read `env.viewportWidth`; maps can't).
   */
  #responsiveViewportUnsub?: () => void;
  /** Responsive warnings already logged (each once per element). */
  #responsiveWarned?: Set<string>;
  readonly #byConfigKey = new Map<string, InputDef>();
  readonly #byAttribute = new Map<string, InputDef>();
  #clearableKeys: ReadonlySet<string> = EMPTY_SET;
  readonly #eventsByName = new Map<string, NormalizedEventDef>();
  /** The `on<Name>` twin currently assigned per event, keyed by event name. */
  readonly #eventHandlers = new Map<string, (detail: unknown) => void>();
  /** Memoized {@link controller}; `#hasController` distinguishes "not built yet" from an `undefined` facade. */
  #controller?: TController;
  #hasController = false;
  readonly #scheduler: MicrotaskScheduler = createMicrotaskScheduler();
  readonly #boundFlush = (): void => this.#flush();
  #pending: Record<string, unknown> | null = null;
  #pendingReinit = false;
  /**
   * configKeys set explicitly (property or attribute) since the last flush.
   * A `getBatchValuesCallback` value never overrides one of these (SPEC §6.2).
   */
  #explicitKeys: Set<string> | null = null;
  /**
   * Batch values staged before the first connect, reflected at that connect's
   * flush. Reflecting during upgrade would make the browser run the element's
   * pending attribute reactions inside our reflect guard — swallowing the
   * initial attribute replay (`edit-trigger="click"` lost to the batch value).
   */
  #deferredReflect: Set<InputDef> | null = null;
  #settleResolvers: Array<() => void> = [];
  #connectedOnce = false;
  /**
   * configKeys that carried a value assigned BEFORE the element was upgraded
   * (`el.foo = …` before its class was defined). The browser fires the initial
   * `attributeChangedCallback`s AFTER the constructor, so without this an initial
   * attribute would clobber that lifted property. We let the pre-upgrade property
   * win over the *initial* attribute (the conventional lazy-property-upgrade
   * guarantee). Keyed by configKey → the attribute value present at upgrade: only
   * that ONE replay (old value `null`, same value) is skipped, so a real
   * `setAttribute()` made later — even before the first connect — still applies.
   * Cleared on first connect.
   */
  #preUpgradeKeys: Map<string, string> | null = null;
  /**
   * The attribute core is writing itself right now (reflection / write-back), so its
   * `attributeChangedCallback` doesn't feed back in. Only THAT name is skipped: a write
   * made during upgrade drains the browser's queued replay of the other initial
   * attributes inside the same call, and those must still be processed.
   */
  #reflectingAttribute: string | null = null;
  /**
   * The partial of an `update()` that threw. Kept apart from `#pending` (like
   * `#hasFailedReinit`) so {@link whenSettled} doesn't wait on a flush nothing
   * schedules; merged into the next flush's partial.
   */
  #failedPartial: Record<string, unknown> | null = null;
  /** `reinit()` / `update()` is running — a nested flush is a no-op (see #flush). */
  #isApplying = false;
  /** `connect()` ran and `disconnect()` hasn't yet — keeps the two balanced when a build throws. */
  #isActive = false;
  /**
   * The last `reinit()` threw, so the structure may be missing or half-built.
   * The next flush rebuilds instead of patching. Separate from `#pendingReinit`
   * so a failed build doesn't leave {@link whenSettled} waiting on a flush that
   * nothing schedules.
   */
  #hasFailedReinit = false;
  /** A `reinit()` has succeeded at least once — `getLiveValue` getters read live state from now on. */
  #hasBuilt = false;
  /** {@link destroy} ran — the element is inert for good (SPEC §6.5). */
  #isDestroyed = false;
  /** Cancels the pending post-disconnect removal check (see {@link removedCallback}); set only while one is scheduled. */
  #cancelRemovalCheck?: () => void;
  /** Unsubscribe from the environment observable; set only while connected AND `environmentChanged` is overridden. */
  #envUnsub?: () => void;
  /** Unsubscribe from the throttled viewport observable; set only while connected AND `viewportChanged` is overridden. */
  #viewportUnsub?: () => void;
  /** Unsubscribe from the per-element ResizeObserver; set only while connected AND `sizeChanged` is overridden. */
  #sizeUnsub?: () => void;
  /** Where this element reads its theme from (SPEC §12.10); `null` = the page. */
  #themeSource: ThemeSource = null;
  /** Unsubscribe from the theme context; set only while connected AND `hasThemeContext` is on. */
  #themeUnsub?: () => void;
  /** The instance motion level (SPEC §12.16); `auto` = follow the page. */
  #motion: Motion = 'auto';
  /** Core wrote `data-motion` — so it may remove it (an author-written one is left alone). */
  #hasAppliedMotion = false;
  #internals?: ElementInternals;
  /**
   * The `defer` gate no longer holds (SPEC §6.3): {@link release} was called, the
   * attribute was removed, or the first build started. Latched — re-adding
   * `defer` afterwards never re-holds.
   */
  #isReleased = false;
  /** `el.shouldDefer` assigned before upgrade — applied as the `defer` attribute at first connect. */
  #preUpgradeDefer?: boolean;
  /** The first build is live and `ready` was announced (once per element lifetime). */
  #isReady = false;
  /** {@link #announceReady} is queued (first build live; fires on the next microtask). */
  #isReadyScheduled = false;
  #readyResolvers: Array<() => void> = [];
  /** Last `formDisabledCallback` value — the browser's combined (own attribute OR fieldset) state. */
  #browserDisabledState = false;
  /** formDisabledCallback ran at least once — {@link #browserDisabledState} is the browser's answer. */
  #hasBrowserDisabledState = false;
  /** {@link isEffectivelyDisabled} as of the last flush — `undefined` before the first build. */
  #lastEffectiveDisabled?: boolean;
  #logLevel?: LogLevelDesc;
  /** `this.log` for a tag with no bundle: every category → `CORE:ELEMENT` (built once). */
  #coreLogProxy?: Record<string, InstanceLogger>;

  constructor() {
    super();
    // Messages core logs on this element's behalf honour its enableLogging() override.
    setInstanceLogLevelSource(this, () => this.#logLevel);
    const ctor = this.constructor as typeof BlissElement;
    const defs = ctor.inputs ?? [];
    const events = withCoreEvents(normalizeEventDefs(ctor.events));
    this.#validateOnce(defs, events);
    for (const def of defs) {
      this.#byConfigKey.set(def.configKey, def);
      if (def.attribute) this.#byAttribute.set(def.attribute, def);
    }
    for (const ev of events) this.#eventsByName.set(ev.name, ev);
    if (defs.length) this.#clearableKeys = deriveClearableKeys(defs);
    this.#seedDefaults(defs);
    this.#installAccessors(defs);
    this.#installEventAccessors(events);
    // Core-declared properties assigned before upgrade (an own property shadowing the
    // accessor): re-apply through the accessor. A subclass input of the same name owns it.
    for (const { property, attribute, isAttributeRouted } of CORE_PROPERTIES) {
      if (this.#byConfigKey.has(property)) continue;
      const pre = this.#liftPreUpgrade(property);
      if (!pre.had) continue;
      if (property === 'shouldDefer') {
        this.#preUpgradeDefer = !!pre.value; // read at the first connect
        continue;
      }
      (this as unknown as Record<string, unknown>)[property] = pre.value;
      // A setter that routes through its attribute (motion, theme-source) wrote it from
      // inside the constructor, where the browser queues no attributeChangedCallback
      // (the element isn't "custom" yet) — apply the attribute now.
      const raw = isAttributeRouted && attribute ? this.getAttribute(attribute) : null;
      if (attribute && raw !== null) this.attributeChangedCallback(attribute, null, raw);
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  attributeChangedCallback(name: string, old: string | null, raw: string | null): void {
    if (name === this.#reflectingAttribute) return;
    // Global `dir` is observed for every component (not an input). Route runtime
    // changes to the directionChanged() hook — but only post-connect: the initial
    // attribute is consumed by the first build, and firing before connect would
    // hit a not-yet-built component. Skip this when a subclass has (unusually)
    // declared `dir` as its own input attribute — then it takes the normal input
    // path below, matching the dedup in observedAttributes.
    if (name === 'dir' && !this.#byAttribute.has('dir')) {
      if (this.#connectedOnce && !this.#isDestroyed) this.directionChanged(this.isRtl);
      return;
    }
    // Global `theme-source` (SPEC §12.10): re-resolve the source when connected.
    if (name === THEME_SOURCE_ATTRIBUTE && !this.#byAttribute.has(THEME_SOURCE_ATTRIBUTE)) {
      this.#themeSource = raw || null;
      this.#resubscribeTheme();
      return;
    }
    // Global `defer` (SPEC §6.3): removing it releases the held first build.
    // Before the first connect the gate is read at that connect, so nothing to do.
    if (name === DEFER_ATTRIBUTE && !this.#byAttribute.has(DEFER_ATTRIBUTE)) {
      if (raw === null && this.#connectedOnce) this.release();
      return;
    }
    // Global `responsive` (SPEC §6.7): the instance responsive map as JSON.
    if (name === RESPONSIVE_ATTRIBUTE && !this.#byAttribute.has(RESPONSIVE_ATTRIBUTE)) {
      this.#setResponsiveFromAttribute(raw);
      return;
    }
    // Global `motion` (SPEC §12.16): invalid → warn, keep the previous level and write it back.
    if (name === MOTION_ATTRIBUTE && !this.#byAttribute.has(MOTION_ATTRIBUTE)) {
      if (raw === null || isMotion(raw)) {
        this.#motion = raw ?? 'auto';
      } else {
        this.#warn(`rejected invalid value for attribute ${MOTION_ATTRIBUTE}="${raw}" (expected ${MOTION_VALUES.join(' | ')}); keeping "${this.#motion}"`);
        this.#withoutReflect(MOTION_ATTRIBUTE, () => {
          if (this.#motion === 'auto') this.removeAttribute(MOTION_ATTRIBUTE);
          else this.setAttribute(MOTION_ATTRIBUTE, this.#motion);
        });
      }
      this.#applyMotion();
      return;
    }
    const def = this.#byAttribute.get(name);
    if (!def) return;
    // A property assigned before upgrade wins over the initial attribute the
    // browser replays right after the constructor (see #preUpgradeKeys) — that replay only.
    const replayed = this.#preUpgradeKeys?.get(def.configKey);
    if (replayed !== undefined && old === null && raw === replayed) {
      this.#preUpgradeKeys!.delete(def.configKey);
      return;
    }
    let isInvalid = false;
    let reason: string | undefined;
    let resolved: Resolved;
    try {
      resolved = resolveFromAttribute(def, raw, this as unknown as AttrReader, (r) => {
        isInvalid = true;
        reason ??= r;
      });
    } catch (err) {
      this.#warn(`converter for "${def.configKey}" threw parsing attribute ${name}="${raw}"; keeping previous value`, err);
      this.#restoreAttribute(def);
      return;
    }
    if (isInvalid) {
      // Same rule as the property path: warn, keep the current value (the default
      // before any valid value), stage nothing — and it isn't an explicit write, so
      // a batch value (getBatchValuesCallback) may still set this input.
      this.#warn(
        `rejected invalid value for attribute ${name}="${raw}"${reason ? ` (${reason})` : ''}; keeping previous value`,
        this.#config[def.configKey],
      );
      this.#restoreAttribute(def);
      return;
    }
    // Persistent "explicitly set": attribute present; removing it hands the input
    // back to its default AND to the page responsive rules (SPEC §6.7).
    if (raw === null) this.#explicit.delete(def.configKey);
    else this.#explicit.add(def.configKey);
    this.#stageExplicit(def, resolved);
  }

  /**
   * After a rejected attribute value: a reflected input writes its current value
   * back, so the DOM shows what the element uses. Non-reflected inputs leave the
   * author's markup alone. Before the first connect it waits for that connect's
   * flush (reflecting mid-upgrade would swallow the initial attribute replay).
   */
  #restoreAttribute(def: InputDef): void {
    if (!def.shouldReflect) return;
    if (this.#connectedOnce) this.#reflect(def, this.#base[def.configKey]);
    else (this.#deferredReflect ??= new Set()).add(def);
  }

  connectedCallback(): void {
    if (this.#isDestroyed) {
      // Destroyed elements stay inert: no rebuild, no connect(), no subscriptions.
      coreLog(this, 'INIT', 'ELEMENT').warn(`<${this.localName}> was destroyed — reconnecting it does nothing; create a new element instead`);
      return;
    }
    // Track the live instance for the window.components registry (SPEC §12.3),
    // before any build so a devtools overlay sees it even mid-reinit.
    trackInstance(this.localName, this);
    // Reconnected before the removal check ran → a DOM move, not a removal.
    this.#cancelRemovalCheck?.();
    this.#cancelRemovalCheck = undefined;
    // Motion (SPEC §12.16): presets in the root this element lives in; follow the page level.
    adoptMotionStyles(this);
    publishMotionHook(); // the page level goes on <html>, not on this host (closest wins)
    this.#applyMotion();
    // Page responsive rules changing reach this element while it is connected.
    if (this.#hasInputs() && !this.#responsiveUnsub) {
      this.#responsiveUnsub = onResponsiveChange((tag) => {
        if (tag === undefined || tag === this.localName) this.#refreshResponsive();
      });
    }
    if (!this.#connectedOnce) {
      // A pre-upgrade `el.shouldDefer = …` becomes the attribute now (the constructor may
      // not touch attributes); the gate is read by the flush below.
      if (this.#preUpgradeDefer !== undefined) this.toggleAttribute(DEFER_ATTRIBUTE, this.#preUpgradeDefer);
      this.#preUpgradeDefer = undefined;
      this.#connectedOnce = true;
      // The pre-upgrade window is over; the initial-attribute guard is no longer
      // needed and later setAttribute()s react normally.
      this.#preUpgradeKeys = null;
      // First connect is always a full build — there is nothing to patch yet.
      this.#pendingReinit = true;
    }
    this.#flushNow(); // reinit()/update() for any pending config, THEN activate
    this.#activate();
  }

  /**
   * Start the live side: `connect()` plus the opt-in subscriptions. Runs after a
   * successful flush only — if `reinit()` threw, the element stays inactive until
   * a later flush rebuilds it.
   */
  #activate(): void {
    if (this.#isDestroyed || this.#isActive || !this.isConnected || this.#isHeld()) return;
    this.#isActive = true;
    // Every step runs even when an earlier one throws: a throwing connect() or first
    // environmentChanged() must not leave the remaining subscriptions unmade or `ready`
    // never announced. The first error is rethrown at the end (to whoever connected /
    // flushed), the same contract as a throwing reinit(). A destroy() from inside a
    // step stops the rest — destroy() already tore down what had started.
    let firstError: { error: unknown } | undefined;
    const step = (run: () => void): boolean => {
      if (this.#isDestroyed) return false;
      try {
        run();
      } catch (error) {
        firstError ??= { error };
      }
      return !this.#isDestroyed;
    };
    if (!step(() => this.connect())) return this.#rethrow(firstError);
    // Subscribe to device/viewport/orientation ONLY when the subclass opts in by
    // overriding environmentChanged — no global listeners for elements that don't
    // care. The subscribe fires immediately, so the hook gets the current snapshot
    // on connect, then again on every change until disconnect.
    if (this.environmentChanged !== BlissElement.prototype.environmentChanged) {
      if (!step(() => (this.#envUnsub = observeEnvironment((env) => this.environmentChanged(env), { shouldFireImmediately: false })))) return this.#rethrow(firstError);
      if (!step(() => this.environmentChanged(getEnvironment()))) return this.#rethrow(firstError);
    }
    // Same opt-in gate for the throttled continuous-viewport channel — a separate
    // subscription so an element pays the ~30ms size stream only if it overrides
    // viewportChanged, not merely environmentChanged.
    if (this.viewportChanged !== BlissElement.prototype.viewportChanged) {
      if (!step(() => (this.#viewportUnsub = observeViewport((env) => this.viewportChanged(env), { shouldFireImmediately: false })))) return this.#rethrow(firstError);
      if (!step(() => this.viewportChanged(getEnvironment()))) return this.#rethrow(firstError);
    }
    // Per-element size (own box, via a shared ResizeObserver) — same opt-in gate.
    // shouldFireImmediately: false so the first fire carries the real laid-out box (RO's initial
    // delivery), not a 0×0 read taken before layout during connect.
    if (this.sizeChanged !== BlissElement.prototype.sizeChanged) {
      if (!step(() => (this.#sizeUnsub = observeElementSize(this, (size) => this.sizeChanged(size), { shouldFireImmediately: false })))) return this.#rethrow(firstError);
    }
    if (!step(() => this.#subscribeTheme())) return this.#rethrow(firstError);
    if (!this.#isReady && !this.#isReadyScheduled) {
      // Announce on a microtask, not synchronously (SPEC §6.3): an element built
      // during upgrade (createElement of a defined tag, `define()` after parsing,
      // an import) would otherwise fire `ready` before the caller's next line
      // could `addEventListener('ready', …)`. A microtask (not rAF) so it never
      // stalls in a hidden tab / SSR-ish env and stays before the next paint.
      this.#isReadyScheduled = true;
      queueMicrotask(() => {
        if (!this.#isDestroyed) this.#announceReady();
      });
    }
    this.#rethrow(firstError);
  }

  /** Rethrow a hook error collected while finishing a multi-step operation. */
  #rethrow(collected: { error: unknown } | undefined): void {
    if (collected) throw collected.error;
  }

  /**
   * First build is live (built + `connect()` ran): set the `ready` attribute and
   * `:state(ready)`, fire `ready` (+ `onReady`), resolve {@link whenReady}. Once
   * per element lifetime — a rebuild or reconnect never re-announces.
   */
  #announceReady(): void {
    this.#isReady = true;
    this.#withoutReflect(READY_ATTRIBUTE, () => this.setAttribute(READY_ATTRIBUTE, ''));
    try {
      this.internals?.states?.add(READY_ATTRIBUTE);
    } catch {
      // CustomStateSet unavailable, or an older engine that only accepts `--dashed`
      // idents — the `ready` attribute is the portable hook then.
    }
    const resolvers = this.#readyResolvers;
    this.#readyResolvers = [];
    try {
      this.emit(READY_EVENT as keyof TEvents & string);
    } finally {
      for (const resolve of resolvers) resolve();
    }
  }

  /** The `defer` gate holds the first build (SPEC §6.3). */
  #isHeld(): boolean {
    return !this.#isReleased && !this.#byAttribute.has(DEFER_ATTRIBUTE) && this.hasAttribute(DEFER_ATTRIBUTE);
  }

  disconnectedCallback(): void {
    if (this.#isDestroyed) return; // destroy() already stopped everything
    untrackInstance(this.localName, this);
    this.#stopResponsive();
    this.#scheduleRemovalCheck();
    this.#deactivate();
  }

  /** Stop the live side: the opt-in subscriptions, then `disconnect()` if `connect()` ran. */
  #deactivate(): void {
    this.#envUnsub?.();
    this.#envUnsub = undefined;
    this.#viewportUnsub?.();
    this.#viewportUnsub = undefined;
    this.#sizeUnsub?.();
    this.#sizeUnsub = undefined;
    this.#themeUnsub?.();
    this.#themeUnsub = undefined;
    if (!this.#isActive) return; // connect() never ran (its build threw)
    this.#isActive = false;
    this.disconnect();
  }

  /**
   * Opt-in (only when {@link removedCallback} is overridden — no timers for the
   * rest): after a disconnect, wait one animation frame and fire the hook if the
   * element is still detached. A synchronous DOM move (disconnect → connect in
   * the same task) cancels the check in `connectedCallback`. rAF doesn't run in
   * a hidden tab, so a hidden document (and any environment without rAF — SSR,
   * jsdom without `pretendToBeVisual`) falls back to a macrotask.
   */
  #scheduleRemovalCheck(): void {
    if (this.removedCallback === BlissElement.prototype.removedCallback) return;
    this.#cancelRemovalCheck?.();
    const check = (): void => {
      this.#cancelRemovalCheck = undefined;
      if (this.isConnected) return;
      this.removedCallback();
    };
    const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (typeof requestAnimationFrame === 'function' && !isHidden) {
      const id = requestAnimationFrame(check);
      this.#cancelRemovalCheck = () => cancelAnimationFrame(id);
    } else {
      const id = setTimeout(check, 0);
      this.#cancelRemovalCheck = () => clearTimeout(id);
    }
  }

  // ── defer / release / ready (SPEC §6.3) ───────────────────────────────────

  /**
   * Hold the first build (attribute `defer`). While it is set when the element first connects,
   * nothing is built — no `reinit()`/`update()`, no `connect()` — and every input,
   * callback and listener assigned meanwhile accumulates. {@link release} (or
   * removing the attribute) then builds ONCE with all of it in place. Reflects to
   * the `defer` attribute. Latched: after the first build, setting it again has no
   * effect.
   */
  get shouldDefer(): boolean {
    return this.hasAttribute(DEFER_ATTRIBUTE);
  }

  set shouldDefer(value: boolean) {
    this.toggleAttribute(DEFER_ATTRIBUTE, !!value);
  }

  /**
   * Release the `defer` gate: run the first build now (one `reinit()` with every
   * pending input, then `connect()`, then `ready`). While detached, the build runs
   * at the next connect. No-op once released or built. Removing the `defer`
   * attribute does the same.
   */
  release(): void {
    if (this.#isReleased) return;
    this.#isReleased = true;
    if (!this.#connectedOnce || !this.isConnected) return; // the (next) connect builds
    this.#flushNow();
    this.#activate();
  }

  /**
   * Whether the first build is live — the `ready` event has fired, the host has
   * the `ready` attribute and matches `:state(ready)`. `false` while a `defer`
   * gate holds and before the first connect. Flips together with the `ready`
   * event, on the microtask after the first build + `connect()` (SPEC §6.3) — so
   * a listener added right after `createElement` / append still catches it.
   */
  get isReady(): boolean {
    return this.#isReady;
  }

  /**
   * Resolves once the first build is live (right after the `ready` event); at
   * once when it already is. Never rejects — a throwing first build keeps it
   * pending until a later flush succeeds. {@link destroy} settles it too (the
   * element will never become ready): check {@link isDestroyed} after awaiting
   * if the element may be destroyed meanwhile.
   */
  whenReady(): Promise<void> {
    if (this.#isReady || this.#isDestroyed) return Promise.resolve();
    return new Promise<void>((resolve) => this.#readyResolvers.push(resolve));
  }

  // ── responsive rules (SPEC §6.7) ───────────────────────────────────────────

  /**
   * This instance's responsive map: partial configs on two axes — `device`
   * (keyed by `classifyDevice`: `mobile` / `tablet` / `desktop`) and `breakpoint`
   * (keyed by the window-width bucket), e.g.
   * `{ device: { tablet: { presentation: 'modal' } }, breakpoint: { mobile: { … } } }`.
   * The breakpoint entry applies first, the device entry over it (device wins).
   * Also the JSON attribute `responsive`. Instance rules beat everything else —
   * the page rules and this element's own attributes/properties. An entry of
   * `null` (either axis) ignores every page rule while it matches. Overrides never reflect to
   * attributes; `this.config` and the property getters report the effective value.
   * `null` / `undefined` = no instance map.
   */
  get responsive(): ResponsiveMap | null {
    return this.#responsiveMap ?? null;
  }

  set responsive(value: ResponsiveMap | null | undefined) {
    if (value != null && !isResponsiveMap(value)) {
      this.#warn('rejected invalid value for property "responsive" (an object { device?, breakpoint? }, or null); keeping previous value', value);
      return;
    }
    this.#responsiveMap = value ?? undefined;
    this.#refreshResponsive();
  }

  /**
   * This instance's computed responsive rule: `(ctx) => partial config`. Runs
   * after {@link responsive} (wins key by key) on every environment flip, every
   * (throttled) viewport-size change, rule change and base-config change — so
   * `ctx.env.viewportWidth <= 600` re-evaluates between breakpoint lines. `undefined` = nothing to add; `null` = ignore
   * every page rule for this element. A throw is logged and treated as `undefined`.
   */
  get responsiveCallback(): ResponsiveCallback | null {
    return this.#responsiveCallback ?? null;
  }

  set responsiveCallback(value: ResponsiveCallback | null | undefined) {
    if (value != null && typeof value !== 'function') {
      this.#warn('rejected invalid value for property "responsiveCallback" (a function, or null); keeping previous value', value);
      return;
    }
    this.#responsiveCallback = value ?? undefined;
    this.#refreshResponsive();
  }

  // ── public batching API ─────────────────────────────────────────────────

  /**
   * Apply many inputs (by `configKey` or attribute name) as ONE reinit/update.
   * The core-declared properties (`shouldDefer` / `defer`, `themeSource` /
   * `theme-source`, `responsive`, `responsiveCallback`, `motion`) are accepted too;
   * a `shouldDefer: false` release applies after the other keys. Any
   * other key is not an input of this element: it warns and is skipped — a
   * renamed or misspelled key must never be dropped silently.
   */
  setAttributes(values: Record<string, unknown>): void {
    // A `shouldDefer: false` / `defer` release is applied LAST, so the build it
    // triggers already has every other value of this call (one build, not two).
    let release: [string, unknown] | undefined;
    for (const [key, value] of Object.entries(values)) {
      const def = this.#byConfigKey.get(key) ?? this.#byAttribute.get(key);
      if (def) {
        this.#setFromProperty(def, value);
        continue;
      }
      const coreProperty = CORE_PROPERTY_BY_KEY.get(key);
      if (coreProperty === 'shouldDefer') {
        release = [coreProperty, value];
        continue;
      }
      if (coreProperty) {
        (this as unknown as Record<string, unknown>)[coreProperty] = value;
        continue;
      }
      this.#warn(`setAttributes: "${key}" is not an input of <${this.localName}> (not a configKey or attribute); skipped`, value);
    }
    if (release) (this as unknown as Record<string, unknown>)[release[0]] = release[1];
    this.#flushNow();
  }

  /** Run `fn` and coalesce every input change it makes into a single reinit/update. */
  batch(fn: () => void): void {
    fn();
    this.#flushNow();
  }

  /**
   * Apply any pending input writes **synchronously, now** — running the
   * resulting `reinit()`/`update()` before this call returns. No-op when nothing
   * is pending (or while detached, where changes are held until connect).
   *
   * This is the escape hatch for **imperative methods** that read or mutate live
   * state built from inputs. Loose property assignments coalesce on a microtask
   * (`el.options = …`), so a synchronous method called right after (e.g.
   * `el.setSelected(…)`) would otherwise run against pre-write state. Call
   * `this.flush()` at the top of such a method to preserve the intuitive
   * "set property, then call method" ordering without forcing consumers to
   * `await whenSettled()` between the two.
   */
  flush(): void {
    this.#flushNow();
  }

  /**
   * Resolves once the element is **settled** — i.e. every staged input change
   * has been applied and the resulting `reinit()`/`update()` has run. If nothing
   * is pending it resolves immediately (a microtask); otherwise it resolves at
   * the end of the next flush. This is the deterministic "await the pipeline"
   * signal for tests AND consumers — read rendered state right after it, instead
   * of guessing with a bare `await Promise.resolve()`.
   *
   * Note: loose property assignments coalesce on a microtask, so
   * `el.x = …; await el.whenSettled()` awaits that microtask. `setAttributes()`
   * and `batch()` flush synchronously, so after either the element is already
   * settled. While the element is **detached**, pending changes are held (the
   * flush no-ops until connected), so the promise resolves on the next connect's
   * flush — not before the change is actually applied. The same holds while a
   * `defer` gate holds the first build (SPEC §6.3): the promise resolves only once
   * {@link release} (or removing `defer`) builds — by design, since resolving
   * earlier would report "settled" with nothing built. Don't `await` it before
   * releasing a deferred element (a test that does hangs); release first.
   */
  whenSettled(): Promise<void> {
    if (this.#isDestroyed || (!this.#pending && !this.#pendingReinit)) return Promise.resolve();
    return new Promise<void>((resolve) => this.#settleResolvers.push(resolve));
  }

  // ── destroy (SPEC §6.5) ──────────────────────────────────────────────────

  /**
   * Tear the element down for good. Stops everything the base owns — runs
   * {@link disconnect} if the element is active, drops the environment /
   * viewport / size / theme subscriptions, cancels a pending flush and the
   * post-disconnect {@link removedCallback} check, untracks the instance —
   * then calls {@link destroyCallback} for the component's own cleanup, which
   * runs **once** (even if `disconnect()` throws; a throw from either is rethrown).
   * Idempotent: later calls do nothing.
   *
   * Afterwards the element is **inert**: input writes still store into
   * `config` but never reach `reinit()`/`update()` (`flush()` / `whenSettled()`
   * resolve at once), `release()` builds nothing, and re-inserting it into the
   * DOM logs a warning and stays inert — no rebuild, no `connect()`. Create a
   * new element instead. `ready` state (attribute, `:state(ready)`, `isReady`)
   * is left as it was; `ElementInternals` can't be detached, so a subclass that
   * set a form value clears it in `destroyCallback()`.
   */
  destroy(): void {
    if (this.#isDestroyed) return;
    this.#isDestroyed = true;
    this.#scheduler.cancel();
    this.#cancelRemovalCheck?.();
    this.#cancelRemovalCheck = undefined;
    this.#pending = null;
    this.#failedPartial = null;
    this.#pendingReinit = false;
    this.#hasFailedReinit = false;
    this.#resolveSettled();
    const readyResolvers = this.#readyResolvers;
    this.#readyResolvers = [];
    for (const resolve of readyResolvers) resolve();
    untrackInstance(this.localName, this);
    this.#stopResponsive();
    try {
      this.#deactivate();
    } finally {
      this.destroyCallback();
    }
  }

  /** {@link destroy} ran — the element is inert and won't rebuild. */
  get isDestroyed(): boolean {
    return this.#isDestroyed;
  }

  // ── subclass surface ─────────────────────────────────────────────────────

  /**
   * The current validated, EFFECTIVE config — the base config (defaults,
   * attributes, properties) with the responsive overrides applied (SPEC §6.7).
   * This is what a component applies.
   */
  protected get config(): Readonly<Record<string, unknown>> {
    return this.#config;
  }

  /**
   * The `configKey`s for which a `null` in {@link config} is a deliberate
   * "clear/reset" signal (the input's converter admits `null` — nullable
   * `toText`, tristate `toBool`, `toFunction`, `isNullable` enums, or a
   * row with `default: null`), NOT an accident to be dropped.
   *
   * Derived once from the input table, this lets an engine-config assembler keep
   * the clear signal only where it's meaningful instead of a hand-maintained
   * per-component exception list — see the null-clear contract (SPEC §11
   * amendment). Empty for elements without an input table.
   */
  protected get clearableConfigKeys(): ReadonlySet<string> {
    return this.#clearableKeys;
  }

  /**
   * Assemble the config object to hand to an engine: a fresh shallow copy of
   * {@link config} with `exclude` keys removed and **every `null` preserved**.
   *
   * A `null` here is a deliberate clear signal (the input admits `null` — see
   * {@link clearableConfigKeys}); forwarding it is what resets a cleared field.
   * Do NOT strip nulls — that is the bug this method exists to prevent. Pass the
   * keys the engine must never see (component-only config, or keys the component
   * applies itself) as `exclude`. Returns a new object each call, safe to
   * `Object.assign` an `update(partial)` onto. See the null-clear contract
   * (SPEC §6).
   */
  protected engineConfig(exclude?: Iterable<string>): Record<string, unknown> {
    return collectEngineConfig(this.#config, { exclude });
  }

  /**
   * Instance-scoped loggers, one per category of the bundle this component
   * registered (via `registerComponent`'s `logging` option). Each line reads
   * `[NAMESPACE:CATEGORY] #id` — the element's own `id` when set (read per
   * line), else a running number — and is gated by the more verbose of the
   * type-level category level and this instance's own override, so a devtools
   * overlay can make ONE element loud while its type stays quiet (SPEC §12.3).
   * When the tag has no attached bundle, every category maps to core's
   * `CORE:ELEMENT` logger labelled `tag#id`. Prefer this over the shared
   * type-level loggers inside a component.
   */
  protected get log(): Record<string, InstanceLogger> {
    const { bundle, loggers } = getElementLoggers(this);
    if (bundle) return loggers;
    // Not memoized against the bundle: a later registration still takes effect,
    // even through a reference held from before it (then it's the bundle's own
    // category, or its first one for a name it doesn't define).
    return (this.#coreLogProxy ??= new Proxy({} as Record<string, InstanceLogger>, {
      get: (_target, key) => {
        const now = getElementLoggers(this);
        if (!now.bundle) return now.loggers.ELEMENT;
        return now.loggers[key as string] ?? now.loggers[now.bundle.LOGGING_CATEGORIES[0]!];
      },
    }));
  }

  /**
   * Set THIS element's own log level (default `debug`): it logs `level` and above, whatever
   * its component type or the page is set to — the closest level wins (element → type →
   * page → `warn`). The seam a Ctrl-Alt-C overlay calls after the user picks one instance.
   * An invalid level warns and changes nothing.
   */
  enableLogging(level: LogLevelDesc = DEFAULT_ENABLED_LEVEL): void {
    if (!isLogLevel(level)) {
      this.#warn(`enableLogging: invalid level "${String(level)}" (expected trace | debug | info | warn | error | silent)`);
      return;
    }
    this.#logLevel = level;
  }

  /** Silence THIS element (its own level = `silent`), whatever its type or the page is set to. */
  disableLogging(): void {
    this.#logLevel = 'silent';
  }

  /** Clear THIS element's own level: it follows its component type / the page again. */
  resetLogging(): void {
    this.#logLevel = undefined;
  }

  /** Whether this element has its own log level that prints something (set, and not `silent`). */
  get isLoggingEnabled(): boolean {
    const rank = toLogLevelNumber(this.#logLevel);
    return rank !== undefined && rank !== LOG_LEVELS.SILENT;
  }

  /**
   * Full rebuild: called when a batch changes any `on: 'reinit'` input, and on
   * first connect. Reads {@link config} (already fully merged) — it is not given
   * a partial, because any `on: 'update'` keys that changed in the same batch
   * are absorbed by the rebuild. Override in components that need it; no-op by
   * default so the input table stays opt-in.
   */
  protected reinit(): void {
    /* opt-in */
  }

  /**
   * In-place patch: called with just the changed `on: 'update'` keys, when a
   * batch contains NO reinit-level change. Override to apply the named keys
   * without a teardown; no-op by default.
   */
  protected update(_partial: Record<string, unknown>): void {
    /* opt-in */
  }

  /**
   * Activate: called on EVERY connect, after any `reinit()`/`update()` for that
   * connect (including the first). Start live resources here — document/window
   * listeners, observers, floating-ui `autoUpdate`, timers. Pairs with
   * {@link disconnect} and can run many times (any DOM move re-fires it), so
   * keep it balanced/idempotent. No-op by default.
   */
  protected connect(): void {
    /* opt-in */
  }

  /**
   * Deactivate: called on EVERY disconnect. Stop whatever {@link connect}
   * started. The shadow DOM persists across disconnect/reconnect, so do NOT
   * tear down structure here — only the live resources. No-op by default.
   */
  protected disconnect(): void {
    /* opt-in */
  }

  /**
   * Final teardown hook: the element was disconnected and NOT reconnected by
   * the next animation frame (a macrotask when rAF is unavailable or the tab is
   * hidden) — i.e. it was really removed, not moved. A synchronous DOM move
   * (`disconnect()`→`connect()` in one task) never fires it. Runs after
   * {@link disconnect}. Use it to cancel in-flight work and release resources
   * that should survive a move but not a removal (e.g. abort uploads, then
   * destroy).
   *
   * Overriding it is the opt-in: the base schedules the post-disconnect check
   * only for subclasses that override this hook.
   *
   * Re-adding the element after it fired is a fresh activation: `connect()`
   * runs as usual (no `reinit()` — the base doesn't know what the hook tore
   * down). A subclass that destroyed its structure here rebuilds it in
   * `connect()` (e.g. "no store → build one"). No-op by default.
   */
  protected removedCallback(): void {
    /* opt-in */
  }

  /**
   * The component's own teardown, called once by {@link destroy} — after the
   * base ran {@link disconnect} (if active) and cancelled its timers. Release
   * what `reinit()` built and anything `disconnect()` keeps for a reconnect
   * (engines, stores, pickers, in-flight work). Never followed by a rebuild.
   * No-op by default.
   */
  protected destroyCallback(): void {
    /* opt-in */
  }

  /**
   * React to the device/viewport/orientation (SPEC §12.9). Overriding this hook
   * opts the element into the shared environment observable: the base subscribes
   * on every connect and unsubscribes on every disconnect (balanced with
   * {@link connect}/{@link disconnect}). It fires once immediately with the
   * current {@link EnvironmentSnapshot} on connect, then again whenever the
   * pointer type, hover capability, orientation, viewport size, or resolved
   * breakpoint changes — e.g. to flip a calendar to fullscreen on a touch-primary
   * device or an orientation change. No-op by default, so elements that don't
   * override it attach no global listeners. For a one-off synchronous read inside
   * `reinit()`/`connect()`, call `getEnvironment()` instead.
   */
  protected environmentChanged(_env: EnvironmentSnapshot): void {
    /* opt-in */
  }

  /**
   * React to *continuous* viewport-size changes (SPEC §12.9) — the throttled
   * companion to {@link environmentChanged}. Overriding this (no-op-default) hook
   * opts the element into the shared viewport observable, subscribed on every
   * `connect` and dropped on every `disconnect` (balanced, override-gated, so
   * non-overriding elements attach no listeners). It fires once immediately with
   * the current {@link EnvironmentSnapshot} on connect, then on every raw
   * `viewportWidth`/`viewportHeight` change, **throttled to ~30 ms (leading +
   * trailing)** — a drag-resize yields a steady stream plus a final settled read,
   * not a per-frame flood. Use it only when you genuinely track live width (a
   * layout that reflows *within* a device class); for "which device / breakpoint
   * am I" use {@link environmentChanged}, which fires only on discrete flips. For
   * a one-off synchronous read, call `getEnvironment()`.
   */
  protected viewportChanged(_env: EnvironmentSnapshot): void {
    /* opt-in */
  }

  /**
   * React to changes in *this element's own box* (SPEC §12.9) — the element-box
   * companion to {@link viewportChanged} (which reports the window). Use it when a
   * component reflows to its *container* rather than the viewport (a picker in a
   * narrow sidebar on a wide monitor). Overriding this (no-op-default) hook opts
   * the element into a shared page-wide `ResizeObserver`, subscribed on every
   * `connect` and dropped on every `disconnect` (balanced, override-gated).
   *
   * **Prefer CSS container queries first** (`container-type: inline-size` +
   * `@container`) when the reflow is purely presentational — they're native and
   * fire before paint. Reach for this hook only when the reflow is *structural*
   * (different DOM / a JS decision). Fires with the element's real laid-out
   * border box shortly after connect, then on size changes, **throttled to ~30 ms
   * (leading + trailing)**; identical consecutive sizes are deduped. The size is the
   * LAYOUT size — CSS transforms are not applied, so a `scale()` open animation doesn't
   * report a shrunken box. For a one-off synchronous read of the same size, use
   * `this.offsetWidth` / `this.offsetHeight` (`getBoundingClientRect()` includes transforms).
   */
  protected sizeChanged(_size: ElementSize): void {
    /* opt-in */
  }

  /**
   * Whether the element currently resolves to right-to-left. Reads the effective
   * CSS `direction`, so it accounts for `dir` on the element, an ancestor, `<html>`,
   * or a CSS `direction` rule — not just this element's own `dir` attribute.
   * Meaningful only while connected (falls back to `false` under SSR / detached).
   */
  protected get isRtl(): boolean {
    return typeof getComputedStyle === 'function' && getComputedStyle(this).direction === 'rtl';
  }

  /**
   * React to a runtime writing-direction change. The base observes the global
   * `dir` attribute on every component; override this hook to re-mirror live DOM
   * when direction flips (an app-wide RTL/LTR switch) WITHOUT a rebuild — the
   * cheaper counterpart to reading direction once during {@link reinit}. Called
   * with the freshly-resolved {@link isRtl}, only for post-connect changes (the
   * initial direction is read by the first build). No-op by default.
   *
   * Note: this fires for `dir` changes on the element itself. A direction change
   * made only on an ancestor (e.g. `<html dir>`) does not trigger it — set/update
   * `dir` on the element, or rebuild, for that case.
   */
  protected directionChanged(_isRtl: boolean): void {
    /* opt-in */
  }

  /**
   * React to a theme-context change (SPEC §12.10) — for JS-side theming (a
   * canvas, a chart palette). Fires on connect with the current scheme, then
   * whenever it changes. CSS needs nothing: the base already mirrors the scheme
   * onto the host as `data-context-theme`. `null` means nothing is detected or
   * forced (the inherited `color-scheme` applies). No-op by default.
   */
  protected themeChanged(_scheme: ColorScheme | null): void {
    /* opt-in */
  }

  /**
   * Where this element reads its theme from instead of the page (SPEC §12.10):
   * a CSS selector (nearest matching ancestor, else the first match in the
   * document), `'closest'` (the nearest ancestor carrying a theme signal), or an
   * `Element`. `null` = the page. Strings reflect to the `theme-source` attribute.
   */
  get themeSource(): ThemeSource {
    return this.#themeSource;
  }

  set themeSource(value: ThemeSource | undefined) {
    const next = value ?? null;
    if (typeof next === 'string' || next === null) {
      // Route through the attribute so both entry points share one path.
      if (next) this.setAttribute(THEME_SOURCE_ATTRIBUTE, next);
      else this.removeAttribute(THEME_SOURCE_ATTRIBUTE);
      return;
    }
    this.#themeSource = next;
    this.#withoutReflect(THEME_SOURCE_ATTRIBUTE, () => this.removeAttribute(THEME_SOURCE_ATTRIBUTE));
    this.#resubscribeTheme();
  }

  /**
   * Motion level (SPEC §12.16): `'auto'` (default — no level of its own: the nearest section's
   * `data-motion`, else the page level `window.components.motion` / `<html data-motion>`, else the
   * component's own speeds), `'none'`, `'snappy'` or `'smooth'`. Core writes the element's own
   * level to `data-motion` on the host; components follow through the `--base-duration-*` /
   * `--base-scroll-behavior` tokens. The OS reduced-motion setting always wins. Reflects to `motion`.
   */
  get motion(): Motion {
    return this.#motion;
  }

  set motion(value: Motion | null | undefined) {
    const next = value ?? 'auto';
    if (!isMotion(next)) {
      this.#warn(`rejected invalid motion ${JSON.stringify(value)} (expected ${MOTION_VALUES.join(' | ')}); keeping "${this.#motion}"`);
      return;
    }
    // Route through the attribute so both entry points share one path.
    if (next === 'auto') this.removeAttribute(MOTION_ATTRIBUTE);
    else this.setAttribute(MOTION_ATTRIBUTE, next);
  }

  // ── form association ──────────────────────────────────────────────────────

  /**
   * This element's {@link ElementInternals}, lazily attached on first access and
   * memoized. Available to form-associated components (`static formAssociated =
   * true`); returns `null` when `attachInternals` is unavailable (SSR, older
   * jsdom) or the element opts out. Because `attachInternals()` may be called at
   * most once per element, a subclass must NOT call it itself — read this getter
   * instead (e.g. `this.internals?.setFormValue(value)`).
   */
  protected get internals(): ElementInternals | null {
    if (this.#internals) return this.#internals;
    if (typeof this.attachInternals !== 'function') return null;
    try {
      return (this.#internals = this.attachInternals());
    } catch {
      // attachInternals throws if internals were already attached elsewhere or
      // the feature is disabled; degrade to null rather than break construction.
      return null;
    }
  }

  /**
   * The `<form>` this element is associated with, or `null`. A form-associated
   * custom element (`static formAssociated = true`) participates in its form, but
   * — unlike a native control — gets NO `.form` property for free: the browser
   * records the association only inside {@link ElementInternals}. This re-exposes
   * it so `el.form` and `event.target.form` resolve like a native input. Host
   * frameworks that route form changes by reading `target.form` (e.g. Phoenix
   * LiveView's `phx-change` delegation) depend on it. Unlike `closest('form')`,
   * `ElementInternals.form` honours shadow-DOM boundaries and `form=` association.
   * Always `null` for a class that isn't form-associated (the browser throws when
   * reading `internals.form` there, so it isn't touched).
   */
  get form(): HTMLFormElement | null {
    return this.#formInternals?.form ?? null;
  }

  // ── form validity (SPEC §6.6) ─────────────────────────────────────────────

  /**
   * {@link internals}, but only for a form-associated class (`static
   * formAssociated = true`). The validity members of `ElementInternals` throw
   * `NotSupportedError` on a non-form-associated element, so the public validity
   * API reads through this and degrades to the "no constraint" answers instead.
   */
  get #formInternals(): ElementInternals | null {
    const ctor = this.constructor as { formAssociated?: boolean };
    return ctor.formAssociated === true ? this.internals : null;
  }

  /**
   * The element's {@link ValidityState} — like a native control's `validity`.
   * `undefined` when the class isn't form-associated (or internals are
   * unavailable).
   */
  get validity(): ValidityState | undefined {
    return this.#formInternals?.validity;
  }

  /** The validation message the element shows when invalid (`''` when valid / not form-associated). */
  get validationMessage(): string {
    return this.#formInternals?.validationMessage ?? '';
  }

  /** Whether the element is a candidate for constraint validation (`false` when not form-associated). */
  get willValidate(): boolean {
    return this.#formInternals?.willValidate ?? false;
  }

  /**
   * Checks validity like a native control: returns `false` and fires a
   * cancelable `invalid` event when invalid. Always `true` when the class isn't
   * form-associated.
   */
  checkValidity(): boolean {
    return this.#formInternals?.checkValidity() ?? true;
  }

  /**
   * Like {@link checkValidity}, and additionally reports the problem to the user
   * (the browser's validation bubble, anchored per {@link setFormatError}).
   * Always `true` when the class isn't form-associated.
   */
  reportValidity(): boolean {
    return this.#formInternals?.reportValidity() ?? true;
  }

  /**
   * Marks the host invalid because its value could not be produced (e.g. a
   * throwing `getValueFormatCallback`), or clears that state (SPEC §6.6).
   *
   * - `error` non-null → `internals.setValidity({ customError: true }, message,
   *   anchor)`. The message is `message`, else the error's own message, else a
   *   generic fallback (the platform rejects an empty message for an invalid
   *   state). `anchor` (a shadow-including descendant) positions the browser's
   *   validation bubble; an anchor the browser rejects is dropped with a warning.
   * - `error` `null` → `internals.setValidity({})` — the element is valid again.
   *
   * The form then refuses to submit (unless `<form novalidate>`) and `:invalid`
   * matches. No-op when the class isn't form-associated or internals are
   * unavailable. Clearing resets ALL validity flags — a component tracking other
   * constraints sets them through {@link internals} itself.
   */
  protected setFormatError(error: unknown | null, message?: string, anchor?: HTMLElement): void {
    const internals = this.#formInternals;
    if (!internals || typeof internals.setValidity !== 'function') return;
    if (error === null || error === undefined) {
      internals.setValidity({});
      return;
    }
    const text =
      message ||
      (error instanceof Error && error.message) ||
      (typeof error === 'string' && error) ||
      'The value is invalid.';
    if (!anchor) {
      internals.setValidity({ customError: true }, text);
      return;
    }
    try {
      internals.setValidity({ customError: true }, text, anchor);
    } catch (anchorError) {
      // NotFoundError: the anchor isn't a shadow-including descendant of the host.
      coreLog(this, 'UI', 'ELEMENT').warn('setFormatError: anchor rejected, validity set without it', anchorError);
      internals.setValidity({ customError: true }, text);
    }
  }

  /**
   * Browser callback (form-associated elements only): the element's disabled
   * state flipped. The browser reports the COMBINED state — its own `disabled`
   * attribute OR a disabled ancestor `<fieldset>` — so core keeps the raw value
   * and derives the fieldset side in {@link isFormDisabled}; the `isDisabled`
   * input (attribute `disabled`, which must reflect) carries the own side. While
   * live, pending writes flush first, then {@link disabledChanged} fires on a
   * flip. Don't override; implement {@link disabledChanged}.
   */
  formDisabledCallback(isDisabled: boolean): void {
    this.#hasBrowserDisabledState = true;
    if (this.#browserDisabledState === isDisabled) return;
    this.#browserDisabledState = isDisabled;
    // Before the first connect only record it: the first build reads it (a flush here
    // would run update() on an element that was never built).
    if (this.isConnected && this.#connectedOnce) this.#flushNow(); // ends with #syncDisabled(); a no-op while held
  }

  /**
   * Disabled by an ancestor `<fieldset disabled>` only (form-associated elements),
   * NOT by the element's own `disabled` attribute. Without the own attribute the
   * browser's state IS the fieldset state; with it the browser can't tell the two
   * apart (no callback fires for a fieldset flip then), so the ancestors are read.
   */
  protected get isFormDisabled(): boolean {
    // Until the browser reports a state (it calls formDisabledCallback AFTER connectedCallback
    // when the element is inserted into a disabled fieldset), read the ancestors, so the
    // first build already sees it.
    if (!this.#hasBrowserDisabledState) {
      return (this.constructor as { formAssociated?: boolean }).formAssociated === true && this.#isInDisabledFieldset();
    }
    if (!this.#browserDisabledState) return false;
    return !this.hasAttribute('disabled') || this.#isInDisabledFieldset();
  }

  /** HTML's rule: a descendant of a `<fieldset disabled>`, outside its first `<legend>`. */
  #isInDisabledFieldset(): boolean {
    let child: Element = this;
    for (let node = this.parentElement; node; child = node, node = node.parentElement) {
      if (node.localName !== 'fieldset' || !node.hasAttribute('disabled')) continue;
      let legend: Element | undefined;
      for (const c of Array.from(node.children)) {
        if (c.localName === 'legend') {
          legend = c;
          break;
        }
      }
      if (legend !== child) return true;
    }
    return false;
  }

  /**
   * The disabled state a component must APPLY: its `isDisabled` input (the
   * conventional configKey, attribute `disabled`) OR a disabled ancestor
   * `<fieldset>`. Read it in `reinit()`; react to flips in {@link disabledChanged}.
   */
  protected get isEffectivelyDisabled(): boolean {
    return this.#config.isDisabled === true || this.isFormDisabled;
  }

  /**
   * {@link isEffectivelyDisabled} flipped on a built element — from the
   * `isDisabled` input (an `update` batch) or a `<fieldset>` change. Not called
   * for a rebuild (`reinit()` reads the state itself) nor before the first build.
   * Apply the disabled state here and leave `isDisabled` out of `update()`.
   * No-op by default.
   */
  protected disabledChanged(_isDisabled: boolean): void {
    /* opt-in */
  }

  /** After a successful flush: report a flip of the effective disabled state. */
  #syncDisabled(isRebuilt: boolean): void {
    const next = this.isEffectivelyDisabled;
    const prev = this.#lastEffectiveDisabled;
    this.#lastEffectiveDisabled = next;
    if (isRebuilt || prev === undefined || prev === next) return;
    this.disabledChanged(next);
  }

  // ── events & callbacks (SPEC §12.5) ───────────────────────────────────────

  /**
   * Fire an outward notification (SPEC §12.5). The detail gets the component
   * context attached ({@link withContext}: `controller` + `element`
   * non-enumerable, plus {@link eventContext} extras); then the event's
   * `on<Name>` twin — if assigned — is called with that detail object, and
   * finally a typed `CustomEvent` carrying the SAME object is dispatched on the
   * host (per-event overrides from the table, else the {@link dispatch}
   * defaults: bubbles, not composed). A throwing twin is logged and the DOM
   * event still fires. No detail → `{}` + context. Returns `false` when a
   * cancelable event was `preventDefault()`-ed.
   */
  protected emit<K extends keyof TEvents & string>(
    name: K,
    detail?: EmitDetail<TEvents[K]>,
    opts?: DispatchOptions,
  ): boolean {
    const def = this.#eventsByName.get(name);
    const payload =
      detail === undefined || (typeof detail === 'object' && detail !== null)
        ? this.withContext(copyPlainDetail((detail ?? {}) as object))
        : detail;
    const twin = this.#eventHandlers.get(name);
    if (twin) {
      try {
        twin.call(this, payload);
      } catch (error) {
        coreLog(this, 'UI', 'ELEMENT').error(`${def?.property ?? name} handler threw`, error);
      }
    }
    return dispatch(this, name, payload, {
      bubbles: opts?.bubbles ?? def?.bubbles,
      composed: opts?.composed ?? def?.composed,
      cancelable: opts?.cancelable ?? def?.cancelable,
    });
  }

  /**
   * The component's public facade — the object every event detail and every
   * callback `ctx` carries as `controller`. Built once, lazily, by
   * {@link createController}; `undefined` for a component without one.
   */
  get controller(): TController {
    if (!this.#hasController) {
      this.#controller = this.createController();
      this.#hasController = true;
    }
    return this.#controller as TController;
  }

  /**
   * Build the public facade (once per element). Override to expose the
   * component's imperative API — never the internal engine.
   */
  protected createController(): TController {
    return undefined as TController;
  }

  /**
   * Extra enumerable fields every event detail and {@link withContext} ctx
   * carries — popup components return their presentation flags
   * (`createPresentationContext(...)`). Called per emit, so it reflects the
   * current state. Default: none.
   */
  protected eventContext(): object | undefined {
    return undefined;
  }

  /**
   * Attach the component context to a detail or callback ctx, in place:
   * `controller` + `element` (non-enumerable — `JSON.stringify`/logs see only
   * the data) and the {@link eventContext} extras. Fields already present win.
   */
  protected withContext<T extends object>(target: T): T & ComponentContext<TController, this> {
    return withComponentContext(target, this.controller, this, this.eventContext());
  }

  /**
   * Typed `addEventListener` for a declared event: the handler receives a
   * `CustomEvent<detail>`. Returns an unsubscribe function. Complements the
   * managed `on<Name>` property with the same event object.
   */
  on<K extends keyof TEvents & string>(
    name: K,
    handler: (event: CustomEvent<TEvents[K]>) => void,
    options?: AddEventListenerOptions,
  ): () => void {
    const listener = handler as EventListener;
    this.addEventListener(name, listener, options);
    return () => this.removeEventListener(name, listener, options);
  }

  /**
   * Invoke a `*Callback` input through the one unified protocol (SPEC §12.5):
   * unset → `opts.whenUnset`; the callback is called with a single `ctx`
   * argument and its result is normalized through `Promise.resolve` (so sync OR
   * async callbacks both work); a throw routes to `opts.errorCallback` if given, else
   * re-throws (no silent swallow). The RESULT contract — the discriminated
   * `action`, adjustments, etc. — is the component's; core owns only the
   * plumbing. Correctness that used to drift across per-component hook wrappers
   * lives here once.
   */
  protected async runHook<Ctx, R>(
    callbackKey: string,
    ctx: Ctx,
    opts: { whenUnset: R; errorCallback?: (error: unknown) => R },
  ): Promise<R> {
    const fn = this.#config[callbackKey] as ((ctx: Ctx) => R | Promise<R>) | undefined;
    if (typeof fn !== 'function') return opts.whenUnset;
    try {
      return await Promise.resolve(fn(ctx));
    } catch (error) {
      if (opts.errorCallback) return opts.errorCallback(error);
      throw error;
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #subscribeTheme(): void {
    if ((this.constructor as typeof BlissElement).hasThemeContext === false) return;
    this.#themeUnsub = observeThemeContext(this, this.#themeSource, (scheme) => {
      if (scheme) this.setAttribute(THEME_CONTEXT_ATTRIBUTE, scheme);
      else this.removeAttribute(THEME_CONTEXT_ATTRIBUTE);
      this.themeChanged(scheme);
    });
  }

  /** Write the resolved motion level to `data-motion`: the instance level, else the page level. */
  #applyMotion(): void {
    if (!this.isConnected) return;
    // Only the element's OWN level goes on the host; `auto` leaves the tokens to inheritance
    // (nearest section / <html> page level / the component's own speeds).
    const level = this.#motion;
    if (level !== 'auto') {
      if (this.getAttribute(MOTION_DATA_ATTRIBUTE) !== level) this.setAttribute(MOTION_DATA_ATTRIBUTE, level);
      this.#hasAppliedMotion = true;
    } else if (this.#hasAppliedMotion) {
      this.removeAttribute(MOTION_DATA_ATTRIBUTE);
      this.#hasAppliedMotion = false;
    }
  }

  /** Re-resolve the theme source while connected (the source is fixed per subscription). */
  #resubscribeTheme(): void {
    if (!this.isConnected || !this.#themeUnsub) return;
    this.#themeUnsub();
    this.#subscribeTheme();
  }

  #seedDefaults(defs: readonly InputDef[]): void {
    for (const def of defs) {
      let value: unknown;
      try {
        // Same resolution as removing the attribute (absent == default).
        value = resolveFromAttribute(def, null, this as unknown as AttrReader).value;
      } catch (err) {
        this.#warn(`converter for "${def.configKey}" threw computing its default; using \`default\``, err);
        value = def.default;
      }
      this.#config[def.configKey] = value;
      this.#base[def.configKey] = value;
      if (def.field) (this as Record<string, unknown>)[def.field] = value;
    }
  }

  /** Sanity-check the input + event tables once per class; warn (never throw) on mistakes. */
  #validateOnce(defs: readonly InputDef[], events: readonly NormalizedEventDef[]): void {
    const ctor = this.constructor as object;
    if (VALIDATED.has(ctor)) return;
    VALIDATED.add(ctor);
    const CORE_MEMBERS = new Set(Object.getOwnPropertyNames(BlissElement.prototype));

    const seenKeys = new Set<string>();
    const seenAttrs = new Set<string>();
    for (const def of defs) {
      if (seenKeys.has(def.configKey)) this.#warn(`invalid input table: duplicate configKey "${def.configKey}"`);
      seenKeys.add(def.configKey);

      if (def.attribute) {
        if (seenAttrs.has(def.attribute)) this.#warn(`invalid input table: duplicate attribute "${def.attribute}"`);
        seenAttrs.add(def.attribute);
      }

      if (def.shouldReflect && !def.attribute) {
        this.#warn(`invalid input table: "${def.configKey}" has shouldReflect:true but no attribute to reflect to`);
      }
      if (def.on !== undefined && !REACTIVITY_VALUES.has(def.on)) {
        this.#warn(`invalid input table: "${def.configKey}" has on: ${describeValue(def.on)} (expected 'update' | 'reinit' | 'none'); treated as 'update'`);
      }
      // The input's accessor is installed on the instance, so it would hide a core member
      // of the same name (`form`, `controller`, `release`, …). The core-declared properties
      // (CORE_PROPERTIES) are the documented exception: an input of that name owns it.
      if (CORE_MEMBERS.has(def.configKey) && !CORE_PROPERTY_BY_KEY.has(def.configKey)) {
        this.#warn(`invalid input table: configKey "${def.configKey}" hides BlissElement's own "${def.configKey}" — rename the input`);
      }
      if (def.getLiveValue !== undefined && typeof def.getLiveValue !== 'function') {
        this.#warn(`invalid input table: "${def.configKey}" has a getLiveValue that is not a function; the getter returns the stored value`);
      }
      // Review E-15: an on:'none' write never reaches the component, so its live state can't
      // follow it — the getter would ignore every assignment. Read-only state is a plain getter.
      if (typeof def.getLiveValue === 'function' && def.on === 'none') {
        this.#warn(
          `invalid input table: "${def.configKey}" has getLiveValue but on: 'none' — a write never reaches the component, so the live getter ignores it; use on: 'update' (or a plain getter for read-only state)`,
        );
      }
      // A converter's own answer for a missing attribute replaces the row's `default`
      // (resolveFromAttribute applies `default` only when it answers `undefined`), so a
      // differing concrete value makes `default` dead — e.g. toBool('default-false') with
      // default: true. `null` is exempt: it's the null-clear "unset, the engine decides"
      // sentinel (SPEC §6.1), and there `default` documents what the engine applies.
      if (def.default !== undefined && def.converter?.fromAttribute) {
        let absent: unknown;
        try {
          absent = def.converter.fromAttribute(null, ABSENT_ATTRIBUTES, def.attribute ?? def.configKey);
        } catch {
          absent = undefined; // a throwing converter is reported when the element seeds its defaults
        }
        if (absent !== undefined && absent !== null && !isSameValue(absent, def.default)) {
          this.#warn(
            `invalid input table: "${def.configKey}" declares default ${describeValue(def.default)}, but its converter resolves a missing attribute to ${describeValue(absent)} — the default never applies. Make the converter's default match (e.g. toBool('default-true'), toEnum(values, { default })) or drop default`,
          );
        }
      }
      if (def.shouldReflect && !def.converter?.toAttribute) {
        this.#warn(`invalid input table: "${def.configKey}" has shouldReflect:true but its converter has no toAttribute`);
      }
      // SPEC §6.4: the browser treats a form-associated element's OWN `disabled`
      // attribute as disabling it (formDisabledCallback, :disabled, no submit), so
      // a non-reflecting input would leave `el.isDisabled = false` stuck disabled.
      if (def.attribute === 'disabled' && !def.shouldReflect && (ctor as { formAssociated?: boolean }).formAssociated) {
        this.#warn(`invalid input table: "${def.configKey}" (attribute "disabled") must have shouldReflect:true on a form-associated element — otherwise clearing it by property leaves the element disabled`);
      }
    }

    const seenEvents = new Set<string>();
    for (const ev of events) {
      if (seenEvents.has(ev.name)) this.#warn(`invalid event table: duplicate event "${ev.name}"`);
      seenEvents.add(ev.name);

      // Convention: event names are lowercase kebab/bare (no `Callback` suffix).
      if (!/^[a-z][a-z0-9-]*$/.test(ev.name)) {
        this.#warn(`invalid event table: event "${ev.name}" should be lowercase kebab-case (e.g. "date-select")`);
      }
      // A composed native name would reach host listeners twice (the browser's and ours).
      if (COMPOSED_NATIVE_EVENT.test(ev.name)) {
        this.#warn(`invalid event table: event "${ev.name}" reuses a composed native event name — prefix the domain (e.g. "node-${ev.name}")`);
      }
      // The managed `on<Name>` property must not collide with an input property.
      if (ev.property && seenKeys.has(ev.property)) {
        this.#warn(`invalid event table: event "${ev.name}" property "${ev.property}" collides with an input configKey`);
      }
    }
  }

  /**
   * Input / table validation warning, logged through this element's instance
   * logger (`INIT` category, else the bundle's first; `CORE:ELEMENT` when the
   * tag has no bundle). Visible at the default `warn` level; silenced like any
   * other line by `disableLogging()`.
   */
  #warn(message: string, ...detail: unknown[]): void {
    coreLog(this, 'INIT', 'ELEMENT').warn(message, ...detail);
  }

  /**
   * Take a value assigned before upgrade (an own data property shadowing the
   * accessor about to be installed) off the instance, so it can be re-applied
   * through that accessor.
   */
  #liftPreUpgrade(key: string): { had: false } | { had: true; value: unknown } {
    if (!Object.prototype.hasOwnProperty.call(this, key)) return { had: false };
    const value = (this as Record<string, unknown>)[key];
    delete (this as Record<string, unknown>)[key];
    return { had: true, value };
  }

  #installAccessors(defs: readonly InputDef[]): void {
    for (const def of defs) {
      const key = def.configKey;
      const pre = this.#liftPreUpgrade(key);
      Object.defineProperty(this, key, {
        configurable: true,
        enumerable: true,
        get: typeof def.getLiveValue === 'function' ? () => this.#readLive(def) : () => this.#config[key],
        set: (value: unknown) => this.#setFromProperty(def, value),
      });
      // Re-apply through the setter. Only an ACCEPTED value is remembered so the
      // initial attribute can't clobber it (see attributeChangedCallback) — a
      // rejected one must not block a valid initial attribute.
      if (pre.had && this.#setFromProperty(def, pre.value) && def.attribute) {
        // The browser replays this attribute right after the constructor; skip that replay.
        const initial = this.getAttribute(def.attribute);
        if (initial !== null) (this.#preUpgradeKeys ??= new Map()).set(key, initial);
      }
    }
  }

  /**
   * Install the `on<Name>` twin property per event. It holds a plain function
   * that {@link emit} calls with the event detail (not the `CustomEvent`) —
   * the config-style twin of the DOM event. Not a listener: listeners use
   * `addEventListener` / {@link on}.
   */
  #installEventAccessors(events: readonly NormalizedEventDef[]): void {
    for (const ev of events) {
      const prop = ev.property;
      if (!prop) continue;
      const eventName = ev.name;
      // Preserve a handler assigned before upgrade, then route it through the setter.
      const pre = this.#liftPreUpgrade(prop);
      Object.defineProperty(this, prop, {
        configurable: true,
        enumerable: true,
        get: () => this.#eventHandlers.get(eventName) ?? null,
        set: (handler: unknown) => {
          if (typeof handler === 'function') this.#eventHandlers.set(eventName, handler as (detail: unknown) => void);
          else if (handler == null) this.#eventHandlers.delete(eventName); // null / undefined clear it
          // Anything else is a mistake (a string from a template, a misspelled object): keep the handler.
          else this.#warn(`rejected ${prop}: expected a function or null; keeping the previous handler`, handler);
        },
      });
      if (pre.had) (this as Record<string, unknown>)[prop] = pre.value;
    }
  }

  /**
   * Getter for an input with `getLiveValue` (SPEC §4.1): the live state once the
   * element has built, else the stored value. The stored (assigned) value wins
   * while this input's write is staged but not applied yet, after a failed
   * `reinit()`, and whenever `getLiveValue` returns `undefined`.
   */
  #readLive(def: InputDef): unknown {
    const key = def.configKey;
    if (!this.#hasBuilt || this.#hasFailedReinit || (this.#pending !== null && key in this.#pending) || (this.#failedPartial !== null && key in this.#failedPartial)) {
      return this.#config[key];
    }
    const live = def.getLiveValue!(this);
    return live === undefined ? this.#config[key] : live;
  }

  /** Stage a JS-assigned value; `false` when the converter rejected it (warned, previous value kept). */
  #setFromProperty(def: InputDef, value: unknown): boolean {
    // `el.x = undefined` resets the input — exactly like removing its attribute: the default
    // (the converter's answer for "absent", else the row default), and it is no longer
    // explicitly set, so page responsive rules reach it again.
    if (value === undefined) {
      const resolved = resolveFromAttribute(def, null, this as unknown as AttrReader);
      this.#explicit.delete(def.configKey);
      this.#stageExplicit(def, resolved, true);
      return true;
    }
    const resolved = resolveFromProperty(def, value);
    if (!resolved) {
      this.#warn(`rejected invalid value for property "${def.configKey}"; keeping previous value`, value);
      return false;
    }
    this.#explicit.add(def.configKey);
    this.#stageExplicit(def, resolved, true);
    return true;
  }

  /** Reflect a just-staged property value to its attribute, if the row asks for it. */
  #reflect(def: InputDef, value: unknown): void {
    const { attribute, converter } = def;
    if (!def.shouldReflect || !attribute || !converter?.toAttribute) return;
    let attrVal: string | null;
    try {
      attrVal = converter.toAttribute(value as never);
    } catch (err) {
      // The value is already staged; a value the converter can't serialise (circular
      // data, BigInt) just isn't mirrored to the attribute.
      this.#warn(`converter for "${def.configKey}" threw serialising it to attribute ${attribute}; attribute left as it was`, err);
      return;
    }
    this.#withoutReflect(attribute, () => {
      if (attrVal === null) this.removeAttribute(attribute);
      else this.setAttribute(attribute, attrVal);
    });
  }

  /**
   * Stage an explicitly set input (property → reflected; attribute → already
   * there), then the values its `getBatchValuesCallback` returns into the same
   * batch (SPEC §6.2).
   */
  #stageExplicit(def: InputDef, resolved: Resolved, isProperty = false): void {
    (this.#explicitKeys ??= new Set()).add(def.configKey);
    this.#stage(resolved);
    if (isProperty) this.#reflect(def, resolved.value);
    if (def.getBatchValuesCallback) this.#stageBatchValues(def, resolved.value);
  }

  #stageBatchValues(source: InputDef, value: unknown): void {
    let values: Record<string, unknown> | null | undefined;
    try {
      values = source.getBatchValuesCallback!(value as never, this.#base);
    } catch (err) {
      this.#warn(`getBatchValuesCallback of "${source.configKey}" threw; no other inputs set`, err);
      return;
    }
    if (!values) return;
    for (const [key, v] of Object.entries(values)) {
      const def = this.#byConfigKey.get(key);
      if (!def || key === source.configKey) {
        this.#warn(`getBatchValuesCallback of "${source.configKey}" returned ${def ? 'its own key' : 'unknown input'} "${key}"; skipped`);
        continue;
      }
      if (this.#explicitKeys?.has(key)) continue; // set explicitly in this batch — it wins
      const resolved = resolveFromProperty(def, v);
      if (!resolved) {
        this.#warn(`getBatchValuesCallback of "${source.configKey}" returned an invalid value for "${key}"; skipped`, v);
        continue;
      }
      this.#stage(resolved);
      if (this.#connectedOnce) this.#reflect(def, resolved.value);
      else (this.#deferredReflect ??= new Set()).add(def);
    }
  }

  /** Write our own attribute `name` without its `attributeChangedCallback` feeding it back in. */
  #withoutReflect(name: string, write: () => void): void {
    const previous = this.#reflectingAttribute;
    this.#reflectingAttribute = name;
    try {
      write();
    } finally {
      this.#reflectingAttribute = previous;
    }
  }

  /** Stage a BASE write; the effective value is the base unless a responsive rule wins (SPEC §6.7). */
  #stage(resolved: Resolved): void {
    this.#base[resolved.configKey] = resolved.value;
    this.#stageEffective(resolved, this.#effectiveValue(resolved.configKey));
  }

  /** Write an effective value (getter / `config` / field) and queue it per the input's `on`. */
  #stageEffective(resolved: Pick<Resolved, 'configKey' | 'field' | 'on'>, value: unknown): void {
    this.#config[resolved.configKey] = value;
    if (resolved.field) (this as Record<string, unknown>)[resolved.field] = value;
    if (resolved.on === 'none') return; // store only
    if (resolved.on === 'reinit') this.#pendingReinit = true;
    (this.#pending ??= {})[resolved.configKey] = value;
    this.#scheduler.schedule(this.#boundFlush);
  }

  // ── responsive internals (SPEC §6.7) ──────────────────────────────────────

  /** Responsive rules apply only to elements with an input table (nothing to set otherwise). */
  #hasInputs(): boolean {
    return this.#byConfigKey.size > 0;
  }

  /**
   * The effective value of `key`: instance rule > explicit instance value > page
   * rule (unless an instance rule opted out) > base.
   */
  #effectiveValue(key: string): unknown {
    if (key in this.#ruleInstance) return this.#ruleInstance[key];
    if (!this.#explicit.has(key) && !this.#isRuleOptOut && key in this.#rulePage) return this.#rulePage[key];
    return this.#base[key];
  }

  /**
   * Log a responsive problem once per element — or once per PAGE when it is about the
   * page-wide rules (`window.components.responsive*`), which every element reads.
   */
  #warnResponsiveOnce(message: string, ...detail: unknown[]): void {
    const isPageWide = message.startsWith('window.components.responsive');
    const warned = isPageWide
      ? sharedState(sharedStateKey('responsive-page-warnings'), () => new Set<string>())
      : (this.#responsiveWarned ??= new Set());
    if (warned.has(message)) return;
    warned.add(message);
    this.#warn(message, ...detail);
  }

  /** The `responsive` attribute (JSON) → the instance map; invalid JSON warns and keeps the previous map. */
  #setResponsiveFromAttribute(raw: string | null): void {
    if (raw === null || raw.trim() === '') {
      this.responsive = null;
      return;
    }
    let parsed: unknown;
    let isValid = true;
    try {
      parsed = JSON.parse(raw);
    } catch {
      isValid = false;
    }
    if (!isValid || (parsed !== null && !isResponsiveMap(parsed))) {
      this.#warn(`rejected invalid value for attribute ${RESPONSIVE_ATTRIBUTE}="${raw}" (a JSON object { "device"?, "breakpoint"? }); keeping previous value`);
      return;
    }
    this.responsive = parsed as ResponsiveMap | null;
  }

  /**
   * Merge one rule result into `out`: each key validated by its input's converter;
   * unknown / reserved / invalid keys warn and are skipped. Returns `true` when the
   * result is `null` (the instance opt-out signal; the caller decides if it counts).
   * Unknown keys from the GLOBAL page layers are skipped silently — a page-wide rule
   * legitimately names inputs only some components have.
   */
  #mergeRule(result: unknown, label: string, out: Record<string, unknown>, isGlobal = false): boolean {
    if (result === null) return true;
    if (result === undefined) return false;
    if (!isResponsiveMap(result)) {
      this.#warnResponsiveOnce(`${label} returned a non-object; ignored`, result);
      return false;
    }
    for (const [key, value] of Object.entries(result)) {
      if (value === undefined) continue;
      if (RESPONSIVE_RESERVED_KEYS.has(key)) {
        this.#warnResponsiveOnce(`${label}: reserved key "${key}" skipped`);
        continue;
      }
      const def = this.#byConfigKey.get(key);
      if (!def) {
        if (!isGlobal) this.#warnResponsiveOnce(`${label}: unknown key "${key}" skipped`);
        continue;
      }
      if (!resolveFromProperty(def, value)) {
        this.#warnResponsiveOnce(`${label}: invalid value for "${key}" skipped`, value);
        continue;
      }
      // The browser disables a form-associated host by its own `disabled` ATTRIBUTE, and
      // responsive overrides never reflect — so an override could only half-disable it.
      if (def.attribute === 'disabled' && (this.constructor as { formAssociated?: boolean }).formAssociated) {
        this.#warnResponsiveOnce(`${label}: "${key}" can't be set by a responsive rule (disabling must reflect to the attribute); skipped`);
        continue;
      }
      out[key] = value;
      // Same rule as an explicit write (SPEC §6.2): the input's batch values come along,
      // at this layer, unless this rule names them itself.
      if (def.getBatchValuesCallback) this.#mergeBatchValues(def, value, result as Record<string, unknown>, label, out);
    }
    return false;
  }

  /** {@link #mergeRule}: add the values `source`'s `getBatchValuesCallback` implies for `value`. */
  #mergeBatchValues(source: InputDef, value: unknown, rule: Record<string, unknown>, label: string, out: Record<string, unknown>): void {
    let implied: Record<string, unknown> | null | undefined;
    try {
      implied = source.getBatchValuesCallback!(value as never, this.#base);
    } catch (err) {
      this.#warnResponsiveOnce(`${label}: getBatchValuesCallback of "${source.configKey}" threw; no other inputs set`, err);
      return;
    }
    if (!implied) return;
    for (const [key, v] of Object.entries(implied)) {
      if (key === source.configKey || rule[key] !== undefined) continue; // the rule's own value wins
      const def = this.#byConfigKey.get(key);
      if (!def || !resolveFromProperty(def, v)) continue;
      out[key] = v;
    }
  }

  /**
   * Merge one responsive map (SPEC §6.7) into `out`: the `breakpoint` entry
   * (width bucket) first, then the `device` entry (`classifyDevice`) over it —
   * device wins on the same key. Any other top-level key (e.g. the pre-rc15
   * `{ mobile: … }` shape) warns once per element and is ignored; a non-object
   * axis likewise. Returns `true` when either axis entry is `null` (the instance
   * opt-out signal; the caller decides if it counts).
   */
  #mergeMap(
    map: ResponsiveMap,
    deviceClass: string,
    breakpoint: string,
    label: string,
    out: Record<string, unknown>,
    isGlobal = false,
  ): boolean {
    const unknown = Object.keys(map).filter((key) => !(RESPONSIVE_MAP_AXES as readonly string[]).includes(key));
    if (unknown.length > 0) {
      this.#warnResponsiveOnce(
        `${label}: unknown top-level key(s) ${unknown.map((k) => `"${k}"`).join(', ')} ignored — a responsive map is { device?: { <deviceClass>: {…} }, breakpoint?: { <breakpoint>: {…} } }`,
      );
    }
    let isNull = false;
    const axes: Array<[ResponsiveMapAxis, string]> = [
      ['breakpoint', breakpoint],
      ['device', deviceClass],
    ];
    for (const [axis, key] of axes) {
      const entries = map[axis];
      if (entries == null) continue;
      if (!isResponsiveMap(entries)) {
        this.#warnResponsiveOnce(`${label}.${axis} must be an object; ignored`, entries);
        continue;
      }
      if (this.#mergeRule((entries as Record<string, unknown>)[key], `${label}.${axis}.${key}`, out, isGlobal)) isNull = true;
    }
    return isNull;
  }

  /** Call a rule callback; a throw is logged and counts as `undefined`. */
  #runRuleCallback(callback: ResponsiveCallback, ctx: ResponsiveContext, label: string): unknown {
    try {
      return callback(ctx);
    } catch (error) {
      coreLog(this, 'INIT', 'ELEMENT').error(`${label} threw; ignored`, error);
      return undefined;
    }
  }

  /**
   * Re-evaluate every responsive layer (SPEC §6.7) and stage the keys whose
   * EFFECTIVE value changed — one batch through the normal pipeline (update /
   * reinit per `on`), never reflected, never explicit. Unchanged result → nothing
   * staged. Runs on an environment flip (plus continuous width changes while a
   * callback layer applies), a rule change (instance or page), and at
   * every flush (base changes re-run the callbacks; the first build gets the rules).
   */
  #refreshResponsive(): void {
    if (this.#isDestroyed || !this.#hasInputs()) return;
    const tag = this.localName;
    const page = readPageRules(tag);
    const hasAny = !!(this.#responsiveMap || this.#responsiveCallback) || hasPageRules(page);
    const hasCallback = !!(this.#responsiveCallback || page.globalCallback || page.tagCallback);
    const hadOverrides = Object.keys(this.#ruleInstance).length > 0 || Object.keys(this.#rulePage).length > 0;
    this.#syncResponsiveEnv(hasAny, hasCallback);
    if (!hasAny && !hadOverrides) return;

    const instance: Record<string, unknown> = {};
    const pageOut: Record<string, unknown> = {};
    let isOptOut = false;
    if (hasAny) {
      const env = getEnvironment();
      const deviceClass = classifyDevice(env);
      const ctx: ResponsiveContext = {
        env,
        deviceClass,
        breakpoint: env.breakpoint,
        element: this,
        component: tag,
        config: Object.freeze({ ...this.#base }),
      };
      // Instance layers first (they decide the opt-out): map → callback.
      if (this.#responsiveMap) {
        if (this.#mergeMap(this.#responsiveMap, deviceClass, env.breakpoint, `<${tag}> responsive`, instance)) isOptOut = true;
      }
      if (this.#responsiveCallback) {
        const label = `<${tag}> responsiveCallback`;
        if (this.#mergeRule(this.#runRuleCallback(this.#responsiveCallback, ctx, label), label, instance)) isOptOut = true;
      }
      if (!isOptOut) {
        // Page layers, later wins: global map → global callback → per-tag map → per-tag callback.
        // A page-level `null` is the same as `undefined`.
        if (page.globalMap) {
          this.#mergeMap(page.globalMap, deviceClass, env.breakpoint, 'window.components.responsive', pageOut, true);
        }
        if (page.globalCallback) {
          const label = 'window.components.responsiveCallback';
          this.#mergeRule(this.#runRuleCallback(page.globalCallback, ctx, label), label, pageOut, true);
        }
        if (page.tagMap) {
          this.#mergeMap(page.tagMap, deviceClass, env.breakpoint, `window.components['${tag}'].responsive`, pageOut);
        }
        if (page.tagCallback) {
          const label = `window.components['${tag}'].responsiveCallback`;
          this.#mergeRule(this.#runRuleCallback(page.tagCallback, ctx, label), label, pageOut);
        }
      }
    }

    const keys = new Set([
      ...Object.keys(this.#ruleInstance),
      ...Object.keys(this.#rulePage),
      ...Object.keys(instance),
      ...Object.keys(pageOut),
    ]);
    this.#ruleInstance = instance;
    this.#rulePage = pageOut;
    this.#isRuleOptOut = isOptOut;
    for (const key of keys) {
      const def = this.#byConfigKey.get(key);
      if (!def) continue;
      const next = this.#effectiveValue(key);
      if (responsiveValueEqual(next, this.#config[key])) continue;
      this.#stageEffective({ configKey: key, field: def.field, on: def.on ?? 'update' }, next);
    }
  }

  /**
   * Observe the environment only while connected AND some rule layer is set (opt-in,
   * no cost otherwise): the discrete channel for any layer, plus the continuous
   * viewport channel (throttled) while a CALLBACK layer applies — a callback may
   * test `env.viewportWidth`, which moves between breakpoint lines. Maps are keyed
   * by device class / breakpoint — both discrete — so they stay on the discrete channel.
   */
  #syncResponsiveEnv(hasAny: boolean, hasCallback: boolean): void {
    const isLive = this.isConnected && !this.#isDestroyed;
    if (hasAny && isLive) {
      this.#responsiveEnvUnsub ??= observeEnvironment(() => this.#refreshResponsive(), { shouldFireImmediately: false });
    } else if (this.#responsiveEnvUnsub) {
      this.#responsiveEnvUnsub();
      this.#responsiveEnvUnsub = undefined;
    }
    if (hasCallback && isLive) {
      this.#responsiveViewportUnsub ??= observeViewport(() => this.#refreshResponsive(), { shouldFireImmediately: false });
    } else if (this.#responsiveViewportUnsub) {
      this.#responsiveViewportUnsub();
      this.#responsiveViewportUnsub = undefined;
    }
  }

  /** Drop the page-rule and environment subscriptions (disconnect / destroy). */
  #stopResponsive(): void {
    this.#responsiveUnsub?.();
    this.#responsiveUnsub = undefined;
    this.#responsiveEnvUnsub?.();
    this.#responsiveEnvUnsub = undefined;
    this.#responsiveViewportUnsub?.();
    this.#responsiveViewportUnsub = undefined;
  }

  /** Cancel any queued microtask and flush pending changes synchronously now. */
  #flushNow(): void {
    this.#scheduler.cancel();
    this.#flush();
  }

  #flush(): void {
    if (this.#isDestroyed) {
      // Inputs still store into `config`, but nothing is ever applied again.
      this.#pending = null;
      this.#pendingReinit = false;
      this.#resolveSettled();
      return;
    }
    if (!this.isConnected) return; // hold until connected
    if (this.#isHeld()) return; // hold until release() (SPEC §6.3)
    // A flush() from inside reinit()/update() (an imperative method's `this.flush()`)
    // is a no-op: the hook is already applying the batch, and writes it stages are
    // picked up by the next (microtask) flush. Without this a retried reinit() that
    // calls flush() would retry itself without bound.
    if (this.#isApplying) return;
    this.#isReleased = true; // building now — a later `defer` never re-holds
    // Responsive rules (SPEC §6.7) see the batch's base changes; the first build gets them too.
    // Whatever this stages is consumed right below, so the queued microtask is dropped.
    this.#refreshResponsive();
    this.#scheduler.cancel();
    const isRetry = this.#hasFailedReinit;
    const reinit = this.#pendingReinit || isRetry;
    // Keys of a patch that threw last time ride along (a rebuild absorbs them anyway).
    const partial = this.#failedPartial ? { ...this.#failedPartial, ...(this.#pending ?? {}) } : this.#pending;
    this.#failedPartial = null;
    this.#pendingReinit = false;
    this.#pending = null;
    // The partial carries EFFECTIVE values (a base write under an instance rule keeps the rule's value).
    if (partial) for (const key of Object.keys(partial)) partial[key] = this.#config[key];
    if (this.#deferredReflect) {
      // An input set explicitly since (markup attribute, property) keeps its own state.
      for (const def of this.#deferredReflect) {
        if (!this.#explicitKeys?.has(def.configKey)) this.#reflect(def, this.#base[def.configKey]);
      }
      this.#deferredReflect = null;
    }
    this.#explicitKeys = null; // the batch ends here
    this.#isApplying = true;
    try {
      // A reinit rebuilds from full config, so it absorbs any update keys in the batch.
      if (reinit) this.reinit();
      else if (partial && Object.keys(partial).length > 0) this.update(partial);
    } catch (err) {
      // Rethrow (no silent swallow), but don't wedge: rebuild on the next flush,
      // and still release whenSettled() waiters in `finally`.
      if (reinit) this.#hasFailedReinit = true;
      // A failed patch keeps its keys for the next flush (whatever triggers it), so
      // they're applied again instead of leaving `config` and the rendered state apart.
      else if (partial) this.#failedPartial = partial;
      throw err;
    } finally {
      this.#isApplying = false;
      this.#resolveSettled();
    }
    this.#hasFailedReinit = false;
    if (reinit) this.#hasBuilt = true;
    try {
      this.#syncDisabled(reinit);
    } finally {
      // A rebuild that finally succeeded while connected activates what the failed one
      // skipped — even when disabledChanged() threw.
      if (isRetry) this.#activate();
    }
  }

  /** Resolve everyone awaiting {@link whenSettled} for the flush that just ran. */
  #resolveSettled(): void {
    if (this.#settleResolvers.length === 0) return;
    const resolvers = this.#settleResolvers;
    this.#settleResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}
