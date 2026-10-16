import { afterEach, describe, expect, it, vi } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import { PINS_KEY, prunePins, readPins, togglePin, writePins } from "./pins";

afterEach(() => {
  localStorage.clear();
  resetLogger();
});

describe("pins", () => {
  it("reads what it wrote", () => {
    writePins(["a", "b"]);
    expect(readPins()).toEqual(["a", "b"]);
  });

  it("reads nothing stored as no pins, silently", () => {
    const memory = memoryProvider();
    initLogger({ providers: [memory] });
    expect(readPins()).toEqual([]);
    expect(memory.entries).toEqual([]);
  });

  it.each(["{", '{"a":1}', "[1,2]", '"a"'])(
    "reads %s as no pins and logs it",
    (raw) => {
      const memory = memoryProvider();
      initLogger({ providers: [memory] });
      localStorage.setItem(PINS_KEY, raw);
      expect(readPins()).toEqual([]);
      expect(memory.entries).toEqual([
        expect.objectContaining({ ns: "app-nav:pins" }),
      ]);
    }
  );

  it("reads no pins, logged, where the browser refuses `localStorage` itself", () => {
    const memory = memoryProvider();
    initLogger({ providers: [memory] });
    // Blocked site data: reaching `window.localStorage` throws a SecurityError
    const blocked = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      });
    try {
      expect(readPins()).toEqual([]);
    } finally {
      blocked.mockRestore();
    }
    expect(memory.entries).toEqual([
      expect.objectContaining({ ns: "app-nav:pins" }),
    ]);
  });

  it("toggles a pin on and off", () => {
    expect(togglePin(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePin(["a", "b"], "a")).toEqual(["b"]);
  });

  it("drops pins no workspace has, keeping their order", () => {
    expect(prunePins(["a", "gone", "b"], ["b", "a"])).toEqual(["a", "b"]);
  });
});
