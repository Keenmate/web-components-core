/**
 * Demo `BlissElement`s for the interaction page (examples-interaction.html —
 * SPEC §12.5 events + before-callbacks, §12.12 `/actions`, §12.13 `/menu`).
 *
 *   - `<core-demo-emitter>`  fires `ping` (default dispatch: bubbles, not composed)
 *                            and `ping-wide` (`composed: true` in its event row);
 *                            has a `controller` facade + an `eventContext()` extra.
 *   - `<core-demo-event-shell>` hosts a `<core-demo-emitter>` inside its own
 *                            shadow root — the "does it leak out?" demo.
 *   - `<core-demo-guarded>`  a list whose `rename()` goes through
 *                            `runBeforeCallback` and whose `select()` goes
 *                            through `runBeforeCallbackEager`.
 *   - `<core-demo-toolbar>`  renders `/actions` items, runs clicks through
 *                            `runAction()` and fires the one `action` event.
 *   - `<core-demo-files>`    a file list with a right-click context menu and an
 *                            "Actions" dropdown, both via `/menu` `openMenu()`.
 *
 * Every element reports what it does to a page-supplied sink ({@link setTraceSink}).
 * Demo-only — not part of the published package (`files` ships `dist/` only).
 */
import {
  BlissElement,
  define,
  runBeforeCallback,
  runBeforeCallbackEager,
  toFunction,
  toObjectArray,
  toText,
} from './src/index.js';
import type { EventDef, InputDef } from './src/index.js';
import {
  isActionBusy,
  createMenuDivider,
  normalizeActionItems,
  readActionDataset,
  resolveActionItem,
  runAction,
} from './src/actions/index.js';
import type { ActionEventDetail, ActionItem, ActionSource, MenuEntry, MenuItem } from './src/actions/index.js';
import { openMenu } from './src/menu/index.js';
import type { MenuHandle, MenuInvocation } from './src/menu/index.js';

// ── trace sink ───────────────────────────────────────────────────────────────

export type TraceKind = 'hook' | 'event' | 'note' | 'error';
export type TraceSink = (el: HTMLElement, kind: TraceKind, what: string, detail?: string) => void;

let sink: TraceSink | null = null;

/** Route every demo element's trace lines to `fn` (the page's logs). */
export function setTraceSink(fn: TraceSink | null): void {
  sink = fn;
}

function trace(el: HTMLElement, kind: TraceKind, what: string, detail?: string): void {
  sink?.(el, kind, what, detail);
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const BASE_CSS = `
  :host { display: block; font: 500 .9rem system-ui, sans-serif; color: var(--kmwc-text-color-1); }
  button { font: inherit; padding: .3rem .7rem; border-radius: 6px; cursor: pointer;
           border: 1px solid var(--kmwc-border-color-strong); background: var(--kmwc-main-bg); color: inherit; }
  button[disabled] { opacity: .5; cursor: not-allowed; }
  .box { border: 1px solid var(--kmwc-border-color); border-radius: 10px; padding: .6rem .8rem;
         background: var(--kmwc-main-bg); }
  .title { font-weight: 700; margin-bottom: .4rem; }
  .meta { font: .75rem ui-monospace, monospace; color: var(--kmwc-text-color-3); }
`;

function shadow(el: HTMLElement): ShadowRoot {
  return el.shadowRoot ?? el.attachShadow({ mode: 'open' });
}

// ── IA01 · <core-demo-emitter> ───────────────────────────────────────────────

export type EmitterEvents = {
  ping: { count: number };
  'ping-wide': { count: number };
};

/** The public facade every detail carries as `controller`. */
export interface EmitterController {
  fire(name?: 'ping' | 'ping-wide'): void;
  readonly count: number;
}

export class EmitterDemo extends BlissElement<EmitterEvents, EmitterController> {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'Emitter' }), on: 'reinit' },
  ];

  protected static override events: readonly (string | EventDef)[] = [
    { name: 'ping', description: 'Default dispatch: bubbles, not composed.' },
    { name: 'ping-wide', composed: true, description: 'Composed: crosses shadow boundaries.' },
  ];

  /** How many events this element has emitted. */
  count = 0;

  protected override createController(): EmitterController {
    const el = this;
    return {
      fire: (name = 'ping') => el.fire(name),
      get count() {
        return el.count;
      },
    };
  }

  /** Enumerable extra on every detail (popup components put presentation flags here). */
  protected override eventContext(): object {
    return { emittedBy: this.id || this.localName };
  }

  /** Emit `ping` (or `ping-wide`) with `{ count }`. */
  fire(name: 'ping' | 'ping-wide' = 'ping'): void {
    this.count += 1;
    trace(this, 'hook', `emit('${name}')`, `{ count: ${this.count} }`);
    this.emit(name, { count: this.count });
    trace(this, 'note', 'emit() returned');
  }

  protected override reinit(): void {
    const root = shadow(this);
    root.innerHTML = `<style>${BASE_CSS} :host { display: inline-block; }</style>
      <div class="box"><div class="title"></div>
        <button type="button" class="do-fire" data-name="ping">emit ping</button>
        <button type="button" class="do-fire" data-name="ping-wide">emit ping-wide</button>
      </div>`;
    (root.querySelector('.title') as HTMLElement).textContent = this.config.label as string;
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.do-fire')) {
      btn.addEventListener('click', () => this.fire(btn.dataset.name as 'ping' | 'ping-wide'));
    }
  }
}

