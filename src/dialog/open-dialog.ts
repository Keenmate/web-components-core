/**
 * `/dialog` (SPEC §12.19): a ready-made modal dialog on `startModalSession` — `openDialog()` for your own
 * buttons / content, `confirmDialog()` and `promptDialog()` for the two everyday cases that components (and
 * apps) answered with `window.confirm` / `window.prompt`: unstyled, untranslatable, blocking the page's JS.
 *
 * The dialog mounts in its own layer — a `<div class="km-dialog-layer">` with a shadow root holding
 * `DIALOG_CSS` + `SHEET_CHROME_CSS` — on `container` (default `<body>`), so no component CSS reaches it and it
 * can't be trapped in a component's stacking context. Theme tokens (`--base-*`) inherit into it as usual.
 */
import { adoptStyles } from '../dom/adopt-styles.js';
import { SHEET_CHROME_CSS, createSheetHeader } from '../overlay/sheet-chrome.js';
import { startModalSession, type ModalDismissReason } from '../overlay/modal-session.js';
import { callSafely } from '../logging/safe-call.js';
import { adoptMotionStyles } from '../environment/motion.js';
import { DIALOG_CSS } from './styles.js';

/** Button texts (from the component's / app's `labels`); English defaults. */
export interface DialogLabels {
  ok?: string;
  cancel?: string;
  close?: string;
}

/** One button at the bottom. Its `value` is what the dialog resolves with. */
export interface DialogAction {
  value: string;
  label: string;
  /** The main action (filled accent; Enter in a prompt field presses it). */
  isPrimary?: boolean;
  /** A destructive action (filled danger colour). */
  isDanger?: boolean;
}

export interface OpenDialogOptions {
  /** Title in the header (also the dialog's accessible name). `null` / omitted = a header with only ✕. */
  title?: string | null;
  /** Plain text under the title (escaped — set as text; line breaks kept). */
  message?: string;
  /** Your own content after the message (a form, a list) — appended as-is. */
  content?: Node;
  /** The buttons, in order. Default: one primary OK. */
  actions?: readonly DialogAction[];
  /** ✕, Escape, phone Back and a backdrop click close it with `null`. Default `true`. */
  isDismissible?: boolean;
  /**
   * Runs before the dialog closes with `value` (`null` = dismissed). Return `false` to keep it open (a field
   * that isn't valid yet). Sync only.
   */
  beforeCloseCallback?(value: string | null): boolean | void;
  /** What gets focus first. Default: `[autofocus]`, else the primary button, else the first button. */
  initialFocus?: HTMLElement | null | (() => HTMLElement | null | undefined);
  /** Where the dialog layer mounts. Default `document.body`. */
  container?: Element;
  /** The element that opened it (focus returns there; default: what had focus). */
  trigger?: Element | null;
  /** Extra class(es) on the dialog panel. */
  className?: string;
  labels?: DialogLabels;
}

export interface DialogHandle {
  /** Resolves with the pressed action's `value`, or `null` when dismissed / closed without a value. */
  readonly result: Promise<string | null>;
  /** Close it from code (resolves `result` with `value`, default `null`). Skips `beforeCloseCallback`. */
  close(value?: string | null): void;
  /** The dialog panel (`.km-dialog`). */
  readonly panel: HTMLElement;
  /** The body (`.km-dialog__body`) — where `message` / `content` went. */
  readonly body: HTMLElement;
}

const DEFAULT_LABELS: Required<DialogLabels> = { ok: 'OK', cancel: 'Cancel', close: 'Close' };
let idCounter = 0;

/** Open a modal dialog. SSR: returns a handle whose `result` resolves `null` at once. */
export function openDialog(opts: OpenDialogOptions = {}): DialogHandle {
  if (typeof document === 'undefined') {
    const stub = {} as HTMLElement;
    return { result: Promise.resolve(null), close() {}, panel: stub, body: stub };
  }
  const labels = { ...DEFAULT_LABELS, ...opts.labels };
  const isDismissible = opts.isDismissible ?? true;
  const id = `km-dialog-${++idCounter}`;

  const layer = document.createElement('div');
  layer.className = 'km-dialog-layer';
  const root = layer.attachShadow({ mode: 'open' });
  adoptStyles(root, DIALOG_CSS, SHEET_CHROME_CSS);

  const panel = document.createElement('div');
  panel.className = `km-dialog${opts.className ? ` ${opts.className}` : ''}`;
  panel.setAttribute('role', opts.actions?.some((a) => a.isDanger) ? 'alertdialog' : 'dialog');

  let resolve!: (value: string | null) => void;
  const result = new Promise<string | null>((r) => (resolve = r));
  let isClosed = false;

  const finish = (value: string | null, shouldAsk: boolean): void => {
    if (isClosed) return;
    if (shouldAsk && opts.beforeCloseCallback) {
      const answer = callSafely(() => opts.beforeCloseCallback!(value), {
        source: opts.trigger ?? null,
        coreCategory: 'ELEMENT',
        message: 'dialog beforeCloseCallback threw',
      });
      if (answer.isOk && answer.value === false) return;
    }
    isClosed = true;
    session.end();
    layer.remove();
    resolve(value);
  };

  const { header, title } = createSheetHeader({
    title: opts.title ?? null,
    closeLabel: labels.close,
    onClose: () => finish(null, true),
  });
  if (title) {
    title.id = `${id}-title`;
    panel.setAttribute('aria-labelledby', title.id);
  }
  const closeButton = header.querySelector('.km-sheet-close') as HTMLElement | null;
  if (!isDismissible) closeButton?.remove();

  const body = document.createElement('div');
  body.className = 'km-dialog__body';
  if (opts.message) {
    const message = document.createElement('p');
    message.className = 'km-dialog__message';
    message.id = `${id}-message`;
    message.textContent = opts.message;
    body.append(message);
    panel.setAttribute('aria-describedby', message.id);
  }
  if (opts.content) body.append(opts.content);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'km-dialog__actions';
  const actions = opts.actions ?? [{ value: 'ok', label: labels.ok, isPrimary: true }];
  let primary: HTMLButtonElement | null = null;
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'km-dialog__action';
    if (action.isPrimary) button.classList.add('is-primary');
    if (action.isDanger) button.classList.add('is-danger');
    button.dataset.value = action.value;
    button.textContent = action.label;
    button.addEventListener('click', () => finish(action.value, true));
    if (action.isPrimary && !primary) primary = button;
    actionsEl.append(button);
  }

  panel.append(header, body, actionsEl);
  root.append(panel);
  (opts.container ?? document.body).append(layer);
  // motion level / OS reduced motion reach the dialog's animation like any component's (SPEC §12.16)
  adoptMotionStyles(panel);

  const firstButton = actionsEl.querySelector('button');
  const session = startModalSession(panel, {
    backdrop: true,
    shouldCloseOnBackdropClick: isDismissible,
    shouldCloseOnEscape: isDismissible,
    shouldCloseOnBack: isDismissible,
    onDismiss: (_reason: ModalDismissReason) => finish(null, true),
    trigger: opts.trigger ?? null,
    initialFocus: opts.initialFocus ?? (() => (body.querySelector('[autofocus]') as HTMLElement | null) ?? primary ?? firstButton),
  });

  return {
    result,
    close: (value = null) => finish(value, false),
    panel,
    body,
  };
}

