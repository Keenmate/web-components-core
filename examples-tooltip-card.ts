/**
 * `<tooltip-card>` — a tiny demo web component for eyeballing the core tooltip
 * WITHOUT pulling in one of the five real KM components.
 *
 * It is a genuine `BlissElement`: the public knobs live in a `static inputs`
 * table (so attribute ↔ property ↔ reactivity all come for free), and the
 * tooltip is wired through the documented lifecycle —
 *   - `connect()`    builds the tooltip (a *live* resource: it attaches pointer
 *                    / focus listeners to the host),
 *   - `disconnect()` tears it down,
 *   - `reinit()`     rebuilds it when an `on:'reinit'` input changes while live,
 *     so flipping `follow-cursor` / `placement` / `delay` in the devtools (or via
 *     the example-page controls) reconfigures the tooltip immediately.
 *
 * The host element itself is the tooltip trigger; its light-DOM text is the
 * hover target. Demo-only — not part of the published package (`files` ships
 * `dist/` only).
 */
import { BlissElement, toBool, toEnum, toInt, toText, define } from './src/index.js';
import type { InputDef } from './src/index.js';
import { createTooltip } from './src/positioning/index.js';
import type { Placement, TooltipHandle } from './src/positioning/index.js';

const PLACEMENTS = [
  'top',
  'top-start',
  'top-end',
  'bottom',
  'bottom-start',
  'bottom-end',
  'left',
  'right',
] as const;

export class TooltipCard extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'tooltipText', attribute: 'tooltip-text', converter: toText({ default: 'A core tooltip' }), on: 'reinit' },
    { configKey: 'placement', attribute: 'placement', converter: toEnum(PLACEMENTS, { default: 'top' }), on: 'reinit' },
    { configKey: 'followCursor', attribute: 'follow-cursor', converter: toBool('default-false'), on: 'reinit' },
    { configKey: 'showDelay', attribute: 'show-delay', converter: toInt({ min: 0, default: 400 }), on: 'reinit' },
  ];

  private tip?: TooltipHandle;

  private rebuild(): void {
    this.tip?.destroy();
    const config = this.config as {
      tooltipText: string;
      placement: Placement;
      followCursor: boolean;
      showDelay: number;
    };
    this.tip = createTooltip({
      trigger: this,
      content: config.tooltipText,
      cssClass: 'demo-tt',
      placement: config.placement,
      followCursor: config.followCursor,
      delay: { show: config.showDelay, hide: 0 },
    });
  }

  protected override reinit(): void {
    // Only reconfigure in place while already live; the first build happens in
    // connect(). (reinit() runs before connect() on first connect, when there is
    // no tooltip yet, and on every on:'reinit' change thereafter.)
    if (this.tip) this.rebuild();
  }

  protected override connect(): void {
    this.rebuild();
  }

  protected override disconnect(): void {
    this.tip?.destroy();
    this.tip = undefined;
  }
}

define('tooltip-card', TooltipCard as unknown as CustomElementConstructor);
