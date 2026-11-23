import { createLogger } from "../logger";

/**
 * A browser's answer to "may Playground send usage events to Google
 * Analytics?" (`analytics-consent`). `unanswered` until the visitor picks.
 */
export type Consent = "unanswered" | "allowed" | "declined";

/** What a visitor can pick; `unanswered` is the state before any pick */
export type ConsentChoice = Exclude<Consent, "unanswered">;

const STORAGE_KEY = "analytics-consent";

const log = createLogger("telemetry:consent");

const isConsent = (value: unknown): value is Consent =>
  value === "unanswered" || value === "allowed" || value === "declined";

/**
 * The choice of a write storage refused, held for this page only. It wins
 * over what storage says, so a decline stops sending at once even when it
 * cannot be kept; a reload forgets it. Cleared by a write that is stored, and
 * by another tab's.
 */
let unsaved: ConsentChoice | undefined;

/**
 * The visitor's choice: one this page could not store, else the stored one.
 * A missing or unreadable value, a value that is none of the three, and
 * storage that throws (blocked cookies, private windows) all read as
 * `unanswered`, so the page never loads GA4 on a guess.
 */
export const readConsent = (): Consent => {
  if (unsaved) return unsaved;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isConsent(value) ? value : "unanswered";
  } catch (error) {
    log.debug("localStorage is unreadable; the choice reads as unanswered", {
      context: { error: String(error) },
    });
    return "unanswered";
  }
};

type Listener = (choice: Consent) => void;

const listeners = new Set<Listener>();

/**
 * Stores `choice` and tells every subscriber. When storage refuses the write,
 * the choice still holds for this page (`unsaved`), and the subscribers hear
 * it all the same.
 *
 * @returns whether the choice was stored, so it outlives a reload
 */
export const writeConsent = (choice: ConsentChoice): boolean => {
  let saved: boolean;
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
    unsaved = undefined;
    saved = true;
  } catch (error) {
    log.warn(
      "the analytics choice could not be stored; it holds until reload",
      {
        context: { error: String(error) },
      }
    );
    unsaved = choice;
    saved = false;
  }
  listeners.forEach((listener) => listener(choice));
  return saved;
};

/**
 * Calls `listener` with the new choice after every change in this tab or, by
 * the browser's `storage` event, in another one. Returns the unsubscribe.
 */
export const subscribe = (listener: Listener) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    // A null key is `localStorage.clear()`, which also drops the choice
    if (event.key === null || event.key === STORAGE_KEY) {
      // Another tab's choice was stored, and is the latest one
      unsaved = undefined;
      listener(readConsent());
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, afterEach, vi } = import.meta.vitest;

  describe("shared/lib/telemetry/consent", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      window.localStorage.clear();
      unsaved = undefined;
    });

    it("should read unanswered in a fresh browser", () => {
      expect(readConsent()).toBe("unanswered");
    });

    it("should read back what was written", () => {
      writeConsent("allowed");
      expect(readConsent()).toBe("allowed");
      writeConsent("declined");
      expect(readConsent()).toBe("declined");
    });

    it("should read unanswered for a stored value that is none of the three", () => {
      window.localStorage.setItem(STORAGE_KEY, "yes please");
      expect(readConsent()).toBe("unanswered");
    });

    it("should read unanswered when storage throws on a read", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      expect(readConsent()).toBe("unanswered");
    });

    it("should hold a choice storage refused for the page, and say it was not saved", () => {
      window.localStorage.setItem(STORAGE_KEY, "allowed");
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const heard: Consent[] = [];
      const unsubscribe = subscribe((choice) => heard.push(choice));

      expect(writeConsent("declined")).toBe(false);
      expect(readConsent()).toBe("declined");
      expect(heard).toEqual(["declined"]);
      unsubscribe();
    });

    it("should say a stored choice was saved, and drop one held for the page", () => {
      const setItem = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementationOnce(() => {
          throw new Error("blocked");
        });
      writeConsent("declined");
      setItem.mockRestore();

      expect(writeConsent("allowed")).toBe(true);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("allowed");
      expect(readConsent()).toBe("allowed");
    });

    it("should let another tab's stored choice replace one held for the page", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
        throw new Error("blocked");
      });
      writeConsent("declined");
      const unsubscribe = subscribe(() => undefined);

      window.localStorage.setItem(STORAGE_KEY, "allowed");
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
      unsubscribe();

      expect(readConsent()).toBe("allowed");
    });

    it("should tell subscribers of each change until they unsubscribe", () => {
      const heard: Consent[] = [];
      const unsubscribe = subscribe((choice) => heard.push(choice));

      writeConsent("allowed");
      writeConsent("declined");
      unsubscribe();
      writeConsent("allowed");

      expect(heard).toEqual(["allowed", "declined"]);
    });

    it("should tell subscribers of a change another tab made", () => {
      const heard: Consent[] = [];
      const unsubscribe = subscribe((choice) => heard.push(choice));

      window.localStorage.setItem(STORAGE_KEY, "declined");
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
      unsubscribe();

      expect(heard).toEqual(["declined"]);
    });
  });
}
