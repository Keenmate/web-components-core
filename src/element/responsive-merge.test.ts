import { describe, expect, it } from 'vitest';
import { toBool, toEnum, toInt, toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import {
  isResponsiveCallbackSetting,
  isResponsiveMapSetting,
  mergeResponsiveMap,
  mergeResponsiveRule,
  type ResponsiveMergeContext,
} from './responsive.js';

// The layer merge as pure functions (review I-16): no element, no DOM — an input table and a
// warning collector stand in for BlissElement.

const INPUTS: InputDef[] = [
  { configKey: 'layout', attribute: 'layout', converter: toEnum(['grid', 'list'] as const, { default: 'grid' }) },
  { configKey: 'columns', attribute: 'columns', converter: toInt({ min: 1, default: 3 }) },
  { configKey: 'label', attribute: 'label', converter: toText({ shouldTrim: true, default: 'Hi' }) },
  { configKey: 'isDisabled', attribute: 'disabled', converter: toBool('presence') },
  {
    configKey: 'preset',
    converter: toText(),
    getBatchValuesCallback: (value) => (value === 'compact' ? { columns: 1, layout: 'list' } : null),
  },
];

function context(over: Partial<ResponsiveMergeContext> = {}) {
  const warnings: string[] = [];
  const ctx: ResponsiveMergeContext = {
    getInput: (key) => INPUTS.find((d) => d.configKey === key),
    base: {},
    isFormAssociated: false,
    warn: (message) => warnings.push(message),
    ...over,
  };
  return { ctx, warnings };
}

describe('mergeResponsiveRule', () => {
  it('keeps valid keys (normalized), skips unknown / reserved / invalid ones with a warning', () => {
    const { ctx, warnings } = context();
    const out: Record<string, unknown> = {};
    const isOptOut = mergeResponsiveRule(ctx, { layout: 'list', label: '  Yo ', nope: 1, responsive: {}, columns: 0 }, 'rule', out);
    expect(isOptOut).toBe(false);
    expect(out).toEqual({ layout: 'list', label: 'Yo' });
    expect(warnings).toEqual([
      'rule: unknown key "nope" skipped',
      'rule: reserved key "responsive" skipped',
      'rule: invalid value for "columns" skipped',
    ]);
  });

  it('a page-wide (global) rule skips unknown keys silently', () => {
    const { ctx, warnings } = context();
    mergeResponsiveRule(ctx, { nope: 1 }, 'window.components.responsive', {}, true);
    expect(warnings).toEqual([]);
  });

  it('null is the opt-out signal, undefined is nothing, a non-object warns', () => {
    const { ctx, warnings } = context();
    expect(mergeResponsiveRule(ctx, null, 'r', {})).toBe(true);
    expect(mergeResponsiveRule(ctx, undefined, 'r', {})).toBe(false);
    expect(mergeResponsiveRule(ctx, 42, 'r', {})).toBe(false);
    expect(warnings).toEqual(['r returned a non-object; ignored']);
  });

  it('batch values come along unless the rule names them itself', () => {
    const { ctx } = context();
    const out: Record<string, unknown> = {};
    mergeResponsiveRule(ctx, { preset: 'compact', layout: 'grid' }, 'r', out);
    expect(out).toEqual({ preset: 'compact', layout: 'grid', columns: 1 });
  });

  it('a form-associated host refuses a disabled override', () => {
    const { ctx, warnings } = context({ isFormAssociated: true });
    const out: Record<string, unknown> = {};
    mergeResponsiveRule(ctx, { isDisabled: true }, 'r', out);
    expect(out).toEqual({});
    expect(warnings[0]).toContain('"isDisabled" can\'t be set by a responsive rule');
  });
});

describe('mergeResponsiveMap', () => {
  it('breakpoint entry first, device entry over it (device wins)', () => {
    const { ctx } = context();
    const out: Record<string, unknown> = {};
    mergeResponsiveMap(
      ctx,
      { breakpoint: { mobile: { layout: 'list', columns: 2 } }, device: { tablet: { columns: 4 } } },
      'tablet',
      'mobile',
      'map',
      out,
    );
    expect(out).toEqual({ layout: 'list', columns: 4 });
  });

  it('warns about unknown top-level keys and a non-object axis; a null entry opts out', () => {
    const { ctx, warnings } = context();
    expect(mergeResponsiveMap(ctx, { mobile: {}, device: 'x', breakpoint: { mobile: null } } as never, 'mobile', 'mobile', 'map', {})).toBe(true);
    expect(warnings).toEqual([
      expect.stringContaining('map: unknown top-level key(s) "mobile" ignored'),
      'map.device must be an object; ignored',
    ]);
  });
});

describe('setting validation (shared by page, tag and element setters)', () => {
  it('maps and callbacks, or null / undefined to clear', () => {
    expect([{}, { device: {} }, null, undefined].every(isResponsiveMapSetting)).toBe(true);
    expect([[], 'x', 5].some(isResponsiveMapSetting)).toBe(false);
    expect([() => ({}), null, undefined].every(isResponsiveCallbackSetting)).toBe(true);
    expect(isResponsiveCallbackSetting({})).toBe(false);
  });
});
