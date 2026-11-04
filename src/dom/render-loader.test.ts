import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishLoaderHook, renderLoader, type RenderLoaderCallback } from './render-loader.js';

let host: HTMLElement;
let box: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  box = document.createElement('div');
  host.appendChild(box);
  document.body.appendChild(host);
});

afterEach(() => {
  if (window.components) window.components.renderLoadingCallback = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('renderLoader — default', () => {
  it('draws <span class="<prefix>__loader"> and sets role=status + aria-label', () => {
    renderLoader(host, box, 'overlay', { prefix: 'wtv', label: 'Loading…' });
    const span = box.querySelector('span')!;
    expect(span.className).toBe('wtv__loader');
    expect(span.getAttribute('aria-hidden')).toBe('true');
    expect(box.getAttribute('role')).toBe('status');
    expect(box.getAttribute('aria-label')).toBe('Loading…');
  });

  it('an empty label sets no aria-label', () => {
    renderLoader(host, box, 'overlay', { prefix: 'x', label: '' });
    expect(box.hasAttribute('aria-label')).toBe(false);
    expect(box.getAttribute('role')).toBe('status');
  });

  it('remove() drops only what it added and restores role / aria-label; idempotent', () => {
    const keep = document.createElement('i');
    box.appendChild(keep);
    box.setAttribute('role', 'presentation');
    const remove = renderLoader(host, box, 'row', { prefix: 'x', label: 'L' });
    expect(box.childNodes.length).toBe(2);
    remove();
    remove();
    expect(Array.from(box.childNodes)).toEqual([keep]);
    expect(box.getAttribute('role')).toBe('presentation');
    expect(box.hasAttribute('aria-label')).toBe(false);
  });

  // Review D-01: remove() used to diff the container when it ran, deleting anything added since.
  it('remove() keeps nodes the component appended after the loader was drawn', () => {
    const remove = renderLoader(host, box, 'rows', { prefix: 'x', label: '' });
    const row = document.createElement('div');
    box.appendChild(row); // the data arrived; the component renders its rows, then drops the loader
    remove();
    expect(Array.from(box.childNodes)).toEqual([row]);
  });

  it('two overlapping loaders each remove only their own node', () => {
    const removeA = renderLoader(host, box, 'a', { prefix: 'a', label: '' });
    const removeB = renderLoader(host, box, 'b', { prefix: 'b', label: '' });
    removeA();
    expect(box.querySelector('.b__loader')).not.toBeNull();
    expect(box.querySelector('.a__loader')).toBeNull();
    removeB();
    expect(box.childNodes.length).toBe(0);
  });
});

describe('renderLoader — precedence', () => {
  it('instance hook (explicit option) wins over the page hook', () => {
    const page = vi.fn();
    window.components = window.components ?? {};
    publishLoaderHook();
    window.components.renderLoadingCallback = page;
    const inst = vi.fn<RenderLoaderCallback>(({ containerElement }) => {
      containerElement.append('inst');
    });
    renderLoader(host, box, 'search', { prefix: 'x', label: 'Searching', renderLoadingCallback: inst });
    expect(page).not.toHaveBeenCalled();
    expect(inst).toHaveBeenCalledWith({ component: 'div', context: 'search', containerElement: box, element: host, label: 'Searching' });
    expect(box.textContent).toBe('inst');
    expect(box.querySelector('.x__loader')).toBeNull();
    expect(box.getAttribute('role')).toBe('status');
  });

  it('reads host.renderLoadingCallback when the option is omitted', () => {
    const inst = vi.fn();
    (host as unknown as { renderLoadingCallback: unknown }).renderLoadingCallback = inst;
    renderLoader(host, box, 'overlay', { prefix: 'x', label: 'L' });
    expect(inst).toHaveBeenCalledOnce();
  });

  it('an explicit null option ignores the host property', () => {
    (host as unknown as { renderLoadingCallback: unknown }).renderLoadingCallback = vi.fn();
    renderLoader(host, box, 'overlay', { prefix: 'x', label: 'L', renderLoadingCallback: null });
    expect(box.querySelector('.x__loader')).not.toBeNull();
  });

  it('page hook draws when there is no instance hook; its cleanup + nodes go on remove()', () => {
    const cleanup = vi.fn();
    publishLoaderHook();
    window.components!.renderLoadingCallback = ({ containerElement, component, context }) => {
      containerElement.append(`${component}:${context}`);
      return cleanup;
    };
    const remove = renderLoader(host, box, 'upload', { prefix: 'x', label: 'L' });
    expect(box.textContent).toBe('div:upload');
    remove();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(box.childNodes.length).toBe(0);
  });

  it('a throwing hook is logged and the default loader is drawn (partial nodes dropped)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderLoader(host, box, 'overlay', {
      prefix: 'x',
      label: 'L',
      renderLoadingCallback: ({ containerElement }) => {
        containerElement.append('partial');
        throw new Error('boom');
      },
    });
    expect(err).toHaveBeenCalled();
    expect(box.textContent).toBe('');
    expect(box.querySelector('.x__loader')).not.toBeNull();
  });
});

describe('window.components.renderLoadingCallback', () => {
  it('is non-enumerable and adopts a value assigned earlier as a plain property', () => {
    const fn = vi.fn();
    const components = (window.components ??= {}) as Record<string, unknown>;
    delete components.renderLoadingCallback;
    components.renderLoadingCallback = fn; // page set it before any component loaded
    publishLoaderHook();
    expect(Object.keys(window.components!)).not.toContain('renderLoadingCallback');
    expect(window.components!.renderLoadingCallback).toBe(fn);
    renderLoader(host, box, 'overlay', { prefix: 'x', label: 'L' });
    expect(fn).toHaveBeenCalledOnce();
  });

  it('a non-function value is treated as unset', () => {
    publishLoaderHook();
    (window.components as Record<string, unknown>).renderLoadingCallback = 'nope';
    expect(window.components!.renderLoadingCallback).toBeUndefined();
    renderLoader(host, box, 'overlay', { prefix: 'x', label: 'L' });
    expect(box.querySelector('.x__loader')).not.toBeNull();
  });
});
