/**
 * `<core-demo-lifecycle>` — a tiny demo `BlissElement` for the lifecycle page
 * (examples-lifecycle.html, SPEC §6.3 / §6.5 and the lifecycle section of the README).
 *
 * Every hook reports itself to a page-supplied sink ({@link setHookSink}) so the
 * page can draw a timeline:
 *   - `reinit()`          renders the whole shadow DOM (a REBUILD — typed text and
 *                         the click counter start over),
 *   - `update(partial)`   patches the accent class in place (no re-render),
 *   - `connect()` / `disconnect()`  count activations (the live side),
 *   - `removedCallback()` overridden = opted in: fires only when still detached at
 *                         the next animation frame,
 *   - `destroyCallback()` marks the card as destroyed.
 *
 * `shouldThrowNextReinit` (a plain demo field, not an input) makes the NEXT
 * `reinit()` throw once — the hook-error demo (LC06).
 *
 * Demo-only — not part of the published package (`files` ships `dist/` only).
 */
import { BlissElement, define, toEnum, toText } from './src/index.js';
import type { InputDef } from './src/index.js';

export type HookName =
  | 'reinit'
  | 'reinit-threw'
  | 'update'
  | 'connect'
  | 'disconnect'
  | 'removedCallback'
  | 'destroyCallback';

export type HookSink = (el: LifecycleCard, hook: HookName, detail?: string) => void;

let sink: HookSink | null = null;

/** Route every hook call of every `<core-demo-lifecycle>` to `fn` (the page's timeline). */
export function setHookSink(fn: HookSink | null): void {
  sink = fn;
}

const ACCENTS = ['blue', 'green', 'amber'] as const;

const STYLES = `
  :host { display: inline-block; vertical-align: top; }
  .lc { min-width: 13rem; border-radius: 10px; padding: .6rem .8rem; font: 500 .88rem system-ui, sans-serif;
        background: light-dark(#ffffff, #1e293b); color: light-dark(#0f172a, #e2e8f0);
        border: 1px solid light-dark(#cbd5e1, #334155); border-left-width: 5px; }
  .lc.accent-blue  { border-left-color: #3b82f6; }
  .lc.accent-green { border-left-color: #22c55e; }
  .lc.accent-amber { border-left-color: #f59e0b; }
  .lc-head { display: flex; gap: .5rem; align-items: center; justify-content: space-between; }
  .lc-label { font-weight: 700; }
  .lc-pill { font: 600 .7rem ui-monospace, monospace; padding: .1rem .45rem; border-radius: 999px;
             background: light-dark(#e2e8f0, #334155); color: light-dark(#475569, #cbd5e1); }
  /* :state(ready) — the CustomStateSet hook core sets after the first build. */
  :host(:state(ready)) .lc-ready { background: #dcfce7; color: #166534; }
  .lc-meta { margin-top: .3rem; font: .75rem ui-monospace, monospace; color: light-dark(#64748b, #94a3b8); }
  .lc-row { display: flex; gap: .4rem; margin-top: .45rem; }
  .lc-row input { flex: 1; min-width: 0; font: inherit; padding: .2rem .4rem; }
  .lc-row button { font: inherit; padding: .2rem .5rem; cursor: pointer; }
  .lc.is-destroyed { opacity: .5; filter: grayscale(1); }
  .lc.is-destroyed .lc-label::after { content: ' (destroyed)'; font-weight: 500; }
`;

export class LifecycleCard extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'Lifecycle demo' }), on: 'reinit' },
    { configKey: 'accent', attribute: 'accent', converter: toEnum(ACCENTS, { default: 'blue' }), on: 'update' },
  ];

  /** Demo knob (not an input): the next `reinit()` throws once, then clears itself. */
  shouldThrowNextReinit = false;

  /** How many times `reinit()` completed — the "build #" pill. */
  builds = 0;
  /** How many times `connect()` ran. */
  connects = 0;

  #root?: HTMLElement;
  #clicks = 0;

  #log(hook: HookName, detail?: string): void {
    sink?.(this, hook, detail);
  }

  #meta(state: string): void {
    const meta = this.#root?.querySelector('.lc-meta');
    if (meta) meta.textContent = `build #${this.builds} · connects ${this.connects} · ${state}`;
  }

  protected override reinit(): void {
    const label = this.config.label as string;
    if (this.shouldThrowNextReinit) {
      this.shouldThrowNextReinit = false;
      this.#log('reinit-threw', `label="${label}"`);
      throw new Error('demo: reinit() failed');
    }
    this.builds += 1;
    this.#log('reinit', `build #${this.builds}, label="${label}"`);
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="lc accent-${this.config.accent as string}" part="card">
        <div class="lc-head"><span class="lc-label"></span><span class="lc-pill lc-ready">ready</span></div>
        <div class="lc-meta"></div>
        <div class="lc-row">
          <input class="lc-text" placeholder="type here (transient)" aria-label="transient text">
          <button class="lc-click" type="button">clicks: 0</button>
        </div>
      </div>`;
    this.#root = shadow.querySelector('.lc') as HTMLElement;
    (shadow.querySelector('.lc-label') as HTMLElement).textContent = label;
    this.#clicks = 0;
    const btn = shadow.querySelector('.lc-click') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      this.#clicks += 1;
      btn.textContent = `clicks: ${this.#clicks}`;
    });
    this.#meta(this.isConnected ? 'building' : 'detached');
  }

  protected override update(partial: Record<string, unknown>): void {
    this.#log('update', JSON.stringify(partial));
    if ('accent' in partial && this.#root) {
      for (const a of ACCENTS) this.#root.classList.toggle(`accent-${a}`, a === partial.accent);
    }
  }

  protected override connect(): void {
    this.connects += 1;
    this.#log('connect', `connect #${this.connects}`);
    this.#meta('active');
  }

  protected override disconnect(): void {
    this.#log('disconnect');
    this.#meta('inactive');
  }

  protected override removedCallback(): void {
    this.#log('removedCallback', 'still detached at the next frame');
  }

  protected override destroyCallback(): void {
    this.#log('destroyCallback');
    this.#root?.classList.add('is-destroyed');
    this.#meta('destroyed');
  }
}

define('core-demo-lifecycle', LifecycleCard as unknown as CustomElementConstructor);
