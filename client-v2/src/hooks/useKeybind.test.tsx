import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { KeybindsActive } from "@/shared/lib/keybinds-active";

// The `utils` barrel cannot load under jsdom; the hook needs only `PgKeybind`
const keybind = vi.hoisted(() => ({ add: vi.fn(), dispose: vi.fn() }));
vi.mock("../utils", () => ({
  PgKeybind: {
    add: (...args: unknown[]) => {
      keybind.add(...args);
      return { dispose: keybind.dispose };
    },
  },
}));

import { useKeybind } from "./useKeybind";

beforeEach(() => {
  keybind.add.mockReset();
  keybind.dispose.mockReset();
});

/** Stable, so only the context's change can re-run the hook's effect */
const handler = () => {};
const Bound = () => {
  useKeybind("Alt+W", handler);
  return null;
};

it("adds its keybind where keybinds are active, as by default", () => {
  render(<Bound />);
  expect(keybind.add).toHaveBeenCalledTimes(1);
});

it("adds nothing where keybinds are off, and adds it once they are on again", () => {
  const { rerender } = render(
    <KeybindsActive.Provider value={false}>
      <Bound />
    </KeybindsActive.Provider>
  );
  expect(keybind.add).not.toHaveBeenCalled();
  rerender(
    <KeybindsActive.Provider value={true}>
      <Bound />
    </KeybindsActive.Provider>
  );
  expect(keybind.add).toHaveBeenCalledTimes(1);
});

it("drops its keybind when keybinds go off", () => {
  const { rerender } = render(
    <KeybindsActive.Provider value={true}>
      <Bound />
    </KeybindsActive.Provider>
  );
  rerender(
    <KeybindsActive.Provider value={false}>
      <Bound />
    </KeybindsActive.Provider>
  );
  expect(keybind.dispose).toHaveBeenCalledTimes(1);
});
