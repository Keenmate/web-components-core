import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindShortcuts, formatShortcut, isTypingTarget, matchesShortcut, parseShortcut, getShortcutKeycaps } from './shortcut.js';

const key = (k: string, mods: Partial<KeyboardEventInit> = {}, code?: string) =>
  new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, composed: true, ...mods });

afterEach(() => document.body.replaceChildren());

describe('parseShortcut', () => {
  it('reads chords, Mod per platform, aliases, ProseMirror style and sequences', () => {
    expect(parseShortcut('Ctrl+Shift+Z')).toEqual([{ key: 'z', ctrl: true, shift: true, alt: false, meta: false }]);
    expect(parseShortcut('Mod+S', { isApple: true })[0]).toMatchObject({ meta: true, ctrl: false, key: 's' });
    expect(parseShortcut('Mod+S', { isApple: false })[0]).toMatchObject({ meta: false, ctrl: true });
    expect(parseShortcut('Mod-Shift-z', { isApple: false })[0]).toMatchObject({ ctrl: true, shift: true, key: 'z' });
    expect(parseShortcut('Ctrl++')[0]).toMatchObject({ ctrl: true, key: '+' });
    expect(parseShortcut('Ctrl+Plus')[0]).toMatchObject({ key: '+' });
    expect(parseShortcut('Shift+F3')[0]).toMatchObject({ shift: true, key: 'f3' });
    expect(parseShortcut('g f').map((c) => c.key)).toEqual(['g', 'f']);
    expect(parseShortcut('Ctrl+')).toEqual([]);
    expect(parseShortcut(undefined)).toEqual([]);
  });
});

