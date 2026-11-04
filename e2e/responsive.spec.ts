import { test, expect, devices } from './fixtures';
import type { Page } from './fixtures';

/**
 * Environment facts + responsive rules (SPEC §6.7, core /environment, /overlay presentation).
 *
 * Covered:
 *   - getEnvironment()/classifyDevice(): mouse = desktop at any width, breakpoint follows width;
 *     touch emulation (iPad portrait = tablet device in the mobile bucket, iPhone 13 = mobile/mobile)
 *   - observeEnvironment (discrete, only on a category flip) vs observeViewport (every size change)
 *   - configureBreakpoints moves the lines globally; restoring the defaults restores the bucket
 *   - resolvePresentation: map per device class, defaults, forced mode
 *   - instance responsive map: breakpoint axis, device entry beats breakpoint entry, base shows
 *     through when no entry applies, reinit on an on:'reinit' key
 *   - precedence page map → page callback → tag map → tag callback → explicit attribute →
 *     instance map → instance callback, key by key; overrides never reflect; instance null =
 *     ignore page rules; dropping a layer restores the base; page rules don't leak across tags
 *   - an instance callback on a custom width re-runs on the continuous channel, update() only
 *     when the result changed, dropped keys restore the base
 *
 * Each test navigates fresh, so page-wide window.components.responsive* never carries over;
 * the precedence test additionally clears them and asserts the reset.
 *
 * Fixtures: test/environment.html, test/responsive.html
 * (both carry the viewport meta tag so touch emulation applies — SPEC §12.7).
 */

const ENV = '/test/environment.html';
const RESP = '/test/responsive.html';

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('body[data-ready="true"]')).toHaveCount(1);
}

type Snap = { device: string; breakpoint: string; isTouchPrimary: boolean; width: number };
type Fx = {
  snapshot(): Snap;
  counts: { discrete: number; continuous: number };
  sim(name: string): unknown;
  classifyDevice(env: unknown): string;
  resolvePresentation(mode: string, env: unknown, map?: Record<string, string>): string;
  getEnvironment(): unknown;
  configureBreakpoints(map: Record<string, number>): void;
  resetBreakpoints(): void;
  probe: { base: Record<string, unknown> | null };
};
type El = HTMLElement & Record<string, unknown> & {
  calls: Array<{ kind: string; partial?: Record<string, unknown> }>;
  updateCount: number;
  responsiveCallback: unknown;
  whenSettled(): Promise<void>;
};

const snapshot = (page: Page) => page.evaluate(() => (window as unknown as { fx: Fx }).fx.snapshot());
const counts = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { fx: Fx }).fx.counts }));
const livePresentation = (page: Page, map: Record<string, string>) =>
  page.evaluate((m) => {
    const { fx } = window as unknown as { fx: Fx };
    return fx.resolvePresentation('auto', fx.getEnvironment(), m);
  }, map);

/** Effective values (generated getters) of the given keys on #id. */
const eff = (page: Page, id: string, keys: readonly string[]) =>
  page.evaluate(
    ([i, ks]) => {
      const el = document.getElementById(i as string) as unknown as El;
      return Object.fromEntries((ks as string[]).map((k) => [k, el[k]]));
    },
    [id, keys] as const,
  );

const MAP_KEYS = ['layout', 'columns', 'presentation'] as const;
const LAYER_KEYS = ['accent', 'density', 'label', 'badge'] as const;

