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
 * Demo-only — not part of the published package (`files` ships `dist/` only).
 */
import { BlissElement, define } from './src/index.js';
import type { ColorScheme } from './src/index.js';

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

  protected override connect(): void {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
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

define('theme-card', ThemeCard as unknown as CustomElementConstructor);
