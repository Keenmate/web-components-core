/**
 * The `/dialog` look (SPEC §12.19): a centered card over a backdrop, the shared sheet header on top
 * (`SHEET_CHROME_CSS`), the message / your content, the buttons at the bottom. On a narrow screen it
 * becomes a bottom sheet (full width, rounded top corners, safe-area padding).
 *
 * Every value reads `var(--km-dialog-X, var(--base-…, <default>))` — the page sets `--km-dialog-X` on
 * `:root`; the dialog layer sits on `<body>`, outside any component, so there is no per-instance layer.
 * In `@layer component`.
 */
import { Z_INDEX } from '../dom/z-index.js';

const REM = 'var(--base-rem, 10px)';
const rem = (token: string, multiplier: number): string => `calc(var(--base-${token}, ${multiplier}) * ${REM})`;
const kd = (name: string, fallback: string): string => `var(--km-dialog-${name}, ${fallback})`;

const DURATION = kd('duration', 'var(--base-duration-medium, 0.25s)');
const EASE_OUT = 'var(--base-ease-out, cubic-bezier(0, 0, 0.2, 1))';
const SPACE = kd('padding', rem('space-base', 1.6));
/** Contract defaults (base-variables.css) — the fallbacks equal them, derived tokens use the contract formula. */
const MAIN_BG = 'var(--base-main-bg, light-dark(#ffffff, #1e293b))';
const TEXT_1 = 'var(--base-text-color-1, light-dark(#334155, #f1f5f9))';
const PRIMARY = 'var(--base-primary-color, #3b82f6)';
const DANGER = 'var(--base-danger-color, #dc2626)';
const BORDER = `var(--base-border-color, light-dark(oklch(from var(--base-main-bg, light-dark(#ffffff, #1e293b)) calc(l - 0.096) c h), oklch(from var(--base-main-bg, light-dark(#ffffff, #1e293b)) calc(l + 0.192) c h)))`;
const HOVER_BG = `var(--base-hover-bg, light-dark(color-mix(in oklch, oklch(from var(--base-main-bg, light-dark(#ffffff, #1e293b)) calc(l - 0.45) c h) 14%, transparent), color-mix(in oklch, oklch(from var(--base-main-bg, light-dark(#ffffff, #1e293b)) calc(l + 0.45) c h) 28%, transparent)))`;
const RADIUS = kd('border-radius', rem('border-radius-lg', 0.8));

export const DIALOG_CSS = `
@layer component {
.km-dialog {
  position: fixed;
  /* top/left + translate (not inset: 0 + margin: auto): the height follows the content */
  inset: 50% auto auto 50%;
  translate: -50% -50%;
  z-index: ${Z_INDEX.modal};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: ${kd('width', `min(calc(48 * ${REM}), calc(100vw - 2 * ${SPACE}))`)};
  max-height: calc(100dvh - 2 * ${SPACE});
  margin: 0;
  overflow: hidden;
  color: ${kd('text-color', TEXT_1)};
  background: ${kd('bg', `var(--base-elevated-bg, light-dark(oklch(from var(--base-main-bg, light-dark(#ffffff, #1e293b)) calc(l - 0.03) c h), oklch(from var(--base-main-bg, light-dark(#ffffff, #1e293b)) calc(l + 0.06) c h)))`)};
  border: ${kd('border', `var(--base-border-width, 1px) solid ${BORDER}`)};
  border-radius: ${RADIUS};
  box-shadow: ${kd('box-shadow', '0 12px 40px rgba(0, 0, 0, 0.25)')};
  font-family: var(--base-font-family, inherit);
  font-size: ${rem('font-size-base', 1.6)};
  line-height: var(--base-line-height-normal, 1.5);
  animation: km-dialog-in ${DURATION} ${EASE_OUT};
}

.km-dialog:focus { outline: none; }

.km-dialog__body {
  flex: 1 1 auto;
  overflow: auto;
  padding: ${SPACE};
  overscroll-behavior: contain;
}

.km-dialog__message { margin: 0; white-space: pre-line; }
.km-dialog__message + .km-dialog__field { margin-top: ${rem('space-md', 1.2)}; }

.km-dialog__field { display: flex; flex-direction: column; gap: ${rem('space-xs', 0.4)}; }

.km-dialog__input {
  box-sizing: border-box;
  width: 100%;
  min-height: ${rem('input-size-md-height', 3.5)};
  padding: 0 ${rem('space-sm', 0.8)};
  font: inherit;
  color: inherit;
  background: var(--base-input-bg, var(--base-main-bg, light-dark(#ffffff, #1e293b)));
  border: var(--base-border-width, 1px) solid var(--base-input-border-color, light-dark(color-mix(in srgb, var(--base-text-color-1, light-dark(#334155, #f1f5f9)) 45%, var(--base-main-bg, light-dark(#ffffff, #1e293b))), color-mix(in srgb, var(--base-text-color-1, light-dark(#334155, #f1f5f9)) 35%, var(--base-main-bg, light-dark(#ffffff, #1e293b)))));
  border-radius: ${rem('border-radius-sm', 0.4)};
}

.km-dialog__input:focus-visible { outline: 2px solid ${PRIMARY}; outline-offset: -1px; }
.km-dialog__input[aria-invalid="true"] { border-color: ${DANGER}; }
.km-dialog__error { color: ${DANGER}; font-size: ${rem('font-size-sm', 1.4)}; }
.km-dialog__error:empty { display: none; }

.km-dialog__actions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: ${rem('space-sm', 0.8)};
  padding: 0 ${SPACE} ${SPACE};
}

.km-dialog__action {
  min-height: var(--base-touch-target-min, 44px);
  padding: 0 ${rem('space-base', 1.6)};
  font: inherit;
  color: inherit;
  background: ${kd('button-bg', 'transparent')};
  border: 1px solid ${BORDER};
  border-radius: ${rem('border-radius-sm', 0.4)};
  cursor: pointer;
}

@media (hover: hover) {
  .km-dialog__action:hover { background: ${HOVER_BG}; }
}

.km-dialog__action:focus-visible { outline: 2px solid ${PRIMARY}; outline-offset: 2px; }
.km-dialog__action.is-primary { color: #fff; background: ${PRIMARY}; border-color: ${PRIMARY}; }
.km-dialog__action.is-danger { color: #fff; background: ${DANGER}; border-color: ${DANGER}; }

.km-modal-backdrop { animation: km-dialog-fade ${DURATION} ${EASE_OUT}; }

/* A narrow screen: a bottom sheet. */
@media (max-width: 480px) {
  .km-dialog {
    inset: auto 0 0 0;
    translate: none;
    width: 100%;
    max-height: 85dvh;
    margin: 0;
    border-width: 1px 0 0;
    border-radius: ${RADIUS} ${RADIUS} 0 0;
    padding-bottom: env(safe-area-inset-bottom);
    animation-name: km-dialog-up;
  }
  .km-dialog__action { flex: 1 1 0; }
}

@keyframes km-dialog-in { from { opacity: 0; transform: scale(0.96); } }
@keyframes km-dialog-up { from { transform: translateY(100%); } }
@keyframes km-dialog-fade { from { opacity: 0; } }

@media (forced-colors: active) {
  .km-dialog { border: 1px solid CanvasText; }
}
}
`;
