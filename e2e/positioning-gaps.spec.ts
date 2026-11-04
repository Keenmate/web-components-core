import { test, expect } from './fixtures';

// Review 2026-11-03 D-29 — the browser-only positioning / scroll scenarios jsdom can't show:
//   - a panel inside a transformed / contained ancestor lands on target (shouldUseFixedContainingBlock),
//     and onDrift names the culprit when the panel really drifts;
//   - lockPlacement:'freeze' flips once near the viewport bottom and doesn't jump back while scrolling;
//   - matchWidth 'min' / 'max', maxHeight capping on a short viewport, the arrow after a flip;
//   - a tooltip mounted in a ShadowRoot picks up the shadow-scoped CSS; trigger removed; Escape;
//   - scrollIntoContainer never shifts an overflow:hidden wrapper; stopAt with no inner scroller
//     leaves the page still.
// (Popover / tooltip above a modal dialog: e2e/dialog.spec.ts.)
//
// Fixture: test/positioning-gaps.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/positioning-gaps.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('shouldUseFixedContainingBlock: a fixed panel inside a transformed, bordered ancestor lands on target, no drift', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as any;
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `
      <div id="cb" style="transform: translateX(0); margin: 80px 0 0 150px; border: 5px solid #888; padding: 20px; width: 500px; height: 300px">
        <button class="fx-ref" id="ref">ref</button>
        <div class="fx-panel" id="panel" style="width: 120px; height: 60px">panel</div>
      </div>`;
    const ref = document.getElementById('ref')!;
    const panel = document.getElementById('panel')!;
    const drifts: unknown[] = [];
    w.pos.anchor(panel, ref, { placement: 'bottom-start', offset: 8, shouldUseFixedContainingBlock: true, onDrift: (d: unknown) => drifts.push(d) });
    await w.frames(3);
    const a = ref.getBoundingClientRect();
    const b = panel.getBoundingClientRect();
    return { dx: b.left - a.left, dy: b.top - a.bottom, drifts: drifts.length };
  });
  expect(Math.abs(r.dx)).toBeLessThan(1);
  expect(Math.abs(r.dy - 8)).toBeLessThan(1);
  expect(r.drifts).toBe(0);
});

test('shouldUseFixedContainingBlock: a contain:paint ancestor is recognised — panel on target, no drift', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as any;
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `
      <div style="contain: paint; margin: 60px 0 0 90px; padding: 15px; width: 500px; height: 300px">
        <button class="fx-ref" id="ref">ref</button>
        <div class="fx-panel" id="panel" style="width: 120px; height: 60px">panel</div>
      </div>`;
    const ref = document.getElementById('ref')!;
    const panel = document.getElementById('panel')!;
    const drifts: unknown[] = [];
    w.pos.anchor(panel, ref, { placement: 'bottom-start', offset: 8, shouldUseFixedContainingBlock: true, onDrift: (d: unknown) => drifts.push(d) });
    await w.frames(3);
    const a = ref.getBoundingClientRect();
    const b = panel.getBoundingClientRect();
    return { dx: b.left - a.left, dy: b.top - a.bottom, drifts: drifts.length };
  });
  expect(Math.abs(r.dx)).toBeLessThan(1);
  expect(Math.abs(r.dy - 8)).toBeLessThan(1);
  expect(r.drifts).toBe(0);
});

