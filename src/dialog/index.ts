/**
 * `@keenmate/web-components-core/dialog` — a ready-made modal dialog (SPEC §12.19): `openDialog()`,
 * `confirmDialog()`, `promptDialog()` on core's `startModalSession()` (focus trap, inert page, Escape / Back /
 * backdrop, scroll lock). The styled replacement for `window.confirm` / `window.prompt`.
 */
export { openDialog, confirmDialog, promptDialog } from './open-dialog.js';
export { DIALOG_CSS } from './styles.js';
export type { ConfirmDialogOptions, DialogAction, DialogHandle, DialogLabels, OpenDialogOptions, PromptDialogOptions } from './open-dialog.js';
