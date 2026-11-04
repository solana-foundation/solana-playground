import type { DocsLink } from "../lib/link";

/**
 * Where the open view came from: no docs link, a link that opened its
 * project, or "This link is broken", which opened none
 */
export type LinkState =
  | { kind: "none" }
  | { kind: "opened"; link: DocsLink }
  | { kind: "broken" };

type Listener = (state: LinkState) => void;

let state: LinkState = { kind: "none" };
const listeners = new Set<Listener>();

const set = (next: LinkState) => {
  state = next;
  listeners.forEach((listener) => listener(next));
};

/**
 * The docs link the open project came from. The `/open` route sets it and
 * clears it when another route takes over, so a project opened any other way
 * never shows the link's source line or asks for its SOL.
 */
export const PgDocsLink = {
  get state() {
    return state;
  },

  /** The link that opened the project, if one did */
  get opened() {
    return state.kind === "opened" ? state.link : undefined;
  },

  /** @param link the link whose project is now open */
  open(link: DocsLink) {
    set({ kind: "opened", link });
  },

  /**
   * The open view is "This link is broken". The frame around it still shows
   * the stage row, and its Run would run a project nobody opened.
   */
  markBroken() {
    set({ kind: "broken" });
  },

  /** Another route took over: its project did not come from a link */
  clear() {
    set({ kind: "none" });
  },

  /**
   * @param listener called with the new state on every change
   * @returns a disposable that removes the listener
   */
  onDidChange(listener: Listener) {
    listeners.add(listener);
    return { dispose: () => void listeners.delete(listener) };
  },
};
