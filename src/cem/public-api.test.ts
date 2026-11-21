import { describe, expect, it } from 'vitest';
import { blissAnalyzerConfig } from './config.js';
import { keepPublicApi } from './public-api.js';

const manifest = () => ({
  modules: [
    {
      path: 'src/index.ts',
      exports: [
        { kind: 'js', name: 'WidgetEngine', declaration: { name: 'WidgetEngine', module: './engine.js' } },
        { kind: 'js', name: '*', declaration: { name: '*', module: 'src/types' } },
      ],
    },
    {
      path: 'src/engine.ts',
      declarations: [
        {
          kind: 'class',
          name: 'WidgetEngine',
          members: [{ name: 'setOptions' }, { name: '#state' }, { name: '_drag' }, { name: 'paint', privacy: 'private' }],
        },
        { kind: 'variable', name: 'apply' }, // the analyzer's stray method-local declaration
      ],
      exports: [
        { kind: 'js', name: 'WidgetEngine', declaration: { name: 'WidgetEngine' } },
        { kind: 'js', name: 'apply', declaration: { name: 'apply' } },
      ],
    },
    { path: 'src/types.ts', declarations: [{ kind: 'variable', name: 'A' }, { kind: 'variable', name: 'B' }] },
    { path: 'src/helpers/dom.ts', declarations: [{ kind: 'function', name: 'h' }] },
    {
      path: 'src/web-component.ts',
      declarations: [
        { kind: 'class', name: 'WebWidget', customElement: true, members: [{ name: 'value' }, { name: 'reinit', privacy: 'protected' }] },
      ],
      exports: [{ kind: 'custom-element-definition', name: 'web-widget', declaration: { name: 'WebWidget' } }],
    },
  ],
});

describe('publicApiPlugin', () => {
  it('drops private / protected / # / _ members, unexported modules and declarations; keeps the element module', () => {
    const m = keepPublicApi(manifest());
    expect(m.modules!.map((x) => x.path)).toEqual(['src/index.ts', 'src/engine.ts', 'src/types.ts', 'src/web-component.ts']);
    const engine = m.modules![1]!;
    expect(engine.declarations!.map((d) => d.name)).toEqual(['WidgetEngine']);
    expect((engine.declarations![0]!.members as Array<{ name: string }>).map((x) => x.name)).toEqual(['setOptions']);
    expect(engine.exports!.map((e) => e.name)).toEqual(['WidgetEngine']);
    expect(m.modules![2]!.declarations!.map((d) => d.name)).toEqual(['A', 'B']); // export * keeps all
    const element = m.modules![3]!.declarations![0]!;
    expect((element.members as Array<{ name: string }>).map((x) => x.name)).toEqual(['value']);
  });

  it('no entry module in the manifest → only the member filter', () => {
    const m = keepPublicApi(manifest(), { entries: ['src/main.ts'] });
    expect(m.modules).toHaveLength(5);
    expect((m.modules![1]!.declarations![0]!.members as unknown[]).length).toBe(1);
  });

  it('the preset runs it by default; isPublicApiOnly: false turns it off', () => {
    expect(blissAnalyzerConfig().plugins.map((p) => p.name)).toContain('keenmate-public-api');
    expect(blissAnalyzerConfig({ isPublicApiOnly: false }).plugins.map((p) => p.name)).not.toContain('keenmate-public-api');
  });
});