// Desktop Chrome project (1280 × 900, mouse) unless a describe block emulates touch.
test.describe('desktop (mouse)', () => {
  test('RS01: snapshot — mouse device is desktop at any width; breakpoint follows the width', async ({ page }) => {
    await open(page, ENV);
    expect(await snapshot(page)).toMatchObject({ device: 'desktop', breakpoint: 'desktop', isTouchPrimary: false });

    await page.setViewportSize({ width: 700, height: 900 });
    await expect.poll(async () => (await snapshot(page)).breakpoint).toBe('mobile');
    expect((await snapshot(page)).device).toBe('desktop'); // capability over width
  });

  test('RS01: discrete channel fires only on a category flip; continuous fires on every size change', async ({ page }) => {
    await open(page, ENV);
    const c0 = await counts(page);

    // Within the desktop bucket: continuous yes, discrete no.
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect.poll(async () => (await counts(page)).continuous).toBeGreaterThan(c0.continuous);
    await page.waitForTimeout(150);
    expect((await counts(page)).discrete).toBe(c0.discrete);

    // Cross the 1024 line → discrete fires.
    await page.setViewportSize({ width: 900, height: 900 });
    await expect.poll(async () => (await counts(page)).discrete).toBeGreaterThan(c0.discrete);
    expect((await snapshot(page)).breakpoint).toBe('tablet');
  });

  test('RS01: classifyDevice on simulated snapshots — touch short side decides, mouse is desktop', async ({ page }) => {
    await open(page, ENV);
    const classes = await page.evaluate(() => {
      const { fx } = window as unknown as { fx: Fx };
      return ['phone-portrait', 'phone-landscape', 'ipad-portrait', 'desktop-narrowed', 'desktop', 'tablet-landscape-keyboard'].map((n) =>
        fx.classifyDevice(fx.sim(n)),
      );
    });
    expect(classes).toEqual(['mobile', 'mobile', 'tablet', 'desktop', 'desktop', 'tablet']);
  });

  test('RS01: configureBreakpoints moves the lines globally; restoring the defaults restores the bucket', async ({ page }) => {
    await open(page, ENV);
    await page.evaluate(() => (window as unknown as { fx: Fx }).fx.configureBreakpoints({ mobile: 1300, tablet: 1600, desktop: Infinity }));
    expect((await snapshot(page)).breakpoint).toBe('mobile');
    await page.evaluate(() => (window as unknown as { fx: Fx }).fx.resetBreakpoints());
    expect((await snapshot(page)).breakpoint).toBe('desktop');
  });

  test('RS02: resolvePresentation — map per class, defaults, forced mode', async ({ page }) => {
    await open(page, ENV);
    const resolve = (mode: string, map: Record<string, string>) =>
      page.evaluate(
        ([m, mp]) => {
          const { fx } = window as unknown as { fx: Fx };
          const envs = ['phone-portrait', 'ipad-portrait', 'desktop'].map((n) => fx.sim(n));
          return [...envs, fx.getEnvironment()].map((e) => fx.resolvePresentation(m as string, e, mp as Record<string, string>));
        },
        [mode, map] as const,
      );
    // [phone, iPad portrait, desktop, live window]
    expect(await resolve('auto', { tablet: 'modal' })).toEqual(['fullscreen', 'modal', 'floating', 'floating']);
    expect(await resolve('auto', {})).toEqual(['fullscreen', 'floating', 'floating', 'floating']);
    expect(await resolve('modal', { tablet: 'floating' })).toEqual(['modal', 'modal', 'modal', 'modal']);
  });

  test('RS03: breakpoint axis flips a narrowed desktop window; base shows through when no entry applies', async ({ page }) => {
    await open(page, RESP);
    expect(await eff(page, 'rs-map', MAP_KEYS)).toEqual({ layout: 'grid', columns: 3, presentation: 'floating' });
    const reinits0 = await page.evaluate(() => (document.getElementById('rs-map') as unknown as El).calls.filter((c) => c.kind === 'reinit').length);

    await page.setViewportSize({ width: 700, height: 900 });
    // desktop device → no device entry; breakpoint.mobile applies.
    await expect.poll(() => eff(page, 'rs-map', MAP_KEYS)).toEqual({ layout: 'stack', columns: 1, presentation: 'floating' });
    const reinits1 = await page.evaluate(() => (document.getElementById('rs-map') as unknown as El).calls.filter((c) => c.kind === 'reinit').length);
    expect(reinits1).toBeGreaterThan(reinits0); // layout is on:'reinit'

    // A base value: the instance map still wins under 768, the base comes back above.
    await page.evaluate(async () => {
      const el = document.getElementById('rs-map') as unknown as El;
      el.setAttribute('columns', '5');
      await el.whenSettled();
    });
    expect(await page.evaluate(() => (window as unknown as { fx: Fx }).fx.probe.base?.columns)).toBe(5);
    expect((await eff(page, 'rs-map', ['columns'])).columns).toBe(1);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(() => eff(page, 'rs-map', ['layout', 'columns'])).toEqual({ layout: 'grid', columns: 5 });
  });

  test('RS04: precedence key by key, no reflection, null opt-out, dropped key restores base', async ({ page }) => {
    await open(page, RESP);
    // Apply a layer state, settle, return the effective values + the reflected attributes.
    const apply = (s: Record<string, unknown>) =>
      page.evaluate(async (st) => {
        const c = (window as unknown as { components: Record<string, Record<string, unknown>> & { responsive: unknown; responsiveCallback: unknown } }).components;
        const tag = c['fx-rs-layers'] as Record<string, unknown>;
        const el = document.getElementById('rs-layers') as unknown as El;
        const everywhere = (p: unknown) => ({ device: { mobile: p, tablet: p, desktop: p } });
        c.responsive = st.globalMap ? everywhere({ accent: 'amber', density: 'compact', label: 'page map', badge: 'page map' }) : null;
        c.responsiveCallback = st.globalCb ? () => ({ accent: 'teal', label: 'page callback' }) : null;
        tag.responsive = st.tagMap ? everywhere({ density: 'spacious', label: 'tag map' }) : null;
        tag.responsiveCallback = st.tagCb ? () => ({ label: 'tag callback' }) : null;
        if (st.attr) el.setAttribute('accent', 'rose');
        else el.removeAttribute('accent');
        if (st.instMap) el.setAttribute('responsive', JSON.stringify(everywhere({ label: 'instance map' })));
        else el.removeAttribute('responsive');
        el.responsiveCallback = st.instCb === 'partial' ? () => ({ badge: 'instance callback' }) : st.instCb === 'null' ? () => null : null;
        await el.whenSettled();
        const keys = ['accent', 'density', 'label', 'badge'];
        return {
          eff: Object.fromEntries(keys.map((k) => [k, el[k]])),
          attrs: Object.fromEntries(keys.map((k) => [k, el.getAttribute(k)])),
        };
      }, s);

    let r = await apply({});
    expect(r.eff).toEqual({ accent: 'slate', density: 'comfortable', label: 'base', badge: 'none' });

    r = await apply({ globalMap: true });
    expect(r.eff).toEqual({ accent: 'amber', density: 'compact', label: 'page map', badge: 'page map' });
    expect(r.attrs).toEqual({ accent: null, density: null, label: null, badge: null }); // overrides never reflect

    r = await apply({ globalMap: true, globalCb: true });
    expect(r.eff).toMatchObject({ accent: 'teal', label: 'page callback' });
    r = await apply({ globalMap: true, globalCb: true, tagMap: true });
    expect(r.eff).toMatchObject({ density: 'spacious', label: 'tag map' });
    r = await apply({ globalMap: true, globalCb: true, tagMap: true, tagCb: true });
    expect(r.eff).toMatchObject({ label: 'tag callback' });

    // Explicit attribute beats every page rule.
    const all = { globalMap: true, globalCb: true, tagMap: true, tagCb: true, attr: true };
    r = await apply(all);
    expect(r.eff.accent).toBe('rose');

    r = await apply({ ...all, instMap: true });
    expect(r.eff.label).toBe('instance map');
    r = await apply({ ...all, instMap: true, instCb: 'partial' });
    expect(r.eff).toEqual({ accent: 'rose', density: 'spacious', label: 'instance map', badge: 'instance callback' });

    // Instance null = ignore every page rule; the instance's own values still apply.
    r = await apply({ ...all, instMap: true, instCb: 'null' });
    expect(r.eff).toEqual({ accent: 'rose', density: 'comfortable', label: 'instance map', badge: 'none' });

    // Reset → all layers gone, base restored, globals cleared.
    r = await apply({});
    expect(r.eff).toEqual({ accent: 'slate', density: 'comfortable', label: 'base', badge: 'none' });
    expect(
      await page.evaluate(() => {
        const c = (window as unknown as { components: { responsive: unknown; responsiveCallback: unknown } }).components;
        return [c.responsive ?? null, c.responsiveCallback ?? null];
      }),
    ).toEqual([null, null]);
  });

  test('RS04: page-wide rules do not leak into other elements (their keys differ)', async ({ page }) => {
    await open(page, RESP);
    await page.evaluate(async () => {
      const c = (window as unknown as { components: Record<string, unknown> }).components;
      const p = { accent: 'amber', density: 'compact', label: 'page map', badge: 'page map' };
      c.responsive = { device: { mobile: p, tablet: p, desktop: p } };
      c.responsiveCallback = () => ({ accent: 'teal' });
      for (const id of ['rs-map', 'rs-layers', 'rs-cb']) await (document.getElementById(id) as unknown as El).whenSettled();
    });
    expect(await eff(page, 'rs-layers', LAYER_KEYS)).toEqual({ accent: 'teal', density: 'compact', label: 'page map', badge: 'page map' });
    expect(await eff(page, 'rs-map', MAP_KEYS)).toEqual({ layout: 'grid', columns: 3, presentation: 'floating' });
    expect(await eff(page, 'rs-cb', ['isCompact', 'cols'])).toEqual({ isCompact: false, cols: 4 });
  });

  test('RS05: a callback on a custom width re-runs continuously; update() only on a changed result', async ({ page }) => {
    await open(page, RESP);
    await page.evaluate(async () => {
      const el = document.getElementById('rs-cb') as unknown as El;
      const w = window as unknown as { cbRuns: number };
      w.cbRuns = 0;
      el.responsiveCallback = ({ env }: { env: { viewportWidth: number } }) => {
        w.cbRuns += 1;
        if (env.viewportWidth < 600) return { isCompact: true, cols: 1 };
        if (env.viewportWidth < 900) return { cols: 2 };
        return undefined;
      };
      await el.whenSettled();
    });
    const cb = () => eff(page, 'rs-cb', ['isCompact', 'cols']);
    const stat = () =>
      page.evaluate(() => ({
        runs: (window as unknown as { cbRuns: number }).cbRuns,
        updates: (document.getElementById('rs-cb') as unknown as El).updateCount,
      }));
    expect(await cb()).toEqual({ isCompact: false, cols: 4 });

    await page.setViewportSize({ width: 800, height: 900 }); // between 600 and 900
    await expect.poll(cb).toEqual({ isCompact: false, cols: 2 });

    // Within the same breakpoint bucket ("mobile", ≤ 768): only the continuous channel can see 550.
    await page.setViewportSize({ width: 700, height: 900 });
    await page.setViewportSize({ width: 550, height: 900 });
    await expect.poll(cb).toEqual({ isCompact: true, cols: 1 });

    const before = await stat();
    await page.setViewportSize({ width: 560, height: 900 });
    await page.setViewportSize({ width: 570, height: 900 });
    await expect.poll(async () => (await stat()).runs).toBeGreaterThan(before.runs);
    await page.waitForTimeout(100);
    expect((await stat()).updates).toBe(before.updates); // same result → diffed out

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(cb).toEqual({ isCompact: false, cols: 4 }); // dropped keys → base
  });
});

