/**
 * Fixture element + hook log for test/lifecycle.html (e2e/lifecycle.spec.ts).
 *
 * `<fx-lifecycle>` reports every lifecycle hook to a page-wide log ({@link lc}):
 *   - `reinit()`  — rebuilds the shadow DOM (a transient `.lc-text` input and a
 *                   `.lc-click` counter button start over); `shouldThrowNextReinit`
 *                   (a plain field, not an input) makes the NEXT reinit throw once
 *                   (logged as `reinit() threw`).
 *   - `update(partial)`, `connect()`, `disconnect()`, `removedCallback()` (opted in),
 *     `destroyCallback()`.
 * `makeCard(id, attrs)` creates one wired to the `ready` event, the `onReady` twin
 * and `whenReady()` (logged as `ready event` / `onReady twin` / `whenReady()`).
 *
 * Test-only; independent of the examples-*-card.ts demo elements.
 */
import { BlissElement, define, toEnum, toText } from '../src/index.js';
import type { InputDef } from '../src/index.js';

export interface LogEntry {
  el: string;
  hook: string;
  detail?: string;
}

/** The page-wide hook log; `reset()` starts a new action, `hooks()` lists hook names since. */
export const lc = {
  entries: [] as LogEntry[],
  add(el: Element, hook: string, detail?: string): void {
    this.entries.push({ el: el.id, hook, ...(detail !== undefined ? { detail } : {}) });
    const sink = document.getElementById('log');
    if (sink) sink.textContent += `${el.id}: ${hook}${detail ? ` — ${detail}` : ''}\n`;
  },
  reset(): void {
    this.entries = [];
    const sink = document.getElementById('log');
    if (sink) sink.textContent += '— action —\n';
  },
  hooks(): string[] {
    return this.entries.map((e) => e.hook);
  },
};

const ACCENTS = ['blue', 'green', 'amber'] as const;

export class FxLifecycle extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'Lifecycle' }), on: 'reinit' },
    { configKey: 'accent', attribute: 'accent', converter: toEnum(ACCENTS, { default: 'blue' }), on: 'update' },
  ];

  shouldThrowNextReinit = false;
  builds = 0;
  connects = 0;

  protected override reinit(): void {
    const label = this.config.label as string;
    if (this.shouldThrowNextReinit) {
      this.shouldThrowNextReinit = false;
      lc.add(this, 'reinit() threw', `label="${label}"`);
      throw new Error('fixture: reinit() failed');
    }
    this.builds += 1;
    lc.add(this, 'reinit', `label="${label}"`);
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<div class="lc"><span class="lc-label"></span>
      <input class="lc-text" aria-label="transient text"> <button class="lc-click" type="button">clicks: 0</button></div>`;
    shadow.querySelector('.lc-label')!.textContent = label;
    (shadow.querySelector('.lc') as HTMLElement).dataset.accent = this.config.accent as string;
    let clicks = 0;
    const btn = shadow.querySelector('.lc-click') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      clicks += 1;
      btn.textContent = `clicks: ${clicks}`;
    });
  }

  protected override update(partial: Record<string, unknown>): void {
    lc.add(this, 'update', JSON.stringify(partial));
    const box = this.shadowRoot?.querySelector('.lc') as HTMLElement | null;
    if (box && 'accent' in partial) box.dataset.accent = partial.accent as string;
  }

  protected override connect(): void {
    this.connects += 1;
    lc.add(this, 'connect');
  }

  protected override disconnect(): void {
    lc.add(this, 'disconnect');
  }

  protected override removedCallback(): void {
    lc.add(this, 'removedCallback');
  }

  protected override destroyCallback(): void {
    lc.add(this, 'destroyCallback');
  }
}

define('fx-lifecycle', FxLifecycle as unknown as CustomElementConstructor);

type Card = FxLifecycle & Record<string, any>;

/** Every card made by {@link makeCard}, by id — so a spec can reach a detached one. */
export const cards = new Map<string, Card>();

/** Create an `<fx-lifecycle>` wired to the ready event, the onReady twin and whenReady(). */
export function makeCard(id: string, attrs: Record<string, string> = {}): Card {
  const el = document.createElement('fx-lifecycle') as Card;
  el.id = id;
  cards.set(id, el);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.addEventListener('ready', (e) => lc.add(el, 'ready event', `detail.element === el: ${(e as CustomEvent).detail?.element === el}`));
  el.onReady = () => lc.add(el, 'onReady twin');
  void el.whenReady().then(() => lc.add(el, 'whenReady()'));
  return el;
}
