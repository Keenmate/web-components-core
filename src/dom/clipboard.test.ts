import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, readPasteText } from './clipboard.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('copyText', () => {
  it('the async Clipboard API when there is one', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    vi.unstubAllGlobals();
  });

  it('falls back to a textarea + execCommand when the API rejects; focus comes back; the textarea is gone', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => { throw new Error('denied'); } } });
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    let copied = '';
    const exec = vi.fn((cmd: string) => {
      copied = cmd === 'copy' ? (document.activeElement as HTMLTextAreaElement).value : '';
      return true;
    });
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await copyText('a\tb')).toBe(true);
    expect(copied).toBe('a\tb');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
    vi.unstubAllGlobals();
  });

  it('nothing works → false, never throws', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    (document as unknown as { execCommand: unknown }).execCommand = () => {
      throw new Error('nope');
    };
    expect(await copyText('x')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('readPasteText', () => {
  const paste = (data: Record<string, string>): Event =>
    Object.assign(new Event('paste'), { clipboardData: { getData: (t: string) => data[t] ?? '' } });

  it('text/plain, newlines normalized; the html type on request; no data → empty', () => {
    expect(readPasteText(paste({ 'text/plain': 'a\r\nb\rc' }))).toBe('a\nb\nc');
    expect(readPasteText(paste({ 'text/plain': 'a\r\nb' }), { shouldNormalizeNewlines: false })).toBe('a\r\nb');
    expect(readPasteText(paste({ text: 'legacy' }))).toBe('legacy');
    expect(readPasteText(paste({ 'text/html': '<b>x</b>' }), { type: 'text/html' })).toBe('<b>x</b>');
    expect(readPasteText(new Event('paste'))).toBe('');
  });
});
