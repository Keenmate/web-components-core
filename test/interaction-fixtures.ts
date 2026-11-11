/**
 * Minimal fixture elements for the interaction e2e specs (events / actions / menu).
 * Independent of the example pages' demo elements on purpose: tests and examples
 * evolve separately.
 *
 *   - `<fx-emitter>`     fires `ping` (default: bubbles, not composed) and `ping-wide`
 *                        (`composed: true`); has a `controller` + an `eventContext()` extra.
 *   - `<fx-event-shell>` hosts an `<fx-emitter>` in its own shadow root.
 *   - `<fx-guarded>`     `rename()` via `runBeforeCallback`, `select()` via `runBeforeCallbackEager`.
 *   - `<fx-toolbar>`     `/actions` items through `runAction()` + one `action` event; light-DOM
 *                        `data-action` buttons join in.
 *   - `<fx-files>`       file rows with a context menu + an "Actions" dropdown via `/menu` `openMenu()`.
 *
 * Every element records what it does in `window.fx.log` (`{ step, detail }`); `fx.reset()`
 * clears it. `console.error` is captured as a `console.error` step, so the specs can assert the
 * exact ORDER of hooks, twins, listeners and logged errors.
 */
import {
  BlissElement,
  define,
  runBeforeCallback,
  runBeforeCallbackEager,
  toFunction,
  toObjectArray,
} from '../src/index.js';
import type { EventDef, InputDef } from '../src/index.js';
import {
  isActionBusy,
  createMenuDivider,
  normalizeActionItems,
  readActionDataset,
  resolveActionItem,
  runAction,
} from '../src/actions/index.js';
import type { ActionEventDetail, ActionItem, ActionSource, MenuEntry, MenuItem } from '../src/actions/index.js';
import { openMenu } from '../src/menu/index.js';
import type { MenuHandle, MenuInvocation } from '../src/menu/index.js';

// ── the step log ─────────────────────────────────────────────────────────────

export interface FxEntry {
  step: string;
  detail: string;
}

export interface Fx {
  log: FxEntry[];
  step(step: string, detail?: string): void;
  /** Just the step names, in order. */
  steps(): string[];
  reset(): void;
}

const fx: Fx = {
  log: [],
  step(step, detail = '') {
    fx.log.push({ step, detail });
  },
  steps() {
    return fx.log.map((e) => e.step);
  },
  reset() {
    fx.log.length = 0;
  },
};
(window as unknown as { fx: Fx }).fx = fx;

const originalError = console.error;
console.error = (...args: unknown[]) => {
  originalError.apply(console, args);
  const text = args
    .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a.replace(/%c/g, '') : ''))
    .join(' ')
    .trim();
  fx.step('console.error', text);
};

const step = (what: string, detail?: string): void => fx.step(what, detail);
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function shadow(el: HTMLElement): ShadowRoot {
  return el.shadowRoot ?? el.attachShadow({ mode: 'open' });
}

// ── <fx-emitter> / <fx-event-shell> ──────────────────────────────────────────

type EmitterEvents = { ping: { count: number }; 'ping-wide': { count: number } };

interface EmitterController {
  fire(name?: 'ping' | 'ping-wide'): void;
  readonly count: number;
}

export class FxEmitter extends BlissElement<EmitterEvents, EmitterController> {
  protected static override inputs: readonly InputDef[] = [];

  protected static override events: readonly (string | EventDef)[] = [
    'ping',
    { name: 'ping-wide', composed: true },
  ];

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

  protected override eventContext(): object {
    return { emittedBy: this.id || this.localName };
  }

  fire(name: 'ping' | 'ping-wide' = 'ping'): void {
    this.count += 1;
    step(`emit('${name}')`);
    this.emit(name, { count: this.count });
  }

  protected override reinit(): void {
    shadow(this).innerHTML = `<button type="button" class="do-fire">emit ping</button>`;
    shadow(this).querySelector('button')!.addEventListener('click', () => this.fire('ping'));
  }
}

export class FxEventShell extends BlissElement {
  protected static override inputs: readonly InputDef[] = [];

  get inner(): FxEmitter | null {
    return (this.shadowRoot?.querySelector('fx-emitter') as FxEmitter | null) ?? null;
  }

  protected override reinit(): void {
    const root = shadow(this);
    root.innerHTML = '';
    const inner = document.createElement('fx-emitter');
    inner.id = `${this.id || 'shell'}-inner`;
    root.append(inner);
  }
}

// ── <fx-guarded> ─────────────────────────────────────────────────────────────

interface GuardedItem {
  id: string;
  label: string;
}

export class FxGuarded extends BlissElement<{ 'item-rename': { id: string; label: string }; 'item-select': { id: string } }> {
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

