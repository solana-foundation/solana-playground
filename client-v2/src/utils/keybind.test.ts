import type { Mock } from "vitest";
import { PgKeybind } from "./keybind";

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
