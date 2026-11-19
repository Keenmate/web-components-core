/** Locale + UI strings (SPEC §12.24): `window.components.locale` / `.security`, settings, numbers, labels. */
export { getPageLocale, getPageSecurity, observeLocale, publishLocaleHooks } from './page-locale.js';
export type { LabelTranslateContext, LocaleSettings, PageLocale, PageSecurity, TranslateCallback } from './page-locale.js';
export {
  getDateFormat,
  getLocaleSettings,
  getMonthNames,
  getNumberSeparators,
  getTimeFormat,
  getWeekdayNames,
  getWeekStartDay,
  resolveLocale,
} from './settings.js';
export type { ResolvedLocaleSettings } from './settings.js';
export { formatNumber, parseNumber } from './numbers.js';
export type { NumberFormatOptions } from './numbers.js';
export { createLabels, formatLabel, getLabelSiblings, resolveLabel } from './labels.js';
export type { CreateLabelsOptions, LabelParams, Labels, OwnLabels } from './labels.js';