test('a real drift (platform says "viewport", a transformed ancestor traps the panel): onDrift names that ancestor', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as any;
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `
      <div id="culprit" class="trap" style="transform: translateX(0); margin: 70px 0 0 130px; border: 4px solid #888; padding: 10px; width: 500px; height: 300px">
        <button class="fx-ref" id="ref">ref</button>
        <div class="fx-panel" id="panel" style="width: 120px; height: 60px">panel</div>
      </div>`;
    const ref = document.getElementById('ref')!;
    const panel = document.getElementById('panel')!;
    const culprit = document.getElementById('culprit')!;
    const drifts: any[] = [];
    // A platform that wrongly claims the viewport is the offset parent → real drift.
    const platform = { ...w.pos.platform, getOffsetParent: () => window };
    w.pos.anchor(panel, ref, { placement: 'bottom-start', platform, onDrift: (d: unknown) => drifts.push(d) });
    await w.frames(3);
    const box = culprit.getBoundingClientRect();
    const d = drifts[0];
    return {
      count: drifts.length,
      isCulprit: d?.culprit === culprit,
      description: d?.culpritDescription,
      css: d?.culpritCss,
      driftX: d?.driftX,
      driftY: d?.driftY,
      paddingBoxX: box.left + 4,
      paddingBoxY: box.top + 4,
    };
  });
  expect(r.count).toBeGreaterThan(0);
  expect(r.isCulprit).toBe(true);
  expect(r.description).toBe('<div#culprit.trap>');
  expect(r.css).toContain('transform');
  expect(Math.abs(r.driftX - r.paddingBoxX)).toBeLessThan(2);
  expect(Math.abs(r.driftY - r.paddingBoxY)).toBeLessThan(2);
});

// FIXED (D-29 #onDrift false positive): without shouldUseFixedContainingBlock, onDrift measures against
// the VIEWPORT, but floating-ui's own platform already compensates for a transformed ancestor — the
// panel lands on target and onDrift still fires (types.ts: "Not called when the panel is on target").
test('no sugar: floating-ui compensates for a transformed ancestor itself — panel on target, onDrift silent', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as any;
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `
      <div style="transform: translateX(0); margin: 80px 0 0 150px; padding: 20px; width: 500px; height: 300px">
        <button class="fx-ref" id="ref">ref</button>
        <div class="fx-panel" id="panel" style="width: 120px; height: 60px">panel</div>
      </div>`;
    const ref = document.getElementById('ref')!;
    const panel = document.getElementById('panel')!;
    const drifts: unknown[] = [];
    w.pos.anchor(panel, ref, { placement: 'bottom-start', offset: 8, onDrift: (d: unknown) => drifts.push(d) });
    await w.frames(3);
    const a = ref.getBoundingClientRect();
    const b = panel.getBoundingClientRect();
    return { dx: b.left - a.left, dy: b.top - a.bottom, drifts: drifts.length };
  });
  expect(Math.abs(r.dx)).toBeLessThan(1);
  expect(Math.abs(r.dy - 8)).toBeLessThan(1);
  expect(r.drifts).toBe(0);
});

test("lockPlacement:'freeze' flips once near the viewport bottom and doesn't jump back while scrolling", async ({ page }) => {
  const build = (freeze: boolean) =>
    page.evaluate(async (isFrozen) => {
      const w = window as any;
      const stage = document.getElementById('stage')!;
      stage.innerHTML = `<button class="fx-ref" id="ref" style="margin-top: 1200px">ref</button>
        <div class="fx-panel" id="panel" style="width: 150px; height: 250px">panel</div>`;
      const ref = document.getElementById('ref')!;
      const panel = document.getElementById('panel')!;
      // Put the reference 60px above the viewport bottom: no room below → flip to top.
      window.scrollTo(0, ref.getBoundingClientRect().top + window.scrollY - (innerHeight - 90));
      await w.frames(2);
      const placements: string[] = [];
      w.handle?.destroy();
      w.handle = w.pos.anchor(panel, ref, {
        placement: 'bottom',
        ...(isFrozen ? { lockPlacement: 'freeze' } : {}),
        onPlaced: (p: string) => placements.push(p),
      });
      await w.frames(3);
      const first = placements.at(-1);
      // Scroll so the reference sits near the TOP: plenty of room below now.
      window.scrollTo(0, ref.getBoundingClientRect().top + window.scrollY - 300);
      await w.frames(4);
      const a = ref.getBoundingClientRect();
      const b = panel.getBoundingClientRect();
      return { first, last: placements.at(-1), panelAbove: b.bottom <= a.top + 1, gap: a.top - b.bottom };
    }, freeze);

  const frozen = await build(true);
  expect(frozen.first).toBe('top');
  expect(frozen.last).toBe('top');
  expect(frozen.panelAbove).toBe(true); // stayed above the reference, tracking it while scrolling
  expect(Math.abs(frozen.gap - 4)).toBeLessThan(1);

  const free = await build(false); // control: without freeze it flips back
  expect(free.first).toBe('top');
  expect(free.last).toBe('bottom');
});

