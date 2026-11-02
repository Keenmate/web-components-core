import { test, expect, type Page } from './fixtures';

// Motion level (SPEC §12.16) in a real browser — computed transition durations, not attributes:
//   - default = the component's own fallback (0.15s);
//   - motion="none" / "snappy" / "smooth" on the element; scroll behaviour follows (none → auto);
//   - window.components.motion page-wide; the element's own level wins;
//   - data-motion on a section works without base-css-variables (core adopts the presets);
//   - a component nested in another's shadow root (presets adopted into that root);
//   - the OS reduced-motion setting always wins, even over motion="smooth".
//
// Fixture: test/motion.html (no base-css-variables on the page)

test.beforeEach(async ({ page }) => {
  await page.goto('/test/motion.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

/** Build `html` in a fresh container, then read every `motion-probe` (light DOM + one level of shadow). */
async function probes(page: Page, html: string) {
  return page.evaluate((markup) => {
    const box = document.createElement('div');
    box.innerHTML = markup;
    document.body.appendChild(box);
    const found = [...box.querySelectorAll('motion-probe')];
    for (const parent of box.querySelectorAll('motion-parent')) found.push(...parent.shadowRoot!.querySelectorAll('motion-probe'));
    return found.map((p) => (window as any).readProbe(p));
  }, html);
}

test('default: the component keeps its own speed', async ({ page }) => {
  expect(await probes(page, '<motion-probe></motion-probe>')).toEqual([{ duration: '0.15s', scroll: 'smooth' }]);
});

test('motion="none" / "snappy" / "smooth" on the element', async ({ page }) => {
  expect(
    await probes(page, '<motion-probe motion="none"></motion-probe><motion-probe motion="snappy"></motion-probe><motion-probe motion="smooth"></motion-probe>'),
  ).toEqual([
    { duration: '0s', scroll: 'auto' },
    { duration: '0.08s', scroll: 'smooth' },
    { duration: '0.25s', scroll: 'smooth' },
  ]);
});

test('the property switches it live', async ({ page }) => {
  const result = await page.evaluate(() => {
    const el = document.createElement('motion-probe') as any;
    document.body.appendChild(el);
    el.motion = 'none';
    const off = (window as any).readProbe(el).duration;
    el.motion = 'auto';
    return { off, back: (window as any).readProbe(el).duration, attr: el.hasAttribute('data-motion') };
  });
  expect(result).toEqual({ off: '0s', back: '0.15s', attr: false });
});

test('window.components.motion applies page-wide; the element\'s own level wins', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).core.getPageMotion(); // publishes the accessor
    window.components!.motion = 'none';
  });
  expect(await probes(page, '<motion-probe></motion-probe><motion-probe motion="smooth"></motion-probe>')).toEqual([
    { duration: '0s', scroll: 'auto' },
    { duration: '0.25s', scroll: 'smooth' },
  ]);
});

test('data-motion on a section — no base-css-variables needed; the element\'s own level still wins', async ({ page }) => {
  expect(
    await probes(page, '<section data-motion="snappy"><motion-probe></motion-probe><motion-probe motion="none"></motion-probe></section>'),
  ).toEqual([
    { duration: '0.08s', scroll: 'smooth' },
    { duration: '0s', scroll: 'auto' },
  ]);
});

test('nested levels: the nearest data-motion wins for speed AND scrolling', async ({ page }) => {
  expect(
    await probes(
      page,
      '<section data-motion="none"><div data-motion="smooth"><motion-probe></motion-probe></div></section>' +
        '<section data-motion="smooth"><div data-motion="none"><motion-probe></motion-probe></div></section>',
    ),
  ).toEqual([
    { duration: '0.25s', scroll: 'smooth' }, // smooth inside none — scrolling must not stay instant
    { duration: '0s', scroll: 'auto' },
  ]);
});

test('a component nested in another component\'s shadow root', async ({ page }) => {
  expect(await probes(page, '<motion-parent></motion-parent>')).toEqual([{ duration: '0s', scroll: 'auto' }]);
});

test('the OS reduced-motion setting always wins — even over motion="smooth"', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await probes(page, '<motion-probe></motion-probe><motion-probe motion="smooth"></motion-probe><section data-motion="smooth"><motion-probe></motion-probe></section>'),
  ).toEqual([
    { duration: '0s', scroll: 'auto' },
    { duration: '0s', scroll: 'auto' },
    { duration: '0s', scroll: 'auto' },
  ]);
});
