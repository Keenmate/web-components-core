import { test, expect } from './fixtures';
import type { Page } from './fixtures';

/**
 * Form association, disabled state, validity (SPEC §6.4 / §6.6) on a real
 * form-associated BlissElement.
 *
 * Covered:
 *   - FO01 el.form honours form="id"; light-DOM hidden inputs submit (inside + form="id"
 *     outside); the component's own formResetCallback; delegated change sees target.form
 *   - FO02 isDisabled reflects; a disabled <fieldset> never writes isDisabled;
 *     disabledChanged fires only on effective flips; a disabled field drops out of FormData;
 *     a non-reflecting isDisabled on a form-associated class warns once per class
 *   - FO03 setFormatError marks :invalid / customError and blocks submit unless novalidate;
 *     message from Error / string / explicit / fallback; a foreign anchor is rejected (warn);
 *     null clears; a non-form-associated element answers "no constraint" and el.form === null
 *     even inside a <form>
 *
 * Fixture: test/forms.html
 */

const PAGE = '/test/forms.html';

type Field = HTMLElement & {
  form: HTMLFormElement | null;
  isDisabled: boolean;
  hooks: string[];
  inner?: HTMLInputElement;
  hiddenInput?: HTMLInputElement;
  disabledState: { isFormDisabled: boolean; isEffectivelyDisabled: boolean };
  validity?: ValidityState;
  validationMessage: string;
  willValidate: boolean;
  checkValidity(): boolean;
  reportValidity(): boolean;
  testSetFormatError(error: unknown, message?: string, anchor?: 'inner' | 'foreign'): void;
  whenSettled(): Promise<void>;
};
type Fx = { events: string[]; entries(form: HTMLFormElement): string; createBad(): string[]; captureConsole(fn: () => void): Array<{ level: string; text: string }> };

const events = (page: Page) => page.evaluate(() => [...(window as unknown as { fx: Fx }).fx.events]);
const formData = (page: Page, formId: string) =>
  page.evaluate((id) => (window as unknown as { fx: Fx }).fx.entries(document.getElementById(id) as HTMLFormElement), formId);
const inner = (page: Page, id: string) => page.locator(`#${id} .inner`);

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('body[data-ready="true"]')).toHaveCount(1);
});

test('FO01: el.form honours form="id"; light-DOM hidden inputs submit; reset; delegated change', async ({ page }) => {
  const forms = await page.evaluate(() =>
    ['f1-in', 'f1-out'].map((id) => {
      const el = document.getElementById(id) as unknown as Field;
      return [el.form?.id ?? null, el.closest('form')?.id ?? null];
    }),
  );
  expect(forms).toEqual([['f1', 'f1'], ['f1', null]]);

  await page.locator('#f1-submit').click();
  expect(await events(page)).toContain('submit #f1 [["qty","3"],["note","hi"],["extra","7"]]');

  // Type into the inside field: change bubbles to the form, e.target.form resolves.
  await inner(page, 'f1-in').fill('42');
  await inner(page, 'f1-out').fill('8');
  expect(await events(page)).toEqual(expect.arrayContaining(['change #f1-in in #f1 · target.form #f1', 'change #f1-out outside · target.form #f1']));
  await page.locator('#f1-submit').click();
  expect((await events(page)).at(-1)).toBe('submit #f1 [["qty","42"],["note","hi"],["extra","8"]]');

  await page.locator('#f1-reset').click();
  expect(await page.evaluate(() => ['f1-in', 'f1-out'].map((id) => (document.getElementById(id) as unknown as Field).hooks))).toEqual([
    ['formResetCallback → "3"'],
    ['formResetCallback → "7"'],
  ]);
  await expect(inner(page, 'f1-in')).toHaveValue('3');
  expect(await formData(page, 'f1')).toBe('[["qty","3"],["note","hi"],["extra","7"]]');
});

