/**
 * The phone sheet chrome (SPEC §12.9): ONE header bar + title + close button for every
 * full-screen / bottom / side sheet a component opens (the `/menu` sheet, the multiselect and
 * daterangepicker full-screen pickers, the grid's editor sheets, the dropzone drawer …).
 *
 * A component adds the classes to its own elements (or builds them with `createSheetHeader()`)
 * and adopts `SHEET_CHROME_CSS` into the root they live in (`adoptStyles`, §12.8). Its own BEM
 * classes stay for layout around them (a search field in the header, a merged title-less corner).
 *
 * Every value reads three layers, like `/menu` (§12.13):
 * `var(--_km-sheet-X, var(--km-sheet-X, var(--base-…, <default>)))` — the component maps its
 * per-instance variable onto the private `--_km-sheet-X` on its host with NO fallback; the page
 * sets `--km-sheet-X` on `:root`. The list ships in `component-variables.manifest.json`.
 *
 * In `@layer component`, so a component's `overrides` layer and unlayered consumer CSS win.
 */

/** `var(--_km-sheet-<name>, var(--km-sheet-<name>, <fallback>))` — the 3-layer read. */
function ks(name: string, fallback: string): string {
  return `var(--_km-sheet-${name}, var(--km-sheet-${name}, ${fallback}))`;
}

const REM = 'var(--base-rem, 10px)';
/** `calc(var(--base-<token>, <multiplier>) * var(--base-rem, 10px))`. */
function rem(token: string, multiplier: number): string {
  return `calc(var(--base-${token}, ${multiplier}) * ${REM})`;
}

/** The base-css-variables ✕ (stroke icon, drawn as a mask in `currentColor`). */
const CLOSE_ICON =
  'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M18 6 6 18%22/%3E%3Cpath d=%22m6 6 12 12%22/%3E%3C/svg%3E")';

const HEADER_GAP = ks('header-gap', rem('space-sm', 0.8));
const HEADER_PADDING_BLOCK = ks('header-padding-block', rem('space-sm', 0.8));
const HEADER_PADDING_INLINE = ks('header-padding-inline', rem('space-base', 1.6));
const CLOSE_SIZE = ks('close-size', 'var(--base-touch-target-min, 44px)');
const CLOSE_EDGE_NUDGE = ks('close-edge-nudge', rem('space-sm', 0.8));
const CLOSE_BG_HOVER = ks('close-bg-hover', 'var(--base-hover-bg, color-mix(in srgb, currentColor 8%, transparent))');

export const SHEET_CHROME_CSS = `
@layer component {
.km-sheet-header {
  display: flex;
  flex: none;
  align-items: center;
  gap: ${HEADER_GAP};
  box-sizing: border-box;
  min-height: ${ks('header-min-height', `calc(5.6 * ${REM})`)};
  padding: ${HEADER_PADDING_BLOCK} ${HEADER_PADDING_INLINE};
  background: ${ks('header-bg', 'transparent')};
  border-bottom: ${ks('header-border', '1px solid var(--base-border-color, light-dark(#e0e0e0, #3d3d3d))')};
}

.km-sheet-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${ks('title-color', 'inherit')};
  font-size: ${ks('title-font-size', rem('font-size-lg', 1.8))};
  font-weight: ${ks('title-font-weight', 'var(--base-font-weight-semibold, 600)')};
}

/* A fixed-size chip (round and borderless by default; the bg / border / radius turn it into a
   bordered button), slid toward the trailing edge by the edge nudge. */
.km-sheet-close {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: ${CLOSE_SIZE};
  height: ${CLOSE_SIZE};
  margin-inline-start: auto;
  margin-inline-end: calc(-1 * ${CLOSE_EDGE_NUDGE});
  padding: 0;
  color: ${ks('close-color', 'inherit')};
  background: ${ks('close-bg', 'transparent')};
  border: ${ks('close-border', 'none')};
  border-radius: ${ks('close-border-radius', '50%')};
  font: inherit;
  cursor: pointer;
}

/* The tap target reaches past the chip into the sheet's top-trailing corner (the easiest place
   to hit), without growing the chip or covering the first row below the header. */
.km-sheet-close::after {
  content: "";
  position: absolute;
  inset-block-start: calc(-1 * ${CLOSE_SIZE});
  inset-block-end: calc(-1 * ${HEADER_PADDING_BLOCK});
  inset-inline-end: calc(-1 * ${HEADER_PADDING_INLINE});
  inset-inline-start: calc(-1 * ${HEADER_GAP});
}

.km-sheet-close::before {
  content: "";
  display: block;
  width: ${ks('close-icon-size', `calc(2 * ${REM})`)};
  height: ${ks('close-icon-size', `calc(2 * ${REM})`)};
  background-color: currentColor;
  -webkit-mask: ${ks('close-icon', `var(--base-icon-close, ${CLOSE_ICON})`)} center / contain no-repeat;
  mask: ${ks('close-icon', `var(--base-icon-close, ${CLOSE_ICON})`)} center / contain no-repeat;
}

/* Hover only with a real pointer: on touch :hover sticks after a tap, and a sheet opening under a
   resting mouse would show the tint at once. :active is the press feedback on touch. */
@media (hover: hover) {
  .km-sheet-close:hover {
    background: ${CLOSE_BG_HOVER};
  }
}

.km-sheet-close:active {
  background: ${CLOSE_BG_HOVER};
}

.km-sheet-close:focus-visible {
  outline: 2px solid ${ks('close-focus-color', 'var(--base-primary-color, #0078d4)')};
  outline-offset: -2px;
}

@media (forced-colors: active) {
  .km-sheet-close::before {
    background-color: ButtonText;
    forced-color-adjust: none;
  }
}
}
`;

export interface SheetHeaderOptions {
  /** Title text; `null` / omitted = no title element (a header holding a search field, say). */
  title?: string | null;
  /**
   * Your own controls between the title and the close button (a search field, a match navigator); they
   * get the space the title would take when there is no title.
   */
  content?: Node | readonly Node[];
  /** The close button's accessible name (from the component's `labels`). */
  closeLabel: string;
  /** Runs on a close-button click. */
  onClose: () => void;
}

export interface SheetHeader {
  header: HTMLDivElement;
  title: HTMLSpanElement | null;
  close: HTMLButtonElement;
}

/**
 * Builds `.km-sheet-header` > [`.km-sheet-title`] + [your `content`] + `.km-sheet-close` (a `type=button` with an
 * `aria-label`, no text: the ✕ is the CSS mask). Add your own classes / children as needed;
 * adopt `SHEET_CHROME_CSS` into the root it ends up in.
 */
export function createSheetHeader(opts: SheetHeaderOptions): SheetHeader {
  const header = document.createElement('div');
  header.className = 'km-sheet-header';
  let title: HTMLSpanElement | null = null;
  if (opts.title != null) {
    title = document.createElement('span');
    title.className = 'km-sheet-title';
    title.textContent = opts.title;
    header.append(title);
  }
  if (opts.content) header.append(...(Array.isArray(opts.content) ? opts.content : [opts.content as Node]));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'km-sheet-close';
  close.setAttribute('aria-label', opts.closeLabel);
  close.addEventListener('click', () => opts.onClose());
  header.append(close);
  return { header, title, close };
}
