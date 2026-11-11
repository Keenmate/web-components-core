/**
 * The phone Back gesture for the menu sheet (SPEC §12.13): one history entry (same URL)
 * while a sheet is open, so Back pops it and closes the sheet (or goes up one submenu level)
 * instead of leaving the page — the web-multiselect / web-grid pattern.
 *
 * A sheet closed any other way gives its entry back with `history.back()`, deferred one task:
 * a sheet that opens right after (a menu re-opened on another row) adopts the entry instead of
 * racing a `back()` against a new `pushState()`. The listener is detached before that `back()`,
 * so the `popstate` it triggers closes nothing. Page-wide state (every copy of core), one
 * sheet at a time.
 */
import { sharedState, sharedStateKey } from '../global/shared-state.js';

interface BackEntryState {
  isPushed: boolean;
  pendingBack: ReturnType<typeof setTimeout> | null;
  onBack: (() => void) | null;
  listener: (() => void) | null;
}

const state = (): BackEntryState =>
  sharedState(sharedStateKey('menu-back-entry'), () => ({ isPushed: false, pendingBack: null, onBack: null, listener: null }));

function detach(s: BackEntryState): void {
  if (s.listener) window.removeEventListener('popstate', s.listener);
  s.listener = null;
}

/**
 * Hold the history entry for an open sheet: `onBack` runs when the user presses Back (the
 * entry is gone by then). Call it again from `onBack` to re-arm the entry (one submenu level
 * up, the sheet stays open). Returns the release (idempotent).
 */
export function claimBackEntry(onBack: () => void): () => void {
  if (typeof window === 'undefined' || typeof history === 'undefined') return () => {};
  const s = state();
  if (s.pendingBack !== null) {
    clearTimeout(s.pendingBack);
    s.pendingBack = null;
  }
  if (!s.isPushed) {
    history.pushState({ kmMenuSheet: true }, '');
    s.isPushed = true;
  }
  s.onBack = onBack;
  detach(s);
  const listener = (): void => {
    // Our entry is gone (Back): run the handler without popping again.
    detach(s);
    s.isPushed = false;
    const back = s.onBack;
    s.onBack = null;
    back?.();
  };
  s.listener = listener;
  window.addEventListener('popstate', listener);
  let isReleased = false;
  return () => {
    if (isReleased) return;
    isReleased = true;
    if (s.onBack !== onBack) return; // re-claimed by a newer sheet, or Back already ran
    s.onBack = null;
    detach(s);
    if (!s.isPushed || s.pendingBack !== null) return;
    s.pendingBack = setTimeout(() => {
      s.pendingBack = null;
      if (s.onBack || !s.isPushed) return; // adopted meanwhile, or popped by Back
      s.isPushed = false;
      history.back();
    }, 0);
  };
}
