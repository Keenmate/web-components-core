import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { observeKeyboardInset } from './keyboard-inset.js';

/**
 * jsdom implements neither `window.visualViewport` nor a real rAF loop, so we
 * stub both: a minimal EventTarget-backed viewport we can drive by hand, and a
 * synchronous requestAnimationFrame so a scheduled write applies immediately.
 */
class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;
  resizeTo(height: number, offsetTop = 0): void {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event('resize'));
  }
}

describe('observeKeyboardInset', () => {
  let vp: FakeViewport;

  beforeEach(() => {
    vp = new FakeViewport();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    // jsdom's window.visualViewport is undefined; define it for the test.
    Object.defineProperty(window, 'visualViewport', { value: vp, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  });

  it('pins the panel to the visual viewport height + offset on attach', () => {
    const panel = document.createElement('div');
    observeKeyboardInset(panel);
    expect(panel.style.height).toBe('800px');
    expect(panel.style.top).toBe('0px');
  });

  it('shrinks the panel as the keyboard opens (viewport resize)', () => {
    const panel = document.createElement('div');
    observeKeyboardInset(panel);
    vp.resizeTo(500, 40); // keyboard opens: shorter viewport, scrolled down
    expect(panel.style.height).toBe('500px');
    expect(panel.style.top).toBe('40px');
  });

  // Review V-14 ---------------------------------------------------------------
  it('leaves the panel alone while pinch-zoomed, and follows again at scale 1', () => {
    const panel = document.createElement('div');
    observeKeyboardInset(panel);
    vp.scale = 2;
    vp.resizeTo(400, 120); // zoomed in: the visual viewport is small, not because of a keyboard
    expect(panel.style.height).toBe('800px');
    vp.scale = 1;
    vp.resizeTo(500, 40);
    expect(panel.style.height).toBe('500px');
  });

  it("cleanup puts back the panel's own inline height / top", () => {
    const panel = document.createElement('div');
    panel.style.height = '90vh';
    panel.style.top = '5vh';
    const cleanup = observeKeyboardInset(panel);
    expect(panel.style.height).toBe('800px');
    cleanup();
    expect(panel.style.height).toBe('90vh');
    expect(panel.style.top).toBe('5vh');
  });

  it("tracks the panel's own window (a panel inside an iframe)", () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const frameView = iframe.contentWindow!;
    const frameVp = new FakeViewport();
    frameVp.height = 300;
    Object.defineProperty(frameView, 'visualViewport', { value: frameVp, configurable: true });
    Object.defineProperty(frameView, 'requestAnimationFrame', { value: window.requestAnimationFrame, configurable: true });
    const panel = iframe.contentDocument!.createElement('div');
    observeKeyboardInset(panel);
    expect(panel.style.height).toBe('300px'); // the iframe's viewport, not the top window's 800
    iframe.remove();
  });

  it('cleanup detaches listeners and clears the inline geometry', () => {
    const panel = document.createElement('div');
    const cleanup = observeKeyboardInset(panel);
    cleanup();
    expect(panel.style.height).toBe('');
    expect(panel.style.top).toBe('');
    vp.resizeTo(300); // must be ignored after cleanup
    expect(panel.style.height).toBe('');
  });

  it('cleanup cancels a frame queued before it (fast open → close)', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames[id - 1] = () => {};
    });
    const panel = document.createElement('div');
    const cleanup = observeKeyboardInset(panel); // queues the first write
    cleanup();
    frames.forEach((cb) => cb(0));
    expect(panel.style.height).toBe('');
    expect(panel.style.top).toBe('');
  });

  it('is a no-op returning a no-op cleanup when visualViewport is unavailable', () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    const panel = document.createElement('div');
    const cleanup = observeKeyboardInset(panel);
    expect(panel.style.height).toBe('');
    expect(() => cleanup()).not.toThrow();
  });
});
