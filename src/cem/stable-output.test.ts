import { describe, expect, it } from 'vitest';
import { blissAnalyzerConfig } from './config.js';
import { stabilizeManifest, stableOutputPlugin } from './stable-output.js';

describe('stableOutputPlugin', () => {
  it('folds CRLF / CR to LF in every string, nested arrays and objects included', () => {
    const manifest = {
      schemaVersion: '1.0.0',
      modules: [
        {
          path: 'src/a.ts',
          declarations: [{ name: 'A', description: 'line 1\r\nline 2\rline 3', attributes: [{ name: 'x', description: 'a\r\nb' }] }],
        },
      ],
    };
    stabilizeManifest(manifest);
    const decl = manifest.modules[0]!.declarations[0]!;
    expect(decl.description).toBe('line 1\nline 2\nline 3');
    expect(decl.attributes[0]!.description).toBe('a\nb');
  });

  it('sorts the modules by path, so run-to-run order does not change the file', () => {
    const manifest = { modules: [{ path: 'src/web-component.ts' }, { path: 'src/helpers/b.ts' }, { path: 'src/helpers/a.ts' }] };
    stableOutputPlugin().packageLinkPhase!({ customElementsManifest: manifest, context: {} });
    expect(manifest.modules.map((m) => m.path)).toEqual(['src/helpers/a.ts', 'src/helpers/b.ts', 'src/web-component.ts']);
  });

  it('blissAnalyzerConfig runs it right after the inputs plugin, before the extra plugins', () => {
    const config = blissAnalyzerConfig({ plugins: [{ name: 'generator' }] });
    expect(config.plugins.map((p) => p.name)).toEqual(['keenmate-bliss-inputs', 'keenmate-stable-output', 'generator']);
  });
});
