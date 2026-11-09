/**
 * `openMenu()` — the shared context / dropdown menu (SPEC §12.13). Renders core
 * `/actions` menu entries (icon, label, shortcut, danger / toggled / disabled,
 * named dividers, `cssClass`), opens submenus (static `children` or a lazy
 * `getChildrenCallback` with a loading row), positions every level through
 * `/positioning` `anchor()`, dismisses on outside interaction, and implements the
 * WAI-ARIA menu keyboard model with roving focus.
 */
import { getMenuChildren, isMenuDivider, resolveMenuEntries } from '../actions/resolve.js';
import type { MenuEntry, MenuItem, ResolvedActionItem } from '../actions/types.js';
import { deepActiveElement } from '../dom/active-element.js';
import { adoptStyles } from '../dom/adopt-styles.js';
import { composedClosest } from '../dom/composed-tree.js';
import { sharedState, sharedStateKey } from '../global/shared-state.js';
import { coreLog } from '../logging/element-logger.js';
import { callSafely } from '../logging/safe-call.js';
import { registerOverlay, type OverlayHandle } from '../overlay/active-overlay.js';
import { anchor } from '../positioning/anchor.js';
import { watchScrollClose } from '../positioning/scroll-close.js';
import type { AnchorHandle } from '../positioning/types.js';
import { MENU_CSS } from './styles.js';
import type { MenuCloseReason, MenuHandle, MenuPoint, OpenMenuOptions } from './types.js';

type Entries<Ctx, A extends string> = readonly (MenuEntry<Ctx, A> | string)[];

/** Delay before a submenu the pointer left collapses (time to cross the gap). */
const SUBMENU_HIDE_DELAY = 150;

const BLOCK = 'km-menu';
const ITEM = `${BLOCK}__item`;

/** One open menu level. Open levels form a chain: root → submenu → sub-submenu. */
interface Level<Ctx, A extends string> {
  el: HTMLElement;
  /** The item in the parent level that opened this one (`null` for the root). */
  owner: HTMLElement | null;
  /** Re-readable entries (re-rendered after a keep-open item runs). */
  source: () => Entries<Ctx, A> | Promise<Entries<Ctx, A>>;
  position: AnchorHandle | null;
  /** Bumped per (re)fill, so a stale lazy load is dropped. */
  token: number;
}

interface ItemRecord<Ctx, A extends string> {
  item: MenuItem<Ctx, A>;
  resolved: ResolvedActionItem<A>;
  hasChildren: boolean;
}

function isPoint(at: OpenMenuOptions<unknown>['at']): at is MenuPoint {
  return typeof (at as Element).getBoundingClientRect !== 'function';
}

function isThenable<T>(value: unknown): value is PromiseLike<T> {
  return !!value && typeof (value as PromiseLike<T>).then === 'function';
}

/**
 * The open menus, oldest first, page-wide (every copy of core): with two menus open, only
 * the last one handles the keyboard, so one Escape closes one menu.
 */
const openMenuStack = (): object[] => sharedState(sharedStateKey('open-menus'), () => [] as object[]);

function addClasses(el: HTMLElement, classes: string | undefined): void {
  for (const c of (classes ?? '').split(/\s+/)) if (c) el.classList.add(c);
}

/**
 * Open a menu of `entries` resolved against `ctx` (the surface context — the
 * node / row / selection it opened on). Returns a handle; when no item is
 * visible nothing is rendered and the handle is already closed.
 */
