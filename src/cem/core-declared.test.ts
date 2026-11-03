import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { blissInputsPlugin } from './plugin.js';
import { withCoreDeclared } from './core-declared.js';
import { extractBlissClasses } from './extract.js';

function parse(source: string) {
  const sf = ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true);
  return extractBlissClasses(ts, sf);
}

/** Run the plugin over one source module and return the linked declarations. */
function runPlugin(source: string, declarations: { kind: string; name: string }[]) {
  const sf = ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true);
  const plugin = blissInputsPlugin();
  const moduleDoc = { path: 'test.ts', declarations: declarations.map((d) => ({ ...d })) as Record<string, any>[] };
  const visit = (node: ts.Node): void => {
    plugin.analyzePhase!({ ts, node, moduleDoc, context: {} });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  plugin.moduleLinkPhase!({ moduleDoc, context: {} });
  return moduleDoc.declarations;
}

const names = (list: { name?: string }[] | undefined) => (list ?? []).map((x) => x.name);
/** Members that are inputs (writable fields) — BlissElement's own API (CORE_DECLARED_API) is listed apart. */
const inputMembers = (list: { name?: string; kind?: string; readonly?: boolean }[] | undefined) =>
  (list ?? []).filter((m) => m.kind === 'field' && !m.readonly);

describe('core-declared CEM entries', () => {
  it('the plugin adds defer / theme-source / motion / responsive / responsiveCallback / ready to a class with an input table', () => {
    const [decl] = runPlugin(
      `class Widget extends BlissElement {
        static inputs = [{ configKey: 'label', attribute: 'label', converter: toText() }];
      }`,
      [{ kind: 'class', name: 'Widget' }],
    );
    expect(names(decl!.attributes)).toEqual(['label', 'defer', 'theme-source', 'motion', 'responsive']);
    expect(names(inputMembers(decl!.members))).toEqual(['label', 'shouldDefer', 'themeSource', 'motion', 'responsive', 'responsiveCallback']);
    expect(names(decl!.events)).toEqual(['ready']);
    const responsive = decl!.members.find((m: { name: string }) => m.name === 'responsive');
    expect(responsive).toMatchObject({ attribute: 'responsive', type: { text: 'ResponsiveMap | null' } });
    expect(responsive.description).toMatch(/device class/i);
    const cb = decl!.members.find((m: { name: string }) => m.name === 'responsiveCallback');
    expect(cb.attribute).toBeUndefined();
    expect(cb.type.text).toBe('ResponsiveCallback | null');
    const defer = decl!.attributes.find((a: { name: string }) => a.name === 'defer');
    expect(defer).toMatchObject({ fieldName: 'shouldDefer', type: { text: 'boolean' } });
  });

  it('an events-only class gets defer / theme-source / motion / ready but no responsive', () => {
    const [meta] = parse(`class Grid extends BlissElement { static events = [{ name: 'row-click' }]; }`);
    const out = withCoreDeclared(meta!);
    expect(names(out.attributes)).toEqual(['defer', 'theme-source', 'motion']);
    expect(names(inputMembers(out.members))).toEqual(['shouldDefer', 'themeSource', 'motion']);
    expect(names(out.events)).toEqual(['row-click', 'ready']);
  });

  it("a component's own declaration of the same name wins (no duplicate)", () => {
    const [meta] = parse(`class W extends BlissElement {
      static inputs = [{ configKey: 'responsive', attribute: 'responsive', converter: toText(), description: 'mine' }];
      static events = [{ name: 'ready', description: 'own ready' }];
    }`);
    const out = withCoreDeclared(meta!);
    expect(out.attributes.filter((a) => a.name === 'responsive')).toHaveLength(1);
    expect(out.members.find((m) => m.name === 'responsive')!.description).toBe('mine');
    expect(out.events.filter((e) => e.name === 'ready')).toEqual([{ name: 'ready', description: 'own ready' }]);
    expect(names(out.members)).toContain('responsiveCallback');
  });

  it('classes without tables are untouched', () => {
    expect(parse(`class Plain extends HTMLElement {}`)).toEqual([]);
  });
});

// Review 2026-11-03 L-08: BlissElement's own API is in every manifest, and stays in sync.
describe('core-declared API', () => {
  it('every CORE_DECLARED_API name exists on BlissElement.prototype', async () => {
    const { BlissElement } = await import('../element/bliss-element.js');
    const { CORE_DECLARED_API } = await import('./core-declared.js');
    const own = new Set(Object.getOwnPropertyNames(BlissElement.prototype));
    for (const api of CORE_DECLARED_API) expect(own.has(api.name), api.name).toBe(true);
  });

  it('the plugin lists them on a component class; the component’s own member wins', () => {
    const [decl] = runPlugin(
      `class Widget extends BlissElement {
        static inputs = [{ configKey: 'label', attribute: 'label', converter: toText() }];
      }`,
      [{ kind: 'class', name: 'Widget' }],
    );
    const release = decl!.members.find((m: { name: string }) => m.name === 'release');
    expect(release).toMatchObject({ kind: 'method', return: { type: { text: 'void' } } });
    expect(decl!.members.find((m: { name: string }) => m.name === 'whenReady')).toMatchObject({ kind: 'method' });
  });
});
