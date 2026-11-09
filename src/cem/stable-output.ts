/**
 * Deterministic manifest output. Two things made the same sources give a different
 * `custom-elements.json` (and the editor-integration files generated from it):
 *
 * - **Line endings.** A Windows checkout (`core.autocrlf`) hands the analyzer CRLF sources,
 *   so JSDoc and input-row descriptions came out with CRLF, and a build on another checkout
 *   rewrote the manifests. Every string is folded to LF.
 * - **Module order.** The analyzer's module order varies from run to run, so the modules are
 *   sorted by path.
 *
 * {@link ./config.blissAnalyzerConfig} runs it right after {@link ./plugin.blissInputsPlugin},
 * before the extra plugins, so the generators that read the manifest see the stable form.
 */
import type { CemPackageDoc, CemPlugin } from './plugin.js';

function foldLineEndings(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n');
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = foldLineEndings(value[i]);
    return value;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) obj[key] = foldLineEndings(obj[key]);
  }
  return value;
}

/** Make a manifest deterministic in place: LF line endings in every string, modules sorted by path. */
export function stabilizeManifest(manifest: CemPackageDoc): CemPackageDoc {
  foldLineEndings(manifest);
  manifest.modules?.sort((a, b) => {
    const pa = a.path ?? '';
    const pb = b.path ?? '';
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  return manifest;
}

/** The analyzer plugin around {@link stabilizeManifest} (`packageLinkPhase`). */
export function stableOutputPlugin(): CemPlugin {
  return {
    name: 'keenmate-stable-output',
    packageLinkPhase({ customElementsManifest }) {
      stabilizeManifest(customElementsManifest);
    },
  };
}
