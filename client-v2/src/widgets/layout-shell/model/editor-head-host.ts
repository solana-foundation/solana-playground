import { useSyncExternalStore } from "react";

/**
 * Where the editor's tab row goes: the element `BaseEditorHead` keeps on its
 * left. The row stays mounted inside the stage, where `EditorWithTabs` puts
 * it and where its contexts are, and portals here: lifting it into the shell
 * would show it over the pages `Primary` swaps in that have no tabs.
 * One slot: the frame draws one head.
 */
let host: HTMLElement | undefined;
const listeners = new Set<() => void>();

/** Sets the host, or clears it with undefined, and tells every reader */
const setEditorHeadHost = (el: HTMLElement | undefined) => {
  if (el === host) return;
  host = el;
  listeners.forEach((listener) => listener());
};

/**
 * The head's ref callback: takes the slot on mount, and on unmount gives it
 * up only if it still holds it, so a head that unmounts after another one
 * took the slot cannot send the row back into the stage. `null` in the type:
 * React's ref callbacks pass it
 */
export const editorHeadHost = (el: HTMLElement | null) => {
  if (!el) return;
  setEditorHeadHost(el);
  return () => {
    if (host === el) setEditorHeadHost(undefined);
  };
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const snapshot = () => host;

/**
 * The head's host, or undefined where no head is drawn (a phone, Home, a unit
 * test); a host that appears later re-renders the reader
 */
export const useEditorHeadHost = () =>
  useSyncExternalStore(subscribe, snapshot, snapshot);

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;

  describe("widgets/layout-shell/model/editor-head-host", () => {
    afterEach(() => setEditorHeadHost(undefined));

    it("notifies readers when the host changes", () => {
      const listener = vi.fn();
      const unsubscribe = subscribe(listener);
      const el = document.createElement("div");
      setEditorHeadHost(el);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(snapshot()).toBe(el);
      setEditorHeadHost(undefined);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(snapshot()).toBeUndefined();
      unsubscribe();
    });

    it("lets a head give up the slot only while it holds it", () => {
      const first = document.createElement("div");
      const second = document.createElement("div");
      const take = (el: HTMLElement) => {
        const release = editorHeadHost(el);
        if (!release) throw new Error("a head took no slot");
        return release;
      };
      const releaseFirst = take(first);
      const releaseSecond = take(second);
      releaseFirst();
      expect(snapshot()).toBe(second);
      releaseSecond();
      expect(snapshot()).toBeUndefined();
    });

    it("stops telling a reader that unsubscribed", () => {
      const listener = vi.fn();
      subscribe(listener)();
      setEditorHeadHost(document.createElement("div"));
      expect(listener).not.toHaveBeenCalled();
    });

    it("does not notify when the same host is set again", () => {
      const el = document.createElement("div");
      setEditorHeadHost(el);
      const listener = vi.fn();
      const unsubscribe = subscribe(listener);
      setEditorHeadHost(el);
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    });
  });
}
