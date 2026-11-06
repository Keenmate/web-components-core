/**
 * Demo `BlissElement`s for the page-wide controls example page (examples-page.html,
 * chapter PG — SPEC §12.1 logging, §12.3 `window.components`, §12.8 style injection,
 * §12.14 loader).
 *
 *   - `<core-demo-pg>`        registered with `registerComponent()` + a `createLoggers('PGDEMO')`
 *                             bundle, so it has `window.components['core-demo-pg']`, per-instance
 *                             loggers (`this.log.INIT/DATA/UI`) and core's own messages for it
 *                             carry `[PGDEMO:…] #id`. It draws loading states with `renderLoader()`
 *                             (instance `renderLoadingCallback` input), adopts one shared stylesheet
 *                             (its CSS in `@layer component`) with `adoptStyles()` and applies custom
 *                             CSS with `createCustomStyles()`: the page layer
 *                             `window.components['core-demo-pg'].customStyles / .getCustomStylesCallback`,
 *                             then its own `custom-styles` / `getCustomStylesCallback`.
 *   - `<core-demo-pg-early>`  registered with `shouldAutoDefine: false` and NO logging bundle — the
 *                             page pre-creates its `window.components` entry (adopted), defines it
 *                             later via `entry.register()`, and core's messages for it fall back to
 *                             `[CORE:ELEMENT] core-demo-pg-early#id`.
 *
 * Demo-only — not part of the published package (`files` ships `dist/` only).
 */
import {
  BlissElement,
  adoptStyles,
  createCustomStyles,
  createLoggers,
  registerComponent,
  renderLoader,
  toEnum,
  toFunction,
  toText,
} from './src/index.js';
import type { CustomStylesCallback, CustomStylesHandle, InputDef, RenderLoaderCallback } from './src/index.js';

/** The demo tag's logger bundle (also reachable as `window.components['core-demo-pg'].logging`). */
export const pgLogging = createLoggers('PGDEMO');

const TONES = ['neutral', 'info', 'success'] as const;

/** What a page / instance `getCustomStylesCallback` receives. */
export interface PgContext {
  element: HTMLElement;
  label: string;
  tone: string;
}

/**
 * Static, shared CSS — ONE CSSStyleSheet for every instance (adoptStyles caches it per string).
 * In `@layer component` (the KeenMate authoring rule): adopted sheets cascade after every
 * `<style>`, so un-layered custom CSS only wins because this is layered.
 */
const SHARED_CSS = `@layer component {
  :host { display: inline-block; vertical-align: top;
    --pgd-loader-icon: var(--base-loader-icon, url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M21 12a9 9 0 1 1-6.219-8.56%22/%3E%3C/svg%3E"));
    --pgd-loader-rotate: var(--base-loader-rotate, 1turn);
    --pgd-loader-duration: var(--base-loader-duration, 0.8s);
    --pgd-loader-size: var(--base-loader-size, 1.25em);
  }
  /* Page tokens (--kmwc-*) inherit into the shadow root, so the card follows light / dark. */
  .pg { min-width: 12rem; border-radius: var(--kmwc-radius-md, 10px); padding: .6rem .8rem; font-size: .88rem; font-weight: 500;
        background: var(--kmwc-main-bg, Canvas); color: var(--kmwc-text-color-1, CanvasText);
        border: 1px solid var(--kmwc-border-color, GrayText); border-left-width: 5px; }
  .pg.tone-neutral { border-left-color: var(--kmwc-neutral-color, #94a3b8); }
  .pg.tone-info    { border-left-color: var(--kmwc-info-color, #3b82f6); }
  .pg.tone-success { border-left-color: var(--kmwc-success-color, #22c55e); }
  .pg-label { font-weight: 700; }
  .pg-id { font: .72rem var(--kmwc-mono-font-family, ui-monospace, monospace); color: var(--kmwc-text-color-3, GrayText); margin-left: .35rem; }
  .pg-status { display: flex; align-items: center; gap: .4rem; min-height: 1.6rem; margin-top: .35rem;
               color: var(--kmwc-info-color, #0369a1); }
  /* SPEC §12.14 — the loader drawing rule every component copies (core ships no loader CSS). */
  .pgd__loader {
    display: inline-block;
    inline-size: var(--pgd-loader-size); block-size: var(--pgd-loader-size);
    mask: var(--pgd-loader-icon) center / contain no-repeat;
    background: currentColor;
    animation: pgd-loader-spin var(--pgd-loader-duration) linear infinite;
  }
  @keyframes pgd-loader-spin { to { transform: rotate(var(--pgd-loader-rotate)); } }
}`;

