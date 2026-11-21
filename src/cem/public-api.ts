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

/**
 * A re-export specifier of module `from` → the manifest path of that module (`./x.js` / `./x` / `src/x` →
 * `src/x.ts`; a folder `./dir` → `src/dir/index.ts`). `undefined` for a package import or a path the
 * manifest doesn't hold.
 */
function toModulePath(from: string, spec: string | undefined, paths: ReadonlySet<string>): string | undefined {
  if (!spec) return undefined;
  const dir = from.slice(0, from.lastIndexOf('/') + 1);
  let path = spec;
  if (spec.startsWith('.')) {
    const parts: string[] = [];
    for (const part of (dir + spec).split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    path = parts.join('/');
  }
  const base = path.replace(/\.[cm]?[jt]s$/, '');
  return [`${base}.ts`, path, `${base}/index.ts`].find((candidate) => paths.has(candidate));
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
  const paths = new Set(modules.map((m) => m.path ?? ''));
  const byPath = new Map(modules.map((m) => [m.path ?? '', m]));
  // module path → the names it must keep ('*' = all); followed through re-export chains (a folder index
  // re-exporting its files, `export *` of a barrel).
  const reexported = new Map<string, Set<string>>();
  const queue: Array<[string, string]> = [];
  const add = (path: string, name: string): void => {
    if (entries.includes(path)) return;
    if (!reexported.has(path)) reexported.set(path, new Set());
    const names = reexported.get(path)!;
    if (names.has(name)) return;
    names.add(name);
    queue.push([path, name]);
  };
  const follow = (mod: { path?: string; exports?: Array<{ name?: string; declaration?: { name?: string; module?: string } }> }, wanted: string | null): void => {
    for (const e of mod.exports ?? []) {
      if (wanted !== null && wanted !== '*' && e.name !== wanted) continue;
      const path = toModulePath(mod.path!, e.declaration?.module, paths);
      if (!path || path === mod.path) continue;
      add(path, e.name === '*' ? '*' : (e.declaration?.name ?? ''));
    }
  };
  for (const entry of entryModules) follow(entry, null);
  while (queue.length > 0) {
    const [path, name] = queue.shift()!;
    const mod = byPath.get(path);
    if (mod) follow(mod, name);
  }
  manifest.modules = modules.filter((mod) => {
    if (entryModules.includes(mod)) {
      dropMembers(mod.declarations ?? []);
      return true;
    }
    const names = reexported.get(mod.path ?? '');
    const hasElement = (mod.declarations ?? []).some((d) => d.customElement);
    if (!names && !hasElement) return false;
    const has = (name: string | undefined): boolean => names?.has('*') === true || (name !== undefined && names?.has(name) === true);
    mod.declarations = (mod.declarations ?? []).filter((d) => d.customElement === true || has(d.name));
    mod.exports = (mod.exports ?? []).filter(
      (e) =>
        e.kind === 'custom-element-definition' ||
        has(e.name) ||
        mod.declarations!.some((d) => d.customElement === true && d.name === e.declaration?.name),
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