export interface ConfirmDialogOptions extends Pick<OpenDialogOptions, 'title' | 'message' | 'content' | 'container' | 'trigger' | 'className' | 'labels'> {
  /** The confirm button's text. Default `labels.ok`. */
  confirmLabel?: string;
  /** The cancel button's text. Default `labels.cancel`. */
  cancelLabel?: string;
  /** The confirm button is destructive (danger colour; `role="alertdialog"`). */
  isDanger?: boolean;
}

/** Cancel / OK. Resolves `true` on confirm, `false` on cancel or dismiss. Focus starts on Cancel when `isDanger`. */
export async function confirmDialog(opts: ConfirmDialogOptions = {}): Promise<boolean> {
  const labels = { ...DEFAULT_LABELS, ...opts.labels };
  // No primary when destructive: focus starts on the first button, Cancel.
  const handle = openDialog({
    ...opts,
    actions: [
      { value: 'cancel', label: opts.cancelLabel ?? labels.cancel },
      { value: 'confirm', label: opts.confirmLabel ?? labels.ok, isPrimary: !opts.isDanger, isDanger: !!opts.isDanger },
    ],
  });
  return (await handle.result) === 'confirm';
}

export interface PromptDialogOptions extends Pick<OpenDialogOptions, 'title' | 'message' | 'container' | 'trigger' | 'className' | 'labels'> {
  /** The field's visible label (default: none; the title names the dialog). */
  label?: string;
  /** Starting value (selected, so typing replaces it). */
  value?: string;
  placeholder?: string;
  /** `<input type>` (`'text'`, `'url'`, `'email'`, `'number'` …). Default `'text'`. */
  inputType?: string;
  /** Returns an error message to keep the dialog open, or nothing when the value is fine. */
  validate?(value: string): string | null | undefined | void;
  okLabel?: string;
  cancelLabel?: string;
}

/** One text field + OK / Cancel. Resolves the entered text, or `null` on cancel / dismiss. Enter = OK. */
export async function promptDialog(opts: PromptDialogOptions = {}): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const labels = { ...DEFAULT_LABELS, ...opts.labels };
  const id = `km-dialog-field-${++idCounter}`;
  const field = document.createElement('div');
  field.className = 'km-dialog__field';
  if (opts.label) {
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = opts.label;
    field.append(label);
  }
  const input = document.createElement('input');
  input.id = id;
  input.className = 'km-dialog__input';
  input.type = opts.inputType ?? 'text';
  input.value = opts.value ?? '';
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (!opts.label && opts.title) input.setAttribute('aria-label', opts.title);
  const error = document.createElement('div');
  error.className = 'km-dialog__error';
  error.id = `${id}-error`;
  error.setAttribute('aria-live', 'polite');
  input.setAttribute('aria-describedby', error.id);
  field.append(input, error);

  const check = (): boolean => {
    const message = opts.validate?.(input.value) || '';
    error.textContent = message;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    return !message;
  };

  const handle = openDialog({
    ...opts,
    content: field,
    actions: [
      { value: 'cancel', label: opts.cancelLabel ?? labels.cancel },
      { value: 'ok', label: opts.okLabel ?? labels.ok, isPrimary: true },
    ],
    initialFocus: () => input,
    beforeCloseCallback: (value) => (value === 'ok' ? check() : true),
  });
  input.select();
  input.addEventListener('input', () => {
    if (error.textContent) check();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      (handle.panel.querySelector('[data-value="ok"]') as HTMLElement | null)?.click();
    }
  });
  return (await handle.result) === 'ok' ? input.value : null;
}