test("matchWidth 'min' floors and 'max' caps the panel at the reference width", async ({ page }) => {
  const widths = await page.evaluate(async () => {
    const w = window as any;
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `<button class="fx-ref" id="ref" style="margin: 40px 0 0 100px">ref</button>`;
    const ref = document.getElementById('ref')!; // 200px wide
    const measure = async (mode: string, contentWidth: number) => {
      const panel = document.createElement('div');
      panel.className = 'fx-panel';
      panel.innerHTML = `<div style="width: ${contentWidth}px; height: 10px"></div>`;
      document.body.append(panel);
      const h = w.pos.anchor(panel, ref, { matchWidth: mode, shift: false, shouldFlip: false });
      await w.frames(3);
      const width = panel.getBoundingClientRect().width;
      h.destroy();
      panel.remove();
      return Math.round(width);
    };
    return {
      refWidth: Math.round(ref.getBoundingClientRect().width),
      minNarrow: await measure('min', 50),
      minWide: await measure('min', 400),
      maxNarrow: await measure('max', 50),
      maxWide: await measure('max', 400),
    };
  });
  expect(widths.refWidth).toBe(200);
  expect(widths.minNarrow).toBe(200); // grows to the reference
  expect(widths.minWide).toBe(400); // wider content keeps its width
  expect(widths.maxNarrow).toBe(50); // narrower content stays narrow
  expect(widths.maxWide).toBe(200); // capped at the reference
});

test('maxHeight caps the panel to the space below on a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 300 });
  const r = await page.evaluate(async () => {
    const w = window as any;
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `<button class="fx-ref" id="ref" style="margin-top: 40px">ref</button>
      <div class="fx-panel" id="panel" style="width: 150px; overflow: auto"><div style="height: 1000px"></div></div>`;
    window.scrollTo(0, 0);
    const ref = document.getElementById('ref')!;
    const panel = document.getElementById('panel')!;
    w.pos.anchor(panel, ref, { placement: 'bottom-start', offset: 4, shouldFlip: false, maxHeight: { padding: 8 } });
    await w.frames(3);
    const b = panel.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, refBottom: ref.getBoundingClientRect().bottom, vh: innerHeight };
  });
  expect(Math.abs(r.top - (r.refBottom + 4))).toBeLessThan(1);
  expect(Math.abs(r.bottom - (r.vh - 8))).toBeLessThan(1.5); // fills the space down to the padding
});

test('the arrow moves to the bottom edge after a flip to top, pointing at the reference', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as any;
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `<button class="fx-ref" id="ref" style="margin: 1200px 0 0 300px; width: 60px">ref</button>
      <div class="fx-panel" id="panel" style="width: 200px; height: 200px">
        <div id="arrow" style="position: absolute; width: 10px; height: 10px; background: red; transform: rotate(45deg)"></div>
      </div>`;
    const ref = document.getElementById('ref')!;
    const panel = document.getElementById('panel')!;
    const arrowEl = document.getElementById('arrow')!;
    window.scrollTo(0, ref.getBoundingClientRect().top + window.scrollY - (innerHeight - 80));
    await w.frames(2);
    let placed = '';
    w.pos.anchor(panel, ref, { placement: 'bottom', offset: 8, arrow: { element: arrowEl }, onPlaced: (p: string) => (placed = p) });
    await w.frames(3);
    const a = ref.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const arrowLeft = parseFloat(arrowEl.style.left);
    return {
      placed,
      top: arrowEl.style.top,
      bottom: arrowEl.style.bottom,
      arrowCenter: p.left + arrowLeft + 5,
      refCenter: a.left + a.width / 2,
      panelAbove: p.bottom <= a.top,
    };
  });
  expect(r.placed).toBe('top');
  expect(r.panelAbove).toBe(true);
  expect(r.top).toBe('');
  expect(r.bottom).toBe('-5px');
  expect(Math.abs(r.arrowCenter - r.refCenter)).toBeLessThan(1);
});

