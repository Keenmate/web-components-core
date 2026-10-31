/**
 * The inputs / events core declares on EVERY `BlissElement` — not rows in a
 * component's `static inputs` table, so the extractor never sees them. The
 * plugin adds them to each table-driven class so custom-elements.json /
 * web-types / VS Code data document them like any other input.
 *
 * - `defer` / `shouldDefer` and `theme-source` / `themeSource` and the `ready`
 *   event: every table-driven class (inputs or events table).
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
    attribute: { name: 'responsive', fieldName: 'responsive', type: { text: 'ResponsiveMap | null' }, description: RESPONSIVE_DESCRIPTION },
    member: { kind: 'field', name: 'responsive', privacy: 'public', type: { text: 'ResponsiveMap | null' }, default: 'null', attribute: 'responsive', description: RESPONSIVE_DESCRIPTION },
    isInputTableOnly: true,
  },
  {
    member: { kind: 'field', name: 'responsiveCallback', privacy: 'public', type: { text: 'ResponsiveCallback | null' }, default: 'null', description: RESPONSIVE_CALLBACK_DESCRIPTION },
    isInputTableOnly: true,
  },
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
  const events = [...meta.events, ...CORE_DECLARED_EVENTS.filter((e) => !eventNames.has(e.name)).map((e) => ({ ...e }))];
  return { ...meta, attributes, members, events };
}
