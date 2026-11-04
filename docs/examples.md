# Examples — @keenmate/web-components-core

Worked patterns beyond the README's quick start. Every snippet type-checks against the current
source. The live demo site (`npm run dev`, http://localhost:15000) has a page per area; each
chapter (IN01, LC02, …) runs the code it shows on small demo elements:

| Page | What it shows |
|---|---|
| [`examples-inputs.html`](../examples-inputs.html) | IN · reactive inputs: converters, invalid values, reflection, update vs reinit, batching / `whenSettled` / `flush` |
| [`examples-lifecycle.html`](../examples-lifecycle.html) | LC · reinit / connect / ready, `defer` + `release()`, DOM moves, `destroy()` |
| [`examples-responsive.html`](../examples-responsive.html) | RS · environment snapshot, `classifyDevice`, `resolvePresentation`, responsive rules |
| [`examples-interaction.html`](../examples-interaction.html) | IA · `emit()` and `on*` twins, `before*Callback`, actions, the shared menu |
| [`examples-forms.html`](../examples-forms.html) | FO · form-associated elements, disabled state, constraint validation |
| [`examples-page.html`](../examples-page.html) | PG · `window.components`, logging switches, the loader hook, style injection |
| [`examples-tooltip.html`](../examples-tooltip.html) | TT · `createTooltip()` |
| [`examples-popover.html`](../examples-popover.html) | PO · `createPopover()` |
| [`examples-anchor.html`](../examples-anchor.html) | AN · the `anchor()` primitive |
| [`examples-nullclear.html`](../examples-nullclear.html) | NC · the null-clear contract |
| [`examples-theme.html`](../examples-theme.html) | TH · theme context |
| [`examples-search.html`](../examples-search.html) | SE · search normalization, match modes, highlighting |
| [`examples-scroll.html`](../examples-scroll.html) | SC · `scrollIntoContainer()` |
| [`examples-motion.html`](../examples-motion.html) | MO · motion level |

The full API behind each pattern is in [usage.md](usage.md).

## A component with typed events and global registration

The event table declares the outward notifications; `emit()` dispatches them and every event gets
an `on<Name>` twin property (`el.onSelect = (detail) => …`). `registerComponent()` defines the tag
and publishes `window.components['color-picker']` (version, instances, logging switches).

```ts
import { BlissElement, registerComponent, createLoggers, toText, type InputDef } from '@keenmate/web-components-core';

type PickerEvents = { select: { value: string } };

class ColorPicker extends BlissElement<PickerEvents> {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'value', attribute: 'value', converter: toText({ isNullable: true }), on: 'update', shouldReflect: true },
  ];
  protected static override events = ['select'];

  pick(value: string): void {
    this.setAttributes({ value });
    this.emit('select', { value });
  }
}

registerComponent('color-picker', ColorPicker, {
  config: { name: '@acme/color-picker', version: '1.0.0', author: 'Acme' },
  logging: createLoggers('COLORPICKER'),
});
```

```js
const picker = document.querySelector('color-picker');
picker.addEventListener('select', (e) => console.log(e.detail.value));
picker.onSelect = ({ value }) => console.log(value);          // the twin
window.components['color-picker'].getInstances();             // every live picker on the page
```

## A floating panel that becomes a modal on a tablet

`environmentChanged()` fires with the current snapshot on connect and again on every device /
viewport / orientation change. `resolvePresentation()` keeps the shared defaults (phone →
fullscreen, desktop → floating) and changes only the classes you list.

```ts
import { BlissElement, define, resolvePresentation, toText, type EnvironmentSnapshot, type InputDef } from '@keenmate/web-components-core';

class SheetPicker extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'presentation', attribute: 'presentation', converter: toText({ default: 'auto' }), on: 'update' },
  ];

  protected override environmentChanged(env: EnvironmentSnapshot): void {
    const mode = this.config.presentation as 'auto' | 'floating' | 'modal' | 'fullscreen';
    this.dataset.presentation = resolvePresentation(mode, env, { tablet: 'modal' });
  }
}
define('sheet-picker', SheetPicker);
```

Width-aware rules, and the page / per-tag responsive maps that apps set without touching the
component, are in [usage.md → Environment & presentation](usage.md#environment--presentation-device--viewport--orientation).

## A dropdown and a context menu

`createPopover()` portals the panel, matches the reference's width and keeps it anchored while
open; `shouldCloseOnEscape` joins the page-wide overlay tree, so Escape closes the deepest open
overlay only. `openMenu()` renders `/actions` entries with the WAI-ARIA menu keyboard (see
[accessibility.md](accessibility.md)).

```ts
import { createPopover } from '@keenmate/web-components-core/positioning';
import { openMenu } from '@keenmate/web-components-core/menu';

const dropdown = createPopover({ reference: input, panel, matchWidth: 'min', shouldCloseOnEscape: true });
input.addEventListener('focus', () => dropdown.open());

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  openMenu(
    [{ id: 'copy', text: 'Copy', shortcut: 'C' }, { id: 'delete', text: 'Delete', isDanger: true }],
    {},
    { at: { x: event.clientX, y: event.clientY }, host: document.body, runAction: (item) => console.log(item.id) },
  );
});
```

## Testing a component

The `/testing` fixtures are pure DOM (vitest + jsdom or a real browser); `await el.whenSettled()`
waits for the reactive pipeline.

```ts
import { mount, cleanup, listen, uniqueTag, defineOnce } from '@keenmate/web-components-core/testing';

afterEach(cleanup);

it('emits select when picked', async () => {
  const tag = defineOnce(uniqueTag(), ColorPicker);
  const el = mount<ColorPicker>(`<${tag}></${tag}>`);
  const spy = listen(el, 'select');
  el.pick('red');
  await el.whenSettled();
  expect(spy.lastDetail).toEqual({ value: 'red' });
});
```

## Batching many changes

`setAttributes()` and `batch()` turn many writes into one `reinit()` / `update()`; the full model
(how many times a component rebuilds, and why) is in
[reactivity-and-batching.md](reactivity-and-batching.md).

```js
const rejected = el.setAttributes({ label: 'Total', count: 3 }); // one update; refused values come back
el.batch(() => { el.label = 'Total'; el.count = 3; });
await el.whenSettled();
```
