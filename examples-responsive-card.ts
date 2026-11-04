/**
 * Demo `BlissElement`s for the responsive-rules page (SPEC §6.7) — tiny cards that
 * render their EFFECTIVE config (`this.config`, what a component applies) and
 * report every `reinit()` / `update(partial)` through a `config-applied` event, so
 * the page can show exactly when and how a responsive rule reached the component.
 *
 * Three tags, each with its OWN configKeys — page-wide rules
 * (`window.components.responsive*`) apply to every component that has the key, so
 * distinct keys keep the RS04 page-wide toggles from leaking into RS03 / RS05:
 *   - `<core-demo-rs-map>`      RS03 — `layout` (reinit), `columns`, `presentation`
 *   - `<core-demo-rs-layers>`   RS04 — `accent`, `density`, `label`, `badge`
 *                               (registered via `registerComponent`, so it gets
 *                               the per-tag `window.components[tag].responsive*`)
 *   - `<core-demo-rs-callback>` RS05 — `isCompact`, `cols`
 *   - `<core-demo-rs-size>`     RS06 — no inputs; overrides `sizeChanged()` and lays out one
 *                               tile per 120px of the width it is told
 *
 * Demo-only — not part of the published package (`files` ships `dist/` only).
 */
import { BlissElement, define, registerComponent, toBool, toEnum, toInt, toText } from './src/index.js';
import type { ElementSize, InputDef } from './src/index.js';

// Page tokens (--kmwc-*) inherit into the shadow root, so the card follows light / dark.
const STYLES = `
  :host { display: block; }
  .rs { border: 1px solid var(--kmwc-border-color, GrayText); border-left: 6px solid var(--rs-accent, #64748b);
        border-radius: var(--kmwc-radius-md, 10px); padding: var(--rs-pad, .7rem .9rem); font-size: .9rem; font-weight: 500;
        background: var(--kmwc-main-bg, Canvas); color: var(--kmwc-text-color-1, CanvasText); }
  .rs-title { font-weight: 700; margin-bottom: .35rem; }
  .rs-kv { font: .8rem var(--kmwc-mono-font-family, ui-monospace, monospace); line-height: 1.55; }
  .rs-kv b { color: var(--kmwc-info-color, #0369a1); }
  .rs-tiles { display: grid; gap: .35rem; margin-top: .5rem; grid-template-columns: repeat(var(--rs-cols, 3), minmax(0, 1fr)); }
  .rs-tiles.stack { grid-template-columns: 1fr; }
  .rs-tiles.list { display: flex; flex-direction: column; gap: .15rem; }
  .rs-tile { background: var(--kmwc-accent-light-bg, #e0f2fe); border-radius: var(--kmwc-radius-sm, 6px); padding: .3rem .4rem; text-align: center; font-size: .78rem; }
  .rs-hooks { margin-top: .4rem; font: .75rem var(--kmwc-mono-font-family, ui-monospace, monospace); color: var(--kmwc-text-color-3, GrayText); }
`;

const ACCENTS: Record<string, string> = { slate: '#64748b', amber: '#d97706', teal: '#0d9488', rose: '#e11d48', violet: '#7c3aed' };
const PADDING: Record<string, string> = { compact: '.35rem .6rem', comfortable: '.7rem .9rem', spacious: '1.2rem 1.4rem' };

export type ConfigAppliedDetail = {
  kind: 'reinit' | 'update';
  partial: Record<string, unknown> | null;
  config: Record<string, unknown>;
};

/** Shared rendering: effective config as key/value lines + hook counters. */
abstract class RsDemoCard extends BlissElement {
  protected static override events = ['config-applied'];

  reinitCount = 0;
  updateCount = 0;
  #root?: ShadowRoot;

  /** The configKeys to print, in order. */
  protected abstract get keys(): readonly string[];
  /** Subclass hook: style the card from the effective config. */
  protected abstract paintVisual(card: HTMLElement, tiles: HTMLElement): void;