test('a tooltip mounted in a ShadowRoot picks up the shadow-scoped CSS and host custom properties', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as any;
    const host = document.createElement('div');
    host.style.setProperty('--tip-bg', 'rgb(10, 20, 30)');
    document.getElementById('stage')!.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>.tip { color: rgb(1, 2, 3); background: var(--tip-bg); }</style><button id="t">trigger</button>`;
    const trigger = shadow.getElementById('t')!;
    const tip = w.pos.createTooltip({ trigger, content: 'hi', container: shadow, cssClass: 'tip' });
    tip.show();
    await w.frames(2);
    const cs = getComputedStyle(tip.element);
    return { inShadow: tip.element.getRootNode() === shadow, color: cs.color, bg: cs.backgroundColor };
  });
  expect(r).toEqual({ inShadow: true, color: 'rgb(1, 2, 3)', bg: 'rgb(10, 20, 30)' });
});

test('a tooltip whose trigger is removed while it shows is torn down (real autoUpdate)', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as any;
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `<button id="t" style="margin: 100px">trigger</button>`;
    w.tip = w.pos.createTooltip({ trigger: document.getElementById('t'), content: 'gone soon', cssClass: 'fx-panel' });
  });
  await page.locator('#t').hover();
  await expect(page.locator('[role="tooltip"]')).toBeVisible();
  await page.evaluate(() => document.getElementById('t')!.remove());
  await expect.poll(() => page.evaluate(() => ({ visible: (window as any).tip.isVisible, mounted: (window as any).tip.element.isConnected }))).toEqual({ visible: false, mounted: false });
});

test('Escape dismisses a hovered tooltip without moving the pointer', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as any;
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `<button id="t" style="margin: 100px">trigger</button>`;
    w.tip = w.pos.createTooltip({ trigger: document.getElementById('t'), content: 'esc me', cssClass: 'fx-panel' });
  });
  await page.locator('#t').hover();
  await expect(page.locator('[role="tooltip"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).tip.isVisible)).toBe(false);
});

test('scrollIntoContainer never shifts an overflow:hidden wrapper that has no scroller (D-11)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as any;
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `<div id="clip" style="overflow: hidden; height: 200px; width: 300px; border: 1px solid">
        <div style="height: 1500px"></div><div id="row" style="height: 30px">row</div></div>`;
    const clip = document.getElementById('clip')!;
    const row = document.getElementById('row')!;
    const native = { before: clip.scrollTop };
    const result = w.core.scrollIntoContainer(row, { block: 'center' });
    await w.frames(2);
    return { result, clipTop: clip.scrollTop, before: native.before };
  });
  expect(r.result).toBeNull();
  expect(r.before).toBe(0);
  expect(r.clipTop).toBe(0); // native scrollIntoView would have scrolled the clip wrapper
});

test('stopAt with no scroller below it leaves the page still (D-04)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as any;
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `<div id="root"><div style="height: 2000px"></div><div id="row" style="height: 30px">row</div></div>`;
    window.scrollTo(0, 0);
    await w.frames(1);
    const result = w.core.scrollIntoContainer(document.getElementById('row'), { stopAt: document.getElementById('root'), block: 'center' });
    await w.frames(2);
    return { result, y: window.scrollY };
  });
  expect(r.result).toBeNull();
  expect(r.y).toBe(0);
});
