import { test, expect } from './fixtures';

// Which CSS makes an ancestor the containing block of a `position: fixed` panel — and does core's
// getFixedPositionOffsetParent() agree with the browser? (review D-23)
//   - contain: paint | layout | strict | content and content-visibility: auto DO trap fixed descendants;
//   - container-type and contain: size | style do NOT (Floating UI's default counts container-type);
//   - the same in light DOM and across a shadow boundary.
// Measured identically in Chromium 156, Firefox 157 and WebKit 27 when the decision was made.
//
// Fixture: test/containing-block.html

test.beforeEach(async ({ page }) => {
  await page.goto('/test/containing-block.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

const CASES: Array<[css: string, isTrapping: boolean]> = [
  ['transform: translateX(0)', true],
  ['contain: paint', true],
  ['contain: layout', true],
  ['contain: strict', true],
  ['contain: content', true],
  ['content-visibility: auto', true],
  ['contain: size', false],
  ['contain: style', false],
  ['container-type: inline-size', false],
  ['container-type: size', false],
];

for (const [css, isTrapping] of CASES) {
  test(`${css}: ${isTrapping ? 'traps' : 'does not trap'} a fixed child, and core agrees`, async ({ page }) => {
    const result = await page.evaluate((c) => (window as any).probe(c), css);
    expect(result).toEqual({ lightTrapped: isTrapping, shadowTrapped: isTrapping, coreLight: isTrapping, coreShadow: isTrapping });
  });
}
