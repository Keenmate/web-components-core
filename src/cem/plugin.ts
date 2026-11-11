/**
 * A `@custom-elements-manifest/analyzer` plugin that teaches the analyzer to
 * read BlissElement's `static inputs` / `static events` tables (SPEC §12.4).
 * Without it the analyzer sees nothing — our public surface lives in tables, not
 * in the Lit-style patterns it recognizes. This wrapper is deliberately thin:
 * all extraction logic lives in {@link ./extract} (pure, unit-tested). It runs
 * per class node in `analyzePhase`, then merges the results into the manifest's
 * class declaration in `moduleLinkPhase`, so it augments (never replaces) the
 * analyzer's own class analysis.
 *
 * The analyzer injects the `typescript` API, so this module has NO runtime
 * dependency on it — the types below are structural and intentionally loose to
 * avoid a hard dependency on the analyzer's internal types.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { extractBlissClass, parseRegisterComponentCall, type ExtractedClass, type ExtractedRegistration, type ModuleReader } from './extract.js';
import { withCoreDeclared } from './core-declared.js';

/** Minimal shape of a CEM class-like declaration this plugin augments. */
interface CemDeclaration {
  kind?: string;
  name?: string;
  tagName?: string;
  customElement?: boolean;
  attributes?: unknown[];
  members?: unknown[];
  events?: unknown[];
  [key: string]: unknown;
}

interface CemExport {
  kind?: string;
  name?: string;
  declaration?: { name?: string; module?: string };
  [key: string]: unknown;
}

interface CemModuleDoc {
  path?: string;
  declarations?: CemDeclaration[];
  exports?: CemExport[];
  [key: string]: unknown;
}

/** The analyzer's plugin interface (only the hooks these plugins use). */
export interface CemPlugin {
  name: string;
  analyzePhase?(params: { ts: unknown; node: unknown; moduleDoc: CemModuleDoc; context: unknown }): void;
  moduleLinkPhase?(params: { moduleDoc: CemModuleDoc; context: unknown }): void;
  /**
   * Runs after all modules are linked, over the whole manifest — the phase where
   * `customElement` / `tagName` are settled (including core's `registerComponent()`
   * recognition) and downstream generators read declarations.
   */
  packageLinkPhase?(params: { customElementsManifest: CemPackageDoc; context: unknown }): void;
}

/** Minimal shape of the whole-manifest object passed to `packageLinkPhase`. */
export interface CemPackageDoc {
  modules?: CemModuleDoc[];
  [key: string]: unknown;
}

/**
 * Reads a relative module from disk for a table spread imported from it (`./shared.js` →
 * `shared.ts`, `./shared` → `shared.ts` / `shared/index.ts`), parsed once per path.
 */
function moduleReader(ts: typeof import('typescript')): ModuleReader {
  const cache = new Map<string, import('typescript').SourceFile | undefined>();
  return (fromFile, specifier) => {
    const base = resolve(dirname(fromFile), specifier);
    const stem = base.replace(/\.(js|mjs|ts|mts)$/, '');
    for (const path of [`${stem}.ts`, `${stem}.mts`, `${stem}/index.ts`, base]) {
      if (cache.has(path)) return cache.get(path);
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      cache.set(path, sf);
      return sf;
    }
    return undefined;
  };
}

/** Merge an attribute/member/event by `name`, extracted data winning on conflicts. */
function mergeByName<T extends { name?: string }>(existing: unknown[] | undefined, incoming: T[]): T[] {
  const out = [...((existing ?? []) as T[])];
  for (const item of incoming) {
    const at = out.findIndex((e) => e && e.name === item.name);
    if (at >= 0) out[at] = { ...out[at], ...item };
    else out.push(item);
  }
  return out;
}

/**
 * Create the plugin. Pass it in your analyzer config's `plugins` array — or use
 * {@link ./config.blissAnalyzerConfig} which includes it.
 */
