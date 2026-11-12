/**
 * `<theme-card>` — a tiny demo `BlissElement` for the theme context (SPEC §12.10),
 * styled exactly the way a real component should be: every color resolves through
 * `light-dark()`, and the host's `color-scheme` comes from the `data-context-theme`
 * attribute the base class mirrors (plus per-instance `data-theme`, declared last
 * so it wins). No `:host-context()` anywhere — this renders the same in Chromium,
 * Firefox and Safari.
 *
 * It prints the scheme it received through the `themeChanged()` hook and how many
 * times that hook fired, so the "notified only on real change" rule is visible.
 *
 * `<theme-panel-card>` (TH05) is the same card with a button that opens a panel moved to
 * `<body>` through `createPopover({ inheritThemeFrom: this })` — the panel takes the card's
 * theme, not the section's.
 *
 * Demo-only — not part of the published package (`files` ships `dist/` only).
 */
import { BlissElement, define } from './src/index.js';
import type { ColorScheme } from './src/index.js';
import { createPopover } from './src/positioning/index.js';
import type { PopoverHandle } from './src/positioning/index.js';

const STYLES = `
  :host {
    display: block;
    --tc-bg: light-dark(#ffffff, #1e293b);
    --tc-text: light-dark(#0f172a, #e2e8f0);
    --tc-muted: light-dark(#64748b, #94a3b8);
    --tc-border: light-dark(#e2e8f0, #334155);
  }
  /* The shared theme context (page / theme-source / setThemeMode). */
  :host([data-context-theme="dark"])  { color-scheme: dark; }
  :host([data-context-theme="light"]) { color-scheme: light; }
  /* Per-instance forcing — declared last, so it wins. */
  :host([data-theme="dark"])  { color-scheme: dark; }
  :host([data-theme="light"]) { color-scheme: light; }

  .tc { background: var(--tc-bg); color: var(--tc-text); border: 1px solid var(--tc-border);
        border-radius: 10px; padding: .7rem .9rem; font: 500 .9rem system-ui, sans-serif;
        transition: background-color .2s, color .2s; min-width: 11rem; }
  .tc-label { font-weight: 700; margin-bottom: .25rem; }
  .tc-meta { color: var(--tc-muted); font: .78rem ui-monospace, 'Courier New', monospace; line-height: 1.5; }
`;

export class ThemeCard extends BlissElement {
  #scheme: ColorScheme | null = null;
  #changes = 0;
  #meta?: HTMLElement;

  // Structure is built once, in reinit() (first connect). A DOM move only re-runs
  // connect()/disconnect(), so the card keeps its counter. The theme subscription is
  // core's own live side — it starts and stops with connect / disconnect.
  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLES}</style>
      <div class="tc">
        <div class="tc-label"></div>
        <div class="tc-meta"></div>
      </div>`;
    (root.querySelector('.tc-label') as HTMLElement).textContent = this.getAttribute('label') ?? 'theme-card';
    this.#meta = root.querySelector('.tc-meta') as HTMLElement;
    this.#paint();
  }

  protected override themeChanged(scheme: ColorScheme | null): void {
    this.#scheme = scheme;
    this.#changes += 1;
    this.#paint();
  }

  /** Demo page only: re-print the meta lines (after the page changed `data-theme`). */
  repaint(): void {
    this.#paint();
  }

  #paint(): void {
    if (!this.#meta) return;
    const forced = this.getAttribute('data-theme');
    const source = this.themeSource;
    const sourceText = source == null ? 'page' : typeof source === 'string' ? source : `<${source.localName}>`;
    this.#meta.innerHTML = [
      `context: <b>${this.#scheme ?? 'null'}</b>`,
      forced ? `data-theme: <b>${forced}</b>` : '',
      `source: ${sourceText}`,
      `themeChanged × ${this.#changes}`,
    ]
      .filter(Boolean)
      .join('<br>');
  }
}

/**
 * The panel's own CSS travels inside it (a panel moved to `<body>` leaves the shadow root), and
 * like the card it reads only its own attributes: what `inheritThemeFrom` copied onto it.
 */
const PANEL_STYLES = `
  .tpc-panel { z-index: 1000; min-width: 15rem; padding: .7rem .9rem; border-radius: 10px;
    color-scheme: light dark;
    background: light-dark(#ffffff, #1e293b); color: light-dark(#0f172a, #e2e8f0);
    border: 1px solid light-dark(#cbd5e1, #475569); box-shadow: 0 8px 24px rgb(0 0 0 / .25);
    font: 500 .85rem system-ui, sans-serif; }
  .tpc-panel[data-context-theme="dark"]  { color-scheme: dark; }
  .tpc-panel[data-context-theme="light"] { color-scheme: light; }
  .tpc-panel[data-theme="dark"]  { color-scheme: dark; }
  .tpc-panel[data-theme="light"] { color-scheme: light; }
  .tpc-panel b { font-weight: 700; }
  .tpc-panel .tpc-meta { margin-top: .3rem; font: .76rem ui-monospace, 'Courier New', monospace; line-height: 1.5;
    color: light-dark(#64748b, #94a3b8); }
`;

/** A theme card with a button that opens a panel portaled to `<body>` (TH05). */
export class ThemePanelCard extends ThemeCard {
  #popover?: PopoverHandle;
  #panel?: HTMLElement;

  /** Whether the panel is open (for the demo page). */
  get isPanelOpen(): boolean {
    return !!this.#popover?.isOpen;
  }

  /** Open the panel (closing it first, so the theme is copied again). */
  openPanel(): void {
    this.#popover?.close();
    this.#popover?.open();
    this.#paintPanel();
  }

  protected override reinit(): void {
    super.reinit();
    const root = this.shadowRoot!;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Open the panel';
    button.style.marginTop = '.5rem';
    root.querySelector('.tc')!.append(button);

    this.#popover?.destroy();
    const panel = document.createElement('div');
    panel.className = 'tpc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Portaled panel');
    this.#panel = panel;
    this.#popover = createPopover({
      reference: button,
      panel,                       // mounted in <body> on open, removed on close
      inheritThemeFrom: this,      // the card's theme, not the section's
      placement: 'bottom-start',
      shouldCloseOnEscape: true,   // or the button again (no outside-click close: the page's controls drive it)
    });
    button.addEventListener('click', () => {
      if (this.#popover!.isOpen) this.#popover!.close();
      else this.#popover!.open();
      this.#paintPanel();
    });
  }

  #paintPanel(): void {
    const panel = this.#panel;
    if (!panel?.isConnected) return;
    const attr = (name: string) => panel.getAttribute(name) ?? '—';
    panel.innerHTML = `<style>${PANEL_STYLES}</style><b>Panel in &lt;body&gt;</b>
      <div class="tpc-meta"></div>`;
    (panel.querySelector('.tpc-meta') as HTMLElement).innerHTML = [
      `parent: &lt;${panel.parentElement?.localName}&gt;`,
      `data-context-theme: <b>${attr('data-context-theme')}</b>`,
      `data-theme: <b>${attr('data-theme')}</b>`,
      `color-scheme: <b>${getComputedStyle(panel).colorScheme}</b>`,
    ].join('<br>');
  }

  protected override destroyCallback(): void {
    this.#popover?.destroy();
  }

  protected override disconnect(): void {
    this.#popover?.close();
  }
}

define('theme-card', ThemeCard as unknown as CustomElementConstructor);
define('theme-panel-card', ThemePanelCard as unknown as CustomElementConstructor);
