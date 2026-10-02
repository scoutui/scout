/** Storage key for the rail's collapsed state, shared by every component page. */
export const RAIL_COLLAPSE_KEY = "cc.composition.rail-collapsed";

/** Defaults to open. Any unrecognised or unreadable value reads as open:
 *  `localStorage` is absent during SSR and can throw in Safari's private
 *  mode. */
export function readRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeRailCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(RAIL_COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch {
    // Without storage, collapse still works for the session.
  }
}