export function blissInputsPlugin(): CemPlugin {
  // module path + className → extracted data, filled in analyzePhase, consumed in
  // moduleLinkPhase. Keyed by module too, so a same-named class in another module (a test
  // double, a demo) never receives this one's attributes.
  const extracted = new Map<string, ExtractedClass>();
  const keyOf = (moduleDoc: CemModuleDoc, className: string): string => `${moduleDoc.path ?? ''}::${className}`;
  // `registerComponent()` calls (core §12.3), which the stock analyzer does not recognize as
  // custom-element definitions. The class argument is resolved to its DECLARED name (an import
  // alias / re-export is followed), and linked to the declaration in the module that declares it.
  // The call usually sits in index.ts while the class lives elsewhere, and the analyzer links
  // module by module, so whatever moduleLinkPhase couldn't link yet is linked in packageLinkPhase;
  // a registration that never finds its class is a build warning, never a silent "no components".
  const registrations: { reg: ExtractedRegistration; callModule: string; isLinked: boolean }[] = [];
  /** One reader per run, so a shared module is parsed once. */
  let readModule: ModuleReader | undefined;

  /** Does `decl` (declared in `moduleDoc`) match the registration's class? */
  const matches = (reg: ExtractedRegistration, moduleDoc: CemModuleDoc, decl: CemDeclaration): boolean =>
    decl.name === reg.className && (!reg.fileName || !moduleDoc.path || resolve(moduleDoc.path) === resolve(reg.fileName));

  /** Flag `decl` as the custom element `tagName` and add the `custom-element-definition` export. */
  const define = (moduleDoc: CemModuleDoc, decl: CemDeclaration, tagName: string): void => {
    decl.customElement = true;
    decl.tagName = tagName;
    moduleDoc.exports ??= [];
    const already = moduleDoc.exports.some((e) => e.kind === 'custom-element-definition' && e.name === tagName);
    if (!already) {
      moduleDoc.exports.push({
        kind: 'custom-element-definition',
        name: tagName,
        declaration: { name: decl.name, module: moduleDoc.path },
      });
    }
  };

  /** Link every not-yet-linked registration whose class `moduleDoc` declares. */
  const linkRegistrations = (moduleDoc: CemModuleDoc): void => {
    for (const entry of registrations) {
      if (entry.isLinked) continue;
      const decl = (moduleDoc.declarations ?? []).find((d) => matches(entry.reg, moduleDoc, d));
      if (!decl) continue;
      define(moduleDoc, decl, entry.reg.tagName);
      entry.isLinked = true;
    }
  };

  return {
    name: 'keenmate-bliss-inputs',

    analyzePhase({ ts, node, moduleDoc }) {
      const tsApi = ts as typeof import('typescript');
      const n = node as import('typescript').Node;
      readModule ??= moduleReader(tsApi);
      const reg = parseRegisterComponentCall(tsApi, n, { readModule });
      if (reg) registrations.push({ reg, callModule: moduleDoc.path ?? '', isLinked: false });
      if (!tsApi.isClassDeclaration(n) && !tsApi.isClassExpression(n)) return;
      const meta = extractBlissClass(tsApi, n, n.getSourceFile(), { readModule });
      // Build-time tooling (not the runtime "no console" rule): say what was left out.
      for (const warning of meta?.warnings ?? []) console.warn(`[keenmate-bliss-inputs] ${moduleDoc.path ?? ''}: ${warning}`);
      // Core-declared inputs / events (defer, theme-source, responsive, ready) are
      // not table rows — add them so every manifest documents them.
      if (meta) extracted.set(keyOf(moduleDoc, meta.name), withCoreDeclared(meta));
    },

    moduleLinkPhase({ moduleDoc }) {
      for (const decl of moduleDoc.declarations ?? []) {
        if (!decl.name) continue;
        const meta = extracted.get(keyOf(moduleDoc, decl.name));
        if (meta) {
          if (meta.attributes.length) decl.attributes = mergeByName(decl.attributes, meta.attributes);
          if (meta.members.length) decl.members = mergeByName(decl.members, meta.members);
          if (meta.events.length) decl.events = mergeByName(decl.events, meta.events);
        }
      }
      // Recognize core's registerComponent() as a custom-element definition: flag the
      // declaration and add the `custom-element-definition` export the stock analyzer
      // would have emitted for `customElements.define()`.
      linkRegistrations(moduleDoc);
    },

    packageLinkPhase({ customElementsManifest }) {
      // Registrations analyzed after their class's module (index.ts after the class file).
      for (const moduleDoc of customElementsManifest.modules ?? []) linkRegistrations(moduleDoc);
      for (const { reg, callModule, isLinked } of registrations) {
        if (isLinked) continue;
        const written = reg.localName ?? reg.className;
        const why = reg.unresolved ?? `no analyzed module declares class \`${reg.className}\`${reg.fileName ? ` (resolved to ${reg.fileName})` : ''}`;
        // Build-time tooling (not the runtime "no console" rule): never drop a component silently.
        console.warn(
          `[keenmate-bliss-inputs] ${callModule}: registerComponent('${reg.tagName}', ${written}) — the class can't be resolved (${why}); '${reg.tagName}' is missing from the manifest`,
        );
      }
    },
  };
}
