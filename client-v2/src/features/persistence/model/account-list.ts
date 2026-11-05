/**
 * Whether the signed-in account's project list has been read on this page,
 * and whether it held anything: what Home needs to tell a signed-in account
 * with no projects (a first run) from a browser sync has not filled yet. Set
 * by the reconcile pass from the list it reads anyway, so it costs no fetch;
 * cleared on sign-out.
 */
export type AccountList = "unknown" | "empty" | "holds";

let state: AccountList = "unknown";
const listeners = new Set<() => void>();

const set = (next: AccountList) => {
  if (state === next) return;
  state = next;
  for (const cb of listeners) cb();
};

export const PgAccountList = {
  get state(): AccountList {
    return state;
  },
  /** The reconcile pass read the account's list, `count` projects long */
  listed(count: number) {
    set(count === 0 ? "empty" : "holds");
  },
  /** Signed out: the next account's list is not known yet */
  forget() {
    set("unknown");
  },
  onDidChange(cb: () => void) {
    listeners.add(cb);
    return { dispose: () => listeners.delete(cb) };
  },
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;

  describe("features/persistence/model/account-list", () => {
    afterEach(() => PgAccountList.forget());

    it("is unknown until a pass reads the list", () => {
      expect(PgAccountList.state).toBe("unknown");
    });

    it("tells an empty account from one that holds projects", () => {
      PgAccountList.listed(0);
      expect(PgAccountList.state).toBe("empty");
      PgAccountList.listed(3);
      expect(PgAccountList.state).toBe("holds");
    });

    it("tells listeners once per change, and forgets on sign-out", () => {
      const heard = vi.fn();
      const sub = PgAccountList.onDidChange(heard);
      PgAccountList.listed(0);
      PgAccountList.listed(0);
      PgAccountList.forget();
      expect(heard).toHaveBeenCalledTimes(2);
      expect(PgAccountList.state).toBe("unknown");
      sub.dispose();
    });
  });
}
