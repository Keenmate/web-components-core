/**
 * Demo elements for the DOM-helpers page (SPEC §12.28, §12.29, §12.34) — stand-ins for a real component's
 * sortable list, drop zone and engine, WITHOUT pulling in one of the KM components.
 *
 * `<core-demo-sortable>` — a list inside an `overflow: hidden` box, reordered with `createPointerDrag`
 * (mouse + touch long press + auto-scroll, Escape cancels); the drag ghost is a `createLayer` so the box
 * can't clip it.
 * `<core-demo-drop>` — lights up while files are dragged anywhere over the page (`observePageDrag` +
 * `setDropActiveState` → `drop-active` attribute + `:state(drop-active)`), and lists what's dropped on it.
 * `<core-demo-counter>` — its `controller` is a `createControllerFacade` over a private engine.
 * `<core-demo-icon-toolbar>` (+ the `-alt` tag) — a shadow-DOM toolbar naming its icons (§12.33): `icons` map,
 * component defaults, an `Actions ▾` `/menu` with `iconDefaults`, custom CSS through `createCustomStyles` (§12.8).
 *
 * Their CSS is the element's own (shadow) CSS, like any component's; page tokens (--kmwc-*) inherit in, so
 * they follow light / dark. Demo-only — not part of the published package.
 */
import {
  BlissElement, define, escapeHtml, observePageDrag, setDropActiveState, createPointerDrag, createControllerFacade, renderIcon,
  toObject, isIconMap, toList, toText, toFunction, adoptStyles, ICON_CSS, createCustomStyles, registerComponent,
} from './src/index.js';
import type { InputDef, PointerDrag, CustomStylesCallback, CustomStylesHandle } from './src/index.js';
import { createLayer } from './src/positioning/index.js';
import type { Layer } from './src/positioning/index.js';
import { openMenu } from './src/menu/index.js';
import type { MenuHandle } from './src/menu/index.js';

const BOX_CSS = `
  :host { display: block; }
  .box { border: 1px solid var(--kmwc-border-color); border-radius: var(--kmwc-radius-md, 8px);
         background: var(--kmwc-page-bg); color: var(--kmwc-text-color-1); }
`;

const GHOST_CSS = `
  .ghost { padding: .35rem .7rem; border-radius: 6px; font: 600 .85rem system-ui, sans-serif; color: #fff;
           background: color-mix(in srgb, #2563eb 88%, transparent); box-shadow: 0 6px 18px rgb(0 0 0 / .25); }
`;

/** A reorderable list whose box clips its overflow — the ghost is a layer, so it isn't clipped. */
export class CoreDemoSortable extends BlissElement {
  protected static override inputs: readonly InputDef[] = [];
  protected static override events = ['drag-log'];