// Touch emulation needs the viewport meta tag (both fixtures have it) — see SPEC §12.7.
test.describe('iPad portrait (touch, 768 × 1024)', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test('RS01/RS03: tablet device in the mobile bucket — device entry beats breakpoint entry', async ({ page }) => {
    await open(page, RESP);
    expect(await snapshot(page)).toMatchObject({ isTouchPrimary: true, device: 'tablet', breakpoint: 'mobile' });
    // device.tablet "grid" over breakpoint.mobile "stack"
    expect(await eff(page, 'rs-map', MAP_KEYS)).toEqual({ layout: 'grid', columns: 2, presentation: 'modal' });
    expect(await livePresentation(page, { tablet: 'modal' })).toBe('modal');
  });
});

test.describe('phone (iPhone 13 profile)', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
  test.use(iphone);

  test('RS01/RS02/RS03: phone is mobile on both axes', async ({ page }) => {
    await open(page, RESP);
    expect(await snapshot(page)).toMatchObject({ device: 'mobile', breakpoint: 'mobile' });
    expect(await livePresentation(page, { tablet: 'modal' })).toBe('fullscreen');
    expect(await eff(page, 'rs-map', ['layout', 'presentation'])).toEqual({ layout: 'stack', presentation: 'fullscreen' });
    // The fixture must fit the 390px viewport (touch emulation would otherwise zoom out).
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
