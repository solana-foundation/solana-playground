/**
 * Failures that mean the connection is gone rather than the request being
 * wrong: the browser closed it (`InvalidStateError`), aborted its
 * transactions with it (`AbortError`, `TransactionInactiveError`), or
 * cleared site data under it (Safari's `UnknownError`, "Database deleted by
 * request of the user"). A fresh connection may succeed where this one
 * failed. A quota, clone or key error would fail again on any connection.
 */
const CONNECTION_LOST = new Set([
  "InvalidStateError",
  "TransactionInactiveError",
  "UnknownError",
  "AbortError",
]);

/** Whether `error` means the IndexedDB connection is gone, so a retry on a new one may succeed */
export const isConnectionLost = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  CONNECTION_LOST.has((error as { name?: unknown }).name as string);

/**
 * `error`, carrying `cause` unless it has one already, so a report of a
 * retry's failure still shows what the first attempt failed with. The error
 * keeps its own name, which is what error tracking groups by.
 */
export const withCause = (error: unknown, cause: unknown) => {
  if (typeof error === "object" && error !== null && !("cause" in error)) {
    Object.assign(error, { cause });
  }
  return error;
};

/** An `Error` named `name`, for a failure the browser reported with none */
export const namedError = (name: string, message: string) =>
  Object.assign(new Error(message), { name });

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/indexeddb-retry", () => {
    it("reads a closed, aborted or cleared connection as lost", () => {
      for (const name of [
        "InvalidStateError",
        "TransactionInactiveError",
        "UnknownError",
        "AbortError",
      ]) {
        expect(isConnectionLost(namedError(name, "x"))).toBe(true);
      }
    });

    it("reads a request's own failure, or no error at all, as not lost", () => {
      expect(isConnectionLost(namedError("QuotaExceededError", "x"))).toBe(
        false
      );
      expect(isConnectionLost(namedError("DataCloneError", "x"))).toBe(false);
      expect(isConnectionLost(new Error("x"))).toBe(false);
      expect(isConnectionLost(undefined)).toBe(false);
    });

    it("attaches the first failure as the cause, keeping the error's name", () => {
      const first = new Error("first");

      const second = withCause(
        namedError("InvalidStateError", "second"),
        first
      );

      expect(second).toMatchObject({ name: "InvalidStateError", cause: first });
    });

    it("keeps a cause the error already has", () => {
      const own = new Error("own");
      const error = new Error("second", { cause: own });

      expect(withCause(error, new Error("first"))).toHaveProperty("cause", own);
    });
  });
}
