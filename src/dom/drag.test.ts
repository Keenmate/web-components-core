import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDropActiveState, observePageDrag } from './page-drag.js';
import { createPointerDrag } from './pointer-drag.js';

/** jsdom has no DragEvent / PointerEvent: plain events with the fields the code reads. */
const drag = (type: string, types: string[]): Event =>
  Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: { types } });
const pointer = (type: string, init: Record<string, unknown>): Event =>
  Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse', clientX: 0, clientY: 0, ...init });

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('observePageDrag', () => {
  it('arms only for matching types; enter / leave depth; drop ends; unsubscribe', () => {
    const files = vi.fn();
    const nodes = vi.fn();
    const stopFiles = observePageDrag({ onChange: files });
    const stopNodes = observePageDrag({ types: ['application/x-node'], onChange: nodes });
    window.dispatchEvent(drag('dragenter', ['text/plain']));
    expect(files).not.toHaveBeenCalled();
    window.dispatchEvent(drag('dragenter', ['Files']));
    window.dispatchEvent(drag('dragenter', ['Files'])); // a child element
    expect(files).toHaveBeenLastCalledWith(true);
    expect(nodes).not.toHaveBeenCalled();
    window.dispatchEvent(drag('dragleave', ['Files']));
    expect(files).toHaveBeenCalledTimes(1);
    window.dispatchEvent(drag('dragleave', ['Files'])); // left the window
    expect(files).toHaveBeenLastCalledWith(false);
    window.dispatchEvent(drag('dragover', ['application/x-node'])); // started before we listened
    expect(nodes).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new Event('drop'));
    expect(nodes).toHaveBeenLastCalledWith(false);
    stopFiles();
    stopNodes();
    window.dispatchEvent(drag('dragenter', ['Files']));
    expect(files).toHaveBeenCalledTimes(2);
  });

  it('the dragover heartbeat stopping ends it (Escape on an external drag)', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stop = observePageDrag({ onChange });
    window.dispatchEvent(drag('dragenter', ['Files']));
    vi.advanceTimersByTime(600);
    expect(onChange).toHaveBeenLastCalledWith(false);
    stop();
  });

  it('after Escape the same drag’s dragovers don’t re-arm; a new dragenter or a pause in them does', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stop = observePageDrag({ onChange });
    window.dispatchEvent(drag('dragenter', ['Files']));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(100);
      window.dispatchEvent(drag('dragover', ['Files'])); // the same drag keeps pulsing
    }
    expect(onChange).toHaveBeenCalledTimes(2); // armed, disarmed — not re-armed
    vi.advanceTimersByTime(500); // the pulses paused: a later dragover is a new drag
    window.dispatchEvent(drag('dragover', ['Files']));
    expect(onChange).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.dispatchEvent(drag('dragenter', ['Files'])); // a new dragenter re-arms at once
    expect(onChange).toHaveBeenLastCalledWith(true);
    stop();
  });

  it('setDropActiveState toggles the attribute', () => {
    const host = document.createElement('div');
    setDropActiveState(host, null, true);
    expect(host.hasAttribute('drop-active')).toBe(true);
    setDropActiveState(host, null, false);
    expect(host.hasAttribute('drop-active')).toBe(false);
  });
});

