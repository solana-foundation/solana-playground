/**
 * What leads Home, by visit (spec `client-v2-first-run`): `return` once the
 * browser holds a project; `first` when it holds none, the session has
 * answered, and either nobody is signed in or the account's own list came
 * back empty; `unknown` otherwise -- a failed read says nothing of who is
 * signed in, and an empty browser says nothing of what sync will bring
 */
export type Visit = "first" | "return" | "unknown";

/** How the session read went: `PgSession.readState`, by type only */
export type SessionSeen = import("@/features/auth").ReadState;

/**
 * What is known of the account's projects: nobody signed in, or the signed-in
 * account's list as the reconcile pass read it (`PgAccountList.state`)
 */
export type AccountSeen =
  | "signed-out"
  | import("@/features/persistence").AccountList;

/** A project in the browser wins; then the session, then the account's list */
export const visitOf = (
  names: readonly string[] | undefined,
  session: SessionSeen,
  account: AccountSeen
): Visit => {
  if (!names) return "unknown";
  if (names.length) return "return";
  if (session !== "answered") return "unknown";
  return account === "signed-out" || account === "empty" ? "first" : "unknown";
};

/**
 * Whether the visit hangs on a failed account check, so Home retries it:
 * no project in the browser to lead with, and a read that failed
 */
export const needsSessionRetry = (
  names: readonly string[] | undefined,
  session: SessionSeen
) => names?.length === 0 && session === "failed";

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/home/model/visit", () => {
    it("is a first visit with no project once the session has answered", () => {
      expect(visitOf([], "answered", "signed-out")).toBe("first");
    });

    it("is a return visit once the browser holds a project", () => {
      expect(visitOf(["a"], "answered", "signed-out")).toBe("return");
      expect(visitOf(["a"], "failed", "signed-out")).toBe("return");
    });

    it("waits for a signed-in account's own list before calling it a first visit", () => {
      expect(visitOf([], "answered", "unknown")).toBe("unknown");
      expect(visitOf([], "answered", "holds")).toBe("unknown");
      expect(visitOf([], "answered", "empty")).toBe("first");
    });

    it("is unknown before the list loads", () => {
      expect(visitOf(undefined, "answered", "signed-out")).toBe("unknown");
    });

    it("retries the check only when a failed read is all there is to go on", () => {
      expect(needsSessionRetry([], "failed")).toBe(true);
      expect(needsSessionRetry(["a"], "failed")).toBe(false);
      expect(needsSessionRetry(undefined, "failed")).toBe(false);
      expect(needsSessionRetry([], "unread")).toBe(false);
    });

    it("is unknown until the session answers, and after a failed read", () => {
      expect(visitOf([], "unread", "signed-out")).toBe("unknown");
      expect(visitOf([], "failed", "signed-out")).toBe("unknown");
    });
  });
}