test('FO02: isDisabled reflects; fieldset never writes isDisabled; disabledChanged only on flips', async ({ page }) => {
  const state = () =>
    page.evaluate(() => {
      const el = document.getElementById('f2-el') as unknown as Field;
      return {
        isDisabled: el.isDisabled,
        attr: el.hasAttribute('disabled'),
        ...el.disabledState,
        matchesDisabled: el.matches(':disabled'),
        hooks: [...el.hooks],
      };
    });
  const act = (fn: string) =>
    page.evaluate(async (f) => {
      const el = document.getElementById('f2-el') as unknown as Field;
      const fs = document.getElementById('f2-fs') as HTMLFieldSetElement;
      if (f === 'prop') el.isDisabled = !el.isDisabled;
      if (f === 'attr') el.toggleAttribute('disabled');
      if (f === 'fs') fs.disabled = !fs.disabled;
      await el.whenSettled();
    }, fn);

  expect(await state()).toMatchObject({ isDisabled: false, isEffectivelyDisabled: false });
  expect(await formData(page, 'f2')).toBe('[["qty","2"]]');

  await act('prop');
  expect(await state()).toEqual({ isDisabled: true, attr: true, isFormDisabled: false, isEffectivelyDisabled: true, matchesDisabled: true, hooks: ['disabledChanged(true)'] });
  expect(await formData(page, 'f2')).toBe('[]');

  await act('fs'); // fieldset on while own attribute on → no flip
  expect(await state()).toMatchObject({ isFormDisabled: true, isEffectivelyDisabled: true });
  await act('prop'); // own off, fieldset still on → no flip; fieldset never wrote isDisabled
  expect(await state()).toEqual({ isDisabled: false, attr: false, isFormDisabled: true, isEffectivelyDisabled: true, matchesDisabled: true, hooks: ['disabledChanged(true)'] });

  await act('fs'); // fieldset off → flip to enabled
  expect((await state()).hooks).toEqual(['disabledChanged(true)', 'disabledChanged(false)']);
  expect(await formData(page, 'f2')).toBe('[["qty","2"]]');

  await act('attr'); // attribute path → el.isDisabled true
  expect(await state()).toMatchObject({ isDisabled: true, attr: true });
  expect((await state()).hooks).toHaveLength(3);

  const first = await page.evaluate(() => (window as unknown as { fx: Fx }).fx.createBad());
  expect(first.join('\n')).toContain('must have shouldReflect:true on a form-associated element');
  expect(await page.evaluate(() => (window as unknown as { fx: Fx }).fx.createBad())).toEqual([]); // checked once per class
});

test('FO03: setFormatError blocks submit unless novalidate; messages; null clears', async ({ page }) => {
  const v = (id: string) =>
    page.evaluate((i) => {
      const el = document.getElementById(i) as unknown as Field;
      return {
        valid: el.validity?.valid,
        customError: el.validity?.customError,
        message: el.validationMessage,
        invalid: el.matches(':invalid'),
        hidden: el.hiddenInput?.value,
      };
    }, id);
  const setErr = (args: [unknown, string?, ('inner' | 'foreign')?], captureWarn = false) =>
    page.evaluate(
      ([a, cap]) => {
        const { fx } = window as unknown as { fx: Fx };
        const el = document.getElementById('f3-el') as unknown as Field;
        const [kind, msg, anchor] = a as [string | null, string | undefined, 'inner' | 'foreign' | undefined];
        const err = kind === null ? null : kind === 'string' ? 'string error' : kind === 'object' ? {} : new Error('boom');
        if (!cap) {
          el.testSetFormatError(err, msg, anchor);
          return [];
        }
        return fx.captureConsole(() => el.testSetFormatError(err, msg, anchor)).filter((l) => l.level === 'warn').map((l) => l.text);
      },
      [args, captureWarn] as const,
    );

  expect(await v('f3-el')).toMatchObject({ valid: true, customError: false, invalid: false });

  await inner(page, 'f3-el').fill('abc');
  expect(await v('f3-el')).toEqual({ valid: false, customError: true, message: '"abc" is not a whole number', invalid: true, hidden: '' });

  await page.locator('#f3-submit').click();
  let ev = await events(page);
  expect(ev).toContain('invalid #f3-el ""abc" is not a whole number"');
  expect(ev.some((e) => e.startsWith('submit #f3 '))).toBe(false);

  await inner(page, 'f3-nvel').fill('abc');
  await page.locator('#f3-nv-submit').click();
  expect(await events(page)).toContain('submit #f3-nv [["qty",""]]');

  expect(await page.evaluate(() => (document.getElementById('f3-el') as unknown as Field).checkValidity())).toBe(false);

  await setErr(['string']);
  expect((await v('f3-el')).message).toBe('string error');
  await setErr(['error', 'Custom message']);
  expect((await v('f3-el')).message).toBe('Custom message');
  await setErr(['object']);
  expect((await v('f3-el')).message).toBe('The value is invalid.');
  const warns = await setErr(['error', undefined, 'foreign'], true);
  expect(warns.join('\n')).toContain('setFormatError: anchor rejected');
  expect((await v('f3-el')).message).toBe('boom');

  await setErr([null]);
  expect(await v('f3-el')).toMatchObject({ valid: true, customError: false, invalid: false });
  await page.locator('#f3-submit').click();
  ev = await events(page);
  expect(ev.at(-1)).toBe('submit #f3 [["qty",""]]');
});

test('FO03: not form-associated = no constraint; el.form is null even inside a <form>', async ({ page }) => {
  expect(
    await page.evaluate(() => {
      const el = document.getElementById('f3-plain') as unknown as Field;
      return {
        validity: el.validity,
        message: el.validationMessage,
        willValidate: el.willValidate,
        check: el.checkValidity(),
        report: el.reportValidity(),
        form: el.form,
        closest: el.closest('form')?.id,
      };
    }),
  ).toEqual({ validity: undefined, message: '', willValidate: false, check: true, report: true, form: null, closest: 'f3-plain-form' });
});
