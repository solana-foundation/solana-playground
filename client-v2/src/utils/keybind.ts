import { PgCommon } from "./common";
import type { Arrayable, Disposable } from "./types";

/** Modifier tokens, matched exactly rather than by presence */
const MODIFIERS = ["CTRL", "ALT", "SHIFT"];

/** Keys of the keybind */
type Keybind = string;

/** Handler callback for the keybind */
type HandleKeybindCb = (ev: KeyboardEvent) => unknown;

/** Handler for the keybind */
type HandleKeybind =
  | HandleKeybindCb
  | { handle: HandleKeybindCb; opts?: { noPreventDefault?: boolean } };

/** A single keybind parameters */
type SingleKeybind = [Keybind, HandleKeybind];

/** Multiple keybinds parameters */
type MultipleKeybinds = [
  Arrayable<{ keybind: Keybind; handle: HandleKeybind }>
];

export class PgKeybind {
  /**
   * Add keybind(s).
   *
   * @param args keybind(s) to add
   * @returns a dispose function to clear the event
   */
  static add(...args: SingleKeybind | MultipleKeybinds): Disposable {
    // Normalize keybinds
    const keybinds = PgCommon.toArray(
      typeof args[0] === "string"
        ? { keybind: args[0], handle: args[1]! }
        : args[0]
    );

    const handle = (ev: KeyboardEvent) => {
      const keybind = keybinds.find(({ keybind }) => {
        const keys = keybind.toUpperCase().replaceAll(" ", "").split("+");

        // A modifier the keybind does not name has to be up, so "Ctrl+R" keeps
        // its hands off Ctrl+Shift+R
        const names = (modifier: string) => keys.includes(modifier);
        if ((ev.ctrlKey || ev.metaKey) !== names("CTRL")) return false;
        if (ev.altKey !== names("ALT")) return false;
        if (ev.shiftKey !== names("SHIFT")) return false;

        return keys
          .filter((key) => !MODIFIERS.includes(key))
          .every((key) => {
            switch (key) {
              case "SPACE":
                return ev.key === " ";
              case "`":
                // Chromium sets `ev.key` to "Unidentified" on "CTRL+`"
                return ev.code === "Backquote";
              default:
                return key === ev.key.toUpperCase();
            }
          });
      });
      if (!keybind) return;

      if (typeof keybind.handle === "function") {
        keybind.handle(ev);
        ev.preventDefault();
      } else {
        keybind.handle.handle(ev);
        if (!keybind.handle.opts?.noPreventDefault) ev.preventDefault();
      }
    };

    document.addEventListener("keydown", handle);
    return { dispose: () => document.removeEventListener("keydown", handle) };
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach, afterEach } = import.meta
    .vitest;
  type Mock = import("vitest").Mock;
  const press = (key: string, mods: Partial<KeyboardEventInit> = {}) => {
    const ev = new KeyboardEvent("keydown", { key, cancelable: true, ...mods });
    document.dispatchEvent(ev);
    return ev;
  };

  describe("PgKeybind", () => {
    let dispose: () => void;
    let handle: Mock;

    beforeEach(() => (handle = vi.fn()));
    afterEach(() => dispose?.());

    const bind = (keybind: string) => {
      dispose = PgKeybind.add(keybind, handle).dispose;
    };

    it("matches the bound modifiers", () => {
      bind("Ctrl+R");
      press("r", { ctrlKey: true });
      expect(handle).toHaveBeenCalledTimes(1);
    });

    it("treats Meta as Ctrl, for macOS", () => {
      bind("Ctrl+R");
      press("r", { metaKey: true });
      expect(handle).toHaveBeenCalledTimes(1);
    });

    it("ignores an unbound Shift, leaving Cmd+Shift+R to reload the page", () => {
      bind("Ctrl+R");
      const ev = press("R", { metaKey: true, shiftKey: true });
      expect(handle).not.toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(false);
    });

    it("does not fire the Ctrl binding of a Ctrl+Shift keybind", () => {
      bind("Ctrl+B");
      press("B", { ctrlKey: true, shiftKey: true });
      expect(handle).not.toHaveBeenCalled();
    });

    it("still matches when Shift is bound", () => {
      bind("Ctrl+Shift+B");
      press("B", { ctrlKey: true, shiftKey: true });
      expect(handle).toHaveBeenCalledTimes(1);
    });

    it("ignores an unbound Alt", () => {
      bind("Ctrl+R");
      press("r", { ctrlKey: true, altKey: true });
      expect(handle).not.toHaveBeenCalled();
    });

    it("ignores an unbound Ctrl", () => {
      bind("Enter");
      press("Enter", { ctrlKey: true });
      expect(handle).not.toHaveBeenCalled();
    });

    it("ignores an unbound Shift on a bare key", () => {
      bind("Enter");
      press("Enter", { shiftKey: true });
      expect(handle).not.toHaveBeenCalled();
    });

    it("matches a bare key with no modifiers", () => {
      bind("Enter");
      press("Enter");
      expect(handle).toHaveBeenCalledTimes(1);
    });

    it("honours noPreventDefault", () => {
      dispose = PgKeybind.add("Ctrl+R", {
        handle,
        opts: { noPreventDefault: true },
      }).dispose;
      const ev = press("r", { ctrlKey: true });
      expect(handle).toHaveBeenCalledTimes(1);
      expect(ev.defaultPrevented).toBe(false);
    });
  });
}
