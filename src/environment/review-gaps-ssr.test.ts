// @vitest-environment node
import { describe, expect, it } from 'vitest';

// Review 2026-11-03 V-19 #7: the environment / theme / motion / element-size / global / overlay modules
// imported and called with NO window / document (a node environment, like SSR). Guards the module-level
// code (createThrottle, createFrameScheduler, Symbol.for lookups) and the SSR fallbacks.

describe('V-19 #7 — SSR: no window / document', () => {
  it('runs in a DOM-less environment', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('the whole main index imports without a DOM', async () => {
    const core = await import('../index.js');
    expect(typeof core.BlissElement).toBe('function');
  });

  it('environment: static desktop default, a once-firing subscribe and no-op unsubscribes', async () => {
    const env = await import('./environment.js');
    expect(env.getEnvironment().breakpoint).toBe('desktop');
    expect(env.classifyDevice(env.getEnvironment())).toBe('desktop');
    const seen: string[] = [];
    const off = env.observeEnvironment((s) => seen.push(s.breakpoint));
    const offViewport = env.observeViewport((s) => seen.push(`vp:${s.viewportWidth}`));
    expect(seen).toEqual(['desktop', 'vp:1024']);
    expect(() => env.configureBreakpoints({ small: 500, large: Infinity })).not.toThrow();
    off();
    offViewport();
    env.__resetEnvironment();
  });

  it('element-size: fires once with 0×0 and returns a working unsubscribe', async () => {
    const { observeElementSize } = await import('./element-size.js');
    const fake = {} as Element; // no layout API at all
    const seen: unknown[] = [];
    const off = observeElementSize(fake, (size) => seen.push(size));
    expect(seen).toEqual([{ width: 0, height: 0 }]);
    expect(() => off()).not.toThrow();
  });

  it('motion: publish / read / observe are no-ops that answer auto', async () => {
    const motion = await import('./motion.js');
    expect(() => motion.publishMotionHook()).not.toThrow();
    expect(motion.getPageMotion()).toBe('auto');
    const off = motion.observePageMotion(() => {});
    off();
    expect(() => motion.adoptMotionStyles({} as Node)).not.toThrow();
  });

  it('theme: null context, forced mode delivered once, no-op unsubscribe', async () => {
    const theme = await import('./theme.js');
    expect(theme.getThemeContext()).toBeNull();
    const seen: unknown[] = [];
    theme.observeThemeContext({} as Element, undefined, (s) => seen.push(s))();
    theme.setThemeMode('dark');
    expect(theme.getThemeContext()).toBe('dark');
    theme.observeThemeContext({} as Element, '.x', (s) => seen.push(s))();
    expect(seen).toEqual([null, 'dark']);
    theme.setThemeMode('auto');
  });

  it('global: registerComponent / instances / page settings without a window', async () => {
    const { registerComponent } = await import('../global/register-component.js');
    const { getInstances, getRegisteredTags } = await import('../global/instances.js');
    const { publishPageSetting } = await import('../global/page-setting.js');
    class El {}
    const entry = registerComponent('ssr-el', El as unknown as CustomElementConstructor, {
      config: { name: 'ssr', version: '1' },
      shouldAutoDefine: false,
    });
    expect(entry.version()).toBe('1');
    expect(getInstances('ssr-el')).toEqual([]);
    expect(getRegisteredTags()).toEqual([]);
    expect(() => publishPageSetting('x', { get: () => 1, set: () => {} })).not.toThrow();
  });

  it('overlay: scroll lock, keyboard inset, active-overlay and presentation are SSR-safe', async () => {
    const { lockBodyScroll } = await import('../overlay/scroll-lock.js');
    const { observeKeyboardInset } = await import('../overlay/keyboard-inset.js');
    const overlay = await import('../overlay/active-overlay.js');
    const { resolvePresentation } = await import('../overlay/presentation.js');
    const env = await import('./environment.js');

    const release = lockBodyScroll();
    expect(() => release()).not.toThrow();
    expect(() => observeKeyboardInset({ style: {} } as HTMLElement)()).not.toThrow();

    const handle = overlay.registerOverlay(() => {});
    expect(() => handle.activate()).not.toThrow();
    expect(() => overlay.notifyOverlayActivated()).not.toThrow();
    expect(() => overlay.dismissAllOverlays()).not.toThrow();
    overlay.onOverlayActivated(() => {})();
    handle.destroy();
    overlay.__resetOverlays();

    expect(resolvePresentation('auto', env.getEnvironment())).toBe('floating');
  });
});
