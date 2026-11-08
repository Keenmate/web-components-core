import { test, expect } from './fixtures';

// Upgrade order in a real browser (review 2026-11-03, WP3): the custom-element reaction
// queue — constructor, the replay of the initial attributes, connectedCallback,
// formDisabledCallback — is browser behaviour jsdom only approximates.
//
// Fixture: test/upgrade.html (exposes core on window.core)

test.beforeEach(async ({ page }) => {
  await page.goto('/test/upgrade.html');
  await page.locator('body[data-ready]').waitFor({ state: 'attached' });
});

test('properties assigned before upgrade win over the initial attributes; core properties too', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { BlissElement, define, toText } = (window as any).core;
    class PreUpgrade extends BlissElement {
      static inputs = [{ configKey: 'label', attribute: 'label', converter: toText({ default: '' }) }];
    }
    document.body.insertAdjacentHTML('beforeend', '<pre-upgrade-el label="markup"></pre-upgrade-el>');
    const el = document.querySelector('pre-upgrade-el') as any;
    let readyDetail: unknown = 'not fired';
    el.label = 'property';
    el.motion = 'none';
    el.themeSource = 'body';
    el.onReady = (detail: unknown) => (readyDetail = detail === undefined ? 'fired' : 'fired');
    define('pre-upgrade-el', PreUpgrade);
    await el.whenReady();
    return {
      label: el.label,
      motion: el.motion,
      motionAttr: el.getAttribute('motion'),
      themeSourceAttr: el.getAttribute('theme-source'),
      readyDetail,
      isReadyState: el.matches(':state(ready)'),
    };
  });
  expect(result).toEqual({
    label: 'property',
    motion: 'none',
    motionAttr: 'none',
    themeSourceAttr: 'body',
    readyDetail: 'fired',
    isReadyState: true,
  });
});

test('a setAttribute() after upgrade but before the first connect still applies', async ({ page }) => {
  const label = await page.evaluate(() => {
    const { BlissElement, define, toText } = (window as any).core;
    class Detached extends BlissElement {
      static inputs = [{ configKey: 'label', attribute: 'label', converter: toText({ default: '' }) }];
    }
    const el = document.createElement('detached-upgrade-el') as any;
    el.label = 'property';
    el.setAttribute('label', 'markup');
    define('detached-upgrade-el', Detached);
    customElements.upgrade(el);
    el.setAttribute('label', 'later');
    return el.label;
  });
  expect(label).toBe('later');
});

test('appended into a <fieldset disabled>: the first build already sees it disabled, and update() never runs first', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { BlissElement, define, toBool } = (window as any).core;
    const calls: string[] = [];
    class Fielded extends BlissElement {
      static formAssociated = true;
      static inputs = [{ configKey: 'isDisabled', attribute: 'disabled', converter: toBool('presence'), default: false, shouldReflect: true }];
      reinit() {
        calls.push(`reinit:${this.isEffectivelyDisabled}`);
      }
      update() {
        calls.push('update');
      }
      disabledChanged(isDisabled: boolean) {
        calls.push(`disabledChanged:${isDisabled}`);
      }
    }
    define('fielded-el', Fielded);
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    document.body.appendChild(fieldset);
    fieldset.appendChild(document.createElement('fielded-el'));
    return calls;
  });
  expect(result[0]).toBe('reinit:true');
  expect(result).not.toContain('update');
});

test('the component\'s own accessors (value, items) assigned before upgrade reach their setters before the first build', async ({ page }) => {
  // A string, so Playwright doesn't transpile the #private field the setter writes (the real case:
  // a setter that needs the subclass constructed).
  const result = await page.evaluate(`(async () => {
    const { BlissElement, define } = window.core;
    class OwnValue extends BlissElement {
      #value = [];
      built = null;
      get value() { return this.#value; }
      set value(v) { this.#value = v; }
      reinit() { this.built = [...this.#value]; }
    }
    document.body.insertAdjacentHTML('beforeend', '<own-value-el></own-value-el>');
    const el = document.querySelector('own-value-el');
    el.value = ['cz', 'sk'];
    define('own-value-el', OwnValue);
    await el.whenReady();
    return { value: el.value, built: el.built, isShadowed: Object.prototype.hasOwnProperty.call(el, 'value') };
  })()`);
  expect(result).toEqual({ value: ['cz', 'sk'], built: ['cz', 'sk'], isShadowed: false });
});
