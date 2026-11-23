/** Locale + UI strings (SPEC §12.24): `window.components.locale` / `.security`, settings, numbers, labels. */
export { getPageLocale, getPageSecurity, observePageLocale, publishLocaleHooks } from './page-locale.js';
export type { LabelTranslateContext, LocaleSettings, PageLocale, PageSecurity, TranslateCallback } from './page-locale.js';
export {
  getDateFormat,
  resolveLocaleSettings,
  getMonthNames,
  getNumberSeparators,
  getTimeFormat,
  getWeekdayNames,
  getWeekStartDay,
  resolveLocale,
} from './settings.js';
export type { ResolvedLocaleSettings } from './settings.js';
export { formatNumber, parseNumber } from './numbers.js';
export type { NumberFormatOptions, ParseNumberCallback, ParseNumberContext, ParseNumberOptions } from './numbers.js';
export { createLabels, createLabelsView, formatLabel, getLabelFallbackKeys, resolveLabel } from './labels.js';
export type { CreateLabelsOptions, LabelParams, Labels, LabelsView, OwnLabels } from './labels.js';
