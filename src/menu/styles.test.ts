import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MENU_CSS } from './styles.js';

interface Row {
  name: string;
}
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'component-variables.manifest.json'), 'utf8')) as {
  prefix: string;
  baseVariables: Row[];
  componentVariables: Row[];
};

const names = (re: RegExp): Set<string> => new Set([...MENU_CSS.matchAll(re)].map((m) => m[1]!));
const sorted = (s: Iterable<string>): string[] => [...s].sort();

describe('MENU_CSS variable chain (SPEC §12.13)', () => {
  it('every public --km-menu-* read is wrapped by its private --_km-menu-* layer', () => {
    const publicReads = [...MENU_CSS.matchAll(/var\(--km-menu-([a-z0-9-]+)/g)];
    expect(publicReads.length).toBeGreaterThan(20);
    for (const m of publicReads) {
      const name = m[1]!;
      const before = MENU_CSS.slice(0, m.index);
      expect(before.endsWith(`var(--_km-menu-${name}, `), `--km-menu-${name}`).toBe(true);
    }
    // ...and no private read lacks the public layer behind it.
    for (const m of MENU_CSS.matchAll(/var\(--_km-menu-([a-z0-9-]+), /g)) {
      expect(MENU_CSS.startsWith(`var(--km-menu-${m[1]}`, m.index + m[0].length)).toBe(true);
    }
  });

  it('uses the exact 3-layer form: private → public → --base-* → default', () => {
    expect(MENU_CSS).toContain(
      'background: var(--_km-menu-bg, var(--km-menu-bg, var(--base-dropdown-bg, var(--base-elevated-bg, var(--base-main-bg, light-dark(#ffffff, #2b2b2b))))));',
    );
    expect(MENU_CSS).toContain('min-width: var(--_km-menu-min-width, var(--km-menu-min-width, 160px));');
    expect(MENU_CSS).toContain('color: var(--_km-menu-hover-color, var(--km-menu-hover-color));');
  });

  it('component-variables.manifest.json lists exactly the variables the stylesheet reads', () => {
    expect(manifest.prefix).toBe('km');
    expect(sorted(manifest.componentVariables.map((r) => r.name))).toEqual(sorted(names(/var\(--(km-menu-[a-z0-9-]+)/g)));
    expect(sorted(manifest.baseVariables.map((r) => r.name))).toEqual(sorted(names(/var\(--(base-[a-z0-9-]+)/g)));
  });
});
