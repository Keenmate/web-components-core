import { test, expect } from './fixtures';

test('the facade answers empty before the build, forwards after it, rides on event details, hides the engine', async ({ page }) => {
  await page.goto('/test/controller.html');
  const result = await page.evaluate(async () => {
    type C = { increment(): number; count: number };
    const el = document.getElementById('counter') as HTMLElement & { controller: C; release(): void; whenReady(): Promise<void>; bump(): void };
    const before = { inc: el.controller.increment(), count: el.controller.count };
    el.release();
    await el.whenReady();
    let fromEvent: C | null = null;
    el.addEventListener('changed', (e) => (fromEvent = (e as CustomEvent<{ controller: C }>).detail.controller));
    el.bump();
    return {
      before,
      after: el.controller.count,
      isSame: fromEvent === el.controller,
      keys: Object.keys(el.controller).sort(),
      isFrozen: Object.isFrozen(el.controller),
    };
  });
  expect(result).toEqual({ before: { inc: -1, count: 0 }, after: 1, isSame: true, keys: ['count', 'increment'], isFrozen: true });
});