/** Wraps a `<core-demo-emitter>` in its own shadow root. */
export class EventShellDemo extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'Outer component' }), on: 'reinit' },
  ];

  /** The emitter inside this element's shadow root. */
  get inner(): EmitterDemo | null {
    return (this.shadowRoot?.querySelector('core-demo-emitter') as EmitterDemo | null) ?? null;
  }

  protected override reinit(): void {
    const root = shadow(this);
    root.innerHTML = `<style>${BASE_CSS}
        .shell { border: 2px dashed var(--kmwc-border-color-strong); border-radius: 12px; padding: .6rem; }
      </style>
      <div class="shell"><div class="meta"></div></div>`;
    (root.querySelector('.meta') as HTMLElement).textContent = `${this.config.label as string} — shadow root ↓`;
    const inner = document.createElement('core-demo-emitter');
    inner.id = `${this.id || 'shell'}-inner`;
    inner.setAttribute('label', 'Inner emitter (inside the shadow root)');
    if (this.dataset.log) inner.dataset.log = this.dataset.log;
    root.querySelector('.shell')!.append(inner);
  }
}

// ── IA02 · <core-demo-guarded> ───────────────────────────────────────────────

interface GuardedItem {
  id: string;
  label: string;
}

export type GuardedEvents = {
  'item-rename': { id: string; label: string };
  'item-select': { id: string };
};

