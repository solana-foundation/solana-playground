import { useSyncExternalStore } from "react";

/**
 * What is in a composer, held outside React state so a keystroke re-renders
 * only the components that subscribe to it: the composer, not the
 * conversation above it (HOO-2781). Everything else reads it with `get` when
 * it acts.
 */
export interface Draft {
  get(): string;
  set(value: string): void;
  /** Calls `onChange` after every `set` that changes the text */
  subscribe(onChange: () => void): () => void;
}

export const createDraft = (): Draft => {
  let value = "";
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
};

/** The draft's text, re-rendering the caller whenever it changes */
export const useDraft = (draft: Draft): string =>
  useSyncExternalStore(draft.subscribe, draft.get);

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("shared/lib/draft", () => {
    it("tells subscribers about a change, and only about a change", () => {
      const draft = createDraft();
      const onChange = vi.fn();
      draft.subscribe(onChange);
      draft.set("a");
      draft.set("a");
      expect(draft.get()).toBe("a");
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("stops calling a subscriber that unsubscribed", () => {
      const draft = createDraft();
      const onChange = vi.fn();
      draft.subscribe(onChange)();
      draft.set("a");
      expect(onChange).not.toHaveBeenCalled();
    });
  });
}
