import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLabels,
  formatLabel,
  formatNumber,
  getDateFormat,
  getLocaleSettings,
  getMonthNames,
  getNumberSeparators,
  getPageLocale,
  getTimeFormat,
  getWeekdayNames,
  getWeekStartDay,
  observeLocale,
  parseNumber,
  publishLocaleHooks,
  resolveLocale,
} from './index.js';
import { BlissElement } from '../element/bliss-element.js';
import { define } from '../element/define.js';
import { getLocaleRevision } from './page-locale.js';

const page = (): Record<string, unknown> => window.components as unknown as Record<string, unknown>;

afterEach(() => {
  publishLocaleHooks();
  page().locale = null;
  page().security = null;
  vi.restoreAllMocks();
});

describe('window.components.locale / .security', () => {
  it('non-enumerable accessors; assigning replaces with a frozen copy and notifies', () => {
    publishLocaleHooks();
    expect(Object.keys(window.components!)).not.toContain('locale');
    const heard = vi.fn();
    const stop = observeLocale(heard);
    const mine = { locale: 'cs-CZ', labels: { 'web-x': { ok: 'Dobře' } } };
    page().locale = mine;
    expect(heard).toHaveBeenCalledTimes(1);
    const stored = getPageLocale()!;
    expect(stored).not.toBe(mine);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.labels!['web-x'])).toBe(true);
    expect(() => {
      'use strict';
      (stored.labels!['web-x'] as Record<string, string>).ok = 'x';
    }).toThrow();
    page().security = { shouldEscapeLabels: true };
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    page().locale = null;
    expect(heard).toHaveBeenCalledTimes(2);
    expect(getPageLocale()).toBeUndefined();
  });

  it('a non-object is refused (kept), a bad formatLabelCallback dropped', () => {
    page().locale = { locale: 'de' };
    page().locale = 'de';
    expect(getPageLocale()?.locale).toBe('de');
    page().locale = { formatLabelCallback: 'nope' };
    expect(getPageLocale()?.formatLabelCallback).toBeUndefined();
  });

  it('the browser languagechange event notifies', () => {
    const heard = vi.fn();
    const stop = observeLocale(heard);
    const before = getLocaleRevision();
    window.dispatchEvent(new Event('languagechange'));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(getLocaleRevision()).toBe(before + 1);
    stop();
  });
});

describe('resolveLocale / getLocaleSettings', () => {
  it('instance → page → browser; auto / invalid fall through', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
    expect(resolveLocale()).toBe('fr-FR');
    page().locale = { locale: 'de-DE' };
    expect(resolveLocale('auto')).toBe('de-DE');
    expect(resolveLocale('en-us')).toBe('en-US');
    expect(resolveLocale('not a locale!!')).toBe('de-DE');
  });

  it('per key: instance → page → derived from the resolved locale', () => {
    page().locale = { locale: 'en-US', decimalSeparator: ',' };
    const s = getLocaleSettings({ locale: 'de-DE', weekStartDay: 0 });
    expect(s.locale).toBe('de-DE');
    expect(s.weekStartDay).toBe(0); // instance
    expect(s.decimalSeparator).toBe(','); // page (the user's preference)
    expect(s.thousandsSeparator).toBe('.'); // derived for de
    expect(s.dateFormat).toBe('DD.MM.YYYY');
    expect(s.timeFormat).toBe('24h');
    expect(getLocaleSettings({ locale: 'en-US', weekStartDay: 9 }).weekStartDay).toBe(0); // invalid → derived (US Sunday)
  });

  it('derivations from Intl', () => {
    expect(getDateFormat('en-US')).toBe('MM/DD/YYYY');
    expect(getDateFormat('de')).toBe('DD.MM.YYYY');
    expect(getTimeFormat('en-US')).toBe('12h');
    expect(getTimeFormat('cs')).toBe('24h');
    expect(getWeekStartDay('en-US')).toBe(0);
    expect(getWeekStartDay('cs-CZ')).toBe(1);
    expect(getNumberSeparators('en-US')).toEqual({ decimalSeparator: '.', thousandsSeparator: ',' });
    expect(getNumberSeparators('de-DE')).toEqual({ decimalSeparator: ',', thousandsSeparator: '.' });
    expect(getMonthNames('en-US')[0]).toBe('January');
    expect(getMonthNames('en-US', 'short')[11]).toBe('Dec');
    expect(getWeekdayNames('en-US')).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(getWeekdayNames('de', 'long')[1]).toBe('Montag');
  });
});