  async rename(id: string): Promise<boolean> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    const newLabel = `${item.label.replace(/ #\d+$/, '')} #${++this.#renames}`;
    step('rename()');
    const ctx = this.withContext({ id, oldLabel: item.label, newLabel });
    const result = await runBeforeCallback<typeof ctx, string>(
      this.config.beforeRenameCallback as ((c: typeof ctx) => unknown) | null,
      ctx,
      'beforeRenameCallback',
    );
    if (result.isRejected) return false;
    item.label = result.hasValue ? String(result.value) : newLabel;
    step('renamed', item.label);
    this.#render();
    this.emit('item-rename', { id, label: item.label });
    return true;
  }

  select(id: string): void {
    step('select()');
    const ctx = this.withContext({ id, previousId: this.selectedId });
    const result = runBeforeCallbackEager<typeof ctx, string>(
      this.config.beforeSelectCallback as ((c: typeof ctx) => unknown) | null,
      ctx,
      'beforeSelectCallback',
    );
    const apply = (r: Exclude<typeof result, Promise<unknown>>): void => {
      if (r.isRejected) {
        step('selection rejected');
        return;
      }
      this.selectedId = r.hasValue ? String(r.value) : id;
      step('selected', this.selectedId);
      this.#render();
      this.emit('item-select', { id: this.selectedId });
    };
    if (result instanceof Promise) {
      step('deferred');
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
    root.innerHTML = '<ul role="listbox"></ul>';
    const ul = root.querySelector('ul')!;
    for (const item of this.items) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.id = item.id;
      li.setAttribute('aria-selected', String(item.id === this.selectedId));
      li.innerHTML = '<span class="lbl"></span>';
      (li.firstChild as HTMLElement).textContent = item.label;
      ul.append(li);
    }
  }
}

// ── <fx-toolbar> ─────────────────────────────────────────────────────────────

interface ToolbarCtx {
  count: number;
}
type ToolbarAction = 'add' | 'reset' | 'fail';
type ToolbarDetail = ActionEventDetail<ToolbarCtx, ToolbarAction>;
type ToolbarItem = ActionItem<ToolbarCtx, ToolbarAction>;

export class FxToolbar extends BlissElement<{ action: ToolbarDetail }> {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'items', converter: toObjectArray<ToolbarItem | string>(), on: 'reinit' },
    { configKey: 'beforeActionCallback', converter: toFunction(), on: 'none' },
  ];

  protected static override events: readonly (string | EventDef)[] = ['action'];

  count = 0;
  #htmlItems = new WeakMap<HTMLElement, ToolbarItem>();

  protected override connect(): void {
    this.addEventListener('click', this.#onLightClick);
  }

  protected override disconnect(): void {
    this.removeEventListener('click', this.#onLightClick);
  }

  #onLightClick = (event: Event): void => {
    const target = (event.target as Element | null)?.closest?.('[data-action]') as HTMLElement | null;
    if (!target || !this.contains(target)) return;
    let item = this.#htmlItems.get(target);
    if (!item) {
      item = {
        action: (target.dataset.action as ToolbarAction | 'custom') ?? 'custom',
        id: target.dataset.id,
        text: target.textContent?.trim() ?? '',
      };
      this.#htmlItems.set(target, item);
    }
    void this.#activate(item, target, event, 'message');
  };

  async #runBuiltIn(detail: ToolbarDetail): Promise<void> {
    switch (detail.action) {
      case 'add':
        this.count += 1;
        step('built-in', 'add');
        break;
      case 'reset':
        this.count = 0;
        step('built-in', 'reset');
        break;
      case 'fail':
        step('built-in', 'fail');
        throw new Error('fixture: built-in "fail" threw');
      default:
        break;
    }
  }

  async #activate(item: ToolbarItem, trigger: HTMLElement, sourceEvent: Event, source: ActionSource): Promise<void> {
    if (isActionBusy(item)) step('busy-ignored');
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
    step('resolved', String(ran));
    this.#render();
  }

  protected override reinit(): void {
    this.#render();
  }

  #render(): void {
    const root = shadow(this);
    root.innerHTML = '<div class="bar" role="toolbar"></div><slot></slot>';
    const bar = root.querySelector('.bar')!;
    const ctx = this.withContext({ count: this.count });
    const items = normalizeActionItems((this.config.items as (ToolbarItem | string)[] | undefined) ?? []);
    for (const item of items) {
      const r = resolveActionItem(item, ctx, item.action === 'reset' ? { isDisabled: this.count === 0 } : {});
      if (!r.isVisible) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = r.text || r.action;
      btn.dataset.action = r.action;
      if (r.id) btn.dataset.id = r.id;
      btn.disabled = r.isDisabled;
      if (item.isToggled !== undefined || item.getIsToggledCallback) btn.setAttribute('aria-pressed', String(r.isToggled));
      btn.addEventListener('click', (e) => void this.#activate(item, btn, e, 'toolbar'));
      bar.append(btn);
    }
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(this.count);
    bar.append(count);
  }
}

// ── <fx-files> ───────────────────────────────────────────────────────────────

interface FxFile {
  name: string;
  isPinned: boolean;
  isLocked: boolean;
}
interface FilesCtx {
  file: FxFile | null;
}
type FilesAction = 'rename' | 'toggle-pin' | 'delete' | 'new-file';
type FilesDetail = ActionEventDetail<FilesCtx, FilesAction>;
type FilesEntry = MenuEntry<FilesCtx, FilesAction>;
type FilesItem = MenuItem<FilesCtx, FilesAction>;

