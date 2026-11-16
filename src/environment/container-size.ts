/**
 * Container size buckets (SPEC §6.7): the component's OWN width, the `container` axis of the responsive
 * rules — `narrow` < `--base-container-narrow` (480px) ≤ `medium` < `--base-container-medium` (768px) ≤ `wide`.
 *
 * The thresholds are CSS custom properties read AT the element, so they inherit: `:root` sets them for the
 * page, a sidebar for the components inside it, an element for itself. No JS configuration. Unlike the
 * window breakpoints (`--base-breakpoint-*`, one value for the page), every element can have its own lines.
 */
import { readCssLengthPx } from '../dom/css-values.js';

export const CONTAINER_SIZES = ['narrow', 'medium', 'wide'] as const;
export type ContainerSize = (typeof CONTAINER_SIZES)[number];

/** The upper bounds (exclusive) of `narrow` and `medium`, in px, when the tokens are not set. */
export const DEFAULT_CONTAINER_SIZES = { narrow: 480, medium: 768 } as const;

/** The CSS tokens that move the lines. */
export const CONTAINER_SIZE_TOKENS = {
  narrow: '--base-container-narrow',
  medium: '--base-container-medium',
} as const;

/** The two lines at `el`, in px (tokens resolved where they apply; defaults otherwise). */
export function readContainerLines(el: Element): { narrow: number; medium: number } {
  return {
    narrow: readCssLengthPx(el, CONTAINER_SIZE_TOKENS.narrow, DEFAULT_CONTAINER_SIZES.narrow),
    medium: readCssLengthPx(el, CONTAINER_SIZE_TOKENS.medium, DEFAULT_CONTAINER_SIZES.medium),
  };
}

/** The bucket of a `width` (px) at `el`. */
export function resolveContainerSize(el: Element, width: number): ContainerSize {
  const lines = readContainerLines(el);
  if (width < lines.narrow) return 'narrow';
  if (width < lines.medium) return 'medium';
  return 'wide';
}
