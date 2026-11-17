/**
 * A styled layer outside the component (SPEC §12.2, B13): a drag ghost, drop pads over the rows, a
 * "drop files here" overlay that covers the component — things that must not be clipped by the
 * component's `overflow` or stacked under its neighbours. web-treeview built its drop pads and ghost
 * by hand; web-dropzone put its overlay on `<body>` and copied its CSS variables inline.
 *
 * `createLayer(host, { css, className })` mounts a fixed `div.km-layer` in the overlay container
 * (`findOverlayContainer(host)`: `<body>`, or the open modal `<dialog>` / popover the host sits in), with
 * its OWN shadow root: the component's `css` and the motion presets adopted there, the host's theme
 * attributes (`data-theme`, `data-context-theme`, `data-motion`, …) copied onto it. `element` is where
 * the component renders. `place(rect)` positions it in viewport coordinates — compensating for a
 * transformed ancestor of the container (a containing block for fixed elements).
 *
 * The layer isn't the host's descendant, so per-instance custom properties set ON the host don't inherit
 * into it; list the ones the layer CSS reads in `cssVars` and their computed values at the host are copied
 * onto the layer (again on `syncTheme()`). Page-level tokens (`:root`) and the theme arrive on their own.
 * Core's reset (`:host { all: initial }`) sits in the lowest cascade layer (`km-layer-base`), so any of the
 * component's rules — layered or not — win over it (a `:host([data-theme="dark"]) { color-scheme: dark }`).
 */

import { adoptStyles } from '../dom/adopt-styles.js';
import { adoptMotionStyles } from '../environment/motion.js';
import { Z_INDEX } from '../dom/z-index.js';
import { findOverlayContainer } from './overlay-container.js';
import { getFixedPositionOffsetParent } from './containing-block.js';
import { inheritTheme } from './inherit-theme.js';

export interface LayerRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface LayerOptions {
  /** The component's CSS for what it renders in the layer (string or several). */
  css?: string | readonly string[];
  /** Class of `element` (the component's BEM block for the layer, e.g. `wtv-drag-layer`). */
  className?: string;
  /** Stacking (default `Z_INDEX.dropdown`). */
  zIndex?: string;
  /** `false` = `pointer-events: none` (a drag ghost the hit test must see through). Default `true`. */
  isInteractive?: boolean;
  /** Where to mount (default `findOverlayContainer(host)`). */
  container?: HTMLElement;
  /**
   * Custom properties to carry from the host (`['--dz-overlay-bg', …]`): their computed values at the host
   * are set on the layer, so instance-level overrides reach the layer CSS. Re-read by `syncTheme()`.
   */
  cssVars?: readonly string[];
}

export interface Layer {
  /** Render into this (inside the layer's shadow root). */
  readonly element: HTMLElement;
  /** The positioned `div.km-layer` in the overlay container. */
  readonly layer: HTMLElement;
  /** Position + size in viewport coordinates (`host.getBoundingClientRect()` to cover the host). */
  place(rect: LayerRect | DOMRectReadOnly): void;
  /** Copy the host's theme attributes (and `cssVars`) again — after a theme switch or a token change while open. */
  syncTheme(): void;
  destroy(): void;
}

// The lowest cascade layer: declared first, so the component's own layers (and unlayered rules) beat it.
const LAYER_CSS = `
@layer km-layer-base {
  :host { all: initial; display: block; }
  .km-layer__content { position: absolute; inset: 0; box-sizing: border-box; }
}
`;

/** Copy `names`' computed values at `host` onto `layer` (an unset one is removed). */
function copyCssVars(host: HTMLElement, layer: HTMLElement, names: readonly string[]): void {
  if (!names.length) return;
  const style = host.ownerDocument.defaultView?.getComputedStyle(host);
  for (const name of names) {
    const value = style?.getPropertyValue(name).trim() ?? '';
    if (value) layer.style.setProperty(name, value);
    else layer.style.removeProperty(name);
  }
}

export function createLayer(host: HTMLElement, options: LayerOptions = {}): Layer {
  const doc = host.ownerDocument;
  const container = options.container ?? findOverlayContainer(host);
  const layer = doc.createElement('div');
  layer.className = 'km-layer';
  layer.style.cssText = `position: fixed; top: 0; left: 0; width: 0; height: 0; margin: 0; z-index: ${options.zIndex ?? Z_INDEX.dropdown};`;
  if (options.isInteractive === false) layer.style.pointerEvents = 'none';
  const root = layer.attachShadow({ mode: 'open' });
  const css = options.css === undefined ? [] : typeof options.css === 'string' ? [options.css] : [...options.css];
  adoptStyles(root, LAYER_CSS, ...css);
  const element = doc.createElement('div');
  element.className = `km-layer__content${options.className ? ` ${options.className}` : ''}`;
  root.append(element);
  container.append(layer);
  adoptMotionStyles(element);
  let restoreTheme = inheritTheme(host, layer);
  const cssVars = options.cssVars ?? [];
  copyCssVars(host, layer, cssVars);

  return {
    element,
    layer,
    place(rect) {
      let { top, left } = rect;
      const parent = getFixedPositionOffsetParent(layer);
      if (parent !== window && parent instanceof Element) {
        const box = parent.getBoundingClientRect();
        top -= box.top + parent.clientTop;
        left -= box.left + parent.clientLeft;
      }
      layer.style.top = `${top}px`;
      layer.style.left = `${left}px`;
      layer.style.width = `${rect.width}px`;
      layer.style.height = `${rect.height}px`;
    },
    syncTheme() {
      restoreTheme();
      restoreTheme = inheritTheme(host, layer);
      copyCssVars(host, layer, cssVars);
    },
    destroy() {
      restoreTheme();
      layer.remove();
    },
  };
}