export class FxFiles extends BlissElement<{ action: FilesDetail }> {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'beforeActionCallback', converter: toFunction(), on: 'none' },
  ];

  protected static override events: readonly (string | EventDef)[] = ['action'];

  files: FxFile[] = [
    { name: 'report.pdf', isPinned: false, isLocked: false },
    { name: 'budget.xlsx', isPinned: true, isLocked: false },
    { name: 'contract.docx', isPinned: false, isLocked: true },
  ];

  menu: MenuHandle | null = null;
  #rowFile = new WeakMap<HTMLElement, FxFile>();

  #rowEntries(): FilesEntry[] {
    return [
      { id: 'open', text: 'Open', shortcut: 'O' },
      { action: 'rename', text: 'Rename', shortcut: 'F2' },
      { action: 'toggle-pin', text: 'Pinned', getIsToggledCallback: (ctx) => !!ctx.file?.isPinned, shouldCloseOnClick: false },
      createMenuDivider(),
      {
        text: 'Share',
        children: [
          { id: 'copy-link', text: 'Copy link' },
          createMenuDivider(),
          { text: 'More', children: [{ id: 'qr', text: 'QR code' }] },
        ],
      },
      {
        text: 'Move to',
        getChildrenCallback: async () => {
          await delay(500);
          return ['Documents', 'Archive 2025'].map((f) => ({ id: `move:${f}`, text: f }));
        },
      },
      createMenuDivider('Danger zone'),
      { id: 'archive', text: 'Archive', getIsDisabledCallback: (ctx) => !!ctx.file?.isLocked },
      { action: 'delete', text: 'Delete', isDanger: true, shortcut: 'Delete' },
    ];
  }

  #barEntries(): FilesEntry[] {
    return [
      { action: 'new-file', text: 'New file', shortcut: 'N' },
      createMenuDivider(),
      { id: 'hidden-item', text: 'Never shown', isVisible: false },
      { id: 'help', text: 'Help' },
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
      default:
        return;
    }
    step('built-in', detail.action);
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

  open(
    entries: FilesEntry[],
    ctx: FilesCtx,
    at: { x: number; y: number } | Element,
    returnFocusTo: HTMLElement,
    shouldFocusFirst: boolean,
    source: ActionSource,
  ): MenuHandle {
    this.menu?.close();
    step('openMenu()');
    const handle = openMenu<FilesCtx, FilesAction>(entries, ctx, {
      at,
      host: shadow(this),
      placement: 'bottom-start',
      returnFocusTo,
      shouldFocusFirst,
      inheritThemeFrom: this,
      title: ctx.file ? ctx.file.name : 'Actions',
      // test/menu-sheet.html forces a presentation via data-presentation (default 'auto').
      presentation: (this.dataset.presentation as 'auto' | 'floating' | 'sheet' | undefined) ?? 'auto',
      runAction: (item, inv) => this.#run(item, inv, ctx, source),
      onClose: (reason) => {
        step('onClose', reason);
        if (this.menu === handle) this.menu = null;
      },
    });
    this.menu = handle;
    return handle;
  }

  protected override reinit(): void {
    const root = shadow(this);
    root.innerHTML = `<style>
        :host { display: block; --_km-menu-bg: var(--fx-menu-bg); --_km-menu-hover-bg: var(--fx-menu-hover-bg); }
        ul { list-style: none; margin: 0; padding: 0; }
        li { padding: 4px 8px; }
      </style>
      <button type="button" class="do-actions" aria-haspopup="menu">Actions</button>
      <ul aria-label="Files"></ul>`;
    const btn = root.querySelector('.do-actions') as HTMLButtonElement;
    btn.addEventListener('click', (e) => {
      // detail === 0: keyboard activation → focus the first item.
      this.open(this.#barEntries(), this.withContext({ file: null }), btn, btn, (e as MouseEvent).detail === 0, 'toolbar');
    });
    this.#renderList();
  }

  #renderList(): void {
    const ul = this.shadowRoot?.querySelector('ul');
    if (!ul) return;
    const focusedFile = this.#rowFile.get(this.shadowRoot!.activeElement as HTMLElement);
    ul.replaceChildren();
    for (const file of this.files) {
      const li = document.createElement('li');
      this.#rowFile.set(li, file);
      li.tabIndex = 0;
      li.dataset.name = file.name;
      li.textContent = file.name;
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

  protected override disconnect(): void {
    this.menu?.close();
  }
}

define('fx-emitter', FxEmitter as unknown as CustomElementConstructor);
define('fx-event-shell', FxEventShell as unknown as CustomElementConstructor);
define('fx-guarded', FxGuarded as unknown as CustomElementConstructor);
define('fx-toolbar', FxToolbar as unknown as CustomElementConstructor);
define('fx-files', FxFiles as unknown as CustomElementConstructor);