  #items = ['Inbox', 'Today', 'Upcoming', 'Projects', 'Someday', 'Waiting', 'Reference', 'Archive', 'Trash',
    'Reading list', 'Ideas', 'Errands'];
  #list: HTMLElement | null = null;
  #drag: PointerDrag | null = null;
  #ghost: Layer | null = null;
  #over: HTMLElement | null = null;

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${BOX_CSS}
        .box { block-size: 200px; overflow: hidden auto; }
        li { list-style: none; padding: .4rem .7rem; border-bottom: 1px solid var(--kmwc-border-color);
             cursor: grab; user-select: none; touch-action: pan-y; }
        ul { margin: 0; padding: 0; }
        li.is-source { opacity: .35; }
        li.is-over { box-shadow: inset 0 3px 0 var(--kmwc-accent-color); }
      </style>
      <div class="box"><ul></ul></div>`;
    this.#list = root.querySelector('ul');
    this.#render();
  }

  protected override connect(): void {
    const list = this.#list!;
    this.#drag = createPointerDrag(list, {
      getSource: (t) => t.closest<HTMLElement>('li'),
      longPressMs: 300,
      beforeStartCallback: ({ source, pointerType, x, y }) => {
        source.classList.add('is-source');
        this.#ghost = createLayer(this, { css: GHOST_CSS, className: 'ghost', isInteractive: false });
        this.#ghost.element.textContent = source.textContent;
        this.#placeGhost(x, y);
        this.emit('drag-log', { text: `start "${source.textContent}" (${pointerType})`, tone: 'info' });
      },
      moveCallback: ({ target, x, y }) => {
        this.#placeGhost(x, y);
        const li = target?.closest<HTMLElement>('li') ?? null;
        const over = li && list.contains(li) ? li : null;
        if (over !== this.#over) {
          this.#over?.classList.remove('is-over');
          over?.classList.add('is-over');
          this.#over = over;
        }
      },
      dropCallback: ({ source }) => {
        const to = this.#over ? Number(this.#over.dataset.i) : -1;
        const from = Number(source.dataset.i);
        this.#end(source);
        if (to < 0 || to === from) return this.emit('drag-log', { text: 'drop outside the list — nothing moved', tone: 'muted' });
        this.#items.splice(to, 0, ...this.#items.splice(from, 1));
        this.#render();
        this.emit('drag-log', { text: `drop "${this.#items[to]}" ${from} → ${to}`, tone: 'ok' });
      },
      cancelCallback: ({ source }) => {
        this.#end(source);
        this.emit('drag-log', { text: 'cancelled (Escape)', tone: 'warn' });
      },
    });
  }

  protected override disconnect(): void {
    this.#drag?.destroy();
    this.#ghost?.destroy();
    this.#ghost = null;
  }

  #placeGhost(x: number, y: number): void {
    this.#ghost?.place({ top: y + 8, left: x + 12, width: 160, height: 32 });
  }

  #end(source: HTMLElement): void {
    source.classList.remove('is-source');
    this.#over?.classList.remove('is-over');
    this.#over = null;
    this.#ghost?.destroy();
    this.#ghost = null;
  }

  #render(): void {
    this.#list!.innerHTML = this.#items.map((t, i) => `<li data-i="${i}">${escapeHtml(t)}</li>`).join('');
  }
}

/** A drop target that arms while files are dragged anywhere over the page. */
export class CoreDemoDrop extends BlissElement {
  protected static override inputs: readonly InputDef[] = [];
  protected static override events = ['drop-active-change', 'files'];

  #stopWatch: (() => void) | null = null;
  #zone: HTMLElement | null = null;

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${BOX_CSS}
        .box { padding: 1.4rem; text-align: center; border-style: dashed; border-width: 2px;
               transition: background var(--base-duration-fast, .15s), border-color var(--base-duration-fast, .15s); }
        :host([drop-active]) .box { border-color: var(--kmwc-accent-color);
               background: color-mix(in srgb, var(--kmwc-accent-color) 12%, transparent); }
        :host([drop-active]) .hint::after { content: ' — drop them here'; font-weight: 600; }
      </style>
      <div class="box"><span class="hint">Drag files from your desktop over the page</span></div>`;
    this.#zone = root.querySelector('.box');
  }

  protected override connect(): void {
    this.#stopWatch = observePageDrag({
      types: ['Files'],
      changeCallback: (isDropActive) => {
        setDropActiveState(this, this.internals, isDropActive);
        this.emit('drop-active-change', { isDropActive });
      },
    });
    this.#zone!.addEventListener('dragover', this.#onDragOver);
    this.#zone!.addEventListener('drop', this.#onDrop);
  }

  protected override disconnect(): void {
    this.#stopWatch?.();
    setDropActiveState(this, this.internals, false);
    this.#zone?.removeEventListener('dragover', this.#onDragOver);
    this.#zone?.removeEventListener('drop', this.#onDrop);
  }

  #onDragOver = (e: DragEvent): void => e.preventDefault();

  #onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const names = [...(e.dataTransfer?.files ?? [])].map((f) => `${f.name} (${f.size} B)`);
    this.emit('files', { names });
  };
}

/** The engine a real component keeps private. */
class CounterEngine {
  count = 0;
  secret = 'engine internals';
  increment(): number {
    return ++this.count;
  }
  reset(): void {
    this.count = 0;
  }
}

/** `el.controller` is a frozen facade: listed methods + state, answers before the first build. */
export class CoreDemoCounter extends BlissElement {
  protected static override inputs: readonly InputDef[] = [];
  #engine: CounterEngine | null = null;

  protected override reinit(): void {
    this.#engine = new CounterEngine();
  }

