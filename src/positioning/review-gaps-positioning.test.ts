import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Review 2026-11-03 D-29: the uncovered anchor / containing-block / tooltip / popover scenarios.
// floating-ui is mocked exactly like positioning.test.ts (jsdom has no layout).
vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() =>
    Promise.resolve({ x: 10, y: 20, placement: 'bottom-start', strategy: 'fixed', middlewareData: {} }),
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
  platform: { __base: true },
}));

import * as fui from '@floating-ui/dom';
import { anchor, createPopover, createTooltip, getFixedPositionOffsetParent, detectFixedDrift } from './index.js';

type Css = Partial<CSSStyleDeclaration> & Record<string, string>;

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
const computeCalls = () => vi.mocked(fui.computePosition).mock.calls;
const middlewareNames = (call = 0) => ((computeCalls()[call]![2]!.middleware ?? []) as { name: string }[]).map((m) => m.name);

function resolveWith(result: { x?: number; y?: number; placement: string; middlewareData?: object }): void {
  vi.mocked(fui.computePosition).mockImplementation(
    () => Promise.resolve({ x: 10, y: 20, strategy: 'fixed', middlewareData: {}, ...result }) as never,
  );
}

function stubStyles(map: Map<Element, Css>) {
  return vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (el: Element) =>
      ({
        transform: 'none',
        perspective: 'none',
        filter: 'none',
        willChange: '',
        contain: '',
        borderLeftWidth: '0px',
        borderTopWidth: '0px',
        ...(map.get(el) ?? {}),
      }) as unknown as CSSStyleDeclaration,
  );
}

function stubRect(el: Element, x: number, y: number): void {
  el.getBoundingClientRect = () =>
    ({ x, y, left: x, top: y, width: 0, height: 0, right: x, bottom: y, toJSON() {} }) as DOMRect;
}

