import { test, expect } from './fixtures';

// examples-forms.html — form association, disabled state, validity (SPEC §6.4 / §6.6).
// <core-demo-field> is a real form-associated BlissElement; these specs assert the
// readouts/logs the page shows, so the page can't drift from core's behaviour.

const PAGE = '/examples-forms.html';

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForFunction(() => customElements.get('core-demo-field') !== undefined);
});

test('FO01: el.form honours form="id"; light-DOM hidden inputs submit; reset; delegated change', async ({ page }) => {
  const readout = page.locator('#fo01-readout');
  await expect(readout).toContainText(/demo-fo01-in\s+form #do-fo01-form · closest\('form'\) #do-fo01-form/);
  await expect(readout).toContainText(/demo-fo01-out\s+form #do-fo01-form · closest\('form'\) null/);

  await page.locator('#fo01-submit').click();
  await expect(page.locator('#fo01-log')).toContainText('submit → FormData [["qty","3"],["note","hi"],["extra","7"]]');

  // Type into the inside field: change bubbles to the form, e.target.form resolves.
  await page.locator('#demo-fo01-in .inner').fill('42');
  await expect(page.locator('#fo01-log')).toContainText('change on <core-demo-field> · e.target.form === form: true');
  await page.locator('#demo-fo01-out .inner').fill('8');
  await expect(page.locator('#fo01-log')).toContainText('change on #demo-fo01-out (outside) · e.target.form === form: true');
  await page.locator('#fo01-submit').click();
  await expect(page.locator('#fo01-log')).toContainText('[["qty","42"],["note","hi"],["extra","8"]]');

  await page.locator('#fo01-reset').click();
  await expect(page.locator('#fo01-log')).toContainText('demo-fo01-in: formResetCallback() value → "3"');
  await expect(page.locator('#fo01-log')).toContainText('demo-fo01-out: formResetCallback() value → "7"');
  await expect(page.locator('#demo-fo01-in .inner')).toHaveValue('3');
});

test('FO02: isDisabled reflects; fieldset never writes isDisabled; disabledChanged only on flips', async ({ page }) => {
  const readout = page.locator('#fo02-readout');
  const log = page.locator('#fo02-log');
  const el = page.locator('#demo-fo02-el');
  await expect(readout).toContainText('isEffectivelyDisabled false');
  await expect(readout).toContainText('FormData [["qty","2"]]');

  await page.locator('#fo02-prop').click();
  await expect(el).toHaveAttribute('disabled', '');
  await expect(readout).toContainText('isFormDisabled false · isEffectivelyDisabled true · :disabled true');
  await expect(readout).toContainText('FormData []');
  await expect(log.locator('.hook')).toHaveText(['disabledChanged(true)']);

  await page.locator('#fo02-fs').click(); // fieldset on while own attribute on → no flip
  await expect(readout).toContainText('isFormDisabled true · isEffectivelyDisabled true');
  await page.locator('#fo02-prop').click(); // own off, fieldset still on → no flip
  await expect(readout).toContainText('el.isDisabled false · [disabled] false · fieldset.disabled true');
  await expect(readout).toContainText('isEffectivelyDisabled true · :disabled true');
  await expect(log.locator('.hook')).toHaveCount(1);

  await page.locator('#fo02-fs').click(); // fieldset off → flip to enabled
  await expect(log.locator('.hook')).toHaveText(['disabledChanged(true)', 'disabledChanged(false)']);
  await expect(readout).toContainText('FormData [["qty","2"]]');

  await page.locator('#fo02-attr').click(); // attribute path → el.isDisabled true
  await expect(readout).toContainText('el.isDisabled true · [disabled] true');
  await expect(log.locator('.hook')).toHaveCount(3);

  await page.locator('#fo02-bad').click();
  await expect(log.locator('.warn')).toContainText('must have shouldReflect:true on a form-associated element');
  await page.locator('#fo02-bad').click();
  await expect(log).toContainText('checked once per class');
});

test('FO03: setFormatError blocks submit unless novalidate; messages; null clears; plain = no constraint', async ({ page }) => {
  const log = page.locator('#fo03-log');
  const readout = page.locator('#fo03-readout');
  await expect(readout).toContainText('validity.valid true');
  await expect(page.locator('#fo03-plain-readout')).toContainText('validity.valid undefined');
  await expect(page.locator('#fo03-plain-readout')).toContainText('willValidate false');
  await expect(page.locator('#fo03-plain-readout')).toContainText('checkValidity() true · reportValidity() true');

  await page.locator('#demo-fo03-el .inner').fill('abc');
  await expect(readout).toContainText('validity.valid false · customError true');
  await expect(readout).toContainText('validationMessage "\\"abc\\" is not a whole number"');
  await expect(readout).toContainText(':invalid true');
  await expect(readout).toContainText('hidden value ""');

  await page.locator('#fo03-submit').click();
  await expect(log).toContainText(`'invalid' event on #demo-fo03-el`);
  await expect(log).not.toContainText(`'submit' on #do-fo03-form`);

  await page.locator('#demo-fo03-nvel .inner').fill('abc');
  await page.locator('#fo03-nv-submit').click();
  await expect(log).toContainText(`'submit' on #do-fo03-nv → FormData [["qty",""]]`);

  await page.locator('#fo03-check').click();
  await expect(log.locator('div').last()).toHaveText('→ false');

  await page.locator('#fo03-str').click();
  await expect(readout).toContainText('validationMessage "string error"');
  await page.locator('#fo03-msg').click();
  await expect(readout).toContainText('validationMessage "Custom message"');
  await page.locator('#fo03-obj').click();
  await expect(readout).toContainText('validationMessage "The value is invalid."');
  await page.locator('#fo03-foreign').click();
  await expect(log.locator('.warn').last()).toContainText('setFormatError: anchor rejected');
  await expect(readout).toContainText('validationMessage "boom"');

  await page.locator('#fo03-null').click();
  await expect(readout).toContainText('validity.valid true · customError false');
  await page.locator('#fo03-submit').click();
  await expect(log).toContainText(`'submit' on #do-fo03-form → FormData [["qty",""]]`);
});
