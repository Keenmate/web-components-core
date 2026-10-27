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
 * SSR base plus
 * `dispatch`/`define` (web-grid's use). See docs/SPEC.md §6.
 */
import { resolveFromAttribute, resolveFromProperty, type Resolved } from '../inputs/apply.js';
import { deriveClearableKeys } from '../inputs/clearable.js';
import { collectEngineConfig } from '../inputs/engine-config.js';
import type { AttrReader, InputDef } from '../inputs/types.js';
import { createMicrotaskScheduler, type MicrotaskScheduler } from '../dom/microtask-scheduler.js';
import { observeEnvironment, observeViewport, type EnvironmentSnapshot } from '../environment/environment.js';
import { observeElementSize, type ElementSize } from '../environment/element-size.js';
import {
  observeThemeContext,
  THEME_CONTEXT_ATTRIBUTE,
  THEME_SOURCE_ATTRIBUTE,
  type ColorScheme,
  type ThemeSource,
} from '../environment/theme.js';
import { trackInstance, untrackInstance } from '../global/instances.js';
import { coreLog, getElementLoggers, setInstanceLogLevelSource } from '../logging/element-logger.js';
import type { InstanceLogger, LogLevelDesc } from '../logging/create-loggers.js';
import { dispatch, type DispatchOptions } from './dispatch.js';
import { withComponentContext, type ComponentContext, type EmitDetail } from './context.js';
import {
  normalizeEventDefs,
  withCoreEvents,
  type EventDef,
  type EventMap,
  type NormalizedEventDef,
} from './events.js';

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
    // writing-direction switch reaches the directionChanged() hook, and
    // `theme-source` (SPEC §12.10) so a component can read its theme from a chosen
    // element. Deduped in case a subclass declares either as an input attribute.
    // `defer` (SPEC §6.3) is the build gate every component gets.
    for (const global of ['dir', THEME_SOURCE_ATTRIBUTE, DEFER_ATTRIBUTE]) {
      if (!attrs.includes(global)) attrs.push(global);
    }
    return attrs;
  }

  readonly #config: Record<string, unknown> = {};
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
   * guarantee); post-connect attribute changes react normally. Cleared on first
   * connect.
   */
  #preUpgradeKeys: Set<string> | null = null;
  #reflecting = false;
  /** `connect()` ran and `disconnect()` hasn't yet — keeps the two balanced when a build throws. */
  #isActive = false;
  /**
   * The last `reinit()` threw, so the structure may be missing or half-built.
   * The next flush rebuilds instead of patching. Separate from `#pendingReinit`
   * so a failed build doesn't leave {@link whenSettled} waiting on a flush that
   * nothing schedules.
   */
  #hasFailedReinit = false;
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
  #isFormDisabled = false;
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
    // A subclass declaring its own `shouldDefer` input owns the property.
    if (!this.#byConfigKey.has('shouldDefer')) {
      const pre = this.#liftPreUpgrade('shouldDefer');
      if (pre.had) this.#preUpgradeDefer = !!pre.value;
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  attributeChangedCallback(name: string, _old: string | null, raw: string | null): void {
    if (this.#reflecting) return;
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
    const def = this.#byAttribute.get(name);
    if (!def) return;
    // A property assigned before upgrade wins over the initial attribute the
    // browser replays right after the constructor (see #preUpgradeKeys).
    if (!this.#connectedOnce && this.#preUpgradeKeys?.has(def.configKey)) return;
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
    if (this.#connectedOnce) this.#reflect(def, this.#config[def.configKey]);
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
    this.connect();
    // Subscribe to device/viewport/orientation ONLY when the subclass opts in by
    // overriding environmentChanged — no global listeners for elements that don't
    // care. The subscribe fires immediately, so the hook gets the current snapshot
    // on connect, then again on every change until disconnect.
    if (this.environmentChanged !== BlissElement.prototype.environmentChanged) {
      this.#envUnsub = observeEnvironment((env) => this.environmentChanged(env));
    }
    // Same opt-in gate for the throttled continuous-viewport channel — a separate
    // subscription so an element pays the ~30ms size stream only if it overrides
    // viewportChanged, not merely environmentChanged.
    if (this.viewportChanged !== BlissElement.prototype.viewportChanged) {
      this.#viewportUnsub = observeViewport((env) => this.viewportChanged(env));
    }
    // Per-element size (own box, via a shared ResizeObserver) — same opt-in gate.
    // shouldFireImmediately: false so the first fire carries the real laid-out box (RO's initial
    // delivery), not a 0×0 read taken before layout during connect.
    if (this.sizeChanged !== BlissElement.prototype.sizeChanged) {
      this.#sizeUnsub = observeElementSize(this, (size) => this.sizeChanged(size), { shouldFireImmediately: false });
    }
    this.#subscribeTheme();
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
  }

  /**
   * First build is live (built + `connect()` ran): set the `ready` attribute and
   * `:state(ready)`, fire `ready` (+ `onReady`), resolve {@link whenReady}. Once
   * per element lifetime — a rebuild or reconnect never re-announces.
   */
  #announceReady(): void {
    this.#isReady = true;
    this.#withoutReflect(() => this.setAttribute(READY_ATTRIBUTE, ''));
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
   * pending until a later flush succeeds.
   */
  whenReady(): Promise<void> {
    if (this.#isReady) return Promise.resolve();
    return new Promise<void>((resolve) => this.#readyResolvers.push(resolve));
  }

  // ── public batching API ─────────────────────────────────────────────────

  /** Apply many inputs (by `configKey` or attribute name) as ONE reinit/update. */
  setAttributes(values: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(values)) {
      const def = this.#byConfigKey.get(key) ?? this.#byAttribute.get(key);
      if (def) this.#setFromProperty(def, value);
    }
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
   * flush — not before the change is actually applied.
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
    this.#pendingReinit = false;
    this.#hasFailedReinit = false;
    this.#resolveSettled();
    untrackInstance(this.localName, this);
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

  /** The current validated config. */
  protected get config(): Readonly<Record<string, unknown>> {
    return this.#config;
  }

  /**
   * The `configKey`s for which a `null` in {@link config} is a deliberate
   * "clear/reset" signal (the input's converter admits `null` — nullable
   * `toText`, tristate `toBool`, `toFunction`, `shouldNullOnInvalid` enums, or a
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
   * Turn on verbose logging for THIS element only (default `debug`), independent
   * of the type-level level. The seam a Ctrl-Alt-C overlay calls after the user
   * picks one instance. Pairs with {@link disableLogging}.
   */
  enableLogging(level: LogLevelDesc = 'debug'): void {
    this.#logLevel = level;
  }

  /** Clear this element's logging override (falls back to the type-level level). */
  disableLogging(): void {
    this.#logLevel = undefined;
  }

  /** Whether this element has an active logging override (not unset/`silent`). */
  get isLoggingEnabled(): boolean {
    return this.#logLevel != null && this.#logLevel !== 'silent' && this.#logLevel !== 5;
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
   * (leading + trailing)**; identical consecutive sizes are deduped. For a one-off
   * synchronous read, call `this.getBoundingClientRect()`.
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
    this.#withoutReflect(() => this.removeAttribute(THEME_SOURCE_ATTRIBUTE));
    this.#resubscribeTheme();
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
   */
  get form(): HTMLFormElement | null {
    return this.internals?.form ?? null;
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
    if (this.#isFormDisabled === isDisabled) return;
    this.#isFormDisabled = isDisabled;
    if (this.isConnected) this.#flushNow(); // ends with #syncDisabled(); a no-op while held
  }

  /**
   * Disabled by an ancestor `<fieldset disabled>` only (form-associated elements),
   * NOT by the element's own `disabled` attribute. Without the own attribute the
   * browser's state IS the fieldset state; with it the browser can't tell the two
   * apart (no callback fires for a fieldset flip then), so the ancestors are read.
   */
  protected get isFormDisabled(): boolean {
    if (!this.#isFormDisabled) return false;
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
        ? this.withContext((detail ?? {}) as object)
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
      if (def.field) (this as Record<string, unknown>)[def.field] = value;
    }
  }

  /** Sanity-check the input + event tables once per class; warn (never throw) on mistakes. */
  #validateOnce(defs: readonly InputDef[], events: readonly NormalizedEventDef[]): void {
    const ctor = this.constructor as object;
    if (VALIDATED.has(ctor)) return;
    VALIDATED.add(ctor);

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
        get: () => this.#config[key],
        set: (value: unknown) => this.#setFromProperty(def, value),
      });
      // Re-apply through the setter. Only an ACCEPTED value is remembered so the
      // initial attribute can't clobber it (see attributeChangedCallback) — a
      // rejected one must not block a valid initial attribute.
      if (pre.had && this.#setFromProperty(def, pre.value)) (this.#preUpgradeKeys ??= new Set()).add(key);
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
          else this.#eventHandlers.delete(eventName);
        },
      });
      if (pre.had) (this as Record<string, unknown>)[prop] = pre.value;
    }
  }

  /** Stage a JS-assigned value; `false` when the converter rejected it (warned, previous value kept). */
  #setFromProperty(def: InputDef, value: unknown): boolean {
    const resolved = resolveFromProperty(def, value);
    if (!resolved) {
      this.#warn(`rejected invalid value for property "${def.configKey}"; keeping previous value`, value);
      return false;
    }
    this.#stageExplicit(def, resolved, true);
    return true;
  }

  /** Reflect a just-staged property value to its attribute, if the row asks for it. */
  #reflect(def: InputDef, value: unknown): void {
    const { attribute, converter } = def;
    if (!def.shouldReflect || !attribute || !converter?.toAttribute) return;
    const attrVal = converter.toAttribute(value as never);
    this.#withoutReflect(() => {
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
      values = source.getBatchValuesCallback!(value as never, this.#config);
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

  /** Write our own attribute without `attributeChangedCallback` feeding it back in. */
  #withoutReflect(write: () => void): void {
    this.#reflecting = true;
    try {
      write();
    } finally {
      this.#reflecting = false;
    }
  }

  #stage(resolved: Resolved): void {
    this.#config[resolved.configKey] = resolved.value;
    if (resolved.field) (this as Record<string, unknown>)[resolved.field] = resolved.value;
    if (resolved.on === 'none') return; // store only
    if (resolved.on === 'reinit') this.#pendingReinit = true;
    (this.#pending ??= {})[resolved.configKey] = resolved.value;
    this.#scheduler.schedule(this.#boundFlush);
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
    this.#isReleased = true; // building now — a later `defer` never re-holds
    const isRetry = this.#hasFailedReinit;
    const reinit = this.#pendingReinit || isRetry;
    const partial = this.#pending;
    this.#pendingReinit = false;
    this.#pending = null;
    if (this.#deferredReflect) {
      // An input set explicitly since (markup attribute, property) keeps its own state.
      for (const def of this.#deferredReflect) {
        if (!this.#explicitKeys?.has(def.configKey)) this.#reflect(def, this.#config[def.configKey]);
      }
      this.#deferredReflect = null;
    }
    this.#explicitKeys = null; // the batch ends here
    try {
      // A reinit rebuilds from full config, so it absorbs any update keys in the batch.
      if (reinit) this.reinit();
      else if (partial && Object.keys(partial).length > 0) this.update(partial);
    } catch (err) {
      // Rethrow (no silent swallow), but don't wedge: rebuild on the next flush,
      // and still release whenSettled() waiters in `finally`.
      if (reinit) this.#hasFailedReinit = true;
      throw err;
    } finally {
      this.#resolveSettled();
    }
    this.#hasFailedReinit = false;
    this.#syncDisabled(reinit);
    // A rebuild that finally succeeded while connected activates what the failed one skipped.
    if (isRetry) this.#activate();
  }

  /** Resolve everyone awaiting {@link whenSettled} for the flush that just ran. */
  #resolveSettled(): void {
    if (this.#settleResolvers.length === 0) return;
    const resolvers = this.#settleResolvers;
    this.#settleResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}