export function openMenu<Ctx, A extends string = string>(
  entries: Entries<Ctx, A> | null | undefined,
  ctx: Ctx,
  opts: OpenMenuOptions<Ctx, A>,
): MenuHandle {
  const host = opts.host;
  const styleRoot = (typeof ShadowRoot !== 'undefined' && host instanceof ShadowRoot
    ? host
    : host.getRootNode()) as Document | ShadowRoot;
  const isCustom = typeof opts.renderMenuCallback === 'function';
  const shouldDismissOutside = opts.shouldCloseOnOutsideInteraction ?? true;

  const records = new WeakMap<HTMLElement, ItemRecord<Ctx, A>>();
  const chain: Level<Ctx, A>[] = [];
  let isOpen = true;
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Hover intent: a sibling's submenu opens after a short delay while another submenu is open. */
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  const hostElement = typeof ShadowRoot !== 'undefined' && host instanceof ShadowRoot ? host.host : (host as Element);
  /** The element the menu was opened from (focus returns there). */
  const opener: Element = opts.returnFocusTo ?? (opts.at instanceof Element ? opts.at : hostElement);
  /** Right-to-left (the opener's `dir`): submenus open to the left and ← / → swap. */
  const isRtl = composedClosest(opener, '[dir]')?.getAttribute('dir')?.toLowerCase() === 'rtl';
  /** This menu's place in the page-wide stack of open menus — only the topmost handles keys. */
  const menuToken = {};
  let overlay: OverlayHandle | null = null;
  let detachListeners: (() => void) | null = null;

  // ── Rendering ──────────────────────────────────────────────────────────

  const createLevelElement = (isSubmenu: boolean): HTMLElement => {
    const el = document.createElement('div');
    el.className = isSubmenu ? `${BLOCK} ${BLOCK}--submenu` : BLOCK;
    if (isCustom && !isSubmenu) el.classList.add(`${BLOCK}--custom`);
    addClasses(el, opts.cssClass);
    if (!isCustom) el.setAttribute('role', 'menu');
    el.tabIndex = -1;
    return el;
  };

  const prepare = (raw: MenuEntry<Ctx, A> | string): MenuEntry<Ctx, A> | string => {
    if (!opts.prepareItemCallback) return raw;
    const entry = typeof raw === 'string' ? ({ action: raw } as MenuItem<Ctx, A>) : raw;
    return isMenuDivider(entry) ? entry : opts.prepareItemCallback(entry);
  };

  /** Render `list` into a level. Returns the number of items rendered. */
  const renderLevel = (level: Level<Ctx, A>, list: Entries<Ctx, A>): number => {
    const el = level.el;
    el.textContent = '';
    el.removeAttribute('aria-busy');
    const resolvedEntries = resolveMenuEntries(list.map(prepare), ctx, opts.defaults, host);
    // Any icon at this level → every item gets the icon column, so labels line up.
    const hasIcons = resolvedEntries.some((e) => e.kind === 'item' && !!e.resolved.icon);
    el.classList.toggle(`${BLOCK}--has-icons`, hasIcons);
    let count = 0;
    for (const entry of resolvedEntries) {
      if (entry.kind === 'divider') {
        const divider = document.createElement('div');
        divider.className = `${BLOCK}__divider`;
        divider.setAttribute('role', 'separator');
        if (entry.text) {
          divider.classList.add(`${BLOCK}__divider--named`);
          divider.textContent = entry.text;
        }
        el.appendChild(divider);
        continue;
      }
      const { item, resolved, hasChildren } = entry;
      const itemEl = document.createElement('div');
      itemEl.className = ITEM;
      // A toggle (defines its toggle state) is a menuitemcheckbox; the rest are menuitems.
      itemEl.setAttribute('role', resolved.isToggle ? 'menuitemcheckbox' : 'menuitem');
      if (resolved.isToggle) itemEl.setAttribute('aria-checked', String(resolved.isToggled));
      itemEl.tabIndex = -1;
      itemEl.dataset.action = resolved.action;
      if (resolved.id !== undefined) itemEl.dataset.id = resolved.id;
      if (resolved.isDisabled) {
        itemEl.classList.add(`${ITEM}--disabled`);
        itemEl.setAttribute('aria-disabled', 'true');
      }
      if (resolved.isDanger) itemEl.classList.add(`${ITEM}--danger`);
      if (resolved.isToggled) itemEl.classList.add(`${ITEM}--toggled`);
      if (hasChildren) {
        itemEl.classList.add(`${ITEM}--has-submenu`);
        itemEl.setAttribute('aria-haspopup', 'menu');
        itemEl.setAttribute('aria-expanded', 'false');
      }
      addClasses(itemEl, resolved.cssClass);
      if (resolved.tooltip) itemEl.title = resolved.tooltip;

      opts.renderItemCallback?.(item, itemEl, ctx, resolved);
      if (!itemEl.hasChildNodes()) {
        if (hasIcons) {
          const icon = document.createElement('span');
          icon.className = `${BLOCK}__icon`;
          icon.setAttribute('aria-hidden', 'true');
          // Developer-supplied markup (an <svg>, an <i class>, a glyph) — like action buttons.
          if (resolved.icon) icon.innerHTML = resolved.icon;
          itemEl.appendChild(icon);
        }
        const label = document.createElement('span');
        label.className = `${BLOCK}__label`;
        label.textContent = resolved.text;
        itemEl.appendChild(label);
        if (resolved.shortcut) {
          const shortcut = document.createElement('span');
          shortcut.className = `${BLOCK}__shortcut`;
          shortcut.textContent = resolved.shortcut;
          itemEl.appendChild(shortcut);
        }
      }

      records.set(itemEl, { item, resolved, hasChildren });
      itemEl.addEventListener('mouseenter', () => onItemEnter(itemEl));
      itemEl.addEventListener('mouseleave', () => onItemLeave(itemEl));
      el.appendChild(itemEl);
      count++;
    }
    return count;
  };

  const showLoading = (level: Level<Ctx, A>): void => {
    const loading = document.createElement('div');
    loading.className = `${BLOCK}__loading`;
    loading.setAttribute('role', 'none');
    loading.textContent = opts.labels?.loading ?? '…';
    level.el.replaceChildren(loading);
    level.el.setAttribute('aria-busy', 'true'); // cleared when the items are rendered
  };

  /**
   * (Re)fill a level from its source: synchronously for a static list, else
   * a loading row until the promise resolves. `onFilled(count)` runs once the
   * items are in (not when the level was closed or refilled meanwhile).
   */
  const fillLevel = (level: Level<Ctx, A>, onFilled?: (count: number) => void): void => {
    const token = ++level.token;
    let result: Entries<Ctx, A> | Promise<Entries<Ctx, A>>;
    try {
      result = level.source();
    } catch (error) {
      coreLog(host, 'UI', 'MENU').error('menu entries threw', error);
      result = [];
    }
    if (!isThenable<Entries<Ctx, A>>(result)) {
      onFilled?.(renderLevel(level, result));
      return;
    }
    showLoading(level);
    void Promise.resolve(result).then(
      (list) => {
        if (token !== level.token || !chain.includes(level)) return;
        const count = renderLevel(level, list ?? []);
        level.position?.update();
        onFilled?.(count);
      },
      (error) => {
        coreLog(host, 'UI', 'MENU').error('menu entries threw', error);
        if (token === level.token && chain.includes(level)) onFilled?.(renderLevel(level, []));
      },
    );
  };

  // ── Levels ─────────────────────────────────────────────────────────────

  const levelIndexOf = (el: Element): number => chain.findIndex((l) => l.el.contains(el));

  /** Close every level from `depth` down (submenus only — the root closes via `close()`). */
  const collapseFrom = (depth: number): void => {
    while (chain.length > Math.max(depth, 1)) {
      const level = chain.pop()!;
      const hadFocus = level.el.contains(deepActiveElement());
      level.position?.destroy();
      level.el.remove();
      level.owner?.setAttribute('aria-expanded', 'false');
      if (hadFocus) level.owner?.focus({ preventScroll: true });
    }
  };

  const cancelCollapse = (): void => {
    if (collapseTimer !== null) clearTimeout(collapseTimer);
    collapseTimer = null;
    if (openTimer !== null) clearTimeout(openTimer);
    openTimer = null;
  };

  const scheduleCollapse = (depth: number): void => {
    cancelCollapse();
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      if (isOpen) collapseFrom(depth);
    }, SUBMENU_HIDE_DELAY);
  };

  const enabledItems = (level: Level<Ctx, A>): HTMLElement[] =>
    Array.from(level.el.children).filter(
      (el): el is HTMLElement => records.has(el as HTMLElement) && !records.get(el as HTMLElement)!.resolved.isDisabled,
    );

  const focusItem = (el: HTMLElement | undefined): void => {
    el?.focus({ preventScroll: false });
  };

  /** Open the submenu of `owner` (at `depth`), optionally focusing its first item once loaded. */
  const openSubmenu = (depth: number, owner: HTMLElement, shouldFocus: boolean): void => {
    const record = records.get(owner);
    if (!record?.hasChildren || record.resolved.isDisabled) return;
    const open = chain[depth + 1];
    if (open?.owner === owner) {
      if (shouldFocus) focusItem(enabledItems(open)[0]);
      return;
    }
    collapseFrom(depth + 1);
    const { item } = record;
    const level: Level<Ctx, A> = {
      el: createLevelElement(true),
      owner,
      source:
        typeof item.getChildrenCallback === 'function'
          ? () => getMenuChildren(item, ctx, host)
          : () => item.children ?? [],
      position: null,
      token: 0,
    };
    chain.push(level);
    owner.setAttribute('aria-expanded', 'true');
    // The submenu is named by the item that opened it (WAI-ARIA menu pattern).
    const ownerLabel = record.resolved.text;
    if (ownerLabel) level.el.setAttribute('aria-label', ownerLabel);
    level.el.addEventListener('mouseenter', cancelCollapse);
    level.el.addEventListener('mouseleave', () => {
      const index = chain.indexOf(level);
      if (index > 0) scheduleCollapse(index);
    });
    wireLevel(level);
    host.appendChild(level.el);
    fillLevel(level, (count) => {
      if (count === 0) {
        collapseFrom(chain.indexOf(level));
        return;
      }
      if (shouldFocus) focusItem(enabledItems(level)[0]);
    });
    // A static list with no visible entries collapsed the level synchronously above —
    // never position a level that is already gone (its anchor would never be destroyed).
    if (!chain.includes(level)) return;
    level.position = anchor(level.el, owner, {
      placement: isRtl ? 'left-start' : 'right-start',
      offset: { mainAxis: 0, crossAxis: -4 },
      shift: 8,
      maxHeight: { padding: 8 },
      ...(opts.inheritThemeFrom ? { inheritThemeFrom: opts.inheritThemeFrom } : {}),
    });
  };

  // ── Pointer ────────────────────────────────────────────────────────────

  const onItemEnter = (itemEl: HTMLElement): void => {
    if (!isOpen) return;
    const depth = levelIndexOf(itemEl);
    if (depth < 0) return;
    cancelCollapse();
    const record = records.get(itemEl)!;
    if (!record.resolved.isDisabled) itemEl.focus({ preventScroll: true });
    const openChild = chain[depth + 1];
    if (record.hasChildren && !record.resolved.isDisabled) {
      // Hover intent: with ANOTHER item's submenu open, the pointer may only be crossing
      // this item on its way there — open this submenu after the same short delay instead
      // of collapsing the other one at once. Entering the open submenu cancels it.
      if (openChild && openChild.owner !== itemEl) {
        openTimer = setTimeout(() => {
          openTimer = null;
          if (isOpen) openSubmenu(depth, itemEl, false);
        }, SUBMENU_HIDE_DELAY);
      } else openSubmenu(depth, itemEl, false);
    } else if (openChild) scheduleCollapse(depth + 1);
  };

  const onItemLeave = (itemEl: HTMLElement): void => {
    const depth = levelIndexOf(itemEl);
    if (depth >= 0 && chain[depth + 1]?.owner === itemEl) scheduleCollapse(depth + 1);
  };

  const wireLevel = (level: Level<Ctx, A>): void => {
    if (isCustom) return;
    level.el.addEventListener('click', (event) => {
      const target = event.target as Element | null;
      const itemEl = target?.closest?.(`.${ITEM}`) as HTMLElement | null;
      if (!itemEl || !level.el.contains(itemEl)) return;
      const record = records.get(itemEl);
      if (!record || record.resolved.isDisabled) return;
      if (record.hasChildren) openSubmenu(chain.indexOf(level), itemEl, false);
      else activate(itemEl, event);
    });
  };

  // ── Activation ─────────────────────────────────────────────────────────

  /** Run a leaf: close first (unless it keeps the menu open), then hand it to `runAction`. */
  const activate = (itemEl: HTMLElement, event: Event): void => {
    const record = records.get(itemEl);
    if (!record || record.resolved.isDisabled || record.hasChildren) return;
    const isKeptOpen = record.item.shouldCloseOnClick === false;
    if (!isKeptOpen) close('action');
    let result: unknown;
    try {
      result = opts.runAction?.(record.item, { triggerElement: itemEl, sourceEvent: event });
    } catch (error) {
      coreLog(host, 'UI', 'MENU').error('menu runAction threw', error);
    }
    if (!isKeptOpen) {
      // Nobody awaits a closed menu's action: log a rejection instead of leaving it unhandled.
      if (isThenable(result)) {
        Promise.resolve(result).catch((error: unknown) => coreLog(host, 'UI', 'MENU').error('menu runAction rejected', error));
      }
      return;
    }
    const level = chain.find((l) => l.el.contains(itemEl));
    const refresh = (): void => {
      if (!isOpen || !level || !chain.includes(level)) return;
      const wasFocused = level.el.contains(deepActiveElement());
      const key = `${record.resolved.action}\u0000${record.resolved.id ?? ''}`;
      collapseFrom(chain.indexOf(level) + 1);
      fillLevel(level, (count) => {
        // Every item of the menu is hidden now: don't leave an empty box open.
        if (count === 0) {
          if (level === chain[0]) close('empty');
          else collapseFrom(chain.indexOf(level));
          return;
        }
        if (!wasFocused) return;
        const same = enabledItems(level).find((el) => {
          const r = records.get(el)!.resolved;
          return `${r.action}\u0000${r.id ?? ''}` === key;
        });
        focusItem(same ?? enabledItems(level)[0]);
      });
    };
    void Promise.resolve(result).then(refresh, refresh);
  };

  // ── Keyboard ───────────────────────────────────────────────────────────

  const matchesShortcut = (shortcut: string | undefined, event: KeyboardEvent): boolean =>
    !!shortcut && (shortcut === event.key || shortcut.toLowerCase() === event.key.toLowerCase());

  const onKeydown = (event: KeyboardEvent): void => {
    if (!isOpen || event.isComposing) return;
    // Two menus open (a context menu over a pinned one): only the topmost one handles keys.
    const stack = openMenuStack();
    if (stack[stack.length - 1] !== menuToken) return;
    const path = event.composedPath();
    const inside = chain.findIndex((l) => path.includes(l.el));
    // Keyboard-modal only while focus is in the menu, on its opener, or nowhere in
    // particular (the body). Focus in an unrelated field (a pinned menu beside a form, a
    // right-click menu over an editor) keeps its keys — only Escape still closes the menu.
    const isTargetNeutral = path[0] === document.body || path[0] === document.documentElement || path[0] === hostElement;
    if (inside < 0 && !path.includes(opener) && !isTargetNeutral) {
      if (event.key === 'Escape' && shouldDismissOutside) close('escape');
      return;
    }
    const depth = inside < 0 ? chain.length - 1 : inside;
    const level = chain[depth]!;
    const focused = (path.find((n) => n instanceof HTMLElement && records.has(n) && level.el.contains(n)) ??
      null) as HTMLElement | null;
    const record = focused ? records.get(focused)! : null;

    if (event.key === 'Tab') {
      // A custom menu (renderMenuCallback) may hold a form: Tab moves between its fields.
      if (isCustom && inside >= 0) return;
      close('tab'); // focus returns, then the browser moves it on — no preventDefault
      return;
    }
    // Logical keys: in a right-to-left menu ← opens a submenu and → goes back.
    const key = isRtl && event.key === 'ArrowRight' ? 'ArrowLeft' : isRtl && event.key === 'ArrowLeft' ? 'ArrowRight' : event.key;
    if (isCustom) {
      if (event.key !== 'Escape') return;
      close('escape');
    } else {
      switch (key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          const items = enabledItems(level);
          if (!items.length) break;
          const at = focused ? items.indexOf(focused) : -1;
          const step = event.key === 'ArrowDown' ? 1 : -1;
          const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
          focusItem(items[next]);
          break;
        }
        case 'Home':
          focusItem(enabledItems(level)[0]);
          break;
        case 'End':
          focusItem(enabledItems(level).at(-1));
          break;
        case 'ArrowRight':
          if (focused && record?.hasChildren) openSubmenu(depth, focused, true);
          break;
        case 'ArrowLeft':
          if (depth > 0) {
            const owner = level.owner;
            collapseFrom(depth);
            focusItem(owner ?? undefined);
          }
          break;
        case 'Escape':
          if (depth > 0) {
            const owner = level.owner;
            collapseFrom(depth);
            focusItem(owner ?? undefined);
          } else close('escape');
          break;
        case 'Enter':
        case ' ':
          if (!focused || !record || record.resolved.isDisabled) break;
          if (record.hasChildren) openSubmenu(depth, focused, true);
          else activate(focused, event);
          break;
        default: {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          // An item's shortcut (a letter, case-insensitive, or a key name like `F2`):
          // the current level first, then its ancestors.
          for (let d = depth; d >= 0; d--) {
            const hit = enabledItems(chain[d]!).find((el) => matchesShortcut(records.get(el)!.resolved.shortcut, event));
            if (!hit) continue;
            if (records.get(hit)!.hasChildren) openSubmenu(d, hit, true);
            else activate(hit, event);
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          return;
        }
      }
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  // ── Dismiss ────────────────────────────────────────────────────────────

  const isInside = (event: Event): boolean => {
    const path = event.composedPath();
    return chain.some((l) => path.includes(l.el));
  };

  const attachListeners = (): void => {
    const onPointerDown = (e: Event) => {
      if (!isInside(e)) close('outside-click');
    };
    const onBlur = () => close('blur');
    // keydown in capture on the document: the menu is keyboard-modal while open,
    // whether focus is in it (submenu nav) or still on the opener (shortcuts, ↓).
    document.addEventListener('keydown', onKeydown, true);
    let stopScrollClose: (() => void) | undefined;
    if (shouldDismissOutside) {
      document.addEventListener('pointerdown', onPointerDown, true);
      // The popover's scroll rule (SPEC §12.2): only a scroll of the page or of a scroller around
      // what the menu belongs to (its `at` element, else the host — a point menu moves with it),
      // once that has actually moved; never a scroll inside the menu, never a bare wheel.
      const hostEl = typeof ShadowRoot !== 'undefined' && host instanceof ShadowRoot ? host.host : (host as Element);
      stopScrollClose = watchScrollClose({
        reference: opts.at instanceof Element ? opts.at : hostEl,
        isInside,
        onScroll: () => close('scroll'),
      });
      window.addEventListener('blur', onBlur);
      // In the page-wide overlay tree (SPEC §12.9): a menu opened from inside another
      // overlay (a context menu in a dropdown) is its child and doesn't dismiss it.
      overlay = registerOverlay(() => close('overlay'), opts.overlayGroup, { getElement: () => chain[0]?.el });
      const hostElement = typeof ShadowRoot !== 'undefined' && host instanceof ShadowRoot ? host.host : (host as Element);
      overlay.activate({ trigger: opts.returnFocusTo ?? (opts.at instanceof Element ? opts.at : hostElement) });
    }
    detachListeners = () => {
      document.removeEventListener('keydown', onKeydown, true);
      if (!shouldDismissOutside) return;
      document.removeEventListener('pointerdown', onPointerDown, true);
      stopScrollClose?.();
      window.removeEventListener('blur', onBlur);
      overlay?.deactivate();
      overlay?.destroy();
      overlay = null;
    };
  };

  function close(reason: MenuCloseReason): void {
    if (!isOpen) return;
    isOpen = false;
    const stack = openMenuStack();
    const at = stack.indexOf(menuToken);
    if (at >= 0) stack.splice(at, 1);
    const active = deepActiveElement();
    const hadFocus = chain.some((l) => l.el.contains(active));
    cancelCollapse();
    detachListeners?.();
    detachListeners = null;
    for (const level of chain.splice(0).reverse()) {
      level.position?.destroy();
      level.el.remove();
    }
    const isPointerAway = reason === 'outside-click' || reason === 'scroll' || reason === 'blur' || reason === 'overlay';
    if (hadFocus && !isPointerAway && opts.returnFocusTo?.isConnected) {
      opts.returnFocusTo.focus({ preventScroll: true });
    }
    // A throwing onClose must not escape close() (or the document listener that called it).
    const { onClose } = opts;
    if (onClose) callSafely(() => onClose(reason), { source: host, coreCategory: 'MENU', message: 'menu onClose threw' });
  }

  // ── Open ───────────────────────────────────────────────────────────────

  adoptStyles(styleRoot, MENU_CSS);
  const rootLevel: Level<Ctx, A> = {
    el: createLevelElement(false),
    owner: null,
    source: () => entries ?? [],
    position: null,
    token: 0,
  };
  chain.push(rootLevel);
  let count = 0;
  if (isCustom) {
    opts.renderMenuCallback!(rootLevel.el, () => close('api'));
    count = 1;
  } else {
    fillLevel(rootLevel, (n) => (count = n));
  }
  if (count === 0) {
    chain.length = 0;
    isOpen = false;
    return {
      isOpen: false,
      element: null,
      close() {},
      focusFirst() {},
      update() {},
    };
  }
  openMenuStack().push(menuToken); // only once it really opens (close() removes it)
  wireLevel(rootLevel);
  host.appendChild(rootLevel.el);

  const at = opts.at;
  const reference = isPoint(at)
    ? {
        getBoundingClientRect: () =>
          ({ x: at.x, y: at.y, width: 0, height: 0, top: at.y, left: at.x, right: at.x, bottom: at.y }) as DOMRect,
      }
    : at;
  rootLevel.position = anchor(rootLevel.el, reference, {
    placement: opts.placement ?? 'bottom-start',
    offset: opts.offset ?? (isPoint(at) ? 0 : 4),
    shift: 8,
    maxHeight: { padding: 8 },
    ...(opts.inheritThemeFrom ? { inheritThemeFrom: opts.inheritThemeFrom } : {}),
  });
  if (isPoint(at)) {
    // Until the first (async) computation lands, show it at the point, not at 0,0.
    rootLevel.el.style.left = `${at.x}px`;
    rootLevel.el.style.top = `${at.y}px`;
  }
  attachListeners();

  const handle: MenuHandle = {
    get isOpen() {
      return isOpen;
    },
    get element() {
      return rootLevel.el;
    },
    close: () => close('api'),
    focusFirst: () => {
      if (isOpen) focusItem(enabledItems(rootLevel)[0]);
    },
    update: () => {
      for (const level of chain) level.position?.update();
    },
  };
  if (opts.shouldFocusFirst) handle.focusFirst();
  return handle;
}