export class GuardedDemo extends BlissElement<GuardedEvents> {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'beforeRenameCallback', converter: toFunction(), on: 'none' },
    { configKey: 'beforeSelectCallback', converter: toFunction(), on: 'none' },
  ];

  protected static override events: readonly (string | EventDef)[] = ['item-rename', 'item-select'];

  items: GuardedItem[] = [
    { id: 'alpha', label: 'Alpha' },
    { id: 'beta', label: 'Beta' },
    { id: 'gamma', label: 'Gamma' },
  ];

  selectedId: string | null = null;
  #renames = 0;

  /**
   * Rename an item: `beforeRenameCallback({ id, oldLabel, newLabel })` decides —
   * `false` rejects, `undefined` keeps `newLabel`, a string replaces it.
   */
  async rename(id: string): Promise<boolean> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    const newLabel = `${item.label.replace(/ #\d+$/, '')} #${++this.#renames}`;
    trace(this, 'hook', 'rename()', `proposes newLabel "${newLabel}"`);
    const ctx = this.withContext({ id, oldLabel: item.label, newLabel });
    const result = await runBeforeCallback<typeof ctx, string>(
      this.config.beforeRenameCallback as ((c: typeof ctx) => unknown) | null,
      ctx,
      'beforeRenameCallback',
    );
    if (result.isRejected) {
      trace(this, 'note', 'rejected — nothing renamed', JSON.stringify(result));
      return false;
    }
    item.label = result.hasValue ? String(result.value) : newLabel;
    trace(this, 'hook', 'renamed', `${JSON.stringify(result)} → label "${item.label}"`);
    this.#render();
    this.emit('item-rename', { id, label: item.label });
    return true;
  }

  /**
   * Select an item through `runBeforeCallbackEager`: a sync hook answers in the
   * same tick (the selection is visible right after `select()` returns); an
   * async one defers it. A returned id redirects the selection.
   */
  select(id: string): void {
    trace(this, 'hook', 'select()', `"${id}"`);
    const ctx = this.withContext({ id, previousId: this.selectedId });
    const result = runBeforeCallbackEager<typeof ctx, string>(
      this.config.beforeSelectCallback as ((c: typeof ctx) => unknown) | null,
      ctx,
      'beforeSelectCallback',
    );
    const apply = (r: Exclude<typeof result, Promise<unknown>>): void => {
      if (r.isRejected) {
        trace(this, 'note', 'selection rejected');
        return;
      }
      this.selectedId = r.hasValue ? String(r.value) : id;
      trace(this, 'hook', 'selected', `"${this.selectedId}"`);
      this.#render();
      this.emit('item-select', { id: this.selectedId });
    };
    if (result instanceof Promise) {
      trace(this, 'note', 'hook returned a Promise — selection waits for it');
      void result.then(apply);
    } else {
      apply(result);
    }
  }

  protected override reinit(): void {
    this.#render();
  }

  #render(): void {
    const root = shadow(this);
    root.innerHTML = `<style>${BASE_CSS}
        ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
        li { display: flex; gap: .5rem; align-items: center; padding: .3rem .5rem; border-radius: 8px;
             border: 1px solid var(--kmwc-border-color); }
        li[aria-selected="true"] { background: var(--kmwc-accent-light-bg-hover); border-color: var(--kmwc-accent-color); }
        .lbl { flex: 1; min-width: 0; }
      </style><div class="box"><ul role="listbox" aria-label="Guarded list"></ul></div>`;
    const ul = root.querySelector('ul')!;
    for (const item of this.items) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.id = item.id;
      li.setAttribute('aria-selected', String(item.id === this.selectedId));
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = item.label;
      const sel = document.createElement('button');
      sel.type = 'button';
      sel.className = 'do-select';
      sel.textContent = 'select';
      sel.addEventListener('click', () => this.select(item.id));
      const ren = document.createElement('button');
      ren.type = 'button';
      ren.className = 'do-rename';
      ren.textContent = 'rename';
      ren.addEventListener('click', () => void this.rename(item.id));
      li.append(lbl, sel, ren);
      ul.append(li);
    }
  }
}

// ── IA03 · <core-demo-toolbar> ───────────────────────────────────────────────

/** The toolbar's surface context: what every item callback and the `action` detail see. */
export interface ToolbarCtx {
  count: number;
}

export type ToolbarAction = 'add' | 'reset' | 'fail';
export type ToolbarDetail = ActionEventDetail<ToolbarCtx, ToolbarAction>;
export type ToolbarItem = ActionItem<ToolbarCtx, ToolbarAction>;