describe('createPointerDrag', () => {
  const setup = (opts: Record<string, unknown> = {}) => {
    document.body.innerHTML = '<ul id="c"><li id="a">a</li><li id="b">b</li></ul>';
    const container = document.getElementById('c')!;
    const calls: string[] = [];
    const drag = createPointerDrag(container, {
      getSource: (t) => t.closest('li'),
      autoScroll: false,
      onStart: (ctx) => void calls.push(`start:${ctx.source.id}`),
      onMove: () => void calls.push('move'),
      onDrop: (ctx) => void calls.push(`drop:${ctx.x},${ctx.y}`),
      onCancel: () => void calls.push('cancel'),
      ...opts,
    });
    return { container, drag, calls, a: document.getElementById('a')! };
  };

  it('mouse: starts after the threshold, moves, drops; a small move is a click', () => {
    const { a, drag, calls } = setup();
    a.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 12, clientY: 11 }));
    expect(drag.isDragging).toBe(false);
    window.dispatchEvent(pointer('pointerup', { clientX: 12, clientY: 11 }));
    expect(calls).toEqual([]);
    a.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 30, clientY: 10 }));
    expect(drag.isDragging).toBe(true);
    window.dispatchEvent(pointer('pointermove', { clientX: 40, clientY: 10 }));
    window.dispatchEvent(pointer('pointerup', { clientX: 50, clientY: 20 }));
    expect(calls).toEqual(['start:a', 'move', 'move', 'drop:50,20']);
    expect(drag.isDragging).toBe(false);
  });

  it('touch: moving before the long press is a scroll; holding starts the drag', () => {
    vi.useFakeTimers();
    const { a, drag, calls } = setup({ longPressMs: 300 });
    a.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    window.dispatchEvent(pointer('pointermove', { pointerType: 'touch', clientY: 20 }));
    vi.advanceTimersByTime(400);
    expect(calls).toEqual([]);
    a.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    vi.advanceTimersByTime(300);
    expect(drag.isDragging).toBe(true);
    const touchmove = new Event('touchmove', { bubbles: true, cancelable: true });
    a.dispatchEvent(touchmove);
    expect(touchmove.defaultPrevented).toBe(true); // the page doesn't scroll under the finger
  });

  it('touch with longPressMs: 0 — armed at once (no scroll), starts past the threshold like a mouse, no timer race', () => {
    const { a, drag, calls } = setup({ longPressMs: 0 });
    a.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 }));
    const touchmove = new Event('touchmove', { bubbles: true, cancelable: true });
    a.dispatchEvent(touchmove);
    expect(touchmove.defaultPrevented).toBe(true);
    window.dispatchEvent(pointer('pointermove', { pointerType: 'touch', clientX: 10, clientY: 30 })); // the first move, same task
    expect(drag.isDragging).toBe(true);
    window.dispatchEvent(pointer('pointerup', { pointerType: 'touch', clientX: 10, clientY: 40 }));
    expect(calls).toEqual(['start:a', 'move', 'drop:10,40']);
  });

  it('longPressMs / threshold may be functions, read per press (a component input that changes between drags)', () => {
    vi.useFakeTimers();
    let delay = 300;
    const { a, drag } = setup({ longPressMs: () => delay });
    a.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    vi.advanceTimersByTime(300);
    expect(drag.isDragging).toBe(true);
    window.dispatchEvent(pointer('pointerup', { pointerType: 'touch' }));
    delay = 800;
    a.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    vi.advanceTimersByTime(400);
    expect(drag.isDragging).toBe(false); // the new delay applies to this press
    vi.advanceTimersByTime(400);
    expect(drag.isDragging).toBe(true);
  });

  it('Escape / pointercancel cancel; onStart false refuses; right button ignored; destroy', () => {
    const { a, drag, calls } = setup();
    a.dispatchEvent(pointer('pointerdown', { button: 2 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 50 }));
    expect(drag.isDragging).toBe(false);
    window.dispatchEvent(pointer('pointerup', {}));
    a.dispatchEvent(pointer('pointerdown', {}));
    window.dispatchEvent(pointer('pointermove', { clientX: 50 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(calls.at(-1)).toBe('cancel');
    expect(drag.isDragging).toBe(false);
    a.dispatchEvent(pointer('pointerdown', {}));
    window.dispatchEvent(pointer('pointermove', { clientX: 50 }));
    window.dispatchEvent(pointer('pointercancel', {}));
    expect(calls.at(-1)).toBe('cancel');
    drag.destroy();
    a.dispatchEvent(pointer('pointerdown', {}));
    window.dispatchEvent(pointer('pointermove', { clientX: 50 }));
    expect(drag.isDragging).toBe(false);

    const refused = setup({ onStart: () => false });
    refused.a.dispatchEvent(pointer('pointerdown', {}));
    window.dispatchEvent(pointer('pointermove', { clientX: 50 }));
    expect(refused.drag.isDragging).toBe(false);
  });
});
