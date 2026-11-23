import { createLogger } from "../logger";

/**
 * A browser's answer to "may Playground send usage events to Google
 * Analytics?" (`analytics-consent`). `unanswered` until the visitor picks.
 */
export type Consent = "unanswered" | "allowed" | "declined";

const STORAGE_KEY = "analytics-consent";

const log = createLogger("telemetry:consent");

const isConsent = (value: unknown): value is Consent =>
  value === "unanswered" || value === "allowed" || value === "declined";

/**
 * The stored choice. A missing or unreadable value, a value that is none of the
 * three, and storage that throws (blocked cookies, private windows) all read as
 * `unanswered`, so the page never loads GA4 on a guess.
 */
export const readConsent = (): Consent => {
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

const notify = () => {
  const choice = readConsent();
  listeners.forEach((listener) => listener(choice));
};

/**
 * Stores `choice` and tells every subscriber. When storage refuses the write,
 * the subscribers still hear what a read now says, which is the old value.
 */
export const writeConsent = (choice: Consent) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch (error) {
    log.warn("the analytics choice could not be stored", {
      context: { error: String(error) },
    });
  }
  notify();
};

/**
 * Calls `listener` with the new choice after every change in this tab or, by
 * the browser's `storage` event, in another one. Returns the unsubscribe.
 */
export const subscribe = (listener: Listener) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    // A null key is `localStorage.clear()`, which also drops the choice
    if (event.key === null || event.key === STORAGE_KEY)
      listener(readConsent());
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

    it("should not throw when storage throws on a write, and keep reading unanswered", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const heard: Consent[] = [];
      const unsubscribe = subscribe((choice) => heard.push(choice));

      expect(() => writeConsent("allowed")).not.toThrow();
      expect(readConsent()).toBe("unanswered");
      expect(heard).toEqual(["unanswered"]);
      unsubscribe();
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
