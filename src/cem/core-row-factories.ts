/**
 * Core's input-row factories a component spreads into its `static inputs`
 * (`...createMenuPresentationInputs()`): the extractor can't read a call from a package import, so it
 * reads these instead — source text generated from the RUNTIME rows, so the manifest can't drift
 * from what the element actually takes.
 */
import type { InputDef } from '../inputs/types.js';
import { createMenuPresentationInputs } from '../menu/inputs.js';

/** A literal in the manifest's usual spelling (single-quoted strings, like hand-written tables). */
function lit(value: unknown): string {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(lit).join(', ')}]`;
  return JSON.stringify(value);
}

/** One runtime row as a table-row literal the extractor parses (enum converters only, for now). */
function rowSource(row: InputDef): string {
  const values = (row.converter as { values?: readonly string[] } | undefined)?.values;
  const fields = [
    `configKey: ${lit(row.configKey)}`,
    row.attribute ? `attribute: ${lit(row.attribute)}` : '',
    values ? `converter: toEnum(${lit(values)}, { default: ${lit(row.default)} })` : '',
    row.default !== undefined ? `default: ${lit(row.default)}` : '',
    row.on ? `on: ${lit(row.on)}` : '',
    row.shouldReflect ? 'shouldReflect: true' : '',
    row.description ? `description: ${lit(row.description)}` : '',
  ].filter(Boolean);
  return `{ ${fields.join(', ')} }`;
}

/** Factory name → `const ROWS = [ … ];` source (the array is the statement's initializer). */
export const CORE_ROW_FACTORY_SOURCES: Readonly<Record<string, string>> = {
  createMenuPresentationInputs: `const ROWS = [${createMenuPresentationInputs().map(rowSource).join(', ')}];`,
};
