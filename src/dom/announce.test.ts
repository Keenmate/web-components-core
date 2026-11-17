import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANNOUNCE_DELAY_MS, ANNOUNCER_ATTRIBUTE, announce } from './announce.js';
import { createFocusTrap } from './focus-trap.js';

const region = (p: string): HTMLElement | null => document.body.querySelector(`[${ANNOUNCER_ATTRIBUTE}="${p}"]`);

describe('announce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    for (const el of document.body.querySelectorAll(`[${ANNOUNCER_ATTRIBUTE}]`)) el.remove();
  });

  it('one polite status region per document, written after a short pause', () => {
    announce('12 results');
    const r = region('polite')!;
    expect(r.getAttribute('role')).toBe('status');
    expect(r.getAttribute('aria-live')).toBe('polite');
    expect(r.getAttribute('aria-atomic')).toBe('true');
    expect(r.textContent).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    expect(r.textContent).toBe('12 results');
    announce('3 results');
    expect(document.body.querySelectorAll(`[${ANNOUNCER_ATTRIBUTE}="polite"]`).length).toBe(1);
  });

  it('the same text again is cleared then rewritten (read again)', () => {
    announce('Saved');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    announce('Saved');
    expect(region('polite')!.textContent).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    expect(region('polite')!.textContent).toBe('Saved');
  });

  it('a newer announcement replaces one not yet written', () => {
    announce('first');
    announce('second');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    expect(region('polite')!.textContent).toBe('second');
  });

  it('assertive has its own region; empty text does nothing', () => {
    announce('Invalid date', { politeness: 'assertive' });
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    const r = region('assertive')!;
    expect(r.getAttribute('aria-live')).toBe('assertive');
    expect(r.hasAttribute('role')).toBe(false);
    expect(r.textContent).toBe('Invalid date');
    announce('');
    expect(region('polite')).toBeNull();
  });

  it('a modal focus trap leaves the region out of the inert background', () => {
    announce('x');
    const panel = document.createElement('div');
    panel.innerHTML = '<button>ok</button>';
    document.body.append(panel);
    const trap = createFocusTrap(panel);
    expect(region('polite')!.hasAttribute('inert')).toBe(false);
    trap.release();
    panel.remove();
  });
});
