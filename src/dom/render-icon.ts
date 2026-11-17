/**
 * Icons are DATA (SPEC §12.33): the page hands a component a string, and every component turned it into markup
 * its own way (web-commandpalette's `renderIcon`, `/menu`'s raw `innerHTML`, web-grid / web-treeview / web-
 * multiselect each their own). One rule:
 *
 * - starts with `<` (an `<svg>`, an `<img>`, an `<i class="fa …">`) → inserted raw — the page vouches for it;
 * - an ASCII name (`gear`, `chevron-right`) → `<span class="km-icon <prefix>__icon <prefix>__icon--gear">`, a
 *   glyph masked from the `--base-icon-<name>` token in `currentColor` (nothing drawn when the token is unset);
 * - anything else (an emoji, a letter in another script) → escaped text.
 *
 * `ICON_CSS` (the `.km-icon` rule) goes into the root the icon renders in (`adoptStyles`).
 */

import { escapeHtml } from './escape-html.js';

export interface RenderIconOptions {
  /** The component's BEM block: adds `<prefix>__icon` + `<prefix>__icon--<name>` to a named icon. */
  prefix?: string;
}

const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** HTML for an icon value; `''` for none. */
export function renderIcon(icon: string | null | undefined, options: RenderIconOptions = {}): string {
  if (icon == null) return '';
  const value = String(icon).trim();
  if (!value) return '';
  if (value.startsWith('<')) return value;
  if (NAME.test(value)) {
    const own = options.prefix ? ` ${options.prefix}__icon ${options.prefix}__icon--${value}` : '';
    return `<span class="km-icon${own}" style="--_km-icon: var(--base-icon-${value}, linear-gradient(transparent 0 0))" aria-hidden="true"></span>`;
  }
  return escapeHtml(value);
}

/** The `.km-icon` drawing rule (1em square, `currentColor`, masked). Adopt it where named icons render. */
export const ICON_CSS = `
@layer component {
.km-icon {
  display: inline-block;
  flex: none;
  inline-size: 1em;
  block-size: 1em;
  vertical-align: -0.125em;
  background-color: currentColor;
  -webkit-mask: var(--_km-icon) center / contain no-repeat;
  mask: var(--_km-icon) center / contain no-repeat;
}
@media (forced-colors: active) {
  .km-icon { background-color: CanvasText; forced-color-adjust: none; }
}
}
`;
