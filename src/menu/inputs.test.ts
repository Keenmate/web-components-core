import { describe, it, expect } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { menuPresentationInputs, menuPresentationOptions } from './inputs.js';

class MenuHost extends BlissElement {
  protected static override inputs = [...menuPresentationInputs()];
  /** What the host passes to openMenu(). */
  menuOptions() {
    return menuPresentationOptions(this.config);
  }
}
customElements.define('zz-menu-host', MenuHost);

describe('menuPresentationInputs (the standard menu-host inputs)', () => {
  it('menu-presentation / menu-side parse into the config; defaults auto / start; invalid keeps the previous value', async () => {
    const el = document.createElement('zz-menu-host') as MenuHost & Record<string, unknown>;
    document.body.append(el);
    await el.whenSettled();
    expect(el.menuOptions()).toEqual({ presentation: 'auto', side: 'start' });
    el.setAttribute('menu-presentation', 'drawer');
    el.setAttribute('menu-side', 'end');
    await el.whenSettled();
    expect(el.menuOptions()).toEqual({ presentation: 'drawer', side: 'end' });
    el.setAttribute('menu-presentation', 'sideways');
    await el.whenSettled();
    expect(el.menuPresentation).toBe('drawer');
    el.menuPresentation = 'floating';
    await el.whenSettled();
    expect(el.menuOptions().presentation).toBe('floating');
    el.remove();
  });
});
