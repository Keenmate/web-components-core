/**
 * The inputs / events core declares on EVERY `BlissElement` — not rows in a
 * component's `static inputs` table, so the extractor never sees them. The
 * plugin adds them to each table-driven class so custom-elements.json /
 * web-types / VS Code data document them like any other input.
 *
 * - `defer` / `shouldDefer`, `theme-source` / `themeSource`, `motion` and the
 *   `ready` event: every table-driven class (inputs or events table).
 * - `responsive` / `responsiveCallback`: only classes with an input table (the
 *   runtime skips responsive rules without one, SPEC §6.7).
 *
 * A component that declares the same attribute / member / event name itself
 * keeps its own entry (same dedup as the runtime's observedAttributes).
 */
import type { ExtractedAttribute, ExtractedClass, ExtractedEvent, ExtractedMember } from './extract.js';

interface CoreInput {
  attribute?: ExtractedAttribute;
  member: ExtractedMember;
  /** Only for classes with a `static inputs` table. */
  isInputTableOnly?: boolean;
}

const DEFER_DESCRIPTION =
  'Hold the first build (core, SPEC §6.3): while set when the element first connects, nothing is built and every input, callback and listener assigned meanwhile accumulates; `release()` (or removing the attribute) then builds once. Latched after the first build.';
const THEME_SOURCE_DESCRIPTION =
  "Where this element reads its theme from instead of the page (core, SPEC §12.10): a CSS selector (nearest matching ancestor, else the first match), `'closest'` (the nearest ancestor carrying a theme signal), or (property only) an `Element`. Unset = the page.";
const MOTION_DESCRIPTION =
  "Motion level (core, SPEC §12.16): `auto` (default — follow `window.components.motion`, then a `data-motion` on the page / an ancestor), `none` (no transitions, instant scrolling), `snappy` (short) or `smooth` (longer). Sets the shared `--base-duration-*` / `--base-scroll-behavior` tokens on the element through `data-motion`; the OS reduced-motion setting always wins.";
const RESPONSIVE_DESCRIPTION =
  "Instance responsive rules (core, SPEC §6.7): partial configs on two axes — `device` (keyed by device class `mobile` / `tablet` / `desktop`; a mouse device is `desktop` at any width) and `breakpoint` (keyed by the window-width bucket); the breakpoint entry applies first, the device entry over it (device wins). An object or a JSON attribute, e.g. `{\"device\":{\"tablet\":{\"presentation\":\"modal\"}},\"breakpoint\":{\"mobile\":{…}}}`. Beats page rules (`window.components.responsive*`) and values set on the element; never reflects. An entry of `null` ignores the page rules while it matches.";
const RESPONSIVE_CALLBACK_DESCRIPTION =
  'Instance computed responsive rule (core, SPEC §6.7): `(ctx) => partial config | null | undefined`, ctx `{ env, deviceClass, breakpoint, element, component, config }` (`config` = base). Runs after `responsive` (wins key by key); re-runs on environment flips, throttled viewport-width changes, rule and config changes. `null` ignores every page rule.';

/** Core-declared inputs, in manifest order. */
export const CORE_DECLARED_INPUTS: readonly CoreInput[] = [
  {
    attribute: { name: 'defer', fieldName: 'shouldDefer', type: { text: 'boolean' }, default: 'false', description: DEFER_DESCRIPTION },
    member: { kind: 'field', name: 'shouldDefer', privacy: 'public', type: { text: 'boolean' }, default: 'false', attribute: 'defer', reflects: true, description: DEFER_DESCRIPTION },
  },
  {
    attribute: { name: 'theme-source', fieldName: 'themeSource', type: { text: 'string' }, description: THEME_SOURCE_DESCRIPTION },
    member: { kind: 'field', name: 'themeSource', privacy: 'public', type: { text: 'string | Element | null' }, default: 'null', attribute: 'theme-source', reflects: true, description: THEME_SOURCE_DESCRIPTION },
  },
  {
    attribute: { name: 'motion', fieldName: 'motion', type: { text: "'auto' | 'none' | 'snappy' | 'smooth'" }, default: "'auto'", description: MOTION_DESCRIPTION },
    member: { kind: 'field', name: 'motion', privacy: 'public', type: { text: "'auto' | 'none' | 'snappy' | 'smooth'" }, default: "'auto'", attribute: 'motion', reflects: true, description: MOTION_DESCRIPTION },
  },
  {
    attribute: { name: 'responsive', fieldName: 'responsive', type: { text: 'ResponsiveMap | null' }, description: RESPONSIVE_DESCRIPTION },
    member: { kind: 'field', name: 'responsive', privacy: 'public', type: { text: 'ResponsiveMap | null' }, default: 'null', attribute: 'responsive', description: RESPONSIVE_DESCRIPTION },
    isInputTableOnly: true,
  },
  {
    member: { kind: 'field', name: 'responsiveCallback', privacy: 'public', type: { text: 'ResponsiveCallback | null' }, default: 'null', description: RESPONSIVE_CALLBACK_DESCRIPTION },
    isInputTableOnly: true,
  },
];

/**
 * BlissElement's own public API — the same on every component, so every manifest lists it
 * (IDE completion, generated docs). Kept in sync with the class by a test
 * (`core-declared.test.ts` checks every name exists on `BlissElement.prototype`).
 */
