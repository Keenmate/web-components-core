/**
 * Demo elements for the container-scroll page (SPEC §12.15) — stand-ins for a real component's
 * list, WITHOUT pulling in one of the KM components.
 *
 * `<core-demo-rows>` renders numbered rows in its shadow root. Without `has-scroller` it doesn't
 * scroll itself (the page puts it inside a light-DOM scroller — a tree inside the app's panel);
 * with `has-scroller` it owns an internal scroller, optionally with a sticky header
 * (`has-sticky-header`) that `scroll-padding-top` keeps clear (`has-scroll-padding`).
 *
 * `<core-demo-slot-box>` is a shadow-root scroller around a `<slot>` — the page's light rows
 * scroll inside it (styled through `::slotted()`, highlighted with `.is-target`).
 *
 * Their CSS is the element's own (shadow) CSS, like any component's; page tokens (--kmwc-*)
 * inherit in, so both follow light / dark. Demo-only — not part of the published package.
 */
import { BlissElement, define, toBool, toInt } from './src/index.js';
import type { InputDef } from './src/index.js';

const SCROLLER_CSS = `
  .scroller { max-height: 220px; overflow-y: auto; border: 1px solid var(--kmwc-border-color);
              border-radius: var(--kmwc-radius-md, 8px); background: var(--kmwc-page-bg); }
`;

/** Row look shared by both demos — `.row` in the shadow root, `::slotted(*)` for page rows. */
const ROW_CSS = (sel: string, target = `${sel}.is-target`) => `
  ${sel} { padding: .35rem .7rem; border-bottom: 1px solid var(--kmwc-border-color);
           font-family: var(--kmwc-mono-font-family, monospace); font-size: .85rem; color: var(--kmwc-text-color-1); }
  ${target} { background: color-mix(in srgb, var(--kmwc-accent-color) 18%, transparent); font-weight: 600; }
`;

export class CoreDemoRows extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'count', attribute: 'count', converter: toInt({ min: 1 }), default: 60, on: 'reinit' },
    { configKey: 'hasScroller', attribute: 'has-scroller', converter: toBool(), default: false, on: 'reinit' },
    { configKey: 'hasStickyHeader', attribute: 'has-sticky-header', converter: toBool(), default: false, on: 'reinit' },
    { configKey: 'hasScrollPadding', attribute: 'has-scroll-padding', converter: toBool('default-true'), default: true, on: 'update' },
  ];

  #scroller: HTMLElement | null = null;

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const { count, hasScroller, hasStickyHeader } = this.config as { count: number; hasScroller: boolean; hasStickyHeader: boolean };
    const rows = Array.from({ length: count }, (_, i) => `<div class="row" data-i="${i}">row ${i}</div>`).join('');
    root.innerHTML = `
      <style>
        :host { display: block; }
        ${SCROLLER_CSS}
        .scroller.is-padded { scroll-padding-top: 2.25rem; }
        .head { position: sticky; top: 0; height: 2.25rem; display: flex; align-items: center; padding: 0 .7rem;
                font-weight: 600; background: var(--kmwc-elevated-bg, #eef2f7); border-bottom: 1px solid var(--kmwc-border-color); }
        ${ROW_CSS('.row')}
      </style>
      ${hasScroller
        ? `<div class="scroller" part="scroller">${hasStickyHeader ? '<div class="head">Sticky header</div>' : ''}${rows}</div>`
        : rows}`;
    this.#scroller = root.querySelector('.scroller');
    this.update();
  }

  protected override update(): void {
    this.#scroller?.classList.toggle('is-padded', Boolean(this.config.hasScrollPadding));
  }

  /** Row `i` (shadow DOM). */
  row(i: number): HTMLElement | null {
    this.flush();
    return this.shadowRoot?.querySelector<HTMLElement>(`.row[data-i="${i}"]`) ?? null;
  }

  /** Highlight row `i` (and only it); returns it. */
  mark(i: number): HTMLElement | null {
    const row = this.row(i);
    for (const r of this.shadowRoot?.querySelectorAll('.row.is-target') ?? []) r.classList.remove('is-target');
    row?.classList.add('is-target');
    return row;
  }
}

export class CoreDemoSlotBox extends BlissElement {
  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    // The page's own rules beat ::slotted() (the kit resets padding on *), so slotted rows get their
    // height from line-height and the indent from the scroller.
    root.innerHTML = `<style>:host { display: block; } ${SCROLLER_CSS} ${ROW_CSS('::slotted(*)', '::slotted(.is-target)')}
      ::slotted(*) { line-height: 1.9; } .scroller { padding-inline: .7rem; }</style><div class="scroller" part="scroller"><slot></slot></div>`;
  }
}

define('core-demo-rows', CoreDemoRows);
define('core-demo-slot-box', CoreDemoSlotBox);
