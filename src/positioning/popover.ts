/**
 * `createPopover()` — the dropdown / popover / panel preset (SPEC §12.2),
 * covering the multiselect dropdown, daterangepicker calendar, grid
 * contextmenu/datepicker/dropdown/toolbar, and dropzone popover. Defaults to
 * `placement: 'bottom-start'`, portals the panel to `document.body` (or the open
 * modal `<dialog>` around the reference), matches the reference width on request
 * (`size()`, replacing the per-component width hacks), and keeps position updated
 * while open. Every {@link AnchorOptions} field is forwarded to `anchor()`.
 */
import { findOverlayContainer } from './overlay-container.js';
import { anchor } from './anchor.js';
import type { AnchorHandle, AnchorOptions } from './types.js';

/** A DOM element or a floating-ui `VirtualElement` to anchor against. */
type Reference = Parameters<typeof anchor>[1];

/**
 * Options for {@link createPopover}: the panel, its reference, where to mount it — and every
 * {@link AnchorOptions} field (`placement` defaults to `'bottom-start'`, `inheritThemeFrom` to
 * the reference when it is an element), passed to `anchor()` as given.
 */
export interface PopoverOptions extends AnchorOptions {
  /** The element (or virtual element) the panel anchors to. */
  reference: Reference;
  /** The panel element to position and portal. */
  panel: HTMLElement;
  /**
   * Where to mount the panel while open. Default: the nearest open modal `<dialog>` /
   * `:popover-open` element around the reference (the top layer), else `document.body`.
   */
  container?: HTMLElement;
}

/** Handle returned by {@link createPopover}. */
export interface PopoverHandle {
  /** Whether the panel is currently open. */
  readonly isOpen: boolean;
  /** Mount + position the panel and keep it placed. */
  open(): void;
  /** Unmount the panel and stop positioning. */
  close(): void;
  /** Recompute the position once (no-op when closed). */
  update(): void;
  /** Close and release everything. Idempotent; `open()` does nothing afterwards. */
  destroy(): void;
}

export function createPopover(opts: PopoverOptions): PopoverHandle {
  const { reference, panel, container: containerOption, ...anchorOptions } = opts;
  // Resolved at each open: a trigger inside a modal <dialog> mounts the panel in the dialog.
  const container = (): HTMLElement =>
    containerOption ?? findOverlayContainer(reference instanceof Element ? reference : null);
  let handle: AnchorHandle | undefined;
  let isOpen = false;
  let isDestroyed = false;

  const defaultTheme = anchorOptions.inheritThemeFrom ?? (reference instanceof HTMLElement ? reference : undefined);

  const close = (): void => {
    if (!isOpen) return;
    isOpen = false;
    handle?.destroy();
    handle = undefined;
    panel.remove();
  };

  return {
    get isOpen() {
      return isOpen;
    },
    open() {
      if (isOpen || isDestroyed) return;
      isOpen = true;
      container().append(panel);
      handle = anchor(panel, reference, {
        ...anchorOptions,
        placement: anchorOptions.placement ?? 'bottom-start',
        ...(defaultTheme ? { inheritThemeFrom: defaultTheme } : {}),
      });
    },
    close,
    update() {
      handle?.update();
    },
    // Not `this.close()`: a destructured `destroy` (`const { destroy } = popover`) still works.
    destroy() {
      isDestroyed = true;
      close();
    },
  };
}
