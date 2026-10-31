/**
 * Fixture elements for test/inputs.html (e2e/inputs.spec.ts).
 *
 *   - `<fx-inputs>` — one input per converter type (toText, toInt, toBool, toEnum,
 *     toList, toFunction), reflected and non-reflected rows; renders `.label`,
 *     `.count` and a `.chip` (class `compact` when isCompact) into its shadow root.
 *   - `captureWarnings(fn)` — runs `fn` and returns the console.warn lines it
 *     produced (`%c` styling stripped), so the spec can assert core's
 *     invalid-value warnings without parsing console prose from the page.
 *
 * Test-only; independent of the examples-*-card.ts demo elements.
 */
import { BlissElement, define, toBool, toEnum, toFunction, toInt, toList, toText } from '../src/index.js';
import type { InputDef } from '../src/index.js';

export type FormatLabelCallback = (label: string, count: number) => string;

export class FxInputs extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'label', attribute: 'label', converter: toText({ default: 'Inbox' }), shouldReflect: true },
    { configKey: 'count', attribute: 'count', converter: toInt({ min: 0, max: 10, default: 3 }), shouldReflect: true },
    { configKey: 'limit', attribute: 'limit', converter: toInt({ min: 1, max: 100, default: 50 }) },
    { configKey: 'isCompact', attribute: 'compact', converter: toBool('presence'), shouldReflect: true },
    {
      configKey: 'tone',
      attribute: 'tone',
      converter: toEnum(['info', 'success', 'warning'] as const, { default: 'info' }),
      shouldReflect: true,
    },
    { configKey: 'tags', attribute: 'tags', converter: toList({ default: ['mail', 'work'] }), shouldReflect: true },
    { configKey: 'formatLabelCallback', converter: toFunction<FormatLabelCallback>(), default: null },
  ];

  #root?: ShadowRoot;

  #render(): void {
    const root = (this.#root ??= this.attachShadow({ mode: 'open' }));
    const c = this.config as {
      label: string;
      count: number;
      isCompact: boolean;
      formatLabelCallback: FormatLabelCallback | null;
    };
    root.innerHTML = '<span class="chip"><span class="label"></span> <span class="count"></span></span>';
    root.querySelector('.chip')!.classList.toggle('compact', c.isCompact);
    root.querySelector('.label')!.textContent = c.formatLabelCallback ? c.formatLabelCallback(c.label, c.count) : c.label;
    root.querySelector('.count')!.textContent = String(c.count);
  }

  protected override reinit(): void {
    this.#render();
  }

  protected override update(): void {
    this.#render();
  }
}

/** Run `fn` and collect the console.warn lines it produced (`%c` styling stripped). */
export function captureWarnings(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    original.apply(console, args);
    const [first, ...rest] = args;
    if (typeof first === 'string' && first.includes('%c')) {
      const cssCount = first.split('%c').length - 1;
      lines.push(`${first.replace(/%c/g, '')} ${rest.slice(cssCount).map(String).join(' ')}`.trim());
    } else lines.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

define('fx-inputs', FxInputs as unknown as CustomElementConstructor);
