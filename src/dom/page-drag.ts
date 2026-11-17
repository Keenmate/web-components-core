/**
 * Page-wide "something of type X is being dragged over the page" (SPEC §12.28) — the `armed` state of a
 * drop target (web-dropzone's `highlight-on-page-drag`), from web-dropzone's `page-file-drag.ts`.
 *
 * One window listener set per copy of core, shared by every watcher (the first subscriber adds them, the
 * last removes them); per watcher only drags carrying one of its `types` count (`'Files'` = files from
 * the OS; a custom type like `'application/x-km-tree-node'` for an in-page source that sets it).
 *
 * Start: the first matching `dragenter` / `dragover` anywhere. End, whichever comes first: `drop`
 * anywhere, the drag leaving the window (an enter / leave depth counter), `dragend`, Escape, or the
 * `dragover` heartbeat stopping for 350 ms (Escape on an EXTERNAL drag never reaches JS). Capture phase on
 * `window`, so a target's `stopPropagation()` can't hide anything.
 */

export interface WatchPageDragOptions {
  /** `dataTransfer.types` that count (any of them); default `['Files']`. */
  types?: readonly string[];
  /** `true` when a matching drag starts over the page, `false` when it ends. Not called on subscribe. */
  onChange: (isArmed: boolean) => void;
}

const HEARTBEAT_TIMEOUT_MS = 350;
const HEARTBEAT_CHECK_MS = 150;
const CAPTURE: AddEventListenerOptions = { capture: true };

interface Watcher {
  types: readonly string[];
  onChange: (isArmed: boolean) => void;
  isArmed: boolean;
}

const watchers = new Set<Watcher>();
let depth = 0;
let lastPulseAt = 0;
let heartbeat: ReturnType<typeof setInterval> | null = null;

const carries = (e: DragEvent, types: readonly string[]): boolean => {
  const list = e.dataTransfer?.types;
  return !!list && types.some((t) => Array.prototype.includes.call(list, t));
};

function set(watcher: Watcher, isArmed: boolean): void {
  if (watcher.isArmed === isArmed) return;
  watcher.isArmed = isArmed;
  try {
    watcher.onChange(isArmed);
  } catch {
    // a watcher's own failure must not stop the others
  }
}

function anyArmed(): boolean {
  for (const w of watchers) if (w.isArmed) return true;
  return false;
}

function startHeartbeat(): void {
  lastPulseAt = Date.now();
  heartbeat ??= setInterval(() => {
    if (Date.now() - lastPulseAt > HEARTBEAT_TIMEOUT_MS) endAll();
  }, HEARTBEAT_CHECK_MS);
}

function endAll(): void {
  depth = 0;
  if (heartbeat !== null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  for (const w of [...watchers]) set(w, false);
}

function arm(e: DragEvent): boolean {
  let isMatched = false;
  for (const w of [...watchers]) {
    if (!carries(e, w.types)) continue;
    isMatched = true;
    set(w, true);
  }
  if (isMatched) startHeartbeat();
  return isMatched;
}

function onDragEnter(e: DragEvent): void {
  if (arm(e)) depth++;
}

function onDragOver(e: DragEvent): void {
  const wasArmed = anyArmed();
  if (!arm(e)) return;
  lastPulseAt = Date.now();
  if (!wasArmed) depth = Math.max(depth, 1); // a drag that started before we listened
}

function onDragLeave(e: DragEvent): void {
  if (!anyArmed() || ![...watchers].some((w) => w.isArmed && carries(e, w.types))) return;
  depth = Math.max(0, depth - 1);
  if (depth === 0) endAll();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && anyArmed()) endAll();
}

function listen(isOn: boolean): void {
  const method = isOn ? 'addEventListener' : 'removeEventListener';
  window[method]('dragenter', onDragEnter as EventListener, CAPTURE);
  window[method]('dragover', onDragOver as EventListener, CAPTURE);
  window[method]('dragleave', onDragLeave as EventListener, CAPTURE);
  window[method]('drop', endAll, CAPTURE);
  window[method]('dragend', endAll, CAPTURE);
  window[method]('keydown', onKeyDown as EventListener, CAPTURE);
}

/** Watch page-wide drags of `types`; returns the (idempotent) unsubscribe. SSR-safe. */
export function watchPageDrag(options: WatchPageDragOptions): () => void {
  if (typeof window === 'undefined') return () => {};
  const watcher: Watcher = { types: options.types?.length ? [...options.types] : ['Files'], onChange: options.onChange, isArmed: false };
  if (watchers.size === 0) listen(true);
  watchers.add(watcher);
  return () => {
    if (!watchers.delete(watcher)) return;
    if (watchers.size === 0) {
      listen(false);
      endAll();
    }
  };
}

/** Expose an armed drop target on its host: the `armed` attribute + `:state(armed)` (like `ready`). */
export function applyArmedState(host: HTMLElement, internals: ElementInternals | null | undefined, isArmed: boolean): void {
  host.toggleAttribute('armed', isArmed);
  try {
    if (isArmed) internals?.states?.add('armed');
    else internals?.states?.delete('armed');
  } catch {
    // no CustomStateSet / only `--dashed` idents — the attribute is the hook
  }
}
