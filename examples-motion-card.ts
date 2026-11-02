/**
 * `<core-demo-motion>` — a stand-in for a component that animates through the shared speed tokens,
 * the way every KeenMate component does (`--<prefix>-transition-*: var(--base-duration-*, …)`).
 * A knob slides across a track; `toggle()` moves it. `durations` reads the speed it actually
 * runs at (computed), so the page can show the effect of `motion` / `data-motion` / the OS setting.
 *
 * Its CSS is the element's own shadow CSS; page tokens (--kmwc-*) inherit in. Demo-only — not
 * part of the published package.
 */
import { BlissElement, define, toText } from './src/index.js';
import type { InputDef } from './src/index.js';

export class CoreDemoMotion extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText(), on: 'update' },
  ];

  #labelEl: HTMLElement | null = null;

  protected override reinit(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { display: block; --demo-transition: var(--base-duration-slow, 0.3s); --demo-easing: var(--base-ease-standard, ease); }
        .label { font-size: .85rem; margin-bottom: .35rem; color: var(--kmwc-text-color-2); }
        .track { position: relative; height: 2rem; border-radius: 999px; background: var(--kmwc-elevated-bg, #eef2f7);
                 border: 1px solid var(--kmwc-border-color); }
        .knob { position: absolute; top: .2rem; left: .2rem; width: 1.6rem; height: 1.6rem; border-radius: 50%;
                background: var(--kmwc-accent-color); transition: left var(--demo-transition) var(--demo-easing); }
        :host([data-on]) .knob { left: calc(100% - 1.8rem); }
      </style>
      <div class="label"></div>
      <div class="track"><div class="knob"></div></div>`;
    this.#labelEl = root.querySelector('.label');
    this.update();
  }

  protected override update(): void {
    if (this.#labelEl) this.#labelEl.textContent = String(this.config.label ?? '');
  }

  /** Slide the knob to the other end. */
  toggle(): void {
    this.flush();
    this.toggleAttribute('data-on');
  }

  /** The speed the knob really animates at, and the scroll behaviour a component would use. */
  get durations(): { transition: string; scroll: string } {
    this.flush();
    const knob = this.shadowRoot?.querySelector('.knob');
    return {
      transition: knob ? getComputedStyle(knob).transitionDuration : '',
      scroll: getComputedStyle(this).getPropertyValue('--base-scroll-behavior').trim() || 'smooth (default)',
    };
  }
}

define('core-demo-motion', CoreDemoMotion);
