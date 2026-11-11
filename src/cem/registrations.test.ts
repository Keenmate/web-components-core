import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ts from 'typescript';
import { extractBlissClasses, extractRegistrations, type ModuleReader } from './extract.js';
import { blissInputsPlugin } from './plugin.js';

// web-grid CEM adoption: `registerComponent('web-grid', _GridElement)` with the class imported
// under an alias produced "No components found" — the class must be matched by its DECLARED name.

const files: Record<string, string> = {
  'src/grid.ts': `export class GridElement extends BlissElement { static inputs = [{ configKey: 'label', attribute: 'label', converter: toText() }]; }`,
  'src/barrel.ts': `export { GridElement as PublicGrid } from './grid.js';`,
  'src/star.ts': `export * from './grid.js';`,
  'src/default.ts': `export default class DefaultGrid extends BlissElement {}`,
  'src/rows.ts': `export { SHARED_ROWS as ROWS } from './rows-impl.js';`,
  'src/rows-impl.ts': `export const SHARED_ROWS = [{ configKey: 'for', attribute: 'for', converter: toText() }];`,
};
const source = (path: string) => ts.createSourceFile(path, files[path]!, ts.ScriptTarget.Latest, true);
const readModule: ModuleReader = (_from, specifier) => {
  const path = `src/${specifier.replace(/^\.\//, '').replace(/\.js$/, '')}.ts`;
  return files[path] === undefined ? undefined : source(path);
};
const regs = (code: string) => extractRegistrations(ts, ts.createSourceFile('src/index.ts', code, ts.ScriptTarget.Latest, true), { readModule });

describe('extractRegistrations — the class argument resolves to its declaration', () => {
  it('plain import', () => {
    expect(regs(`import { GridElement } from './grid.js'; registerComponent('web-grid', GridElement);`)).toEqual([
      { tagName: 'web-grid', className: 'GridElement', fileName: 'src/grid.ts' },
    ]);
  });

  it('aliased import', () => {
    expect(regs(`import { GridElement as _GridElement } from './grid.js'; registerComponent('web-grid', _GridElement);`)).toEqual([
      { tagName: 'web-grid', className: 'GridElement', localName: '_GridElement', fileName: 'src/grid.ts' },
    ]);
  });

  it('aliased re-export, export * and a default import', () => {
    expect(regs(`import { PublicGrid as G } from './barrel.js'; registerComponent('web-grid', G);`)[0]).toMatchObject({
      className: 'GridElement',
      fileName: 'src/grid.ts',
    });
    expect(regs(`import { GridElement as G } from './star.js'; registerComponent('web-grid', G);`)[0]).toMatchObject({
      className: 'GridElement',
      fileName: 'src/grid.ts',
    });
    expect(regs(`import D from './default.js'; registerComponent('web-d', D);`)[0]).toMatchObject({
      className: 'DefaultGrid',
      fileName: 'src/default.ts',
    });
  });

  it('unresolvable: says why', () => {
    expect(regs(`import { Grid } from '@scope/grid'; registerComponent('web-grid', Grid);`)[0]!.unresolved).toContain("package '@scope/grid'");
    expect(regs(`import { Grid } from './missing.js'; registerComponent('web-grid', Grid);`)[0]!.unresolved).toContain("couldn't be read");
    expect(regs(`import { Nope } from './grid.js'; registerComponent('web-grid', Nope);`)[0]!.unresolved).toContain("doesn't export `Nope`");
    expect(regs(`registerComponent('web-grid', Ghost);`)[0]!.unresolved).toContain('neither declared nor imported');
  });
});

describe('table spreads follow re-exports the same way', () => {
  it('a spread imported through an aliased re-export', () => {
    const [cls] = extractBlissClasses(
      ts,
      ts.createSourceFile('src/picker.ts', `import { ROWS as R } from './rows.js'; class Picker extends BlissElement { static inputs = [...R]; }`, ts.ScriptTarget.Latest, true),
      { readModule },
    );
    expect(cls!.attributes.map((a) => a.name)).toEqual(['for']);
    expect(cls!.warnings).toBeUndefined();
  });
});

describe('blissInputsPlugin — registerComponent() across modules', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Run the analyzer phases over in-memory modules, in the given order (index.ts last = the web-grid case). */
  const analyze = (modules: Record<string, string>) => {
    const plugin = blissInputsPlugin();
    const docs = Object.entries(modules).map(([path, code]) => {
      const sf = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
      const declarations = sf.statements
        .filter(ts.isClassDeclaration)
        .map((c) => ({ kind: 'class', name: c.name!.text }) as Record<string, any>);
      const moduleDoc = { path, declarations, exports: [] as Record<string, any>[] };
      const visit = (node: ts.Node): void => {
        plugin.analyzePhase!({ ts, node, moduleDoc, context: {} });
        ts.forEachChild(node, visit);
      };
      visit(sf);
      plugin.moduleLinkPhase!({ moduleDoc, context: {} });
      return moduleDoc;
    });
    plugin.packageLinkPhase!({ customElementsManifest: { modules: docs }, context: {} });
    return docs;
  };

  it('links an aliased import even when the class module is analyzed first', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs' as string);
    const { join } = await import('node:path' as string);
    const { tmpdir } = await import('node:os' as string);
    const dir = mkdtempSync(join(tmpdir(), 'bliss-cem-reg-'));
    const grid = `export class GridElement extends BlissElement { static inputs = [{ configKey: 'label', attribute: 'label', converter: toText() }]; }`;
    writeFileSync(join(dir, 'grid.ts'), grid);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [gridDoc] = analyze({
      [join(dir, 'grid.ts')]: grid,
      [join(dir, 'index.ts')]: `import { GridElement as _GridElement } from './grid.js';\nregisterComponent('web-grid', _GridElement);`,
    });
    expect(gridDoc!.declarations[0]).toMatchObject({ customElement: true, tagName: 'web-grid' });
    expect(gridDoc!.exports).toEqual([
      { kind: 'custom-element-definition', name: 'web-grid', declaration: { name: 'GridElement', module: join(dir, 'grid.ts') } },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns with the tag and the identifier when the class cannot be resolved', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    analyze({ 'src/index.ts': `import { Grid as _G } from '@scope/grid';\nregisterComponent('web-grid', _G);` });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("registerComponent('web-grid', _G)");
    expect(warn.mock.calls[0]![0]).toContain("'web-grid' is missing from the manifest");
  });
});
