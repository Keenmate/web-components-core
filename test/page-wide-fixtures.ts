/**
 * Minimal BlissElements for test/page-wide.html (e2e/page.spec.ts — SPEC §12.1 logging,
 * §12.3 window.components, §12.8 style injection, §12.14 loader).
 *
 *   - <fx-pg>        registerComponent() + a createLoggers('FXPG') bundle: per-instance loggers,
 *                    core messages labelled [FXPG:…] #id. Draws loading states with renderLoader()
 *                    (instance renderLoadingCallback), adopts one shared sheet (adoptStyles) and
 *                    applies customStylesCallback through a createStyleSlot().
 *   - <fx-pg-early>  shouldAutoDefine: false, NO logging bundle — the page pre-creates its
 *                    window.components entry (adopted), defines it via entry.register(); core
 *                    messages for it fall back to [CORE:ELEMENT] fx-pg-early#id.
 */
import {
  BlissElement,
  adoptStyles,
  createLoggers,
  createStyleSlot,
  registerComponent,
  renderLoader,
  toEnum,
  toFunction,
  toText,
} from '../src/index.js';
import type { InputDef, RenderLoaderCallback, StyleSlot } from '../src/index.js';

export const fxLogging = createLoggers('FXPG');

const TONES = ['neutral', 'info', 'success'] as const;
const SHARED_CSS = ':host { display: block; } .pg { padding: 2px 4px; }';

export class FxPg extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'pg' }), on: 'reinit' },
    { configKey: 'tone', attribute: 'tone', converter: toEnum(TONES, { default: 'neutral' }), shouldReflect: true },
    { configKey: 'renderLoadingCallback', converter: toFunction<RenderLoaderCallback>(), default: null, on: 'none' },
    { configKey: 'customStylesCallback', converter: toFunction<() => string | null>(), default: null },
  ];

  #slot?: StyleSlot;
  #removeLoader?: () => void;

  get isLoading(): boolean {
    return this.#removeLoader !== undefined;
  }

  get statusElement(): HTMLElement | null {
    return this.shadowRoot?.querySelector('.pg-status') ?? null;
  }

  /** One line per level through this instance's loggers. */
  logSample(): void {
    this.log.INIT!.debug('debug line (INIT)');
    this.log.DATA!.info('info line (DATA)');
    this.log.UI!.warn('warn line (UI)');
    this.log.UI!.error('error line (UI)');
  }

  startLoading(): void {
    this.flush();
    if (this.#removeLoader || !this.statusElement) return;
    this.#removeLoader = renderLoader(this, this.statusElement, 'overlay', { label: 'Loading…', prefix: 'fxpg' });
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
    root.innerHTML = '<div class="pg"><span class="pg-label"></span> <span class="pg-status"></span></div>';
    root.querySelector('.pg-label')!.textContent = `${this.config.label as string} #${this.id}`;
    this.#slot ??= createStyleSlot(root, { cssClass: 'fxpg-custom' });
    this.#applyCustomStyles();
    if (wasLoading) this.startLoading();
  }

  protected override update(partial: Record<string, unknown>): void {
    if ('customStylesCallback' in partial) this.#applyCustomStyles();
  }

  protected override destroyCallback(): void {
    this.stopLoading();
    this.#slot?.destroy();
  }

  #applyCustomStyles(): void {
    const cb = this.config.customStylesCallback as (() => string | null) | null;
    this.#slot?.set(cb ? cb() : null);
  }
}

export class FxPgEarly extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'tone', attribute: 'tone', converter: toEnum(TONES, { default: 'neutral' }), shouldReflect: true },
  ];
}

registerComponent('fx-pg', FxPg as unknown as CustomElementConstructor, {
  config: { name: 'fx-pg', version: '0.0.0-test' },
  logging: fxLogging,
});

// shouldAutoDefine: false → the spec calls window.components['fx-pg-early'].register().
registerComponent('fx-pg-early', FxPgEarly as unknown as CustomElementConstructor, {
  config: { name: 'fx-pg-early', version: '0.0.0-test' },
  shouldAutoDefine: false,
});
