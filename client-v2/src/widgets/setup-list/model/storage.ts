import { useSyncExternalStore } from "react";

import { createLogger } from "@/shared/lib/logger";

const log = createLogger("setup-list:storage");

/**
 * Where the checklist keeps what only this device knows: whether it was
 * dismissed, whether all four steps were once done together (the assistant
 * connection is per tab, so the live state alone would bring "3 of 4" back
 * in a new tab), and whether the user last left it folded.
 */
export const SETUP_LIST_KEY = "setup-list";

export interface SetupMarks {
  dismissed: boolean;
  completed: boolean;
  /**
   * How the user last left the list, folded or not; absent until they first
   * fold or unfold it, when the list starts as its place draws it
   */
  folded?: boolean;
}

/** The marks that only ever turn true */
type Mark = "dismissed" | "completed";

const nothingDone = (): SetupMarks => ({
  dismissed: false,
  completed: false,
});

/**
 * The marks of a parsed value, or `null` when they are not booleans. Only the
 * marks decide: a `folded` that is not a boolean is dropped, so a bad fold
 * never brings back a list the user dismissed, and any other key (such as
 * the `networkChosen` older builds stored) is ignored and gone on the next
 * write.
 */
const parseMarks = (value: unknown): SetupMarks | null => {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;
  if (
    typeof stored.dismissed !== "boolean" ||
    typeof stored.completed !== "boolean"
  ) {
    return null;
  }
  const marks: SetupMarks = {
    dismissed: stored.dismissed,
    completed: stored.completed,
  };
  if (typeof stored.folded === "boolean") marks.folded = stored.folded;
  return marks;
};

/**
 * The stored marks. Nothing stored is nothing done; a value of the wrong
 * shape, or storage that cannot be read, is nothing done too, logged, so a
 * bad value never takes the navigation down.
 */
export const readMarks = (storage?: Storage): SetupMarks => {
  let raw: string | null;
  try {
    // Resolved in here: where site data is blocked, reaching
    // `window.localStorage` is itself what throws
    raw = (storage ?? localStorage).getItem(SETUP_LIST_KEY);
  } catch (e) {
    log.warn("marks unreadable: storage unavailable", { context: { e } });
    return nothingDone();
  }
  if (raw === null) return nothingDone();

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    log.warn("marks unreadable: not JSON", { context: { e } });
    return nothingDone();
  }
  const marks = parseMarks(value);
  if (marks) return marks;

  log.warn("marks unreadable: wrong shape");
  return nothingDone();
};

/**
 * The marks held in memory, read from storage once. Each mark only ever turns
 * true, so a mark merges with what storage holds now (another tab may have
 * dismissed the list since this one read it) and never undoes it; the fold is
 * the last one stored, from any tab. A change takes effect on this page before
 * it is written, so a refused write (reported once per page) still hides a
 * dismissed checklist until the next load.
 */
export const createSetupMarks = (storage?: Storage) => {
  let marks: SetupMarks | null = null;
  let writeReported = false;
  const listeners = new Set<() => void>();

  const get = () => {
    marks ??= readMarks(storage);
    return marks;
  };
  const notify = () => listeners.forEach((listener) => listener());

  /**
   * `current` with every mark `stored` holds too: a mark never turns back. The
   * fold is the stored one, the latest any tab wrote, unless none was.
   */
  const merged = (current: SetupMarks, stored: SetupMarks): SetupMarks => {
    const marks: SetupMarks = {
      dismissed: current.dismissed || stored.dismissed,
      completed: current.completed || stored.completed,
    };
    const folded = stored.folded ?? current.folded;
    if (folded !== undefined) marks.folded = folded;
    return marks;
  };

  /** Writes `next` to memory at once, then to storage */
  const keep = (next: SetupMarks, which: Mark | "folded") => {
    marks = next;
    notify();
    try {
      (storage ?? localStorage).setItem(SETUP_LIST_KEY, JSON.stringify(marks));
    } catch (e) {
      // Blocked or full storage refuses every write; once tells the team
      if (writeReported) return;
      writeReported = true;
      log.error(e, { report: true, context: { which } });
    }
  };

  // Another tab stored a mark: take it, so an open list hides there too. A
  // `null` key is the site's storage cleared, which starts the list over.
  // Listened to for the page's life, not only while mounted: the memory is
  // what the next mount reads.
  window.addEventListener("storage", (event) => {
    if (event.key === null) {
      marks = readMarks(storage);
    } else if (event.key === SETUP_LIST_KEY) {
      marks = merged(get(), readMarks(storage));
    } else {
      return;
    }
    notify();
  });

  return {
    get,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mark(which: Mark) {
      const current = get();
      if (current[which]) return;
      const next = merged(current, readMarks(storage));
      next[which] = true;
      keep(next, which);
    },
    /** The user folded or unfolded the list: kept for the next load */
    fold(folded: boolean) {
      const current = get();
      if (current.folded === folded) return;
      const next = merged(current, readMarks(storage));
      next.folded = folded;
      keep(next, "folded");
    },
  };
};

