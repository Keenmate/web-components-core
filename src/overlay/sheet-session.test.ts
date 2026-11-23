import { afterEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let backHandler: (() => void) | undefined;
vi.mock('./scroll-lock.js', () => ({ lockBodyScroll: () => (calls.push('lock'), () => calls.push('unlock')) }));
vi.mock('./keyboard-inset.js', () => ({ fitToVisibleViewport: () => (calls.push('inset'), () => calls.push('uninset')) }));
vi.mock('./back-entry.js', () => ({
  claimBackEntry: (onBack: () => void) => {
    backHandler = onBack;
    calls.push('claim');
    return () => calls.push('release');
  },
}));

import { startSheetSession } from './sheet-session.js';
import { createSheetHeader } from './sheet-chrome.js';

afterEach(() => {
  calls.length = 0;
  backHandler = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('startSheetSession', () => {
  it('locks scroll, observes the keyboard, claims Back; end() undoes all once, in reverse', () => {
    const panel = document.createElement('div');
    document.body.append(panel);
    const session = startSheetSession(panel, { onBack: () => {} });
    expect(calls).toEqual(['lock', 'inset', 'claim']);
    session.end();
    session.end();
    expect(calls).toEqual(['lock', 'inset', 'claim', 'release', 'uninset', 'unlock']);
    expect(session.isEnded).toBe(true);
  });

  it('no onBack → no Back entry; options switch the pieces off', () => {
    const panel = document.createElement('div');
    startSheetSession(panel, { shouldLockScroll: false, shouldObserveKeyboardInset: false }).end();
    expect(calls).toEqual([]);
  });

  it('rearmBack() from inside onBack claims the entry again (one level up)', () => {
    const panel = document.createElement('div');
    let level = 1;
    const session = startSheetSession(panel, {
      onBack: () => {
        if (level-- > 0) session.rearmBack();
      },
    });
    backHandler!();
    expect(calls.filter((c) => c === 'claim')).toHaveLength(2);
    session.end();
    session.rearmBack(); // after end: no-op
    expect(calls.filter((c) => c === 'claim')).toHaveLength(2);
  });

  it('warns once when an ancestor traps the fixed panel', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const trap = document.createElement('section');
    trap.id = 'trap';
    trap.style.transform = 'scale(1)';
    const panel = document.createElement('div');
    trap.append(panel);
    document.body.append(trap);
    startSheetSession(panel).end();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]!.join(' ')).toContain('<section#trap>');
  });
});

describe('createSheetHeader content', () => {
  it('puts your controls between the title and the close button', () => {
    const search = document.createElement('input');
    const { header, close } = createSheetHeader({ title: null, closeLabel: 'Close', onClose: () => {}, content: search });
    expect([...header.children]).toEqual([search, close]);
  });
});