  #render(): void {
    this.#root ??= this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `<style>${STYLES}</style>
      <div class="rs" part="card">
        <div class="rs-title">&lt;${this.localName}&gt;</div>
        <div class="rs-kv"></div>
        <div class="rs-tiles"></div>
        <div class="rs-hooks"></div>
      </div>`;
  }

  #paint(): void {
    const root = this.#root;
    if (!root) return;
    const cfg = this.config;
    (root.querySelector('.rs-kv') as HTMLElement).innerHTML = this.keys
      .map((k) => `${k}: <b data-key="${k}">${JSON.stringify(cfg[k])}</b>`)
      .join('<br>');
    (root.querySelector('.rs-hooks') as HTMLElement).textContent = `reinit() × ${this.reinitCount} · update() × ${this.updateCount}`;
    this.paintVisual(root.querySelector('.rs') as HTMLElement, root.querySelector('.rs-tiles') as HTMLElement);
  }

  protected override reinit(): void {
    this.reinitCount += 1;
    this.#render();
    this.#paint();
    this.emit('config-applied', { kind: 'reinit', partial: null, config: { ...this.config } } satisfies ConfigAppliedDetail);
  }

  protected override update(partial: Record<string, unknown>): void {
    this.updateCount += 1;
    this.#paint();
    this.emit('config-applied', { kind: 'update', partial: { ...partial }, config: { ...this.config } } satisfies ConfigAppliedDetail);
  }
}

function tiles(el: HTMLElement, count: number, cls: string): void {
  el.className = `rs-tiles ${cls}`;
  el.innerHTML = Array.from({ length: count }, (_, i) => `<div class="rs-tile">item ${i + 1}</div>`).join('');
}

/** RS03 — an instance responsive map flips layout / columns / presentation. */
export class RsMapCard extends RsDemoCard {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'layout', attribute: 'layout', converter: toEnum(['grid', 'stack', 'list'] as const, { default: 'grid' }), on: 'reinit' },
    { configKey: 'columns', attribute: 'columns', converter: toInt({ min: 1, max: 6, default: 3 }), on: 'update' },
    {
      configKey: 'presentation',
      attribute: 'presentation',
      converter: toEnum(['floating', 'modal', 'fullscreen'] as const, { default: 'floating' }),
      on: 'update',
    },
  ];
  protected get keys(): readonly string[] {
    return ['layout', 'columns', 'presentation'];
  }
  protected paintVisual(_card: HTMLElement, el: HTMLElement): void {
    const cfg = this.config as { layout: string; columns: number };
    el.style.setProperty('--rs-cols', String(cfg.columns));
    tiles(el, 6, cfg.layout);
  }
}

/** RS04 — four keys, one per precedence story. */
export class RsLayersCard extends RsDemoCard {
  protected static override inputs: readonly InputDef[] = [
    {
      configKey: 'accent',
      attribute: 'accent',
      converter: toEnum(['slate', 'amber', 'teal', 'rose', 'violet'] as const, { default: 'slate' }),
      on: 'update',
    },
    {
      configKey: 'density',
      attribute: 'density',
      converter: toEnum(['comfortable', 'compact', 'spacious'] as const, { default: 'comfortable' }),
      on: 'update',
    },
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'base' }), on: 'update' },
    { configKey: 'badge', attribute: 'badge', converter: toText({ default: 'none' }), on: 'update' },
  ];
  protected get keys(): readonly string[] {
    return ['accent', 'density', 'label', 'badge'];
  }
  protected paintVisual(card: HTMLElement, el: HTMLElement): void {
    const cfg = this.config as { accent: string; density: string };
    card.style.setProperty('--rs-accent', ACCENTS[cfg.accent] ?? '#64748b');
    card.style.setProperty('--rs-pad', PADDING[cfg.density] ?? '.7rem .9rem');
    el.replaceChildren();
  }
}

/** RS05 — driven by an instance responsiveCallback on a custom width. */
export class RsCallbackCard extends RsDemoCard {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'isCompact', attribute: 'compact', converter: toBool('default-false'), on: 'update' },
    { configKey: 'cols', attribute: 'cols', converter: toInt({ min: 1, max: 6, default: 4 }), on: 'update' },
  ];
  protected get keys(): readonly string[] {
    return ['isCompact', 'cols'];
  }
  protected paintVisual(card: HTMLElement, el: HTMLElement): void {
    const cfg = this.config as { isCompact: boolean; cols: number };
    card.style.setProperty('--rs-pad', cfg.isCompact ? PADDING.compact! : PADDING.comfortable!);
    el.style.setProperty('--rs-cols', String(cfg.cols));
    tiles(el, 4, '');
  }
}

define('core-demo-rs-map', RsMapCard as unknown as CustomElementConstructor);
// Registered so `window.components['core-demo-rs-layers'].responsive*` (the per-tag layer) exists.
registerComponent('core-demo-rs-layers', RsLayersCard as unknown as CustomElementConstructor, {
  config: { name: 'core-demo-rs-layers', version: 'demo' },
});
define('core-demo-rs-callback', RsCallbackCard as unknown as CustomElementConstructor);

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** What `<core-demo-rs-size>` reports on every `sizeChanged()` (the `size-report` event). */
export type SizeReportDetail = { size: ElementSize; visual: { width: number; height: number }; columns: number };

/**
 * RS06 — a component that makes a STRUCTURAL decision from its width (one tile per 120px),
 * the job `sizeChanged()` is for. It shows the size the hook reported next to the visual box
 * (`getBoundingClientRect()`, transforms applied), so scaling the element shows the difference.
 */
export class RsSizeCard extends BlissElement {
  protected static override events = ['size-report'];
  #root?: ShadowRoot;

  protected override reinit(): void {
    this.#root ??= this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `<style>${STYLES}</style>
      <div class="rs"><div class="rs-title">sizeChanged() → layout</div>
      <div class="rs-kv" part="kv">waiting for the first report…</div><div class="rs-tiles"></div></div>`;
  }

  protected override sizeChanged(size: ElementSize): void {
    const root = this.#root;
    if (!root) return;
    const columns = Math.max(1, Math.floor(size.width / 120));
    const rect = this.getBoundingClientRect();
    const visual = { width: round1(rect.width), height: round1(rect.height) };
    root.querySelector('.rs-kv')!.innerHTML =
      `sizeChanged: <b>${round1(size.width)} × ${round1(size.height)}</b> → <b>${columns}</b> tile(s)<br>` +
      `visual box (getBoundingClientRect): ${visual.width} × ${visual.height}`;
    const tilesEl = root.querySelector<HTMLElement>('.rs-tiles')!;
    tilesEl.style.setProperty('--rs-cols', String(columns));
    tiles(tilesEl, columns, '');
    this.emit('size-report', { size, visual, columns } satisfies SizeReportDetail);
  }
}

define('core-demo-rs-size', RsSizeCard as unknown as CustomElementConstructor);