  protected override createController(): object {
    return createControllerFacade(() => {
      this.flush();
      return this.#engine;
    }, {
      methods: ['increment', 'reset'],
      state: { count: 0 },
      emptyResults: { increment: () => -1 },
    });
  }
}

/** The icons this demo component names (its documented icon names) — markup defaults, like web-grid's row icons. */
const ICON_BAR_DEFAULTS: Readonly<Record<string, string>> = {
  rowAdd: '<svg viewBox="0 0 10 10" width="1em" height="1em"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.6"/></svg>',
  rowDelete: '<svg viewBox="0 0 10 10" width="1em" height="1em"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.6"/></svg>',
  rowEdit: '<svg viewBox="0 0 10 10" width="1em" height="1em"><path d="M2 8l1-3 4-4 2 2-4 4z" fill="currentColor"/></svg>',
};

/**
 * An icon-rendering component (SPEC §12.33): names its icons, renders them through `renderIcon(name, { defaults })`,
 * has an `icons` input row, repaints in `iconsChanged()` (el.icons, window.components.icons / renderIconCallback).
 */
export class CoreDemoIconBar extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'icons', attribute: 'icons', converter: toObject({ validate: isIconMap }), on: 'update' },
  ];

  protected override reinit(): void {
    this.#paint();
  }

  protected override iconsChanged(): void {
    this.#paint();
  }

  #paint(): void {
    this.innerHTML = Object.keys(ICON_BAR_DEFAULTS)
      .map((name) => `<button type="button" data-icon-name="${name}">${renderIcon(name, { prefix: 'demo', host: this, defaults: ICON_BAR_DEFAULTS })} ${name}</button>`)
      .join(' ');
  }
}

/** The toolbar's own icons (its documented icon names). `add` / `delete` are built-in names: drawn from their token. */
const TOOLBAR_ICONS: Readonly<Record<string, string>> = {
  rowEdit: '<svg viewBox="0 0 10 10" width="1em" height="1em"><path d="M2 8l1-3 4-4 2 2-4 4z" fill="currentColor"/></svg>',
  share: '<svg viewBox="0 0 10 10" width="1em" height="1em"><circle cx="2.5" cy="5" r="1.5" fill="currentColor"/><circle cx="7.5" cy="2" r="1.5" fill="currentColor"/><circle cx="7.5" cy="8" r="1.5" fill="currentColor"/><path d="M2.5 5l5-3M2.5 5l5 3" stroke="currentColor"/></svg>',
  archive: '<svg viewBox="0 0 10 10" width="1em" height="1em"><path d="M1 2h8v2H1zM2 4.5h6V9H2z" fill="currentColor"/></svg>',
};

/** The menu's icon names → icons: `openMenu`'s `iconDefaults` (entries carry the NAME, never markup). */
const TOOLBAR_MENU_ICONS: Readonly<Record<string, string>> = {
  menuCopy: '<svg viewBox="0 0 10 10" width="1em" height="1em"><path d="M3.5 3.5h5v5h-5zM1.5 6.5v-5h5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  menuMove: '<svg viewBox="0 0 10 10" width="1em" height="1em"><path d="M1 5h6M5 2.5 7.5 5 5 7.5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
};

const TOOLBAR_CSS = `@layer component {
  :host { display: inline-block; }
  .tb { display: inline-flex; flex-wrap: wrap; gap: .35rem; align-items: center; padding: .35rem;
        border: 1px solid var(--kmwc-border-color); border-radius: var(--kmwc-radius-md, 8px); }
  .tb__btn { display: inline-flex; gap: .35rem; align-items: center; }
  .tb__btn--danger { color: var(--kmwc-danger-color, #dc2626); }
  .tb__slot { display: inline-flex; min-width: 1em; min-height: 1em; align-items: center; justify-content: center; }
}`;

/**
 * An icon-rendering component in a shadow root (SPEC §12.33): shows its `items` (icon names) as buttons through
 * `renderIcon(name, { defaults })`, an optional `menu` (`Actions ▾`, `openMenu({ iconDefaults })`), takes custom
 * CSS through `createCustomStyles` (page layer `window.components['core-demo-icon-toolbar'].customStyles` + its
 * own `custom-styles`), repaints in `iconsChanged()`. `delete` is drawn in the danger colour.
 */
