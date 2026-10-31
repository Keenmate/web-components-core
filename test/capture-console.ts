/**
 * Test-fixture helper: run `fn` and collect every console line it produced, with the
 * logger's `%c` styling arguments stripped (core's loggers print `%c[TAG:CAT]%c …`).
 * Used by test/forms.html and test/page-wide.html. Dev-server-only.
 */
export interface CapturedLine {
  level: 'debug' | 'info' | 'warn' | 'error' | 'log';
  text: string;
}

const METHODS = ['debug', 'info', 'warn', 'error', 'log'] as const;

export function captureConsole(fn: () => void): CapturedLine[] {
  const lines: CapturedLine[] = [];
  const originals = Object.fromEntries(METHODS.map((m) => [m, console[m]])) as Record<(typeof METHODS)[number], (...a: unknown[]) => void>;
  for (const m of METHODS) {
    console[m] = (...args: unknown[]) => {
      const [first, ...rest] = args;
      const str = (a: unknown) => (a instanceof Error ? a.message : String(a));
      let text: string;
      if (typeof first === 'string' && first.includes('%c')) {
        const cssCount = first.split('%c').length - 1;
        text = `${first.replace(/%c/g, '')} ${rest.slice(cssCount).map(str).join(' ')}`;
      } else text = args.map(str).join(' ');
      lines.push({ level: m, text: text.trim() });
    };
  }
  try {
    fn();
  } finally {
    for (const m of METHODS) console[m] = originals[m];
  }
  return lines;
}
