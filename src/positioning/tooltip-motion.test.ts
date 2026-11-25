import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// createTooltip's exit fade + data-placement (SPEC §12.2). jsdom has no transitions and doesn't
// resolve var(): a test gives the tooltip an inline `transition-duration` to stand in for the
// motion token. Real token resolution (data-motion="none" → 0s, the fade frames) is e2e
// (e2e/tooltip.spec.ts).
vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() =>
    Promise.resolve({ x: 10, y: 20, placement: 'bottom', strategy: 'fixed', middlewareData: {} }),
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

import * as fui from '@floating-ui/dom';
import { createTooltip, TOOLTIP_CLASS, TOOLTIP_CSS, TOOLTIP_HIDING_CLASS } from './index.js';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

function setup(duration = '0.2s'): { trigger: HTMLButtonElement; tip: ReturnType<typeof createTooltip> } {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  const tip = createTooltip({ trigger, content: 'hi', cssClass: 'tt' });
  tip.element.style.transitionDuration = duration; // stands in for var(--base-duration-fast)
  return { trigger, tip };
}

const transitionEnd = (target: Element, propertyName: string): void => {
  target.dispatchEvent(Object.assign(new Event('transitionend', { bubbles: true }), { propertyName }));
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('createTooltip — data-placement', () => {
  it('carries the requested placement at show, then the RESOLVED one (after flip / shift)', async () => {
    const { tip } = setup();
    tip.show();
    expect(tip.element.classList.contains(TOOLTIP_CLASS)).toBe(true);
    expect(tip.element.classList.contains('tt')).toBe(true);
    expect(tip.element.getAttribute('data-placement')).toBe('top'); // requested, until the first placement
    await flush();
    expect(tip.element.getAttribute('data-placement')).toBe('bottom'); // floating-ui flipped it
    tip.destroy();
  });

  it('is updated on every reposition', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const tip = createTooltip({ trigger, content: () => 'hi' });
    tip.show();
    await flush();
    expect(tip.element.getAttribute('data-placement')).toBe('bottom');
    vi.mocked(fui.computePosition).mockResolvedValueOnce({
      x: 0, y: 0, placement: 'right-start', strategy: 'fixed', middlewareData: {},
    } as never);
    tip.refresh(); // handle.update()
    await flush();
    expect(tip.element.getAttribute('data-placement')).toBe('right-start');
    tip.destroy();
  });
});