export class ToolbarDemo extends BlissElement<{ action: ToolbarDetail }> {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'items', converter: toObjectArray<ToolbarItem | string>(), on: 'reinit' },
    { configKey: 'beforeActionCallback', converter: toFunction(), on: 'none' },
  ];

  protected static override events: readonly (string | EventDef)[] = ['action'];

  /** The built-ins' state. */
  count = 0;

  protected override connect(): void {
    // HTML-authored buttons in the light DOM take part via data-action / data-id.
    this.addEventListener('click', this.#onLightClick);
  }

  protected override disconnect(): void {
    this.removeEventListener('click', this.#onLightClick);
  }

  #onLightClick = (event: Event): void => {
    const target = (event.target as Element | null)?.closest?.('[data-action]') as HTMLElement | null;
    if (!target || !this.contains(target)) return;
    // A synthetic item for markup — kept per element so the busy guard works.
    const item = (this.#htmlItems.get(target) ??
      this.#htmlItems.set(target, {
        action: (target.dataset.action as ToolbarAction | 'custom') ?? 'custom',
        id: target.dataset.id,
        text: target.textContent?.trim() ?? '',
      }).get(target))!;
    // No built-in source fits light-DOM markup; ActionSource takes any custom string.
    void this.#activate(item, target, event, 'markup');
  };

  #htmlItems = new WeakMap<HTMLElement, ToolbarItem>();

  #ctx(): ToolbarCtx {
    return this.withContext({ count: this.count });
  }

  /** The built-ins' own state (the `defaults` argument of resolveActionItem). */
  #defaults(item: ToolbarItem): { isDisabled?: boolean } {
    return item.action === 'reset' ? { isDisabled: this.count === 0 } : {};
  }

  async #runBuiltIn(detail: ToolbarDetail): Promise<void> {
    switch (detail.action) {
      case 'add':
        this.count += 1;
        trace(this, 'hook', 'built-in', `add → count = ${this.count}`);
        break;
      case 'reset':
        this.count = 0;
        trace(this, 'hook', 'built-in', 'reset → count = 0');
        break;
      case 'fail':
        trace(this, 'hook', 'built-in', 'fail → throws');
        throw new Error('demo: built-in "fail" threw');
      default:
        trace(this, 'note', 'no built-in for this item');
    }
  }

  async #activate(item: ToolbarItem, trigger: HTMLElement, sourceEvent: Event, source: ActionSource): Promise<void> {
    if (isActionBusy(item)) trace(this, 'note', 'item is busy — this activation is ignored');
    const detail = this.withContext({
      count: this.count,
      action: item.action ?? 'custom',
      id: item.id,
      item,
      source,
      sourceEvent,
      triggerElement: trigger,
      dataset: readActionDataset(trigger),
    }) as ToolbarDetail;
    const ran = await runAction<ToolbarCtx, ToolbarAction>({
      detail,
      beforeActionCallback: this.config.beforeActionCallback as ((d: ToolbarDetail) => unknown) | null,
      runBuiltIn: (d) => this.#runBuiltIn(d),
      emitAction: (d) => this.emit('action', d),
    });
    trace(this, 'note', `runAction() resolved ${ran}`);
    this.#render();
  }

  protected override reinit(): void {
    this.#render();
  }

  /** Re-render (re-resolves every item: disabled / toggled / text callbacks). */
  refresh(): void {
    this.flush();
    this.#render();
  }

  #render(): void {
    const root = shadow(this);
    root.innerHTML = `<style>${BASE_CSS}
        .bar { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
        button.danger { color: var(--kmwc-danger-color); border-color: currentColor; }
        button[aria-pressed="true"] { background: var(--kmwc-accent-light-bg-hover); border-color: var(--kmwc-accent-color); }
        button[aria-busy="true"] { opacity: .6; cursor: progress; }
        .count { margin-left: auto; font: 600 .85rem ui-monospace, monospace; }
        ::slotted(*) { margin-top: .5rem; }
      </style>
      <div class="box"><div class="bar" role="toolbar" aria-label="Demo toolbar"></div><slot></slot></div>`;
    const bar = root.querySelector('.bar')!;
    const ctx = this.#ctx();
    const items = normalizeActionItems((this.config.items as (ToolbarItem | string)[] | undefined) ?? []);
    for (const item of items) {
      const r = resolveActionItem(item, ctx, this.#defaults(item));
      if (!r.isVisible) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = r.text || r.action;
      // The item's own name / id, so readActionDataset() reports only the extra data-* (none here).
      btn.dataset.action = r.action;
      if (r.id) btn.dataset.id = r.id;
      if (r.tooltip) btn.title = r.tooltip;
      if (r.cssClass) btn.className = r.cssClass;
      if (r.isDanger) btn.classList.add('danger');
      btn.disabled = r.isDisabled;
      if (item.isToggled !== undefined || item.getIsToggledCallback) btn.setAttribute('aria-pressed', String(r.isToggled));
      btn.addEventListener('click', (e) => void this.#activate(item, btn, e, 'toolbar'));
      bar.append(btn);
    }
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `count = ${this.count}`;
    bar.append(count);
  }
}

// ── IA04 · <core-demo-files> ─────────────────────────────────────────────────

export interface DemoFile {
  name: string;
  isPinned: boolean;
  isLocked: boolean;
}

/** The menu's surface context: the file it opened on (`null` for the toolbar dropdown). */
export interface FilesCtx {
  file: DemoFile | null;
}

export type FilesAction = 'rename' | 'toggle-pin' | 'delete' | 'new-file' | 'sort';
export type FilesDetail = ActionEventDetail<FilesCtx, FilesAction>;
type FilesEntry = MenuEntry<FilesCtx, FilesAction>;
type FilesItem = MenuItem<FilesCtx, FilesAction>;

const FOLDERS = ['Documents', 'Pictures', 'Archive 2025'];

