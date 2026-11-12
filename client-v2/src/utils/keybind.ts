import { PgCommon } from "./common";
import type { Arrayable, Disposable } from "./types";

/** Modifier tokens, matched exactly rather than by presence */
const MODIFIERS = ["CTRL", "ALT", "SHIFT"];

/** Keys of the keybind */
type Keybind = string;

/**
 * Handler callback for the keybind. Returning `false` declines the key: the
 * handler did nothing with it, so its default (a reload, the address bar, a
 * typed character) is left alone.
 */
type HandleKeybindCb = (ev: KeyboardEvent) => false | void | Promise<void>;

/** Options of a keybind */
interface KeybindOpts {
  /** Leave the default alone even when the handler takes the key */
  noPreventDefault?: boolean;
  /**
   * Hear the key before the element it lands in: on the window, in the
   * capture phase. A field that acts on the key and stops it (Monaco binds
   * ⌘E, find with the selection) otherwise keeps it from a document
   * listener. A key the handler takes, its default prevented, is stopped
   * there, so the field does not act on it too; one it declines or prevents
   * nothing for goes on to the field.
   */
  capture?: boolean;
}

/** Handler for the keybind */
type HandleKeybind =
  | HandleKeybindCb
  | { handle: HandleKeybindCb; opts?: KeybindOpts };

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
    ).map(({ keybind, handle }) =>
      typeof handle === "function"
        ? { keybind, run: handle, opts: undefined }
        : { keybind, run: handle.handle, opts: handle.opts }
    );

    const bubble = keybinds.filter(({ opts }) => !opts?.capture);
    const capture = keybinds.filter(({ opts }) => opts?.capture);
    const onBubble = PgKeybind._listener(bubble);
    const onCapture = PgKeybind._listener(capture);

    if (bubble.length) document.addEventListener("keydown", onBubble);
    if (capture.length) {
      window.addEventListener("keydown", onCapture, { capture: true });
    }
    return {
      dispose: () => {
        document.removeEventListener("keydown", onBubble);
        window.removeEventListener("keydown", onCapture, { capture: true });
      },
    };
  }

  /** The keydown listener that runs the first of `keybinds` the event matches */
  private static _listener(
    keybinds: Array<{
      keybind: Keybind;
      run: HandleKeybindCb;
      opts: KeybindOpts | undefined;
    }>
  ) {
    return (ev: KeyboardEvent) => {
      const keybind = keybinds.find(({ keybind: combination }) => {
        const keys = combination.toUpperCase().replaceAll(" ", "").split("+");

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

      const { run, opts } = keybind;
      if (run(ev) === false) return;
      if (!opts?.noPreventDefault) ev.preventDefault();
      if (opts?.capture && ev.defaultPrevented) ev.stopPropagation();
    };
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach, afterEach } = import.meta
    .vitest;
  type Mock = import("vitest").Mock;
  describe("utils/keybind", () => {
    const press = (key: string, mods: Partial<KeyboardEventInit> = {}) => {
      const ev = new KeyboardEvent("keydown", {
        key,
        cancelable: true,
        ...mods,
      });
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

      it("leaves the default to a handler that returns false", () => {
        dispose = PgKeybind.add("Ctrl+R", () => false).dispose;
        const ev = press("r", { metaKey: true });
        expect(ev.defaultPrevented).toBe(false);
      });

      it("prevents the default when a handler returns anything else", () => {
        dispose = PgKeybind.add("Ctrl+R", () => undefined).dispose;
        const ev = press("r", { metaKey: true });
        expect(ev.defaultPrevented).toBe(true);
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

      describe("capture", () => {
        /** A field that, like Monaco, acts on the key and stops it */
        let field: HTMLTextAreaElement;
        let fieldHeard: Mock;
        beforeEach(() => {
          fieldHeard = vi.fn();
          field = document.createElement("textarea");
          field.addEventListener("keydown", (ev) => {
            fieldHeard();
            ev.stopPropagation();
          });
          document.body.append(field);
        });
        afterEach(() => field.remove());

        const pressIn = (key: string, mods: Partial<KeyboardEventInit>) => {
          const ev = new KeyboardEvent("keydown", {
            key,
            cancelable: true,
            bubbles: true,
            ...mods,
          });
          field.dispatchEvent(ev);
          return ev;
        };

        it("misses a key a field stops, without capture", () => {
          bind("Ctrl+E");
          pressIn("e", { metaKey: true });
          expect(handle).not.toHaveBeenCalled();
          expect(fieldHeard).toHaveBeenCalledTimes(1);
        });

        it("takes the key before the field, and keeps it from the field", () => {
          dispose = PgKeybind.add("Ctrl+E", {
            handle,
            opts: { capture: true },
          }).dispose;
          const ev = pressIn("e", { metaKey: true });
          expect(handle).toHaveBeenCalledTimes(1);
          expect(ev.defaultPrevented).toBe(true);
          expect(fieldHeard).not.toHaveBeenCalled();
        });

        it("leaves a key it declines to the field", () => {
          dispose = PgKeybind.add("Ctrl+E", {
            handle: () => false,
            opts: { capture: true },
          }).dispose;
          const ev = pressIn("e", { metaKey: true });
          expect(ev.defaultPrevented).toBe(false);
          expect(fieldHeard).toHaveBeenCalledTimes(1);
        });

        it("leaves a key to the field when it prevents nothing", () => {
          // A handler under noPreventDefault that returns without acting
          dispose = PgKeybind.add("Ctrl+E", {
            handle: () => undefined,
            opts: { capture: true, noPreventDefault: true },
          }).dispose;
          pressIn("e", { metaKey: true });
          expect(fieldHeard).toHaveBeenCalledTimes(1);
        });

        it("keeps the other keybinds of the same call in the bubble phase", () => {
          const other = vi.fn();
          dispose = PgKeybind.add([
            { keybind: "Ctrl+E", handle: { handle, opts: { capture: true } } },
            { keybind: "Ctrl+J", handle: other },
          ]).dispose;
          pressIn("j", { metaKey: true });
          expect(other).not.toHaveBeenCalled();
          press("j", { metaKey: true });
          expect(other).toHaveBeenCalledTimes(1);
        });

        it("stops listening on dispose", () => {
          PgKeybind.add("Ctrl+E", {
            handle,
            opts: { capture: true },
          }).dispose();
          pressIn("e", { metaKey: true });
          expect(handle).not.toHaveBeenCalled();
        });
      });
    });
  });
}