describe('formatNumber / parseNumber', () => {
  it('format swaps in the resolved separators', () => {
    expect(formatNumber(1234567.5, { locale: 'en-US' })).toBe('1,234,567.5');
    expect(formatNumber(1234.5, { locale: 'de-DE' })).toBe('1.234,5');
    page().locale = { thousandsSeparator: ' ', decimalSeparator: ',' };
    expect(formatNumber(1234.5, { locale: 'en-US', minimumFractionDigits: 2 })).toBe('1 234,50');
    expect(formatNumber(1234.5, { locale: 'en-US', shouldGroup: false })).toBe('1234,5');
    expect(formatNumber(Number.NaN)).toBe('');
  });

  it('parse with the resolved separators', () => {
    expect(parseNumber('1,234.5', { locale: 'en-US' })).toBe(1234.5);
    expect(parseNumber('1.234,5', { locale: 'de-DE' })).toBe(1234.5);
    expect(parseNumber('1 234,5', { locale: 'cs-CZ' })).toBe(1234.5);
    expect(parseNumber('1.5', { locale: 'cs-CZ' })).toBe(1.5); // '.' can't be a group in cs
    expect(parseNumber('−3,25', { locale: 'de-DE' })).toBe(-3.25);
    expect(parseNumber('', { locale: 'en-US' })).toBeNull();
    expect(parseNumber('12abc', { locale: 'en-US' })).toBeNull();
    expect(parseNumber('1,2,3.4.5', { locale: 'en-US' })).toBeNull();
  });
});

describe('labels', () => {
  const DEFAULTS = { cancel: 'Cancel {name}', empty: 'Nothing', count: '{count} files' };
  const host = document.createElement('web-x');

  it('per key: instance → page-wide → English; "" is a deliberate empty label', () => {
    let own: Partial<typeof DEFAULTS> | null = { empty: '' };
    const labels = createLabels(host, DEFAULTS, () => own);
    page().locale = { labels: { 'web-x': { cancel: 'Zrušit {name}', count: 42 as unknown as string } } };
    expect(labels.text('cancel', { name: 'a.txt' })).toBe('Zrušit a.txt');
    expect(labels.text('empty')).toBe('');
    expect(labels.text('count', { count: 3 })).toBe('3 files'); // non-string page value ignored
    own = null;
    expect(labels.all()).toEqual({ cancel: 'Zrušit {name}', empty: 'Nothing', count: '{count} files' });
  });

  it('text never escapes; html escapes the values, or the whole label when shouldEscapeLabels', () => {
    const labels = createLabels(host, { add: '<b>Add</b> "{value}"' }, () => null);
    expect(labels.text('add', { value: '<i>' })).toBe('<b>Add</b> "<i>"');
    expect(labels.html('add', { value: '<i>' })).toBe('<b>Add</b> "&lt;i&gt;"');
    page().security = { shouldEscapeLabels: true };
    expect(labels.html('add', { value: '<i>' })).toBe('&lt;b&gt;Add&lt;/b&gt; &quot;&lt;i&gt;&quot;');
  });

  it('formatLabelCallback formats; a throw or non-string falls back to {name}', () => {
    const labels = createLabels(host, DEFAULTS, () => null, { getLocale: () => 'cs' });
    const callback = vi.fn((ctx: { component: string; key: string; params: Record<string, unknown>; locale: string }) =>
      ctx.key === 'count' ? `${ctx.component}.${ctx.key}:${String(ctx.params.count)}@${ctx.locale}` : ctx.key === 'empty' ? (undefined as unknown as string) : (() => { throw new Error('x'); })(),
    );
    page().locale = { formatLabelCallback: callback };
    expect(labels.text('count', { count: 2 })).toBe('web-x.count:2@cs');
    expect(labels.text('empty')).toBe('Nothing');
    expect(labels.text('cancel', { name: 'f' })).toBe('Cancel f');
  });

  it('a number param is shown locale-formatted; formatLabelCallback gets the raw number; a string stays as is', () => {
    const labels = createLabels(host, DEFAULTS, () => null, { getLocale: () => 'en-US' });
    expect(labels.text('count', { count: 12345 })).toBe('12,345 files');
    expect(labels.text('count', { count: '2026' })).toBe('2026 files'); // a string: not grouped
    page().locale = { thousandsSeparator: ' ' };
    expect(labels.text('count', { count: 12345 })).toBe('12 345 files');
    let seen: unknown;
    page().locale = { formatLabelCallback: (ctx: { params: Record<string, unknown> }) => ((seen = ctx.params.count), 'x') };
    labels.text('count', { count: 12345 });
    expect(seen).toBe(12345);
  });

  it('formatLabel leaves unknown placeholders', () => {
    expect(formatLabel('{a} {b}', { a: 1 })).toBe('1 {b}');
  });
});

describe('BlissElement.localeChanged()', () => {
  class LocaleEl extends BlissElement {
    static inputs = [];
    calls = 0;
    protected override localeChanged(): void {
      this.calls++;
    }
  }
  define('locale-hook-el', LocaleEl);

  it('fires on a change while connected (not on the first connect); replays a change missed while detached', async () => {
    const el = document.createElement('locale-hook-el') as LocaleEl;
    document.body.append(el);
    await el.whenSettled();
    expect(el.calls).toBe(0);
    page().locale = { locale: 'cs' };
    expect(el.calls).toBe(1);
    el.remove();
    page().locale = { locale: 'de' };
    expect(el.calls).toBe(1);
    document.body.append(el);
    expect(el.calls).toBe(2);
    el.remove();
    document.body.append(el); // nothing changed meanwhile
    expect(el.calls).toBe(2);
    el.destroy();
    el.remove();
  });
});