export class FilesDemo extends BlissElement<{ action: FilesDetail }> {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'beforeActionCallback', converter: toFunction(), on: 'none' },
  ];

  protected static override events: readonly (string | EventDef)[] = ['action'];

  files: DemoFile[] = [
    { name: 'report.pdf', isPinned: false, isLocked: false },
    { name: 'budget.xlsx', isPinned: true, isLocked: false },
    { name: 'contract.docx', isPinned: false, isLocked: true },
  ];

  /** The currently open menu (one at a time). */
  menu: MenuHandle | null = null;

  /** The row (context) menu entries. */
  #rowEntries(): FilesEntry[] {
    return [
      { id: 'open', text: 'Open', shortcut: 'O' },
      { action: 'rename', text: 'Rename', shortcut: 'F2' },
      {
        action: 'toggle-pin',
        text: 'Pinned',
        getIsToggledCallback: (ctx) => !!ctx.file?.isPinned,
        shouldCloseOnClick: false,
      },
      createMenuDivider(),
      {
        text: 'Share',
        children: [
          { id: 'copy-link', text: 'Copy link' },
          { id: 'email', text: 'Email…' },
          createMenuDivider(),
          { text: 'More', children: [{ id: 'qr', text: 'QR code' }, { id: 'embed', text: 'Embed code' }] },
        ],
      },
      {
        text: 'Move to',
        getChildrenCallback: async () => {
          await delay(700);
          return FOLDERS.map((f) => ({ id: `move:${f}`, text: f }));
        },
      },
      createMenuDivider('Danger zone'),
      {
        id: 'archive',
        text: 'Archive',
        tooltip: 'Disabled for a locked file',
        getIsDisabledCallback: (ctx) => !!ctx.file?.isLocked,
      },
      { action: 'delete', text: 'Delete', isDanger: true, shortcut: 'Delete' },
    ];
  }

  /** The "Actions" dropdown entries. */
  #barEntries(): FilesEntry[] {
    return [
      { action: 'new-file', text: 'New file', shortcut: 'N' },
      {
        text: 'Sort by',
        children: [
          { action: 'sort', id: 'name', text: 'Name' },
          { action: 'sort', id: 'pinned', text: 'Pinned first' },
        ],
      },
      createMenuDivider(),
      { id: 'hidden-item', text: 'Never shown', isVisible: false },
      { id: 'help', text: 'Help', shortcut: 'H' },
    ];
  }

  async #runBuiltIn(detail: FilesDetail): Promise<void> {
    const file = detail.file;
    switch (detail.action) {
      case 'rename':
        if (file) file.name = file.name.replace(/^(?:renamed-)?/, 'renamed-');
        break;
      case 'toggle-pin':
        if (file) file.isPinned = !file.isPinned;
        break;
      case 'delete':
        if (file) this.files = this.files.filter((f) => f !== file);
        break;
      case 'new-file':
        this.files.push({ name: `new-${this.files.length + 1}.txt`, isPinned: false, isLocked: false });
        break;
      case 'sort':
        this.files.sort((a, b) =>
          detail.id === 'pinned' ? Number(b.isPinned) - Number(a.isPinned) : a.name.localeCompare(b.name),
        );
        break;
      default:
        return;
    }
    trace(this, 'hook', 'built-in', `${detail.action}${file ? ` on ${file.name}` : ''}`);
    this.#renderList();
  }

  #run(item: FilesItem, inv: MenuInvocation, ctx: FilesCtx, source: ActionSource): Promise<boolean> {
    const detail = this.withContext({
      ...ctx,
      action: item.action ?? 'custom',
      id: item.id,
      item,
      source,
      sourceEvent: inv.sourceEvent,
      triggerElement: inv.triggerElement,
      dataset: readActionDataset(inv.triggerElement),
    }) as FilesDetail;
    return runAction<FilesCtx, FilesAction>({
      detail,
      beforeActionCallback: this.config.beforeActionCallback as ((d: FilesDetail) => unknown) | null,
      runBuiltIn: (d) => this.#runBuiltIn(d),
      emitAction: (d) => this.emit('action', d),
    });
  }

  /** Open a menu of `entries` for `ctx` at a point or below an element. */
  open(
    entries: FilesEntry[],
    ctx: FilesCtx,
    at: { x: number; y: number } | Element,
    returnFocusTo: HTMLElement,
    shouldFocusFirst: boolean,
    source: ActionSource,
  ): MenuHandle {
    this.menu?.close();
    const what = ctx.file ? `on ${ctx.file.name}` : 'dropdown';
    trace(this, 'hook', 'openMenu()', `${what}${shouldFocusFirst ? ' (keyboard: focus first item)' : ''}`);
    const handle = openMenu<FilesCtx, FilesAction>(entries, ctx, {
      at,
      host: shadow(this),
      placement: 'bottom-start',
      returnFocusTo,
      shouldFocusFirst,
      inheritThemeFrom: this,
      runAction: (item, inv) => this.#run(item, inv, ctx, source),
      onClose: (reason) => {
        trace(this, 'event', 'onClose', `reason "${reason}"`);
        if (this.menu === handle) this.menu = null;
      },
    });
    this.menu = handle;
    return handle;
  }

  protected override reinit(): void {
    const root = shadow(this);
    root.innerHTML = `<style>${BASE_CSS}
        /* Per-instance theming: the component maps ITS variable onto the private
           --_km-menu-* layer, with no fallback (SPEC §12.13). */
        :host {
          --_km-menu-bg: var(--dfm-menu-bg);
          --_km-menu-hover-bg: var(--dfm-menu-hover-bg);
        }
        .head { display: flex; gap: .5rem; align-items: center; margin-bottom: .5rem; }
        .head .meta { margin-left: auto; }
        ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
        li { padding: .4rem .6rem; border-radius: 8px; border: 1px solid var(--kmwc-border-color);
             cursor: context-menu; display: flex; gap: .5rem; }
        li:focus-visible { outline: 2px solid var(--kmwc-accent-color); outline-offset: 1px; }
        .tag { font: .7rem ui-monospace, monospace; padding: .05rem .4rem; border-radius: 999px;
               background: var(--kmwc-elevated-bg); color: var(--kmwc-text-color-2); }
      </style>
      <div class="box">
        <div class="head">
          <button type="button" class="do-actions" aria-haspopup="menu">Actions ▾</button>
          <span class="meta">right-click a file, or focus it and press Shift+F10</span>
        </div>
        <ul aria-label="Files"></ul>
      </div>`;
    const btn = root.querySelector('.do-actions') as HTMLButtonElement;
    btn.addEventListener('click', (e) => {
      // detail === 0: activated from the keyboard (Enter / Space) → focus the first item.
      this.open(this.#barEntries(), this.withContext({ file: null }), btn, btn, (e as MouseEvent).detail === 0, 'toolbar');
    });
    this.#renderList();
  }

  #renderList(): void {
    const ul = this.shadowRoot?.querySelector('ul');
    if (!ul) return;
    // Keep keyboard focus on the same file across a re-render (rename, sort, …).
    const focusedFile = this.#rowFile.get(this.shadowRoot!.activeElement as HTMLElement);
    ul.replaceChildren();
    for (const file of this.files) {
      const li = document.createElement('li');
      this.#rowFile.set(li, file);
      li.tabIndex = 0;
      li.dataset.name = file.name;
      li.textContent = file.name;
      if (file.isPinned) li.insertAdjacentHTML('beforeend', '<span class="tag">pinned</span>');
      if (file.isLocked) li.insertAdjacentHTML('beforeend', '<span class="tag">locked</span>');
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.open(this.#rowEntries(), this.withContext({ file }), { x: e.clientX, y: e.clientY }, li, false, 'context-menu');
      });
      li.addEventListener('keydown', (e) => {
        if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          e.preventDefault();
          this.open(this.#rowEntries(), this.withContext({ file }), li, li, true, 'context-menu');
        }
      });
      ul.append(li);
      if (file === focusedFile) li.focus();
    }
  }

  #rowFile = new WeakMap<HTMLElement, DemoFile>();

  protected override disconnect(): void {
    this.menu?.close();
  }
}

define('core-demo-emitter', EmitterDemo as unknown as CustomElementConstructor);
define('core-demo-event-shell', EventShellDemo as unknown as CustomElementConstructor);
define('core-demo-guarded', GuardedDemo as unknown as CustomElementConstructor);
define('core-demo-toolbar', ToolbarDemo as unknown as CustomElementConstructor);
define('core-demo-files', FilesDemo as unknown as CustomElementConstructor);
