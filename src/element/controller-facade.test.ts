import { describe, expect, it } from 'vitest';
import { createControllerFacade } from './controller-facade.js';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';

class Engine {
  items = ['a'];
  anchor: string | null = null;
  secret = 'internal';
  add(x: string): number {
    return this.items.push(x);
  }
  find(x: string): string | null {
    return this.items.includes(x) ? x : null;
  }
}

describe('createControllerFacade', () => {
  it('forwards methods to the CURRENT target, with empty answers before it exists', () => {
    let engine: Engine | null = null;
    const c = createControllerFacade<{ add(x: string): number; find(x: string): string | null; items: string[]; anchor: string | null }>(() => engine, {
      methods: ['add', 'find'],
      state: { items: () => [] },
      writable: ['anchor'],
      emptyResults: { find: () => null },
    });
    expect(c.find('a')).toBeNull();
    expect(c.items).toEqual([]);
    expect(c.anchor).toBeNull();
    c.anchor = 'x'; // no target: ignored
    engine = new Engine();
    expect(c.add('b')).toBe(2);
    expect(c.find('b')).toBe('b');
    expect(c.items).toEqual(['a', 'b']);
    c.anchor = 'b';
    expect(engine.anchor).toBe('b');
    engine = new Engine(); // rebuilt: picked up
    expect(c.items).toEqual(['a']);
  });

  it('frozen, internal members not exposed; the array form is methods only', () => {
    const engine = new Engine();
    const c = createControllerFacade<Record<string, unknown>>(engine, ['add']);
    expect(Object.isFrozen(c)).toBe(true);
    expect('secret' in c).toBe(false);
    expect(Object.keys(c)).toEqual(['add']);
    expect(() => {
      'use strict';
      (c as Record<string, unknown>).add = null;
    }).toThrow();
  });

  it('as a BlissElement controller (also on event details)', () => {
    class FacadeEl extends BlissElement<{ ping: { n: number } }, { ping(): string }> {
      static inputs = [];
      protected override createController() {
        return createControllerFacade<{ ping(): string }>(this, ['ping']);
      }
      ping(): string {
        return 'pong';
      }
    }
    define('facade-el', FacadeEl);
    const el = document.createElement('facade-el') as FacadeEl;
    expect(el.controller.ping()).toBe('pong');
    expect(el.controller).toBe(el.controller);
  });
});
