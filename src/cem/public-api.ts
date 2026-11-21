/**
 * Keep the manifest to the package's PUBLIC API. The stock analyzer records every class member
 * (`private` / `protected` / `#private` / `_internal`) and every module under `globs`, so a
 * component's manifest carried its internals (web-treeview: 459 members, 19k lines). This pass drops:
 *
 * - members that are `private` / `protected` (the core hooks, `static inputs` / `events`) or named
 *   `#…` / `_…` (the internal-naming convention);
 * - modules the package entries (default `src/index.ts`) don't re-export from, and in the rest the
 *   declarations / exports the entries don't re-export (incl. the analyzer's stray function-local
 *   declarations). Custom-element modules and the entries themselves are always kept.
 *
 * No entry module in the manifest (a package that analyzes only its element file) → only the
 * member filter runs. {@link ./config.blissAnalyzerConfig} runs it after {@link ./stable-output.stableOutputPlugin},
 * before the extra plugins, so the generators (VS Code / JetBrains / css variables) see the public form.
 */
import type { CemPackageDoc, CemPlugin } from './plugin.js';

export interface PublicApiOptions {
  /** The package entry modules (manifest paths). Default: `['src/index.ts']`. */
  entries?: string[];
}

interface Named {
  name?: string;
  privacy?: string;
}

const isInternalMember = (m: Named): boolean =>
  m.privacy === 'private' || m.privacy === 'protected' || /^[#_]/.test(m.name ?? '');

/** A re-export specifier of `entry` → the manifest path of that module (`./x.js` / `src/x` → `src/x.ts`). */
function toModulePath(entry: string, spec: string | undefined): string | undefined {
  if (!spec) return undefined;
  const dir = entry.slice(0, entry.lastIndexOf('/') + 1);
  const path = spec.startsWith('.') ? (dir + spec).replace(/\/\.\//g, '/') : spec;
  if (!path.startsWith(dir)) return undefined; // a package import — not a module of this manifest
  return /\.[cm]?[jt]s$/.test(path) ? path.replace(/\.js$/, '.ts') : `${path}.ts`;
}

/** Filter `manifest` in place to the public API (see the module comment). */
export function keepPublicApi(manifest: CemPackageDoc, options: PublicApiOptions = {}): CemPackageDoc {
  const entries = options.entries ?? ['src/index.ts'];
  const modules = manifest.modules ?? [];
  const entryModules = modules.filter((m) => m.path !== undefined && entries.includes(m.path));
  const dropMembers = (decls: Array<{ members?: unknown[] }>): void => {
    for (const d of decls) if (d.members) d.members = (d.members as Named[]).filter((m) => !isInternalMember(m));
  };
  if (entryModules.length === 0) {
    for (const mod of modules) dropMembers(mod.declarations ?? []);
    return manifest;
  }
  const reexported = new Map<string, Set<string>>(); // module path → names ('*' = all)
  for (const entry of entryModules) {
    for (const e of entry.exports ?? []) {
      const path = toModulePath(entry.path!, e.declaration?.module);
      if (!path || entries.includes(path)) continue;
      if (!reexported.has(path)) reexported.set(path, new Set());
      reexported.get(path)!.add(e.name === '*' ? '*' : (e.declaration?.name ?? ''));
    }
  }
  manifest.modules = modules.filter((mod) => {
    if (entryModules.includes(mod)) {
      dropMembers(mod.declarations ?? []);
      return true;
    }
    const names = reexported.get(mod.path ?? '');
    const hasElement = (mod.declarations ?? []).some((d) => d.customElement);
    if (!names && !hasElement) return false;
    const keep = (name: string | undefined, decl: { customElement?: boolean } | undefined): boolean =>
      decl?.customElement === true || names?.has('*') === true || (name !== undefined && names?.has(name) === true);
    mod.declarations = (mod.declarations ?? []).filter((d) => keep(d.name, d));
    mod.exports = (mod.exports ?? []).filter(
      (e) =>
        e.kind === 'custom-element-definition' ||
        keep(e.declaration?.name, mod.declarations!.find((d) => d.name === e.declaration?.name)),
    );
    dropMembers(mod.declarations);
    return true;
  });
  return manifest;
}

/** The analyzer plugin around {@link keepPublicApi} (`packageLinkPhase`). */
export function publicApiPlugin(options: PublicApiOptions = {}): CemPlugin {
  return {
    name: 'keenmate-public-api',
    packageLinkPhase({ customElementsManifest }) {
      keepPublicApi(customElementsManifest, options);
    },
  };
}
