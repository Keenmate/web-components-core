/**
 * `@keenmate/web-components-core/cem` — Custom Elements Manifest tooling
 * (SPEC §12.4). A shared analyzer config preset and a plugin that reads
 * BlissElement's `static inputs` / `static events` tables so the manifest is
 * generated from the single source of truth (structure) plus each row's
 * `description` / `deprecated` (prose). Build-time only — not imported by the
 * runtime bundle.
 */
export { blissAnalyzerConfig, type BlissAnalyzerConfig, type BlissAnalyzerOptions } from './config.js';
export { blissInputsPlugin, type CemPackageDoc, type CemPlugin } from './plugin.js';
export { CORE_DECLARED_API, CORE_DECLARED_EVENTS, CORE_DECLARED_INPUTS, withCoreDeclared } from './core-declared.js';
export { stabilizeManifest, stableOutputPlugin } from './stable-output.js';
export { cssVariablesFromManifestPlugin, type CssVariablesPluginOptions } from './css-variables.js';
export {
  extractBlissClass,
  extractBlissClasses,
  extractRegistrations,
  parseRegisterComponentCall,
  type ExtractedAttribute,
  type ExtractedClass,
  type ExtractedEvent,
  type ExtractedMember,
  type ExtractedRegistration,
  type ExtractedTypeAnnotation,
} from './extract.js';
