import { afterEach, describe, expect, it, vi } from 'vitest';

// createTooltip({ shouldHideOnScroll }) — G9b (SPEC §12.2): the watchScrollClose rule while shown.
vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() =>
    Promise.resolve({ x: 10, y: 20, placement: 'top', strategy: 'fixed', middlewareData: {} }),
  ),
  autoUpdate: vi.fn((_ref: unknown, _float: unknown, update: () => void) => {
    update();
    return vi.fn();
  }),
  offset: vi.fn((value: unknown) => ({ name: 'offset', value })),
  flip: vi.fn((options: unknown) => ({ name: 'flip', options })),
  shift: vi.fn((options: unknown) => ({ name: 'shift', options })),
  size: vi.fn((options: unknown) => ({ name: 'size', options })),
  arrow: vi.fn((options: unknown) => ({ name: 'arrow', options })),
  platform: {},
}));

import { createTooltip } from './index.js';

afterEach(() => document.body.replaceChildren());

/** jsdom has no layout: a real scroll moves the target, so tests move it themselves. */
const moveBy = (el: Element, dy: number): void => {
  const top = el.getBoundingClientRect().top + dy;
  el.getBoundingClientRect = () => ({ top, left: 0, right: 0, bottom: top, width: 0, height: 0, x: 0, y: top, toJSON() {} }) as DOMRect;
};
const scroll = (target: EventTarget): void => {
  target.dispatchEvent(new Event('scroll'));
};

function setup(shouldHideOnScroll?: boolean) {
  const scroller = document.createElement('div');
  const trigger = document.createElement('button');
  const other = document.createElement('div'); // an unrelated scroller (a log panel)
  scroller.append(trigger);
  document.body.append(scroller, other);
  const tip = createTooltip({ trigger, content: 'hi', ...(shouldHideOnScroll === undefined ? {} : { shouldHideOnScroll }) });
  return { scroller, trigger, other, tip };
}

describe('createTooltip — shouldHideOnScroll', () => {
  it('default: a scroll of the container around the target hides a hover-shown tooltip', () => {
    const { scroller, trigger, tip } = setup();
    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tip.isVisible).toBe(true);
    moveBy(trigger, -40);
    scroll(scroller);
    expect(tip.isVisible).toBe(false);
    tip.destroy();
  });

  it('a page scroll hides it; one that did not move the target (a late event) does not', () => {
    const { trigger, tip } = setup();
    tip.show();
    scroll(document);
    expect(tip.isVisible).toBe(true);
    moveBy(trigger, 10);
    scroll(document);
    expect(tip.isVisible).toBe(false);
    tip.destroy();
  });

  it('a scroll inside the tooltip itself, or of an unrelated scroller, keeps it', () => {
    const { trigger, other, tip } = setup();
    const body = document.createElement('div');
    tip.show();
    tip.element.append(body);
    moveBy(trigger, -40);
    scroll(body);
    scroll(tip.element);
    scroll(other);
    expect(tip.isVisible).toBe(true);
    tip.destroy();
  });

  it('false: scrolling keeps it', () => {
    const { scroller, trigger, tip } = setup(false);
    tip.show();
    moveBy(trigger, -40);
    scroll(scroller);
    scroll(document);
    expect(tip.isVisible).toBe(true);
    tip.destroy();
  });

  it('a FOCUS-shown tooltip stays through a scroll (it follows its focused target, WCAG 1.4.13)', () => {
    const { scroller, trigger, tip } = setup();
    trigger.focus();
    expect(tip.isFocusShown).toBe(true);
    moveBy(trigger, -40);
    scroll(scroller);
    expect(tip.isVisible).toBe(true);
    tip.destroy();
  });

  it('stops watching on hide: a later show measures from where the target is then', () => {
    const { scroller, trigger, tip } = setup();
    tip.show();
    tip.hide();
    moveBy(trigger, -40); // scrolled while hidden
    tip.show();
    scroll(scroller); // a late event of that scroll: the target hasn't moved since the show
    expect(tip.isVisible).toBe(true);
    moveBy(trigger, -40);
    scroll(scroller);
    expect(tip.isVisible).toBe(false);
    tip.destroy();
  });

  it('delegated: switching targets re-baselines on the new target', () => {
    const root = document.createElement('div');
    const a = document.createElement('div');
    const b = document.createElement('div');
    a.className = b.className = 'cell';
    root.append(a, b);
    document.body.append(root);
    const tip = createTooltip({ trigger: root, selector: '.cell', content: 'x' });
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    moveBy(b, -40); // b sits elsewhere already; switching to it is not a scroll
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tip.target).toBe(b);
    scroll(root);
    expect(tip.isVisible).toBe(true);
    moveBy(b, -40);
    scroll(root);
    expect(tip.isVisible).toBe(false);
    tip.destroy();
  });
});
