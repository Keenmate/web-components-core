import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { blissAnalyzerConfig } from './config.js';
import { blissInputsPlugin } from './plugin.js';
import { extractBlissClasses } from './extract.js';

// Review 2026-11-03 (WP11): L-04 / L-05 / L-06.

const parse = (source: string) => extractBlissClasses(ts, ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true));

describe('blissAnalyzerConfig', () => {
  it('analyzes index.ts (where registerComponent() runs) and skips tests / declarations', () => {
    const config = blissAnalyzerConfig();
    expect(config.exclude).not.toContain('**/index.ts');
    expect(config.exclude).toEqual(expect.arrayContaining(['**/*.test.ts', '**/*.spec.ts', '**/*.d.ts']));
    expect(config.plugins[0]!.name).toBe('keenmate-bliss-inputs');
  });

  it('options override the preset', () => {
    expect(blissAnalyzerConfig({ exclude: ['x'], outdir: 'dist' })).toMatchObject({ exclude: ['x'], outdir: 'dist' });
  });
});

describe('blissInputsPlugin — modules', () => {
  it('a same-named class in another module does not receive this one’s attributes', () => {
    const plugin = blissInputsPlugin();
    const run = (path: string, source: string) => {
      const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const moduleDoc = { path, declarations: [{ kind: 'class', name: 'Picker' }] as Record<string, any>[] };
      const visit = (node: ts.Node): void => {
        plugin.analyzePhase!({ ts, node, moduleDoc, context: {} });
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return moduleDoc;
    };
    const real = run('src/picker.ts', `class Picker extends BlissElement { static inputs = [{ configKey: 'label', attribute: 'label', converter: toText() }]; }`);
    const demo = run('demo/picker.ts', `class Picker extends HTMLElement {}`);
    plugin.moduleLinkPhase!({ moduleDoc: real, context: {} });
    plugin.moduleLinkPhase!({ moduleDoc: demo, context: {} });
    expect(real.declarations[0]!.attributes?.map((a: { name: string }) => a.name)).toContain('label');
    expect(demo.declarations[0]!.attributes).toBeUndefined();
  });
});

describe('type and default inference', () => {
  it('toList itemType, toCssLength, toFunction, and nullable / unset enums', () => {
    const [meta] = parse(`class W extends BlissElement {
      static inputs = [
        { configKey: 'ids', attribute: 'ids', converter: toList({ itemType: 'int' }) },
        { configKey: 'tags', attribute: 'tags', converter: toList() },
        { configKey: 'width', attribute: 'width', converter: toCssLength() },
        { configKey: 'onPick', converter: toFunction() },
        { configKey: 'size', attribute: 'size', converter: toEnum(['sm', 'lg'], { default: 'sm' }) },
        { configKey: 'mode', attribute: 'mode', converter: toEnum(['a', 'b']) },
        { configKey: 'tone', attribute: 'tone', converter: toEnum(['x', 'y'], { isNullable: true, default: 'x' }) },
      ];
    }`);
    const type = (key: string) => meta!.members.find((m) => m.name === key)!.type!.text;
    expect(type('ids')).toBe('number[]');
    expect(type('tags')).toBe('string[]');
    expect(type('width')).toBe('string');
    expect(type('onPick')).toBe('Function | null');
    expect(type('size')).toBe("'sm' | 'lg'");
    expect(type('mode')).toBe("'a' | 'b' | null"); // no default: an absent attribute is null
    expect(type('tone')).toBe("'x' | 'y' | null");
  });

  it('a toBool default comes from its mode', () => {
    const [meta] = parse(`class W extends BlissElement {
      static inputs = [
        { configKey: 'isOpen', attribute: 'open', converter: toBool('default-true') },
        { configKey: 'isSorted', attribute: 'sorted', converter: toBool('tristate') },
        { configKey: 'isOff', attribute: 'off', converter: toBool('default-false') },
      ];
    }`);
    const def = (key: string) => meta!.members.find((m) => m.name === key)!.default;
    expect(def('isOpen')).toBe('true');
    expect(def('isSorted')).toBe('null');
    expect(def('isOff')).toBe('false');
  });
});

describe('leading comments (L-19)', () => {
  it('keeps every line of a // comment run above a row', () => {
    const [meta] = parse(`class W extends BlissElement {
      static inputs = [
        // The label shown in the header.
        // Plain text, not HTML.
        { configKey: 'label', attribute: 'label', converter: toText() },
      ];
    }`);
    expect(meta!.members.find((m) => m.name === 'label')!.description).toBe('The label shown in the header. Plain text, not HTML.');
  });
});
