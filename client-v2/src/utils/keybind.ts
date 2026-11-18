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
   * listener. A key the handler takes is stopped there, before the target
   * and the document, so the field does not act on it too; a key it declines
   * (returns `false`) goes on to the field. Other capture listeners on the
   * window still hear it.
   */
  capture?: boolean;
}

/** Handler for the keybind */
type HandleKeybind =
  | HandleKeybindCb
  | { handle: HandleKeybindCb; opts?: KeybindOpts };

/** A keybind with its handler and options pulled apart */
interface NormalizedKeybind {
  keybind: Keybind;
  run: HandleKeybindCb;
  opts: KeybindOpts | undefined;
}

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
    const onBubble = PgKeybind._listenFor(bubble);
    const onCapture = PgKeybind._listenFor(capture);

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

  /**
   * The keydown listener that runs the first of `keybinds` the event matches.
   * Capture and bubble keybinds of one `add` get a listener each, so the
   * first match is per phase.
   */
  private static _listenFor(keybinds: NormalizedKeybind[]) {
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
      if (opts?.capture) ev.stopPropagation();
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

        /** Cmd plus `key` (Meta, read as Ctrl), in the field */
        const pressIn = (key: string) => {
          const ev = new KeyboardEvent("keydown", {
            key,
            metaKey: true,
            cancelable: true,
            bubbles: true,
          });
          field.dispatchEvent(ev);
          return ev;
        };

        it("misses a key a field stops, without capture", () => {
          bind("Ctrl+E");
          pressIn("e");
          expect(handle).not.toHaveBeenCalled();
          expect(fieldHeard).toHaveBeenCalledTimes(1);
        });

        it("takes the key before the field, and keeps it from the field", () => {
          dispose = PgKeybind.add("Ctrl+E", {
            handle,
            opts: { capture: true },
          }).dispose;
          const ev = pressIn("e");
          expect(handle).toHaveBeenCalledTimes(1);
          expect(ev.defaultPrevented).toBe(true);
          expect(fieldHeard).not.toHaveBeenCalled();
        });

        it("leaves a key it declines to the field", () => {
          dispose = PgKeybind.add("Ctrl+E", {
            handle: () => false,
            opts: { capture: true },
          }).dispose;
          const ev = pressIn("e");
          expect(ev.defaultPrevented).toBe(false);
          expect(fieldHeard).toHaveBeenCalledTimes(1);
        });

        it("keeps a key it takes from the field under noPreventDefault too", () => {
          dispose = PgKeybind.add("Ctrl+E", {
            handle,
            opts: { capture: true, noPreventDefault: true },
          }).dispose;
          const ev = pressIn("e");
          expect(handle).toHaveBeenCalledTimes(1);
          expect(ev.defaultPrevented).toBe(false);
          expect(fieldHeard).not.toHaveBeenCalled();
        });

        it("leaves a declined key to the field when the default was prevented elsewhere", () => {
          // Another window capture listener, ahead of this one
          const other = (ev: KeyboardEvent) => ev.preventDefault();
          window.addEventListener("keydown", other, { capture: true });
          try {
            dispose = PgKeybind.add("Ctrl+E", {
              handle: () => false,
              opts: { capture: true },
            }).dispose;
            pressIn("e");
            expect(fieldHeard).toHaveBeenCalledTimes(1);
          } finally {
            window.removeEventListener("keydown", other, { capture: true });
          }
        });

        it("keeps the other keybinds of the same call in the bubble phase", () => {
          const other = vi.fn();
          dispose = PgKeybind.add([
            { keybind: "Ctrl+E", handle: { handle, opts: { capture: true } } },
            { keybind: "Ctrl+J", handle: other },
          ]).dispose;
          pressIn("j");
          expect(other).not.toHaveBeenCalled();
          press("j", { metaKey: true });
          expect(other).toHaveBeenCalledTimes(1);
        });

        it("stops listening on dispose", () => {
          PgKeybind.add("Ctrl+E", {
            handle,
            opts: { capture: true },
          }).dispose();
          pressIn("e");
          expect(handle).not.toHaveBeenCalled();
        });
      });
    });
  });
}