export const setupMarks = createSetupMarks();

export const useSetupMarks = () =>
  useSyncExternalStore(setupMarks.subscribe, setupMarks.get);

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach, beforeAll } = import.meta.vitest;

  describe("widgets/setup-list/model/storage", () => {
    let initLogger: typeof import("@/shared/lib/logger").initLogger;
    let memoryProvider: typeof import("@/shared/lib/logger").memoryProvider;
    let resetLogger: typeof import("@/shared/lib/logger").resetLogger;
    beforeAll(async () => {
      ({ initLogger, memoryProvider, resetLogger } = await import(
        "@/shared/lib/logger"
      ));
    });
    const NOTHING_DONE = { dismissed: false, completed: false };

    /** A `Storage` whose every call throws, as where site data is blocked */
    const refusingStorage = (): Storage => {
      const refuse = () => {
        throw new DOMException(
          "The quota has been exceeded.",
          "QuotaExceededError"
        );
      };
      return {
        length: 0,
        clear: refuse,
        getItem: refuse,
        key: refuse,
        removeItem: refuse,
        setItem: refuse,
      };
    };

    afterEach(() => {
      localStorage.clear();
      resetLogger();
    });

    describe("readMarks", () => {
      it("reads nothing stored as nothing done, silently", () => {
        const memory = memoryProvider();
        initLogger({ providers: [memory] });
        expect(readMarks()).toEqual(NOTHING_DONE);
        expect(memory.entries).toEqual([]);
      });

      it("reads back what is stored", () => {
        localStorage.setItem(
          SETUP_LIST_KEY,
          '{"dismissed":true,"completed":false,"folded":true}'
        );
        expect(readMarks()).toEqual({
          dismissed: true,
          completed: false,
          folded: true,
        });
      });

      it("reads a value stored before the fold was kept, its network mark dropped", () => {
        localStorage.setItem(
          SETUP_LIST_KEY,
          '{"dismissed":true,"completed":false,"networkChosen":true}'
        );
        const marks = readMarks();
        expect(marks).toEqual({ dismissed: true, completed: false });
        expect("folded" in marks).toBe(false);
        expect("networkChosen" in marks).toBe(false);
      });

      it("drops a fold that is not a boolean and keeps the marks", () => {
        localStorage.setItem(
          SETUP_LIST_KEY,
          '{"dismissed":true,"completed":false,"folded":1}'
        );
        expect(readMarks()).toEqual({ dismissed: true, completed: false });
      });

      it.each(["{", "[]", '{"dismissed":"yes"}'])(
        "reads %s as nothing done and warns once",
        (raw) => {
          const memory = memoryProvider();
          initLogger({ providers: [memory] });
          localStorage.setItem(SETUP_LIST_KEY, raw);
          expect(readMarks()).toEqual(NOTHING_DONE);
          expect(memory.entries).toEqual([
            expect.objectContaining({
              ns: "setup-list:storage",
              level: "warn",
            }),
          ]);
        }
      );

      it("reads nothing done, logged, where storage cannot be read", () => {
        const memory = memoryProvider();
        initLogger({ providers: [memory] });
        expect(readMarks(refusingStorage())).toEqual(NOTHING_DONE);
        expect(memory.entries).toEqual([
          expect.objectContaining({ ns: "setup-list:storage" }),
        ]);
      });
    });

    describe("setupMarks", () => {
      it("writes a mark and reads it back on the next load", () => {
        createSetupMarks().mark("completed");
        expect(createSetupMarks().get()).toEqual({
          dismissed: false,
          completed: true,
        });
      });

      it("keeps a fold, and an unfold, for the next load", () => {
        createSetupMarks().fold(true);
        expect(createSetupMarks().get().folded).toBe(true);
        createSetupMarks().fold(false);
        expect(createSetupMarks().get().folded).toBe(false);
      });

      it("writes nothing and notifies no one for a fold already kept", () => {
        const marks = createSetupMarks();
        marks.fold(true);
        const listener = vi.fn();
        marks.subscribe(listener);
        const write = vi.spyOn(Storage.prototype, "setItem");
        try {
          marks.fold(true);
          expect(write).not.toHaveBeenCalled();
          expect(listener).not.toHaveBeenCalled();
        } finally {
          write.mockRestore();
        }
      });

      it("keeps another tab's dismissal when this tab folds the list", () => {
        const stale = createSetupMarks();
        stale.get();
        createSetupMarks().mark("dismissed");

        stale.fold(true);

        expect(createSetupMarks().get()).toEqual({
          dismissed: true,
          completed: false,
          folded: true,
        });
      });

      it("keeps the fold when a mark is set after it", () => {
        createSetupMarks().fold(true);
        createSetupMarks().mark("completed");
        expect(createSetupMarks().get()).toEqual({
          dismissed: false,
          completed: true,
          folded: true,
        });
      });

      it("keeps this page's fold when another tab stores marks with none", () => {
        const storage = refusingStorage();
        const marks = createSetupMarks(storage);
        marks.subscribe(() => {});
        marks.fold(true);
        // The write was refused; another tab then stores marks without a fold
        vi.spyOn(storage, "getItem").mockReturnValue(
          '{"dismissed":false,"completed":true}'
        );

        window.dispatchEvent(
          new StorageEvent("storage", { key: SETUP_LIST_KEY })
        );

        expect(marks.get().folded).toBe(true);
      });

      it("takes another tab's fold as soon as it is stored", () => {
        const marks = createSetupMarks();
        marks.subscribe(() => {});
        marks.fold(true);
        localStorage.setItem(
          SETUP_LIST_KEY,
          '{"dismissed":false,"completed":false,"folded":false}'
        );

        window.dispatchEvent(
          new StorageEvent("storage", { key: SETUP_LIST_KEY })
        );

        expect(marks.get().folded).toBe(false);
      });

      it("writes nothing and notifies no one for a mark already set", () => {
        const marks = createSetupMarks();
        marks.mark("completed");
        const listener = vi.fn();
        marks.subscribe(listener);
        const write = vi.spyOn(Storage.prototype, "setItem");
        try {
          marks.mark("completed");
          expect(write).not.toHaveBeenCalled();
          expect(listener).not.toHaveBeenCalled();
        } finally {
          write.mockRestore();
        }
      });

      it("keeps another tab's dismissal when this tab marks something else", () => {
        // This tab read the marks before the other tab dismissed the list
        const stale = createSetupMarks();
        stale.get();
        createSetupMarks().mark("dismissed");

        stale.mark("completed");

        expect(createSetupMarks().get()).toEqual({
          dismissed: true,
          completed: true,
        });
      });

      it("takes another tab's mark as soon as it is stored", () => {
        const marks = createSetupMarks();
        const listener = vi.fn();
        marks.subscribe(listener);
        marks.get();
        localStorage.setItem(
          SETUP_LIST_KEY,
          '{"dismissed":true,"completed":false}'
        );

        window.dispatchEvent(
          new StorageEvent("storage", { key: SETUP_LIST_KEY })
        );

        expect(marks.get().dismissed).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("never lets another tab's stored value undo a mark of this page", () => {
        const storage = refusingStorage();
        const marks = createSetupMarks(storage);
        marks.subscribe(() => {});
        marks.mark("dismissed");
        // The write was refused; another tab then stores its own marks
        vi.spyOn(storage, "getItem").mockReturnValue(
          '{"dismissed":false,"completed":true}'
        );

        window.dispatchEvent(
          new StorageEvent("storage", { key: SETUP_LIST_KEY })
        );

        expect(marks.get()).toEqual({
          dismissed: true,
          completed: true,
        });
      });

      it("starts over when another tab clears the site's storage", () => {
        const marks = createSetupMarks();
        marks.subscribe(() => {});
        marks.mark("dismissed");
        localStorage.clear();

        window.dispatchEvent(new StorageEvent("storage", { key: null }));

        expect(marks.get().dismissed).toBe(false);
      });

      it("keeps a mark for this page when storage refuses the write, and reports it once", () => {
        const memory = memoryProvider();
        initLogger({ providers: [memory] });
        const marks = createSetupMarks(refusingStorage());
        const listener = vi.fn();
        marks.subscribe(listener);

        marks.mark("dismissed");
        marks.fold(true);

        expect(marks.get().dismissed).toBe(true);
        expect(marks.get().folded).toBe(true);
        expect(listener).toHaveBeenCalledTimes(2);
        expect(memory.entries.filter((entry) => entry.report)).toEqual([
          expect.objectContaining({ ns: "setup-list:storage", level: "error" }),
        ]);
      });

      it("stops notifying a listener once it unsubscribes", () => {
        const marks = createSetupMarks();
        const listener = vi.fn();
        marks.subscribe(listener)();
        marks.mark("completed");
        expect(listener).not.toHaveBeenCalled();
      });
    });
  });
}
