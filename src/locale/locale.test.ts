import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLabels,
  formatLabel,
  formatNumber,
  getDateFormat,
  getLabelSiblings,
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
    const mine = { locale: 'cs-CZ', labels: { 'web-x.buttons.ok': 'Dobře' } };
    page().locale = mine;
    expect(heard).toHaveBeenCalledTimes(1);
    const stored = getPageLocale()!;
    expect(stored).not.toBe(mine);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.labels)).toBe(true);
    expect(() => {
      'use strict';
      (stored.labels as Record<string, string>)['web-x.buttons.ok'] = 'x';
    }).toThrow();
    page().security = { shouldEscapeLabels: true };
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    page().locale = null;
    expect(heard).toHaveBeenCalledTimes(2);
    expect(getPageLocale()).toBeUndefined();
  });

  it('labels is one flat dictionary: non-strings dropped, nested per-tag objects warn + ignored', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    page().locale = { labels: { 'web-x.buttons.ok': 'OK', 'web-x.buttons.no': 3, 'web-x': { ok: 'x' }, 'app.title': 'App' } };
    expect(getPageLocale()?.labels).toEqual({ 'web-x.buttons.ok': 'OK', 'app.title': 'App' });
    expect(warn.mock.calls.some((c) => String(c.join(' ')).includes('ONE flat dictionary'))).toBe(true);
  });

  it('formatLabelCallback (renamed translateCallback) warns + is dropped; a bad translateCallback dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    page().locale = { formatLabelCallback: () => 'x', translateCallback: 'nope' };
    expect(getPageLocale()).not.toHaveProperty('formatLabelCallback');
    expect(getPageLocale()?.translateCallback).toBeUndefined();
    expect(warn.mock.calls.some((c) => String(c.join(' ')).includes('now translateCallback'))).toBe(true);
  });

  it('a non-object is refused (kept)', () => {
    page().locale = { locale: 'de' };
    page().locale = 'de';
    expect(getPageLocale()?.locale).toBe('de');
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
  const DEFAULTS = { 'buttons.cancel': 'Cancel {name}', 'messages.empty': 'Nothing', 'labels.count': '{count} files' };
  const host = document.createElement('web-x');

  it('per key: instance → page-wide flat `<tag>.<key>` → English; "" is a deliberate empty label', () => {
    let own: Record<string, unknown> | null = { 'messages.empty': '' };
    const labels = createLabels(host, DEFAULTS, () => own);
    page().locale = { labels: { 'web-x.buttons.cancel': 'Zrušit {name}', 'web-x.labels.count': 42, 'buttons.cancel': 'no prefix' } };
    expect(labels.text('buttons.cancel', { name: 'a.txt' })).toBe('Zrušit a.txt');
    expect(labels.text('messages.empty')).toBe('');
    expect(labels.text('labels.count', { count: 3 })).toBe('3 files'); // non-string page value ignored
    own = null;
    expect(labels.all()).toEqual({ 'buttons.cancel': 'Zrušit {name}', 'messages.empty': 'Nothing', 'labels.count': '{count} files' });
  });

  it('the instance takes the short or the full key; the prefix is options.tag, not the element tag', () => {
    const own = { 'web-grid.buttons.cancel': 'Full {name}' };
    const labels = createLabels(document.createElement('my-grid'), DEFAULTS, () => own, { tag: 'web-grid' });
    expect(labels.text('buttons.cancel', { name: 'f' })).toBe('Full f');
    page().locale = { labels: { 'web-grid.messages.empty': 'Prázdné', 'my-grid.messages.empty': 'wrong' } };
    expect(labels.text('messages.empty')).toBe('Prázdné');
  });

  it('text never escapes; html escapes the values, or the whole label when shouldEscapeLabels', () => {
    const labels = createLabels(host, { add: '<b>Add</b> "{value}"' }, () => null);
    expect(labels.text('add', { value: '<i>' })).toBe('<b>Add</b> "<i>"');
    expect(labels.html('add', { value: '<i>' })).toBe('<b>Add</b> "&lt;i&gt;"');
    page().security = { shouldEscapeLabels: true };
    expect(labels.html('add', { value: '<i>' })).toBe('&lt;b&gt;Add&lt;/b&gt; &quot;&lt;i&gt;&quot;');
  });

  it('translateCallback gets the full key; null / a throw falls back to {name}; never asked for an instance key', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const own = { 'messages.empty': 'Mine {n}' };
    const labels = createLabels(host, DEFAULTS, () => own, { getLocale: () => 'cs' });
    const callback = vi.fn((ctx: { component: string; key: string; template: string; params: Record<string, unknown>; locale: string }) =>
      ctx.key === 'web-x.labels.count'
        ? `${ctx.component}|${ctx.key}:${String(ctx.params.count)}@${ctx.locale}`
        : ctx.key === 'web-x.buttons.cancel'
          ? null
          : (() => { throw new Error('x'); })(),
    );
    page().locale = { translateCallback: callback };
    expect(labels.text('labels.count', { count: 2 })).toBe('web-x|web-x.labels.count:2@cs');
    expect(labels.text('buttons.cancel', { name: 'f' })).toBe('Cancel f'); // null = not mine
    expect(labels.text('messages.empty', { n: 1 })).toBe('Mine 1'); // the instance's own text
    expect(callback.mock.calls.map(([c]) => c.key)).toEqual(['web-x.labels.count', 'web-x.buttons.cancel']);
    expect(callback.mock.calls[1]![0].template).toBe('Cancel {name}');
  });

  it('a number param is shown locale-formatted; translateCallback gets the raw number; a string stays as is', () => {
    const labels = createLabels(host, DEFAULTS, () => null, { getLocale: () => 'en-US' });
    expect(labels.text('labels.count', { count: 12345 })).toBe('12,345 files');
    expect(labels.text('labels.count', { count: '2026' })).toBe('2026 files'); // a string: not grouped
    page().locale = { thousandsSeparator: ' ' };
    expect(labels.text('labels.count', { count: 12345 })).toBe('12 345 files');
    let seen: unknown;
    page().locale = { translateCallback: (ctx: { params: Record<string, unknown> }) => ((seen = ctx.params.count), 'x') };
    labels.text('labels.count', { count: 12345 });
    expect(seen).toBe(12345);
  });

  describe('sibling fallback (ariaLabels / tooltips nobody set → a customized twin with the same name)', () => {
    const TWINS = {
      'labels.prompt': 'Drop files here',
      'ariaLabels.prompt': 'Drop files here',
      'buttons.clear': 'Clear',
      'ariaLabels.clear': 'Clear',
      'tooltips.clear': 'Clear the value',
      'ariaLabels.close': 'Close',
      'tooltips.close': 'Close',
      'messages.noData': 'No data',
      'labels.noData': 'unused',
    };
    const el = document.createElement('web-dz');

    it('getLabelSiblings: visible texts first; visible types have none', () => {
      expect(getLabelSiblings('ariaLabels.x')).toEqual(['buttons.x', 'labels.x', 'headers.x', 'menuItems.x', 'tooltips.x']);
      expect(getLabelSiblings('tooltips.x')).toEqual(['buttons.x', 'labels.x', 'menuItems.x', 'ariaLabels.x']);
      expect(getLabelSiblings('buttons.x')).toEqual([]);
      expect(getLabelSiblings('nodot')).toEqual([]);
    });

    it('only the visible text translated → the aria name follows it (instance or page); nothing set → English', () => {
      let own: Record<string, unknown> | null = { 'labels.prompt': 'Přetáhněte soubory sem' };
      const labels = createLabels(el, TWINS, () => own);
      expect(labels.text('ariaLabels.prompt')).toBe('Přetáhněte soubory sem');
      expect(labels.template('ariaLabels.prompt')).toBe('Přetáhněte soubory sem');
      own = null;
      expect(labels.text('ariaLabels.prompt')).toBe('Drop files here');
      page().locale = { labels: { 'web-dz.buttons.clear': 'Vymazat' } };
      expect(labels.text('ariaLabels.clear')).toBe('Vymazat');
      expect(labels.text('tooltips.clear')).toBe('Vymazat'); // buttons.x comes before its own English
      expect(labels.all()['ariaLabels.clear']).toBe('Vymazat');
    });

    it('a key that is set is respected, even in English; visible types never fall back', () => {
      const own = { 'labels.prompt': 'Přetáhněte', 'ariaLabels.prompt': 'Drop files here', 'labels.noData': 'Nic' };
      const labels = createLabels(el, TWINS, () => own);
      expect(labels.text('ariaLabels.prompt')).toBe('Drop files here');
      expect(labels.text('messages.noData')).toBe('No data');
    });

    it('order: a visible twin beats the tooltip; a sibling the component lacks is skipped', () => {
      page().locale = { labels: { 'web-dz.tooltips.close': 'Zavřít panel', 'web-dz.buttons.close': 'not a key of this component' } };
      const labels = createLabels(el, TWINS, () => null);
      expect(labels.text('ariaLabels.close')).toBe('Zavřít panel');
      page().locale = { labels: { 'web-dz.tooltips.clear': 'Vymaže hodnotu', 'web-dz.buttons.clear': 'Vymazat' } };
      expect(labels.text('ariaLabels.clear')).toBe('Vymazat');
    });

    it('translateCallback: own key first, then the twin; null for both → English', () => {
      const asked: string[] = [];
      page().locale = {
        translateCallback: ({ key }: { key: string }) => (asked.push(key), key === 'web-dz.labels.prompt' ? 'Přetáhněte' : null),
      };
      const labels = createLabels(el, TWINS, () => null);
      expect(labels.text('ariaLabels.prompt')).toBe('Přetáhněte');
      expect(asked).toEqual(['web-dz.ariaLabels.prompt', 'web-dz.labels.prompt']);
      expect(labels.text('ariaLabels.close')).toBe('Close');
    });
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
