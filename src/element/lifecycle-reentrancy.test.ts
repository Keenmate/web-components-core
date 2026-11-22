import { afterEach, describe, expect, it } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toBool } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

/**
 * A DOM write to an OBSERVED attribute inside `disconnect()` during a move makes the browser run
 * the already-queued `connectedCallback` right there (CEReactions) — `connect()` nested inside
 * `disconnect()`. Core defers it until the disconnect path finished.
 */
class ReentrantElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'isOpen', attribute: 'open', converter: toBool('default-false'), shouldReflect: true, on: 'update' },
  ];
  readonly events: string[] = [];
  isListening = false;
  protected override reinit(): void {
    this.events.push('reinit');
  }
  protected override update(partial: Record<string, unknown>): void {
    this.events.push(`update:${Object.keys(partial).join(',')}`);
  }
  protected override connect(): void {
    this.events.push('connect');
    this.isListening = true;
  }
  protected override disconnect(): void {
    this.events.push('disconnect:start');
    this.removeAttribute('open'); // observed attribute written mid-disconnect (cp's close())
    this.isListening = false;
    this.events.push('disconnect:end');
  }
  protected override removedCallback(): void {
    this.events.push('removed');
  }
}
define('reentrant-element', ReentrantElement as unknown as CustomElementConstructor);

/** connect() writes an observed attribute while a removal is queued behind it. */
class ReentrantConnectElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'isOpen', attribute: 'open', converter: toBool('default-false'), shouldReflect: true, on: 'update' },
  ];
  readonly events: string[] = [];
  isListening = false;
  protected override connect(): void {
    this.events.push('connect:start');
    this.setAttribute('open', 'true');
    this.isListening = true;
    this.events.push('connect:end');
  }
  protected override disconnect(): void {
    this.events.push('disconnect');
    this.isListening = false;
  }
}
define('reentrant-connect-element', ReentrantConnectElement as unknown as CustomElementConstructor);

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 20);
  });

describe('lifecycle re-entrancy', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('a move whose disconnect() writes an observed attribute runs connect() once, AFTER disconnect()', async () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    const el = document.createElement('reentrant-element') as ReentrantElement;
    el.setAttribute('open', '');
    a.appendChild(el);
    await el.whenSettled();
    el.events.length = 0;
    b.appendChild(el); // a DOM move
    expect(el.events).toEqual(['disconnect:start', 'disconnect:end', 'update:isOpen', 'connect']);
    expect(el.isListening).toBe(true);
    expect(el.hasAttribute('open')).toBe(false);
    await nextFrame();
    expect(el.events).not.toContain('removed'); // still a move, not a removal
    expect(el.events.filter((e) => e === 'reinit')).toEqual([]); // moved without a rebuild
  });

  it('a removal (not a move) stays detached and inactive', async () => {
    const el = document.createElement('reentrant-element') as ReentrantElement;
    el.setAttribute('open', '');
    document.body.appendChild(el);
    el.events.length = 0;
    el.remove();
    expect(el.events).toEqual(['disconnect:start', 'disconnect:end']);
    expect(el.isListening).toBe(false);
    await nextFrame();
    expect(el.events).toContain('removed');
  });

  it('connect() writing an observed attribute while a removal is queued: disconnect() runs after connect()', () => {
    const el = document.createElement('reentrant-connect-element') as ReentrantConnectElement;
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Insert + remove inside one CEReactions scope: connectedCallback and disconnectedCallback
    // are both queued; connect()'s attribute write flushes the queue from inside connect().
    class Mover extends HTMLElement {
      connectedCallback(): void {
        this.appendChild(el);
      }
    }
    customElements.define('reentrant-mover', Mover);
    const mover = document.createElement('reentrant-mover');
    const frag = document.createDocumentFragment();
    frag.appendChild(mover);
    host.appendChild(frag);
    el.events.length = 0;
    host.replaceChildren(); // detach mover (and el)
    host.appendChild(mover); // mover re-appends el — plain reconnect
    // Without the guard: disconnect, connect:start, disconnect, connect:start, connect:end, connect:end.
    expect(el.events).toEqual(['disconnect', 'connect:start', 'connect:end', 'disconnect', 'connect:start', 'connect:end']);
    expect(el.isConnected).toBe(true);
    expect(el.isListening).toBe(true);
  });
});