export class CoreDemoPg extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'Demo' }), on: 'reinit' },
    { configKey: 'tone', attribute: 'tone', converter: toEnum(TONES, { default: 'neutral' }), shouldReflect: true },
    // Same name in every component (SPEC §12.14); read by renderLoader() from the host property.
    { configKey: 'renderLoadingCallback', converter: toFunction<RenderLoaderCallback>(), default: null, on: 'none' },
    // Custom CSS (SPEC §12.8): the callback wins over the attribute; both go through createCustomStyles().
    { configKey: 'customStyles', attribute: 'custom-styles', converter: toText({ isNullable: true }) },
    { configKey: 'getCustomStylesCallback', converter: toFunction<CustomStylesCallback<PgContext>>(), default: null },
  ];

  #styles?: CustomStylesHandle;
  #removeLoader?: () => void;

  get isLoading(): boolean {
    return this.#removeLoader !== undefined;
  }

  /** The loader container (for the page's readout). */
  get statusElement(): HTMLElement | null {
    return this.shadowRoot?.querySelector('.pg-status') ?? null;
  }

  /** One line per level, through this instance's loggers (`[PGDEMO:CAT] #id`). */
  logSample(): void {
    this.log.INIT!.debug('debug line (INIT)');
    this.log.DATA!.info('info line (DATA)');
    this.log.UI!.warn('warn line (UI)');
    this.log.UI!.error('error line (UI)');
  }

  startLoading(): void {
    this.flush(); // an imperative method: apply pending writes first
    if (this.#removeLoader || !this.statusElement) return;
    this.#removeLoader = renderLoader(this, this.statusElement, 'overlay', { label: 'Loading…', prefix: 'pgd' });
  }

  stopLoading(): void {
    this.#removeLoader?.();
    this.#removeLoader = undefined;
  }

  protected override reinit(): void {
    const wasLoading = this.isLoading;
    this.stopLoading();
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    adoptStyles(root, SHARED_CSS);
    root.innerHTML = `<div class="pg" part="card"><span class="pg-label"></span><span class="pg-id"></span>
      <div class="pg-status"></div></div>`;
    root.querySelector('.pg-label')!.textContent = this.config.label as string;
    root.querySelector('.pg-id')!.textContent = this.id ? `#${this.id}` : '';
    this.#applyTone();
    // innerHTML above dropped the slots; refresh() puts them back (page layer first).
    this.#styles ??= createCustomStyles<PgContext>(this, root, {
      cssClass: 'pgd-custom',
      getContext: () => ({ element: this, label: this.config.label as string, tone: this.config.tone as string }),
      getInstanceStyles: () => ({
        css: this.config.customStyles as string | null,
        callback: this.config.getCustomStylesCallback as CustomStylesCallback<PgContext> | null,
      }),
    });
    this.#styles.refresh();
    if (wasLoading) this.startLoading();
  }

  protected override update(partial: Record<string, unknown>): void {
    if ('tone' in partial) this.#applyTone();
    // tone is in the callbacks' context, so it re-runs them too.
    if ('customStyles' in partial || 'getCustomStylesCallback' in partial || 'tone' in partial) this.#styles?.refresh();
  }

  protected override destroyCallback(): void {
    this.stopLoading();
    this.#styles?.destroy();
  }

  #applyTone(): void {
    const card = this.shadowRoot?.querySelector('.pg');
    if (!card) return;
    for (const t of TONES) card.classList.toggle(`tone-${t}`, t === this.config.tone);
  }

}

/** No logging bundle: core's messages for it go to `CORE:ELEMENT`, labelled `tag#id`. */
export class CoreDemoPgEarly extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'tone', attribute: 'tone', converter: toEnum(TONES, { default: 'neutral' }), shouldReflect: true },
  ];

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{display:inline-block;padding:.45rem .7rem;border-radius:var(--kmwc-radius-sm,6px);font-size:.85rem;font-weight:500;
      background:color-mix(in srgb,var(--kmwc-success-color,#16a34a) 16%,transparent);color:var(--kmwc-success-color,#16a34a)}</style>upgraded · tone <b></b>`;
    this.update();
  }

  protected override update(): void {
    const b = this.shadowRoot?.querySelector('b');
    if (b) b.textContent = this.config.tone as string;
  }
}

/**
 * The same card under another tag, defined only when PG05 calls `entry.register()`. The page sets
 * `window.components['core-demo-pg-late'].customStyles` in an early `<script>`, before this module
 * loads; `registerComponent()` adopts it.
 */
export class CoreDemoPgLate extends CoreDemoPg {}

registerComponent('core-demo-pg', CoreDemoPg as unknown as CustomElementConstructor, {
  config: { name: 'core-demo-pg', version: '0.0.0-demo', author: 'examples-page-card.ts' },
  logging: pgLogging,
});

// shouldAutoDefine: false → the page calls window.components['core-demo-pg-early'].register().
registerComponent('core-demo-pg-early', CoreDemoPgEarly as unknown as CustomElementConstructor, {
  config: { name: 'core-demo-pg-early', version: '0.0.0-demo' },
  shouldAutoDefine: false,
});

registerComponent('core-demo-pg-late', CoreDemoPgLate as unknown as CustomElementConstructor, {
  config: { name: 'core-demo-pg-late', version: '0.0.0-demo', author: 'examples-page-card.ts' },
  shouldAutoDefine: false,
});