export const CORE_DECLARED_API: readonly ExtractedMember[] = [
  { kind: 'field', name: 'isReady', privacy: 'public', readonly: true, type: { text: 'boolean' }, description: 'The first build is live (core, SPEC §6.3) — the `ready` event has fired.' },
  { kind: 'method', name: 'whenReady', privacy: 'public', return: { type: { text: 'Promise<void>' } }, description: 'Resolves once the first build is live (also settles when the element is destroyed first). Never rejects.' },
  { kind: 'method', name: 'release', privacy: 'public', return: { type: { text: 'void' } }, description: 'Build an element held by `defer` (SPEC §6.3), with everything assigned meanwhile.' },
  { kind: 'method', name: 'setAttributes', privacy: 'public', parameters: [{ name: 'values', type: { text: 'Record<string, unknown>' } }], return: { type: { text: 'void' } }, description: 'Apply many inputs (by configKey or attribute name) as ONE rebuild / update.' },
  { kind: 'method', name: 'batch', privacy: 'public', parameters: [{ name: 'fn', type: { text: '() => void' } }], return: { type: { text: 'void' } }, description: 'Run `fn` and coalesce every input change it makes into one rebuild / update.' },
  { kind: 'method', name: 'flush', privacy: 'public', return: { type: { text: 'void' } }, description: 'Apply pending input writes synchronously, now (SPEC §12.7).' },
  { kind: 'method', name: 'whenSettled', privacy: 'public', return: { type: { text: 'Promise<void>' } }, description: 'Resolves once every staged input change has been applied (SPEC §12.7).' },
  { kind: 'method', name: 'destroy', privacy: 'public', return: { type: { text: 'void' } }, description: 'Final teardown (SPEC §6.5): the element is inert afterwards; idempotent.' },
  { kind: 'field', name: 'isDestroyed', privacy: 'public', readonly: true, type: { text: 'boolean' }, description: '`destroy()` ran.' },
  { kind: 'method', name: 'enableLogging', privacy: 'public', parameters: [{ name: 'level', type: { text: 'LogLevelDesc' }, optional: true }], return: { type: { text: 'void' } }, description: "Set this element's own log level (default `debug`): it logs that level and above, whatever its component type or the page is set to." },
  { kind: 'method', name: 'disableLogging', privacy: 'public', return: { type: { text: 'void' } }, description: "Silence this element (its own level = `silent`)." },
  { kind: 'method', name: 'resetLogging', privacy: 'public', return: { type: { text: 'void' } }, description: "Clear this element's own log level: it follows its component type / the page again." },
  { kind: 'field', name: 'form', privacy: 'public', readonly: true, type: { text: 'HTMLFormElement | null' }, description: 'The owning form (form-associated components).' },
  { kind: 'field', name: 'validity', privacy: 'public', readonly: true, type: { text: 'ValidityState' }, description: 'Form validity (SPEC §6.6).' },
  { kind: 'field', name: 'validationMessage', privacy: 'public', readonly: true, type: { text: 'string' }, description: 'Form validation message (SPEC §6.6).' },
  { kind: 'field', name: 'willValidate', privacy: 'public', readonly: true, type: { text: 'boolean' }, description: 'Whether the element takes part in form validation.' },
  { kind: 'method', name: 'checkValidity', privacy: 'public', return: { type: { text: 'boolean' } }, description: 'Form validity check (SPEC §6.6).' },
  { kind: 'method', name: 'reportValidity', privacy: 'public', return: { type: { text: 'boolean' } }, description: 'Form validity check that reports to the user (SPEC §6.6).' },
];

/** Core-declared events, in manifest order. */
export const CORE_DECLARED_EVENTS: readonly ExtractedEvent[] = [
  {
    name: 'ready',
    description:
      'Fired once after the first live build (core, SPEC §6.3), on the microtask after it; also the `ready` attribute, `:state(ready)`, `isReady` and `whenReady()`. Twin callback `onReady`.',
  },
];

/**
 * Return `meta` with the core-declared inputs / events appended — skipping any
 * name the class's own tables already declare (the component's entry wins).
 */
export function withCoreDeclared(meta: ExtractedClass): ExtractedClass {
  const attrNames = new Set(meta.attributes.map((a) => a.name));
  const memberNames = new Set(meta.members.map((m) => m.name));
  const eventNames = new Set(meta.events.map((e) => e.name));
  const attributes = [...meta.attributes];
  const members = [...meta.members];
  for (const input of CORE_DECLARED_INPUTS) {
    if (input.isInputTableOnly && !meta.hasInputTable) continue;
    // A component that owns either side (attribute or property) owns the input.
    if (memberNames.has(input.member.name) || (input.attribute && attrNames.has(input.attribute.name))) continue;
    if (input.attribute) attributes.push({ ...input.attribute });
    members.push({ ...input.member });
  }
  // BlissElement's own API, on every table-driven class (the component's same-named member wins).
  for (const api of CORE_DECLARED_API) {
    if (!memberNames.has(api.name)) members.push({ ...api });
  }
  const events = [...meta.events, ...CORE_DECLARED_EVENTS.filter((e) => !eventNames.has(e.name)).map((e) => ({ ...e }))];
  return { ...meta, attributes, members, events };
}
