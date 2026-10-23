import { createLogger } from "@/shared/lib/logger";

const log = createLogger("app-nav:pins");

/**
 * Where the navigation keeps pinned workspace ids: on this device only
 * (syncing them across devices is HOO-2121). Ids, not names, so a rename
 * keeps the pin.
 */
export const PINS_KEY = "nav.pins";

const isIdList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * The pinned ids. Nothing stored is no pins; a value that is not a list of
 * ids, or storage that cannot be read, is no pins too, logged, so a bad
 * value never takes the navigation down.
 */
export const readPins = (storage?: Storage): string[] => {
  let raw: string | null;
  try {
    // Resolved in here: where site data is blocked, reaching
    // `window.localStorage` is itself what throws
    raw = (storage ?? localStorage).getItem(PINS_KEY);
  } catch (e) {
    log.warn("pins unreadable: storage unavailable", { context: { e } });
    return [];
  }
  if (raw === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    log.warn("pins unreadable: not JSON", { context: { e } });
    return [];
  }
  if (isIdList(value)) return value;

  log.warn("pins unreadable: not a list of ids");
  return [];
};

/** Throws when storage refuses the write; a caller acting for the user tells them */
export const writePins = (ids: readonly string[], storage?: Storage) =>
  (storage ?? localStorage).setItem(PINS_KEY, JSON.stringify(ids));

export const togglePin = (pins: readonly string[], id: string) =>
  pins.includes(id) ? pins.filter((pin) => pin !== id) : [...pins, id];

/** Drops pins no workspace has any more, keeping the order of the rest */
export const prunePins = (
  pins: readonly string[],
  liveIds: readonly string[]
) => pins.filter((pin) => liveIds.includes(pin));

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach, beforeAll } = import.meta.vitest;

  describe("widgets/app-nav/model/pins", () => {
    let initLogger: typeof import("@/shared/lib/logger").initLogger;
    let memoryProvider: typeof import("@/shared/lib/logger").memoryProvider;
    let resetLogger: typeof import("@/shared/lib/logger").resetLogger;
    beforeAll(async () => {
      ({ initLogger, memoryProvider, resetLogger } = await import(
        "@/shared/lib/logger"
      ));
    });
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
            throw new DOMException(
              "The operation is insecure.",
              "SecurityError"
            );
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
  });
}