export class CoreDemoIconToolbar extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'items', attribute: 'items', converter: toList({ default: ['add', 'delete', 'rowEdit'] }), on: 'update' },
    { configKey: 'menu', attribute: 'menu', converter: toList(), on: 'update' },
    { configKey: 'icons', attribute: 'icons', converter: toObject({ validate: isIconMap }), on: 'update' },
    { configKey: 'customStyles', attribute: 'custom-styles', converter: toText({ isNullable: true }), on: 'update' },
    { configKey: 'getCustomStylesCallback', converter: toFunction<CustomStylesCallback>(), default: null, on: 'update' },
  ];

  #customStyles: CustomStylesHandle | null = null;
  #menu: MenuHandle | null = null;

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    adoptStyles(root, ICON_CSS, TOOLBAR_CSS);
    root.innerHTML = '<div class="tb" part="toolbar"></div>';
    root.querySelector('.tb')!.addEventListener('click', (e) => {
      const button = (e.target as Element).closest<HTMLElement>('.tb__menu');
      if (button) this.#openMenu(button);
    });
    this.#paint();
    if (this.#customStyles) this.#customStyles.refresh();
    else {
      this.#customStyles = createCustomStyles(this, root, {
        cssClass: 'tb-custom-styles',
        getContext: () => this.withContext({}),
        getInstanceStyles: () => ({
          css: this.config.customStyles as string | null,
          callback: this.config.getCustomStylesCallback as CustomStylesCallback | null,
        }),
      });
    }
  }

  protected override update(partial: Record<string, unknown>): void {
    if ('items' in partial || 'menu' in partial) this.#paint(); // `icons` → iconsChanged()
    if ('customStyles' in partial || 'getCustomStylesCallback' in partial) this.#customStyles?.refresh();
  }

  protected override iconsChanged(): void {
    this.#paint();
  }

  protected override disconnect(): void {
    this.#menu?.close();
  }

  protected override destroyCallback(): void {
    this.#customStyles?.destroy();
    this.#customStyles = null;
  }

  #paint(): void {
    const bar = this.shadowRoot?.querySelector('.tb');
    if (!bar) return;
    const button = (name: string): string =>
      `<button type="button" class="tb__btn${name === 'delete' ? ' tb__btn--danger' : ''}" data-icon-name="${escapeHtml(name)}">`
      + `<span class="tb__slot">${renderIcon(name, { prefix: 'tb', host: this, defaults: TOOLBAR_ICONS })}</span>${escapeHtml(name)}</button>`;
    const menu = (this.config.menu as string[]).length ? '<button type="button" class="tb__menu" aria-haspopup="menu">Actions ▾</button>' : '';
    bar.innerHTML = (this.config.items as string[]).map(button).join('') + menu;
  }

  #openMenu(button: HTMLElement): void {
    this.#menu?.close();
    const entries = (this.config.menu as string[]).map((name) => ({ id: name, text: name, icon: name, isDanger: name === 'delete' }));
    this.#menu = openMenu(entries, this.withContext({}), {
      at: button,
      host: this.shadowRoot!,
      returnFocusTo: button,
      inheritThemeFrom: this,
      iconDefaults: TOOLBAR_MENU_ICONS, // the entries name their icons; the page can still replace them
      closeCallback: () => { this.#menu = null; },
    });
  }
}

/** The same toolbar under a second tag — shows `window.components.icons`' `'<tag>.<name>'` keys. */
export class CoreDemoIconToolbarAlt extends CoreDemoIconToolbar {}

define('core-demo-sortable', CoreDemoSortable);
define('core-demo-drop', CoreDemoDrop);
define('core-demo-counter', CoreDemoCounter);
define('core-demo-icon-bar', CoreDemoIconBar);
// registered, not just defined: registerComponent() installs window.components[tag].customStyles (the page layer)
registerComponent('core-demo-icon-toolbar', CoreDemoIconToolbar as unknown as CustomElementConstructor, {
  config: { name: 'core-demo-icon-toolbar', version: '0.0.0-demo', author: 'examples-dom-card.ts' },
});
registerComponent('core-demo-icon-toolbar-alt', CoreDemoIconToolbarAlt as unknown as CustomElementConstructor, {
  config: { name: 'core-demo-icon-toolbar-alt', version: '0.0.0-demo', author: 'examples-dom-card.ts' },
});