describe('matchesShortcut', () => {
  it('modifiers exact; letters case-insensitive; Alt on a Mac via event.code', () => {
    expect(matchesShortcut(key('d', { ctrlKey: true }), 'Ctrl+D')).toBe(true);
    expect(matchesShortcut(key('D', { ctrlKey: true, shiftKey: true }), 'Ctrl+D')).toBe(false);
    expect(matchesShortcut(key('Z', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Z')).toBe(true);
    expect(matchesShortcut(key('∂', { altKey: true }, 'KeyD'), 'Alt+D')).toBe(true);
    expect(matchesShortcut(key('F2'), 'F2')).toBe(true);
    expect(matchesShortcut(key('Delete'), 'Del')).toBe(true);
  });

  it('a bare single character ignores Shift ("?" and a menu letter)', () => {
    expect(matchesShortcut(key('?', { shiftKey: true }), '?')).toBe(true);
    expect(matchesShortcut(key('R', { shiftKey: true }), 'r')).toBe(true);
    expect(matchesShortcut(key('r', { ctrlKey: true }), 'r')).toBe(false);
  });

  it('a sequence never matches one event', () => {
    expect(matchesShortcut(key('g'), 'g f')).toBe(false);
  });
});

describe('format', () => {
  it('text on Windows / Linux, symbols on Apple; unparseable text unchanged', () => {
    expect(formatShortcut('mod+shift+z', { isApple: false })).toBe('Ctrl+Shift+Z');
    expect(formatShortcut('Mod+Shift+Z', { isApple: true })).toBe('⇧⌘Z');
    expect(formatShortcut('g f', { isApple: false })).toBe('G F');
    expect(formatShortcut('Shift+ArrowUp', { isApple: false })).toBe('Shift+↑');
    expect(formatShortcut('right-click', { isApple: false })).toBe('right-click');
    expect(getShortcutKeycaps('Ctrl+Alt+Delete', { isApple: false })).toEqual([['Ctrl', 'Alt', 'Del']]);
  });
});

describe('isTypingTarget', () => {
  it('text fields and contenteditable, not buttons / checkboxes', () => {
    const input = document.createElement('input');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const button = document.createElement('button');
    document.body.append(input, box, button);
    const at = (el: Element): boolean => {
      let result = false;
      el.addEventListener('keydown', (e) => (result = isTypingTarget(e)), { once: true });
      el.dispatchEvent(key('a'));
      return result;
    };
    expect(at(input)).toBe(true);
    expect(at(box)).toBe(false);
    expect(at(button)).toBe(false);
  });
});

describe('bindShortcuts', () => {
  it('runs the matching binding, prevents default, skips disabled ones', () => {
    const save = vi.fn();
    const off = vi.fn();
    const unbind = bindShortcuts(document, [
      { shortcut: 'Ctrl+S', run: save },
      { shortcut: 'Ctrl+D', run: off, isEnabled: () => false },
    ]);
    const e = key('s', { ctrlKey: true });
    document.body.dispatchEvent(e);
    expect(save).toHaveBeenCalledWith(e);
    expect(e.defaultPrevented).toBe(true);
    const d = key('d', { ctrlKey: true });
    document.body.dispatchEvent(d);
    expect(off).not.toHaveBeenCalled();
    expect(d.defaultPrevented).toBe(false);
    unbind();
    document.body.dispatchEvent(key('s', { ctrlKey: true }));
    expect(save).toHaveBeenCalledOnce();
  });

  it('sequences: g then f within the timeout; a wrong key resets', () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn();
      const unbind = bindShortcuts(document, () => [{ shortcut: 'g f', run }]);
      document.body.dispatchEvent(key('g'));
      document.body.dispatchEvent(key('f'));
      expect(run).toHaveBeenCalledOnce();
      document.body.dispatchEvent(key('g'));
      document.body.dispatchEvent(key('x'));
      document.body.dispatchEvent(key('f'));
      expect(run).toHaveBeenCalledOnce();
      document.body.dispatchEvent(key('g'));
      vi.advanceTimersByTime(1001);
      document.body.dispatchEvent(key('f'));
      expect(run).toHaveBeenCalledOnce();
      unbind();
    } finally {
      vi.useRealTimers();
    }
  });

  it('isEnabled receives the event and is asked only for the binding that matched the key', () => {
    const sGate = vi.fn((_e: KeyboardEvent) => true);
    const dGate = vi.fn((_e: KeyboardEvent) => true);
    const save = vi.fn();
    const unbind = bindShortcuts(document, [
      { shortcut: 'Ctrl+S', run: save, isEnabled: sGate },
      { shortcut: 'Ctrl+D', run: vi.fn(), isEnabled: dGate },
    ]);
    const e = key('s', { ctrlKey: true });
    document.body.dispatchEvent(e);
    expect(sGate).toHaveBeenCalledOnce();
    expect(sGate).toHaveBeenCalledWith(e);
    expect(dGate).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
    document.body.dispatchEvent(key('x', { ctrlKey: true }));
    expect(sGate).toHaveBeenCalledOnce();
    expect(dGate).not.toHaveBeenCalled();
    unbind();
  });

  it('isEnabled(event) false: the key is not consumed and an outer binding on an ancestor still runs', () => {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    const input = document.createElement('input');
    inner.append(input);
    outer.append(inner);
    document.body.append(outer);
    const innerRun = vi.fn();
    const outerRun = vi.fn();
    const unbindInner = bindShortcuts(inner, [{ shortcut: 'Ctrl+D', run: innerRun, isEnabled: (e) => !isTypingTarget(e) }]);
    const unbindOuter = bindShortcuts(outer, [{ shortcut: 'Ctrl+D', run: outerRun }]);
    const typed = key('d', { ctrlKey: true });
    input.dispatchEvent(typed);
    expect(innerRun).not.toHaveBeenCalled();
    expect(outerRun).toHaveBeenCalledOnce();
    expect(typed.defaultPrevented).toBe(true); // prevented by the OUTER binding
    unbindOuter();
    const alone = key('d', { ctrlKey: true });
    input.dispatchEvent(alone);
    expect(innerRun).not.toHaveBeenCalled();
    expect(alone.defaultPrevented).toBe(false);
    unbindInner();
  });

  it('nested layering: an inner binding that handled the key makes the outer one skip it', () => {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    outer.append(inner);
    document.body.append(outer);
    const innerRun = vi.fn();
    const outerRun = vi.fn();
    const outerGate = vi.fn(() => true);
    const unbindInner = bindShortcuts(inner, [{ shortcut: 'Ctrl+D', run: innerRun }]);
    const unbindOuter = bindShortcuts(outer, [{ shortcut: 'Ctrl+D', run: outerRun, isEnabled: outerGate }]);
    const e = key('d', { ctrlKey: true });
    inner.dispatchEvent(e);
    expect(innerRun).toHaveBeenCalledOnce();
    expect(outerRun).not.toHaveBeenCalled();
    expect(outerGate).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
    unbindInner();
    unbindOuter();
  });

  it('a disabled sequence does not start (its first key is not consumed)', () => {
    const run = vi.fn();
    const unbind = bindShortcuts(document, [{ shortcut: 'g f', run, isEnabled: () => false }]);
    const g = key('g');
    document.body.dispatchEvent(g);
    expect(g.defaultPrevented).toBe(false);
    document.body.dispatchEvent(key('f'));
    expect(run).not.toHaveBeenCalled();
    unbind();
  });

  it('plain keys do not fire while typing; chords with Ctrl do; run() returning false keeps the default', () => {
    const plain = vi.fn();
    const chord = vi.fn(() => false as const);
    const input = document.createElement('input');
    document.body.append(input);
    const unbind = bindShortcuts(document, [
      { shortcut: 'Delete', run: plain },
      { shortcut: 'Ctrl+K', run: chord },
    ]);
    input.dispatchEvent(key('Delete'));
    expect(plain).not.toHaveBeenCalled();
    const k = key('k', { ctrlKey: true });
    input.dispatchEvent(k);
    expect(chord).toHaveBeenCalled();
    expect(k.defaultPrevented).toBe(false);
    unbind();
  });
});
