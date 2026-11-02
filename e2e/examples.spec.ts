import { test, expect } from './fixtures';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// SMOKE test of the human-facing example site only — nothing behavioural lives here (feature
// specs drive the dedicated fixtures under test/):
//   - the index renders one card per registered page + a version badge;
//   - every examples-*.html loads with no uncaught page error (the pageErrors fixture) and every
//     custom element it uses is defined;
//   - the devkit kit chrome (chapter nav, copy-links, theme switch) is present.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = readdirSync(ROOT).filter((f) => /^examples-.*\.html$/.test(f)).sort();
/** Tags a page deliberately leaves undefined until the user acts (PG01: registerComponent with shouldAutoDefine: false). */
const LAZY_TAGS = ['core-demo-pg-early'];

test('index renders a card per registered page and a version badge', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.kmwc-index__card')).toHaveCount(13);
  await expect(page.locator('[data-kmwc-version]')).toHaveText(/^v\d/);
});

for (const file of PAGES) {
  test(`${file} loads cleanly and its custom elements are defined`, async ({ page }) => {
    await page.goto(`/${file}`);
    await page.waitForLoadState('networkidle');
    const undefinedTags = await page.evaluate(async (lazy) => {
      const tags = new Set<string>();
      const walk = (root: Document | ShadowRoot) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.localName.includes('-')) tags.add(el.localName);
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(document);
      // Give late module definitions a moment, then report what is still undefined.
      await Promise.race([
        Promise.all([...tags].filter((t) => !lazy.includes(t)).map((t) => customElements.whenDefined(t))),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      return [...tags].filter((t) => !lazy.includes(t) && !customElements.get(t));
    }, LAZY_TAGS);
    expect(undefinedTags).toEqual([]);
  });
}

test('example pages get the devkit chapter nav, copy-links and theme switch', async ({ page }) => {
  await page.goto('/examples-tooltip.html');
  await expect(page.locator('.kmwc-chapter-nav')).toHaveCount(1);
  await expect(page.locator('.card h2 .kmwc-copy-link').first()).toBeAttached();
  await expect(page.locator('.kmwc-theme-switch')).toBeVisible();
});
