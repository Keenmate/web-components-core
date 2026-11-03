import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// core /search helpers in a real browser (prepareSearchTerm → matchesSearchTerm →
// findHighlightRanges → wrapRanges):
//   - accent-insensitive 'normalized' matching + <mark> highlight on the original label;
//     'case-insensitive' keeps diacritics significant;
//   - a lazily-passed prepared value is not computed for a regex term;
//   - regex match: one compiler per instance keeps the last valid pattern while typing;
//   - highlight returns NFC text whose ranges wrap correctly (NFD input), and escapes HTML;
//   - getSearchTermCallback: a returned RegExp is used raw (separator-insensitive part numbers);
//     a returned object is unusable for built-in search → no term + onObjectTerm.
//
// Fixture: test/search.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/search.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

type Opts = { term: string; behavior?: string; match?: string; prepare?: string; items?: string[] };
const run = (page: Page, opts: Opts) =>
  page.evaluate((o) => (window as any).runSearch(o) as { kind: string; hits: string[] }, opts);

test('accent-insensitive filter + highlight; case-insensitive keeps diacritics', async ({ page }) => {
  expect((await run(page, { term: 'ces' })).hits).toEqual(['České Budějovice', 'Český Krumlov']);
  await expect(page.locator('#results mark')).toHaveText(['Čes', 'Čes']);

  expect((await run(page, { term: 'lodz' })).hits).toEqual(['Łódź']);
  await expect(page.locator('#results mark')).toHaveText(['Łódź']);
  expect((await run(page, { term: 'lodz', behavior: 'case-insensitive' })).hits).toEqual([]);
  expect((await run(page, { term: 'strasse' })).hits).toEqual(['Straße des 17. Juni']);
});

test('a lazy prepared value is only computed when the term needs it', async ({ page }) => {
  await run(page, { term: 'brno' });
  const afterText = await page.evaluate(() => (window as any).stats.prepared);
  expect(afterText).toBeGreaterThan(0);
  await run(page, { term: '^Br', match: 'regex' });
  expect(await page.evaluate(() => (window as any).stats.prepared)).toBe(afterText); // regex tests the raw value
});

test('regex keeps the last valid pattern while typing', async ({ page }) => {
  expect((await run(page, { term: '^(Ústí|Nové)', match: 'regex' })).hits).toHaveLength(3);
  const partial = await run(page, { term: '^(Ústí|Nové', match: 'regex' }); // invalid mid-typing
  expect(partial.kind).toBe('regex');
  expect(partial.hits).toHaveLength(3);
});

test('highlight renders the returned NFC text; wrapRanges escapes HTML', async ({ page }) => {
  const r = await page.evaluate(() => {
    const s = (window as any).search;
    const opts = { behavior: 'normalized', match: 'contains' };
    const nfd = 'Zli\u0301n'; // decomposed: i + combining acute
    const hl = s.findHighlightRanges(nfd, s.prepareSearchTerm('zli', { ...opts, regex: s.createRegexCompiler() }), opts);
    const label = 'R&D <b>Brno</b>';
    const hl2 = s.findHighlightRanges(label, s.prepareSearchTerm('brno', { ...opts, regex: s.createRegexCompiler() }), opts);
    return {
      text: hl.text,
      ranges: hl.ranges,
      html: s.wrapRanges(hl.text, hl.ranges),
      escaped: s.wrapRanges(hl2.text, hl2.ranges, { escape: (window as any).escapeHtml }),
    };
  });
  expect(r.text).toBe('Zlín'); // NFC
  expect(r.ranges).toEqual([[0, 3]]);
  expect(r.html).toBe('<mark>Zlí</mark>n');
  expect(r.escaped).toBe('R&amp;D &lt;b&gt;<mark>Brno</mark>&lt;/b&gt;');

  await run(page, { term: 'zli' });
  await expect(page.locator('#results mark')).toHaveText(['Zlí']);
});

test('getSearchTermCallback: a RegExp is used raw (separator-insensitive part numbers)', async ({ page }) => {
  const items = ['HA-324/56', 'HA 324-56', 'HA32456', 'ha.324.56', 'HA-324/57', 'HB-324/56', 'XHA-324/56-B'];
  const withCb = await run(page, { term: 'ha-324/56', prepare: 'parts', items });
  expect(withCb.kind).toBe('regex');
  expect(withCb.hits).toEqual(['HA-324/56', 'HA 324-56', 'HA32456', 'ha.324.56', 'XHA-324/56-B']);
  const without = await run(page, { term: 'ha-324/56', items });
  expect(without.hits).toEqual(['HA-324/56', 'XHA-324/56-B']);
});

test('getSearchTermCallback returning an object → no built-in term + onObjectTerm', async ({ page }) => {
  const r = await page.evaluate(() => {
    const s = (window as any).search;
    const seen: unknown[] = [];
    const term = s.prepareSearchTerm('350 02', {
      behavior: 'normalized',
      match: 'contains',
      regex: s.createRegexCompiler(),
      getSearchTermCallback: (t: string) => ({ zip: t.replace(/\s/g, '') }),
      onObjectTerm: (o: unknown) => seen.push(o),
    });
    return { kind: term.kind, seen, lodz: s.normalizeSearchText('Łódź') };
  });
  expect(r.kind).toBe('none');
  expect(r.seen).toEqual([{ zip: '35002' }]);
  expect(r.lodz).toBe('lodz');
});
