import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../overlay/scroll-lock.js', () => ({ lockBodyScroll: () => () => {} }));

import { confirmDialog, DIALOG_CSS, openDialog, promptDialog } from './index.js';
import { __resetOverlays } from '../overlay/active-overlay.js';
import { deepActiveElement } from '../dom/active-element.js';

afterEach(() => {
  __resetOverlays();
  document.body.replaceChildren();
});

const layer = (): ShadowRoot | null => document.querySelector('.km-dialog-layer')?.shadowRoot ?? null;
const button = (value: string): HTMLButtonElement => layer()!.querySelector(`[data-value="${value}"]`) as HTMLButtonElement;
const escape = (): void => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
};

describe('openDialog', () => {
  it('renders title / message (as text) / actions in its own layer, resolves the pressed value, cleans up', async () => {
    const opener = document.createElement('button');
    const page = document.createElement('main');
    document.body.append(opener, page);
    opener.focus();

    const handle = openDialog({
      title: 'Save changes?',
      message: '<b>not html</b>',
      actions: [
        { value: 'discard', label: 'Discard', isDanger: true },
        { value: 'save', label: 'Save', isPrimary: true },
      ],
    });
    const root = layer()!;
    const panel = root.querySelector('.km-dialog')!;
    expect(panel).toBe(handle.panel);
    expect(panel.getAttribute('role')).toBe('alertdialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(root.getElementById(panel.getAttribute('aria-labelledby')!)!.textContent).toBe('Save changes?');
    expect(root.querySelector('.km-dialog__message')!.textContent).toBe('<b>not html</b>');
    expect(root.querySelector('.km-modal-backdrop')).not.toBeNull();
    expect(page.hasAttribute('inert')).toBe(true);
    expect(deepActiveElement()).toBe(button('save')); // the primary

    button('save').click();
    expect(await handle.result).toBe('save');
    expect(layer()).toBeNull();
    expect(page.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('✕, Escape and a backdrop click resolve null; isDismissible: false removes ✕ and ignores Escape', async () => {
    const a = openDialog({ title: 'A' });
    (layer()!.querySelector('.km-sheet-close') as HTMLElement).click();
    expect(await a.result).toBeNull();

    const b = openDialog({ title: 'B' });
    escape();
    expect(await b.result).toBeNull();

    const c = openDialog({ title: 'C' });
    (layer()!.querySelector('.km-modal-backdrop') as HTMLElement).click();
    expect(await c.result).toBeNull();

    const d = openDialog({ title: 'D', isDismissible: false });
    expect(layer()!.querySelector('.km-sheet-close')).toBeNull();
    escape();
    (layer()!.querySelector('.km-modal-backdrop') as HTMLElement).click();
    expect(layer()).not.toBeNull();
    button('ok').click();
    expect(await d.result).toBe('ok');
  });

  it('beforeCloseCallback false keeps it open; close(value) from code skips it', async () => {
    const seen: (string | null)[] = [];
    const handle = openDialog({ beforeCloseCallback: (v) => (seen.push(v), false) });
    button('ok').click();
    escape();
    expect(seen).toEqual(['ok', null]);
    expect(layer()).not.toBeNull();
    handle.close('forced');
    expect(await handle.result).toBe('forced');
  });

  it('content node is appended as-is; labels translate the defaults', () => {
    const form = document.createElement('form');
    openDialog({ content: form, labels: { ok: 'Budiž', close: 'Zavřít' } });
    expect(layer()!.querySelector('.km-dialog__body form')).toBe(form);
    expect(button('ok').textContent).toBe('Budiž');
    expect(layer()!.querySelector('.km-sheet-close')!.getAttribute('aria-label')).toBe('Zavřít');
  });
});

describe('confirmDialog', () => {
  it('resolves true on confirm, false on cancel / dismiss; isDanger starts on Cancel', async () => {
    const yes = confirmDialog({ title: 'Delete?', isDanger: true, confirmLabel: 'Delete' });
    expect(deepActiveElement()).toBe(button('cancel'));
    expect(button('confirm').classList.contains('is-danger')).toBe(true);
    button('confirm').click();
    expect(await yes).toBe(true);

    const no = confirmDialog({ title: 'Sure?' });
    expect(deepActiveElement()).toBe(button('confirm'));
    escape();
    expect(await no).toBe(false);
  });
});

describe('promptDialog', () => {
  it('Enter submits the typed value; Cancel resolves null', async () => {
    const answer = promptDialog({ title: 'Code language', value: 'javascript' });
    const input = layer()!.querySelector('input')!;
    expect(deepActiveElement()).toBe(input);
    expect(input.getAttribute('aria-label')).toBe('Code language');
    input.value = 'elixir';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(await answer).toBe('elixir');

    const cancelled = promptDialog({ title: 'x' });
    button('cancel').click();
    expect(await cancelled).toBeNull();
  });

  it('validate keeps it open and shows the message until the value is fine', async () => {
    const answer = promptDialog({ label: 'URL', validate: (v) => (v.startsWith('https://') ? null : 'Must start with https://') });
    const root = layer()!;
    const input = root.querySelector('input')!;
    expect(root.querySelector('label')!.htmlFor).toBe(input.id);
    input.value = 'ftp://x';
    button('ok').click();
    expect(root.querySelector('.km-dialog__error')!.textContent).toBe('Must start with https://');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.value = 'https://x';
    input.dispatchEvent(new Event('input'));
    expect(input.getAttribute('aria-invalid')).toBe('false');
    button('ok').click();
    expect(await answer).toBe('https://x');
  });
});

describe('DIALOG_CSS contract fallbacks (713cb52)', () => {
  it('the prompt field height is the unitless --base-input-size-md-height × --base-rem (default 3.5)', () => {
    expect(DIALOG_CSS).toContain('min-height: calc(var(--base-input-size-md-height, 3.5) * var(--base-rem, 10px));');
  });
});
