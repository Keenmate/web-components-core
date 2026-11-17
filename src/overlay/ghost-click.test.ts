import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardGhostClick } from './ghost-click.js';
import { startModalSession } from './modal-session.js';

describe('guardGhostClick', () => {
  let panel: HTMLElement;
  let outside: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    panel = document.createElement('div');
    panel.innerHTML = '<button>day</button>';
    outside = document.createElement('button');
    document.body.append(panel, outside);
  });
  afterEach(() => {
    vi.useRealTimers();
    panel.remove();
    outside.remove();
  });

  it('swallows the next click on a guarded element, once', () => {
    const onClick = vi.fn();
    panel.addEventListener('click', onClick);
    guardGhostClick([panel]);
    panel.querySelector('button')!.click();
    expect(onClick).not.toHaveBeenCalled();
    panel.querySelector('button')!.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('a first click elsewhere passes and disarms it', () => {
    const onClick = vi.fn();
    panel.addEventListener('click', onClick);
    const onOutside = vi.fn();
    outside.addEventListener('click', onOutside);
    guardGhostClick([panel, null]);
    outside.click();
    expect(onOutside).toHaveBeenCalledOnce();
    panel.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('expires after durationMs; stop() disarms early', () => {
    const onClick = vi.fn();
    panel.addEventListener('click', onClick);
    guardGhostClick([panel], { durationMs: 100 });
    vi.advanceTimersByTime(100);
    panel.click();
    expect(onClick).toHaveBeenCalledOnce();
    const stop = guardGhostClick([panel]);
    stop();
    stop();
    panel.click();
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('blurs the trailing focus while armed', () => {
    const input = document.createElement('input');
    document.body.append(input);
    guardGhostClick([panel], { trailingFocus: input });
    input.focus();
    expect(document.activeElement).not.toBe(input);
    vi.advanceTimersByTime(700);
    input.focus();
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});

describe('startModalSession isOpenedByPointer', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('the ghost click on the backdrop does not dismiss; a later one does', () => {
    const panel = document.createElement('div');
    panel.innerHTML = '<button>ok</button>';
    document.body.append(panel);
    const onDismiss = vi.fn();
    const session = startModalSession(panel, { backdrop: true, onDismiss, isOpenedByPointer: true });
    session.backdrop!.click();
    expect(onDismiss).not.toHaveBeenCalled();
    session.backdrop!.click();
    expect(onDismiss).toHaveBeenCalledWith('backdrop');
    session.end();
    panel.remove();
  });

  it('without it the first backdrop click dismisses', () => {
    const panel = document.createElement('div');
    document.body.append(panel);
    const onDismiss = vi.fn();
    const session = startModalSession(panel, { backdrop: true, onDismiss });
    session.backdrop!.click();
    expect(onDismiss).toHaveBeenCalledWith('backdrop');
    session.end();
    panel.remove();
  });
});
