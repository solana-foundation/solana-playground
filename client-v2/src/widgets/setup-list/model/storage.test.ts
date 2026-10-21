import { afterEach, describe, expect, it, vi } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import { createSetupMarks, readMarks, SETUP_LIST_KEY } from "./storage";

const NOTHING_DONE = {
  dismissed: false,
  completed: false,
  networkChosen: false,
};

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
      '{"dismissed":true,"completed":false,"networkChosen":true}'
    );
    expect(readMarks()).toEqual({
      dismissed: true,
      completed: false,
      networkChosen: true,
    });
  });

  it.each(["{", "[]", '{"dismissed":"yes"}'])(
    "reads %s as nothing done and warns once",
    (raw) => {
      const memory = memoryProvider();
      initLogger({ providers: [memory] });
      localStorage.setItem(SETUP_LIST_KEY, raw);
      expect(readMarks()).toEqual(NOTHING_DONE);
      expect(memory.entries).toEqual([
        expect.objectContaining({ ns: "setup-list:storage", level: "warn" }),
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
    createSetupMarks().mark("networkChosen");
    expect(createSetupMarks().get()).toEqual({
      dismissed: false,
      completed: false,
      networkChosen: true,
    });
  });

  it("writes nothing and notifies no one for a mark already set", () => {
    const marks = createSetupMarks();
    marks.mark("networkChosen");
    const listener = vi.fn();
    marks.subscribe(listener);
    const write = vi.spyOn(Storage.prototype, "setItem");
    try {
      marks.mark("networkChosen");
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

    stale.mark("networkChosen");

    expect(createSetupMarks().get()).toEqual({
      dismissed: true,
      completed: false,
      networkChosen: true,
    });
  });

  it("takes another tab's mark as soon as it is stored", () => {
    const marks = createSetupMarks();
    const listener = vi.fn();
    marks.subscribe(listener);
    marks.get();
    localStorage.setItem(
      SETUP_LIST_KEY,
      '{"dismissed":true,"completed":false,"networkChosen":false}'
    );

    window.dispatchEvent(new StorageEvent("storage", { key: SETUP_LIST_KEY }));

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
      '{"dismissed":false,"completed":false,"networkChosen":true}'
    );

    window.dispatchEvent(new StorageEvent("storage", { key: SETUP_LIST_KEY }));

    expect(marks.get()).toEqual({
      dismissed: true,
      completed: false,
      networkChosen: true,
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
    marks.mark("networkChosen");

    expect(marks.get().dismissed).toBe(true);
    expect(marks.get().networkChosen).toBe(true);
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
