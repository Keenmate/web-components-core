import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// Review 2026-11-03 A-27 (e2e gap of /search, SPEC §12.11): highlight on labels that are
// already trusted HTML — highlightHtml() rendered by a real HTML parser: <mark> lands only in
// text (inside the right element), never in a tag / attribute / entity; the visible text is
// unchanged. Fixture: test/search.html (the module is on window.search).

const render = (page: Page, html: string, term: string, match = 'contains') =>
  page.evaluate(
    ({ html, term, match }) => {
      const s = (window as any).search;
      const active = s.prepareSearchTerm(term, { behavior: 'normalized', match, regex: s.createRegexCompiler() });
      const out = s.highlightHtml(html, active, { behavior: 'normalized', match });
      document.getElementById('results')!.innerHTML = `<li>${out}</li>`;
      return out as string;
    },
    { html, term, match },
  );

const li = (page: Page) => page.locator('#results li');

test.beforeEach(async ({ page }) => {
  await page.goto('/test/search.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('highlightHtml: marks inside the right element, tags / attributes / entities untouched', async ({ page }) => {
  const label = '<b class="okoli" title="Praha okolí">Praha</b> &amp; <i>okolí</i>';
  await render(page, label, 'okoli');
  await expect(li(page)).toHaveText('Praha & okolí'); // the visible text is unchanged
  await expect(li(page).locator('i > mark')).toHaveText('okolí');
  await expect(li(page).locator('mark')).toHaveCount(1); // not in the class / title attributes
  await expect(li(page).locator('b')).toHaveAttribute('class', 'okoli');
  await expect(li(page).locator('b')).toHaveAttribute('title', 'Praha okolí');

  await render(page, label, 'praha');
  await expect(li(page).locator('b > mark')).toHaveText('Praha');
  await expect(li(page).locator('mark')).toHaveCount(1);

  // An entity is one character: "&" marks the whole &amp;, never half of it.
  await render(page, label, '&');
  await expect(li(page).locator('mark')).toHaveText('&');
  await expect(li(page)).toHaveText('Praha & okolí');
});

test('highlightHtml: accent-insensitive across entities; a match spanning a tag is not highlighted', async ({ page }) => {
  await render(page, '<span>&#268;esk&yacute; Krumlov</span>', 'cesky'); // a named entity outside the small table → matches nothing (documented)
  await expect(li(page).locator('mark')).toHaveCount(0);
  await render(page, '<span>&#268;esk&#253; Krumlov</span>', 'cesky');
  await expect(li(page).locator('span > mark')).toHaveText('Český');

  await render(page, 'Pra<b>ha</b>', 'praha');
  await expect(li(page).locator('mark')).toHaveCount(0);
  await expect(li(page)).toHaveText('Praha');

  // Markup in the label is rendered (trusted), not escaped
  await render(page, '<em>Brno</em> &lt;b&gt;', 'brno');
  await expect(li(page).locator('em > mark')).toHaveText('Brno');
  await expect(li(page)).toHaveText('Brno <b>'); // an escaped tag stays text
});
