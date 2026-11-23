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
 *
 * Their CSS is the element's own (shadow) CSS, like any component's; page tokens (--kmwc-*) inherit in, so
 * they follow light / dark. Demo-only — not part of the published package.
 */
import { BlissElement, define, escapeHtml, observePageDrag, setDropActiveState, createPointerDrag, createControllerFacade } from './src/index.js';
import type { InputDef, PointerDrag } from './src/index.js';
import { createLayer } from './src/positioning/index.js';
import type { Layer } from './src/positioning/index.js';

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

define('core-demo-sortable', CoreDemoSortable);
define('core-demo-drop', CoreDemoDrop);
define('core-demo-counter', CoreDemoCounter);