describe('createTooltip — exit fade', () => {
  it('stays mounted, hit-testing off, until the fallback timeout of the transition duration', () => {
    vi.useFakeTimers();
    const { trigger, tip } = setup('0.2s');
    tip.show();
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.element.id);
    tip.hide();
    expect(tip.isVisible).toBe(false);
    expect(tip.target).toBe(null);
    expect(tip.element.isConnected).toBe(true);
    expect(tip.element.classList.contains('is-visible')).toBe(false);
    expect(tip.element.classList.contains(TOOLTIP_HIDING_CLASS)).toBe(true);
    expect(tip.element.style.pointerEvents).toBe('none');
    expect(trigger.hasAttribute('aria-describedby')).toBe(false); // no longer describes it
    vi.advanceTimersByTime(199);
    expect(tip.element.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tip.element.isConnected).toBe(false);
    expect(tip.element.classList.contains(TOOLTIP_HIDING_CLASS)).toBe(false);
    expect(tip.element.style.pointerEvents).toBe('');
    expect(tip.element.hasAttribute('data-placement')).toBe(false);
    tip.destroy();
  });

  it('the fallback counts transition-delay too', () => {
    vi.useFakeTimers();
    const { tip } = setup('100ms');
    tip.element.style.transitionDelay = '50ms';
    tip.show();
    tip.hide();
    vi.advanceTimersByTime(149);
    expect(tip.element.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tip.element.isConnected).toBe(false);
  });

  it("the tooltip's own opacity transitionend ends it early; another property / a child's does not", () => {
    vi.useFakeTimers();
    const { tip } = setup('5s');
    const child = document.createElement('span');
    tip.element.append(child);
    tip.show();
    tip.hide();
    transitionEnd(tip.element, 'translate');
    transitionEnd(child, 'opacity'); // bubbles up, but not the tooltip's own
    expect(tip.element.isConnected).toBe(true);
    transitionEnd(tip.element, 'opacity');
    expect(tip.element.isConnected).toBe(false);
    vi.advanceTimersByTime(5000); // the fallback was cleared — nothing left to fire
    expect(tip.element.isConnected).toBe(false);
  });

  it('showing again during the fade cancels it: same element, same anchor, no remount', () => {
    vi.useFakeTimers();
    const { trigger, tip } = setup('0.2s');
    tip.show();
    const parent = tip.element.parentNode;
    const anchors = vi.mocked(fui.autoUpdate).mock.calls.length;
    tip.hide();
    vi.advanceTimersByTime(100);
    tip.show();
    expect(tip.isVisible).toBe(true);
    expect(tip.element.parentNode).toBe(parent);
    expect(tip.element.classList.contains('is-visible')).toBe(true);
    expect(tip.element.classList.contains(TOOLTIP_HIDING_CLASS)).toBe(false);
    expect(tip.element.style.pointerEvents).toBe('');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.element.id);
    expect(vi.mocked(fui.autoUpdate).mock.calls.length).toBe(anchors); // kept anchored, not rebuilt
    vi.advanceTimersByTime(1000);
    expect(tip.element.isConnected).toBe(true); // the cancelled fallback never fires
    tip.element.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'opacity' }));
    expect(tip.element.isConnected).toBe(true); // nor the transitionend listener
    tip.destroy();
  });

  it('delegated: hovering another target during the fade re-anchors to it at once (no show delay)', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    root.innerHTML = '<span class="cell" data-tip="A">a</span><span class="cell" data-tip="B">b</span><span class="x">x</span>';
    document.body.append(root);
    const [a, b, x] = [...root.querySelectorAll<HTMLElement>('span')];
    const tip = createTooltip({ trigger: root, selector: '.cell', content: (t) => t.dataset.tip, delay: { show: 300 } });
    tip.element.style.transitionDuration = '0.2s';
    a!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(tip.target).toBe(a);
    x!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); // off the targets → fade starts
    expect(tip.element.classList.contains(TOOLTIP_HIDING_CLASS)).toBe(true);
    const anchors = vi.mocked(fui.autoUpdate).mock.calls.length;
    b!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tip.target).toBe(b); // still on screen: switches without the show delay
    expect(tip.element.textContent).toBe('B');
    expect(vi.mocked(fui.autoUpdate).mock.calls.length).toBe(anchors + 1); // re-anchored to b
    expect(b!.getAttribute('aria-describedby')).toBe(tip.element.id);
    expect(a!.hasAttribute('aria-describedby')).toBe(false);
    tip.destroy();
  });

  it('no transition (0s — motion none / reduced motion resolve the token to 0s) → removed at once', () => {
    const scope = document.createElement('section');
    scope.setAttribute('data-motion', 'none');
    const trigger = document.createElement('button');
    scope.append(trigger);
    document.body.append(scope);
    const tip = createTooltip({ trigger, content: 'hi' });
    tip.element.style.transitionDuration = '0s';
    tip.show();
    expect(tip.element.getAttribute('data-motion')).toBe('none'); // the level follows it to the body
    tip.hide();
    expect(tip.element.isConnected).toBe(false);
    expect(tip.element.classList.contains(TOOLTIP_HIDING_CLASS)).toBe(false);
  });

  it('destroy() during the fade removes it at once', () => {
    vi.useFakeTimers();
    const { tip } = setup('0.2s');
    tip.show();
    tip.hide();
    tip.destroy();
    expect(tip.element.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a target removed from the page hides at once (nothing to fade toward)', () => {
    const { trigger, tip } = setup('0.2s');
    tip.show();
    trigger.remove();
    tip.hide();
    expect(tip.element.isConnected).toBe(false);
  });

  it('TOOLTIP_CSS: layered, zero-specificity, timed only by the motion token', () => {
    expect(TOOLTIP_CSS).toContain('@layer component');
    expect(TOOLTIP_CSS).toContain(`:where(.${TOOLTIP_HIDING_CLASS})`);
    expect(TOOLTIP_CSS).toContain('@starting-style');
    const durations = TOOLTIP_CSS.match(/\d*\.?\d+m?s\b/g) ?? [];
    expect(durations.every((d) => d === '0.1s')).toBe(true); // only the var() fallback
    expect(TOOLTIP_CSS).toMatch(/opacity var\(--base-duration-fast/);
  });
});

describe('TOOLTIP_CSS contract fallbacks (713cb52)', () => {
  it('the easing falls back to the contract --base-ease-standard', () => {
    expect(TOOLTIP_CSS).toContain('var(--base-ease-standard, cubic-bezier(0.4, 0, 0.2, 1))');
    expect(TOOLTIP_CSS).not.toMatch(/ease-standard, ease\)/); // the pre-contract fallback
  });
});