function size(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.mocked(fui.computePosition).mockReset();
  resolveWith({ placement: 'bottom-start' });
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

// ---------------------------------------------------------------------------
// anchor
// ---------------------------------------------------------------------------

describe('anchor — D-29 gaps', () => {
  it('positionArrow: after a flip to top, the arrow sits on the BOTTOM edge by half its height', async () => {
    resolveWith({ placement: 'top', middlewareData: { arrow: { x: 12 } } }); // asked bottom-start, flipped
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    const arrowEl = document.createElement('div');
    floating.append(arrowEl);
    document.body.append(floating, reference);
    size(arrowEl, 10, 6);
    arrowEl.style.top = '99px'; // stale value from a previous placement
    anchor(floating, reference, { arrow: { element: arrowEl } });
    await settle();
    expect(arrowEl.style.left).toBe('12px');
    expect(arrowEl.style.top).toBe(''); // no y from floating-ui → cleared
    expect(arrowEl.style.right).toBe('');
    expect(arrowEl.style.bottom).toBe('-3px'); // offsetHeight / 2 on a top/bottom edge
  });

  it('positionArrow: a side placement uses the LEFT static side and half the arrow width', async () => {
    resolveWith({ placement: 'right-start', middlewareData: { arrow: { y: 7 } } });
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    const arrowEl = document.createElement('div');
    floating.append(arrowEl);
    document.body.append(floating, reference);
    size(arrowEl, 10, 6);
    anchor(floating, reference, { placement: 'right-start', arrow: { element: arrowEl } });
    await settle();
    expect(arrowEl.style.top).toBe('7px');
    expect(arrowEl.style.left).toBe('-5px'); // static side `left`, offsetWidth / 2
    expect(arrowEl.style.bottom).toBe('');
  });

  it('positionArrow: no arrow data from floating-ui leaves the arrow untouched', async () => {
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    const arrowEl = document.createElement('div');
    arrowEl.style.left = '3px';
    document.body.append(floating, reference);
    anchor(floating, reference, { arrow: { element: arrowEl } });
    await settle();
    expect(arrowEl.style.left).toBe('3px');
  });

  it('onDrift is skipped for a virtual reference (no element to diagnose against)', async () => {
    const floating = document.createElement('div');
    document.body.append(floating);
    floating.getBoundingClientRect = () => ({ x: 500, y: 500, top: 500, left: 500, right: 500, bottom: 500, width: 0, height: 0, toJSON() {} }) as DOMRect;
    const onDrift = vi.fn();
    const onPlaced = vi.fn();
    anchor(floating, { getBoundingClientRect: () => new DOMRect(0, 0, 0, 0) }, { onDrift, onPlaced });
    await settle();
    expect(onPlaced).toHaveBeenCalled(); // positioned …
    expect(onDrift).not.toHaveBeenCalled(); // … but never diagnosed
  });

  it("lockPlacement:'freeze' with shouldFlip:false never adds flip, and pins the resolved placement", async () => {
    resolveWith({ placement: 'top-end' });
    const handle = anchor(document.createElement('div'), document.createElement('button'), {
      placement: 'bottom',
      lockPlacement: 'freeze',
      shouldFlip: false,
    });
    await settle();
    expect(middlewareNames(0)).not.toContain('flip');
    expect(computeCalls()[0]![2]!.placement).toBe('bottom');
    handle.update();
    await settle();
    expect(middlewareNames(1)).not.toContain('flip');
    expect(computeCalls()[1]![2]!.placement).toBe('top-end'); // the first resolved placement, pinned
    expect(vi.mocked(fui.flip)).not.toHaveBeenCalled();
  });

  it('a throwing beforeComputeCallback is logged; positioning still runs', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    document.body.append(floating, reference);
    anchor(floating, reference, {
      beforeComputeCallback: () => {
        throw new Error('before boom');
      },
    });
    await settle();
    expect(error).toHaveBeenCalled();
    expect(floating.style.left).toBe('10px');
  });

  it('a throwing onDrift is logged, not an unhandled rejection', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    document.body.append(floating, reference);
    floating.getBoundingClientRect = () => ({ x: 300, y: 300, top: 300, left: 300, right: 300, bottom: 300, width: 0, height: 0, toJSON() {} }) as DOMRect;
    anchor(floating, reference, {
      onDrift: () => {
        throw new Error('drift boom');
      },
    });
    await settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(error.mock.calls.some((args) => args.some((a) => a instanceof Error && a.message === 'drift boom'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// containing block
// ---------------------------------------------------------------------------

describe('getFixedPositionOffsetParent — D-29 gaps', () => {
  function chain(): { outer: HTMLElement; el: HTMLElement } {
    const outer = document.createElement('div');
    const el = document.createElement('span');
    outer.append(el);
    document.body.append(outer);
    return { outer, el };
  }

  it.each([
    ['will-change: transform', { willChange: 'transform' }],
    ['will-change: opacity, filter', { willChange: 'opacity, filter' }],
    ['perspective', { perspective: '500px' }],
    ['backdrop-filter', { backdropFilter: 'blur(2px)' }],
  ])('%s establishes a fixed containing block', (_name, css) => {
    const { outer, el } = chain();
    stubStyles(new Map([[outer, css as Css]]));
    expect(getFixedPositionOffsetParent(el)).toBe(outer);
  });

  it.each([
    ['will-change: opacity', { willChange: 'opacity' }],
    ['will-change: auto', { willChange: 'auto' }],
  ])('%s does not', (_name, css) => {
    const { outer, el } = chain();
    stubStyles(new Map([[outer, css as Css]]));
    expect(getFixedPositionOffsetParent(el)).toBe(window);
  });

  it('the walk crosses a shadow root to the transformed light-DOM ancestor of the host', () => {
    const outer = document.createElement('div');
    const host = document.createElement('div');
    outer.append(host);
    document.body.append(outer);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    const floating = document.createElement('div');
    inner.append(floating);
    shadow.append(inner);
    stubStyles(new Map([[outer, { transform: 'matrix(1, 0, 0, 1, 0, 0)' }]]));
    expect(getFixedPositionOffsetParent(floating)).toBe(outer);
  });

  it('a transformed ancestor INSIDE the shadow root wins over one outside it (nearest first)', () => {
    const outer = document.createElement('div');
    const host = document.createElement('div');
    outer.append(host);
    document.body.append(outer);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    const floating = document.createElement('div');
    inner.append(floating);
    shadow.append(inner);
    stubStyles(new Map<Element, Css>([[outer, { transform: 'scale(2)' }], [inner, { contain: 'paint' }]]));
    expect(getFixedPositionOffsetParent(floating)).toBe(inner);
  });
});

describe('detectFixedDrift — D-29 gaps', () => {
  it('a bordered culprit found from the panel: drift measured to its padding box, CSS described', () => {
    const wrapper = document.createElement('div');
    wrapper.id = 'stage';
    const panel = document.createElement('div');
    wrapper.append(panel);
    const reference = document.createElement('button');
    document.body.append(wrapper, reference);
    stubStyles(new Map([[wrapper, { transform: 'translateX(37px)', borderLeftWidth: '3px', borderTopWidth: '3px' }]]));
    stubRect(wrapper, 37, 17); // padding box origin (40, 20)
    stubRect(panel, 50, 40); // expected (10, 20) → drift (40, 20)
    const report = detectFixedDrift({ panel, reference, expectedX: 10, expectedY: 20, offsetParent: window });
    expect(report).toMatchObject({ driftX: 40, driftY: 20, culprit: wrapper, culpritDescription: '<div#stage>' });
    expect(report!.culpritCss).toBe('transform: translateX(37px)');
  });

  // FIXED (D-29 #containing-block culpritCss): describeContainingBlockProps() re-appends `contain: …`
  // after fixedContainingBlockProps() already listed it, so the hint reads "contain: paint; contain: paint".
  it('a contain:paint culprit is described once (no duplicated contain entry)', () => {
    const wrapper = document.createElement('div');
    const panel = document.createElement('div');
    wrapper.append(panel);
    const reference = document.createElement('button');
    document.body.append(wrapper, reference);
    stubStyles(new Map([[wrapper, { contain: 'paint' }]]));
    stubRect(wrapper, 40, 30);
    stubRect(panel, 50, 50);
    const report = detectFixedDrift({ panel, reference, expectedX: 10, expectedY: 20, offsetParent: window });
    expect(report!.culprit).toBe(wrapper);
    expect(report!.culpritCss).toBe('contain: paint');
  });
});

// ---------------------------------------------------------------------------
// tooltip
// ---------------------------------------------------------------------------

describe('createTooltip — D-29 gaps', () => {
  function trigger(): HTMLButtonElement {
    const t = document.createElement('button');
    document.body.append(t);
    return t;
  }

  it('respects a hide delay', () => {
    vi.useFakeTimers();
    const t = trigger();
    const tip = createTooltip({ trigger: t, content: 'hi', delay: { hide: 150 } });
    t.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tip.isVisible).toBe(true);
    t.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip.isVisible).toBe(true); // still waiting
    vi.advanceTimersByTime(149);
    expect(tip.isVisible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tip.isVisible).toBe(false);
    expect(tip.element.isConnected).toBe(false);
  });

  it('re-entering the trigger during the hide delay keeps it visible (no re-anchor)', () => {
    vi.useFakeTimers();
    const t = trigger();
    const tip = createTooltip({ trigger: t, content: 'hi', delay: 100 });
    t.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(100);
    expect(tip.isVisible).toBe(true);
    const anchors = vi.mocked(fui.autoUpdate).mock.calls.length;
    t.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(50);
    t.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(500);
    expect(tip.isVisible).toBe(true);
    expect(vi.mocked(fui.autoUpdate).mock.calls.length).toBe(anchors);
  });

  it('moving onto the tooltip itself during the hide delay keeps it visible (hoverable, WCAG 1.4.13)', () => {
    vi.useFakeTimers();
    const t = trigger();
    const tip = createTooltip({ trigger: t, content: 'hi', delay: { hide: 100 } });
    t.dispatchEvent(new MouseEvent('mouseenter'));
    t.dispatchEvent(new MouseEvent('mouseleave'));
    tip.element.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(500);
    expect(tip.isVisible).toBe(true);
    tip.element.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(100);
    expect(tip.isVisible).toBe(false);
  });

  it('focus then hover then pointer leaves: stays (focused); blur then hides', () => {
    const t = trigger();
    const tip = createTooltip({ trigger: t, content: 'hi' });
    t.focus(); // focusin → show
    expect(tip.isVisible).toBe(true);
    t.dispatchEvent(new MouseEvent('mouseenter'));
    t.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip.isVisible).toBe(true);
    t.blur();
    expect(tip.isVisible).toBe(false);
  });

  // FIXED (D-29 #tooltip focus interplay — review D-08 "ignore focusout whose relatedTarget is inside
  // the trigger", not in the fix plan): moving focus between two focusable children of the trigger
  // hides + re-shows (destroy + re-anchor; a visible flicker with delay 0).
  it('focus moving between two children of the trigger does not re-anchor the tooltip', () => {
    const t = document.createElement('div');
    const a = document.createElement('button');
    const b = document.createElement('button');
    t.append(a, b);
    document.body.append(t);
    const tip = createTooltip({ trigger: t, content: 'hi' });
    a.focus();
    expect(tip.isVisible).toBe(true);
    const anchors = vi.mocked(fui.autoUpdate).mock.calls.length;
    b.focus();
    expect(tip.isVisible).toBe(true);
    expect(vi.mocked(fui.autoUpdate).mock.calls.length).toBe(anchors);
  });

  it('destroy() while visible removes the element and the aria-describedby link', () => {
    const t = trigger();
    const tip = createTooltip({ trigger: t, content: 'hi' });
    tip.show();
    expect(tip.element.isConnected).toBe(true);
    const cleanup = vi.mocked(fui.autoUpdate).mock.results.at(-1)!.value as ReturnType<typeof vi.fn>;
    tip.destroy();
    expect(tip.isVisible).toBe(false);
    expect(tip.element.isConnected).toBe(false);
    expect(t.hasAttribute('aria-describedby')).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
    tip.destroy(); // idempotent
  });

  it('follow-cursor: a focus show after a hover anchors to the trigger, not the stale cursor (D-15)', () => {
    const t = trigger();
    t.getBoundingClientRect = () => new DOMRect(100, 200, 300, 40);
    const tip = createTooltip({ trigger: t, content: 'hi', shouldFollowCursor: true });
    t.dispatchEvent(new MouseEvent('mouseenter', { clientX: 150, clientY: 210 }));
    t.dispatchEvent(new MouseEvent('mousemove', { clientX: 160, clientY: 215 }));
    t.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip.isVisible).toBe(false);
    t.focus();
    expect(tip.isVisible).toBe(true);
    const ref = computeCalls().at(-1)![0] as { getBoundingClientRect: () => DOMRect };
    const rect = ref.getBoundingClientRect();
    expect([rect.x, rect.y, rect.width]).toEqual([100, 200, 300]);
  });

  it('content as an element is appended (not stringified)', () => {
    const t = trigger();
    const body = document.createElement('strong');
    body.textContent = 'bold';
    const tip = createTooltip({ trigger: t, content: body });
    expect(tip.element.firstElementChild).toBe(body);
    tip.show();
    expect(tip.element.querySelector('strong')!.textContent).toBe('bold');
  });
});

// ---------------------------------------------------------------------------
// popover
// ---------------------------------------------------------------------------

describe('createPopover — D-29 gaps', () => {
  it('the container option mounts the panel there instead of document.body', () => {
    const reference = document.createElement('button');
    const panel = document.createElement('div');
    const mount = document.createElement('section');
    document.body.append(reference, mount);
    const pop = createPopover({ reference, panel, container: mount });
    pop.open();
    expect(panel.parentNode).toBe(mount);
    pop.close();
    expect(panel.isConnected).toBe(false);
  });

  it('inheritThemeFrom defaults to the reference; an explicit one wins', () => {
    const light = document.createElement('div');
    light.setAttribute('data-theme', 'light');
    const reference = document.createElement('button');
    light.append(reference);
    const dark = document.createElement('div');
    dark.setAttribute('data-theme', 'dark');
    const source = document.createElement('span');
    dark.append(source);
    document.body.append(light, dark);

    const panel = document.createElement('div');
    const pop = createPopover({ reference, panel });
    pop.open();
    expect(panel.getAttribute('data-theme')).toBe('light');
    pop.close();
    expect(panel.hasAttribute('data-theme')).toBe(false);

    const panel2 = document.createElement('div');
    createPopover({ reference, panel: panel2, inheritThemeFrom: source }).open();
    expect(panel2.getAttribute('data-theme')).toBe('dark');
  });

  it('forwards matchWidth, offset and onPlaced to anchor()', async () => {
    const reference = document.createElement('button');
    const panel = document.createElement('div');
    document.body.append(reference);
    const onPlaced = vi.fn();
    createPopover({ reference, panel, matchWidth: 'max', offset: 14, onPlaced }).open();
    await settle();
    expect(vi.mocked(fui.offset)).toHaveBeenCalledWith(14);
    const sizeMw = (computeCalls()[0]![2]!.middleware as unknown as { name: string; options: { apply: (a: unknown) => void } }[]).find((m) => m.name === 'size')!;
    sizeMw.options.apply({ rects: { reference: { width: 180 } }, elements: { floating: panel } });
    expect(panel.style.maxWidth).toBe('180px');
    expect(onPlaced).toHaveBeenCalledWith('bottom-start');
  });

  it('destroy() while open on a DETACHED reference closes cleanly', () => {
    const reference = document.createElement('button'); // never attached
    const panel = document.createElement('div');
    const pop = createPopover({ reference, panel });
    pop.open();
    expect(() => pop.destroy()).not.toThrow();
    expect(panel.isConnected).toBe(false);
    pop.open();
    expect(pop.isOpen).toBe(false);
  });
});
