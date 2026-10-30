import type { SessionUser, SignInState } from "@/features/auth";
import type { ClusterStatus } from "./use-cluster-status";

/** What a user can pick in the account menu (and the row's Cancel), for telemetry */
export type AccountItem =
  | "sign-in"
  | "cancel-sign-in"
  | "github-profile"
  | "sign-out"
  | "settings"
  | "docs"
  | "cluster-down"
  | "connect-wallet"
  | "wallet"
  | "disconnect-wallet";

/** Where the account menu opens from: the footer's account row, or the rail's "Account" */
export type AccountSurface = "footer" | "rail";

export type AccountUser = Pick<SessionUser, "name" | "login" | "image">;

/**
 * Signed in, or where a sign-in stands. One value, so a user who is signed in
 * is never also shown a sign-in that failed before the session arrived
 */
export type AccountSession =
  | { status: "signed-in"; user: AccountUser }
  | SignInState;

export interface AccountWallet {
  /** Base58 */
  address: string;
  /** In SOL; `null` until it has loaded */
  balance: number | null;
  /**
   * An extension wallet's name; `null` for the Playground wallet. Disconnecting
   * an extension hands back to the Playground wallet, so the menu names it
   */
  name: string | null;
}

/** Everything the footer, the rail and the menu draw */
export interface AccountView {
  session: AccountSession;
  wallet: AccountWallet | null;
  cluster: ClusterStatus;
  /** A feedback send is in flight behind a closed form */
  sending: boolean;
  /** What the browser says of the network (`navigator.onLine`) */
  online: boolean;
}

/**
 * The one line under the account's name (Spec 02, "The account row says who
 * and where"): where work is saved, where a sign-in stands, who is signed
 * in, or that the network is down and work saves here. The wallet is not on
 * the row; the menu's wallet group carries it.
 */
export type AccountLine =
  | { kind: "saved-here" }
  | { kind: "signing-in" }
  | { kind: "failed"; message: string }
  | { kind: "login"; login: string }
  | { kind: "offline" };

/** Where the sign-out question stands inside the account menu */
export type SignOutState =
  | { status: "idle" }
  | { status: "asking" }
  /** Signed out; `kept` projects stayed in this browser */
  | { status: "done"; kept: number };

/**
 * What the menu shows of the sign-out question, given the session now. A
 * question with no session left to end (another tab signed out) is not asked,
 * unless its own sign-out is running and stays busy until it settles; the
 * leftovers line belongs to the signed-out menu, and a new session drops it.
 */
export const shownSignOutState = (
  state: SignOutState,
  now: { signedIn: boolean; running: boolean }
): SignOutState => {
  if (state.status === "asking" && !now.signedIn && !now.running) {
    return { status: "idle" };
  }
  if (state.status === "done" && now.signedIn) return { status: "idle" };
  return state;
};

export const SIGN_OUT_QUESTION = "Sign out of Playground?";

export const SIGN_OUT_CONSEQUENCE =
  "Projects saved to your account leave this browser. Anything not saved stays here.";

/** Spec 02's leftovers line, or `null` when nothing stayed */
export const leftoversText = (kept: number) => {
  if (kept <= 0) return null;
  if (kept === 1) {
    return "1 project stayed in this browser because it wasn't saved to your account.";
  }
  return `${kept} projects stayed in this browser because they weren't saved to your account.`;
};

export const DOCS_URL = "https://solana.com/docs";

export const githubProfileUrl = (login: string) =>
  `https://github.com/${login}`;

export const formatBalance = (balance: number | null) =>
  `${balance === null ? "…" : balance.toFixed(2)} SOL`;

export const accountUser = ({ session }: AccountView) =>
  session.status === "signed-in" ? session.user : null;

/** The short name in the account controls' label: the handle first */
const displayName = (user: AccountUser) => user.login ?? user.name ?? "Account";

/** The name on the row and at the head of the menu: the display name first, never empty */
export const profileName = (user: AccountUser) =>
  user.name ?? user.login ?? "Account";

/** The account controls' name: the visible text alone would not say what they open */
export const accountLabel = (view: AccountView) => {
  const user = accountUser(view);
  return user ? `Account: ${displayName(user)}` : "Account, signed out";
};

/** Signed in: offline first, then the handle under the display name */
const signedInLine = (
  user: AccountUser,
  view: Pick<AccountView, "online">
): AccountLine | null => {
  if (!view.online) return { kind: "offline" };
  // Without a display name the handle is already the name above
  if (user.login && user.name) return { kind: "login", login: user.login };
  return null;
};

/**
 * A failed sign-in's reason, unless the person cancelled it: a cancel is
 * their choice, and there is nothing to report. The row and the menu both
 * say a failure from this
 */
export const failureOf = ({ session }: Pick<AccountView, "session">) =>
  session.status === "failed" && session.reason !== "cancelled"
    ? session.message
    : null;

/** Signed out: a sign-in under way or failed, else where work is saved */
const signedOutLine = (session: AccountSession): AccountLine => {
  if (session.status === "pending") return { kind: "signing-in" };
  const failure = failureOf({ session });
  if (failure) return { kind: "failed", message: failure };
  return { kind: "saved-here" };
};

/**
 * The account row's name, and the one line under it. A sign-in failure the
 * person did not cancel holds the line until the next attempt or a session
 */
export const accountLines = (
  view: AccountView
): { primary: string; line: AccountLine | null } => {
  const user = accountUser(view);
  if (user) {
    return {
      primary: profileName(user),
      line: signedInLine(user, view),
    };
  }
  return {
    primary: view.session.status === "pending" ? "Signing in…" : "Sign in",
    line: signedOutLine(view.session),
  };
};

/** A line, in words */
export const lineText = (line: AccountLine) => {
  switch (line.kind) {
    case "saved-here":
      return "Saved in this browser";
    case "signing-in":
      return "Waiting for GitHub…";
    case "failed":
      // The prototype's row; the reason is said in full in the menu
      return "Couldn't sign in";
    case "login":
      return `@${line.login}`;
    case "offline":
      return "Offline · saving here";
  }
};

/** Named, not only coloured, so a screen reader hears a cluster that is down */
export const clusterLabel = (
  cluster: ClusterStatus,
  prefix: "Cluster: " | "Change cluster, currently "
) => `${prefix}${cluster.name}${cluster.down ? ", down" : ""}`;

/**
 * Down when the cluster does not answer (`PgConnection.isConnected`, polled),
 * or answers with a slot that does not move (`PgConnection.isClusterDown`,
 * read again while it stays stalled). The slot check cannot say the first on
 * its own: it is `null` when the cluster does not answer. An input that is
 * unread (`undefined`) or cannot be asked yet (`null` from `isConnected`, a
 * Playnet that has not started) says nothing; for a moment after a cluster
 * switch, either may still describe the previous cluster.
 */
export const clusterIsDown = ({
  isConnected,
  slotStalled,
}: {
  isConnected: boolean | null | undefined;
  slotStalled: boolean | null | undefined;
}) => isConnected === false || slotStalled === true;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/session-footer/model/account", () => {
    const UP = { name: "devnet", down: false };
    const IDLE = { status: "idle" } as const;

    /** Every field named: an explicit copy, not a spread over a base */
    const view = (fields: Partial<AccountView>): AccountView => ({
      session: fields.session ?? IDLE,
      wallet: fields.wallet ?? null,
      cluster: fields.cluster ?? UP,
      sending: fields.sending ?? false,
      online: fields.online ?? true,
    });

    const TESTER = { name: "Tester", login: "t", image: null };
    const NAME_ONLY = { name: "Tester", login: null, image: null };
    const NAMELESS = { name: null, login: null, image: null };
    const signedIn = (user: AccountUser): AccountSession => ({
      status: "signed-in",
      user,
    });
    const WALLET = {
      address: "7Hq5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXk2P",
      balance: 2.4,
      name: null,
    };

    describe("accountLabel", () => {
      it("names the login, then the name, then says signed out", () => {
        expect(accountLabel(view({ session: signedIn(TESTER) }))).toBe(
          "Account: t"
        );
        expect(accountLabel(view({ session: signedIn(NAME_ONLY) }))).toBe(
          "Account: Tester"
        );
        expect(accountLabel(view({}))).toBe("Account, signed out");
      });
    });

    describe("accountUser", () => {
      it("is the user only when signed in", () => {
        expect(accountUser(view({ session: signedIn(TESTER) }))).toBe(TESTER);
        expect(
          accountUser(view({ session: { status: "pending" } }))
        ).toBeNull();
      });
    });

    describe("profileName", () => {
      it("prefers the display name, then the login, never an empty label", () => {
        expect(profileName(TESTER)).toBe("Tester");
        expect(profileName({ name: null, login: "t", image: null })).toBe("t");
        expect(profileName(NAMELESS)).toBe("Account");
      });
    });

    describe("accountLines", () => {
      const FAILED = {
        status: "failed",
        reason: "popup-blocked",
        message: "Allow popups for this site to sign in.",
      } as const;

      it("says signed-out work is saved in this browser", () => {
        expect(accountLines(view({}))).toEqual({
          primary: "Sign in",
          line: { kind: "saved-here" },
        });
      });

      it("keeps the wallet off the row, signed out or in", () => {
        expect(accountLines(view({ wallet: WALLET })).line).toEqual({
          kind: "saved-here",
        });
        expect(
          accountLines(view({ session: signedIn(TESTER), wallet: WALLET })).line
        ).toEqual({ kind: "login", login: "t" });
      });

      it("says a sign-in is under way, in the name and the line", () => {
        expect(accountLines(view({ session: { status: "pending" } }))).toEqual({
          primary: "Signing in…",
          line: { kind: "signing-in" },
        });
      });

      it("says a sign-in failed, with its reason", () => {
        expect(accountLines(view({ session: FAILED }))).toEqual({
          primary: "Sign in",
          line: {
            kind: "failed",
            message: "Allow popups for this site to sign in.",
          },
        });
      });

      it("goes back to where work is saved after a cancelled sign-in", () => {
        expect(
          accountLines(
            view({
              session: {
                status: "failed",
                reason: "cancelled",
                message: "Sign-in cancelled.",
              },
            })
          ).line
        ).toEqual({ kind: "saved-here" });
      });

      it("shows the display name over the @login once signed in", () => {
        expect(accountLines(view({ session: signedIn(TESTER) }))).toEqual({
          primary: "Tester",
          line: { kind: "login", login: "t" },
        });
      });

      it("shows the name alone for an account with no login", () => {
        expect(accountLines(view({ session: signedIn(NAME_ONLY) }))).toEqual({
          primary: "Tester",
          line: null,
        });
      });

      it("says signed-in work saves here while offline", () => {
        expect(
          accountLines(view({ session: signedIn(TESTER), online: false })).line
        ).toEqual({ kind: "offline" });
      });

      it("keeps saying where signed-out work is saved while offline", () => {
        expect(accountLines(view({ online: false })).line).toEqual({
          kind: "saved-here",
        });
      });
    });

    describe("lineText", () => {
      it("says each line in Spec 02's words", () => {
        expect(lineText({ kind: "saved-here" })).toBe("Saved in this browser");
        expect(lineText({ kind: "signing-in" })).toBe("Waiting for GitHub…");
        expect(lineText({ kind: "failed", message: "x" })).toBe(
          "Couldn't sign in"
        );
        expect(lineText({ kind: "login", login: "t" })).toBe("@t");
        expect(lineText({ kind: "offline" })).toBe("Offline · saving here");
      });
    });

    describe("shownSignOutState", () => {
      const ASKING = { status: "asking" } as const;
      const DONE = { status: "done", kept: 2 } as const;

      it("drops a question whose session ended elsewhere", () => {
        expect(
          shownSignOutState(ASKING, { signedIn: false, running: false })
        ).toEqual({ status: "idle" });
      });

      it("keeps a question whose own sign-out is running", () => {
        expect(
          shownSignOutState(ASKING, { signedIn: false, running: true })
        ).toBe(ASKING);
        expect(
          shownSignOutState(ASKING, { signedIn: true, running: false })
        ).toBe(ASKING);
      });

      it("drops the leftovers line once a session is back", () => {
        expect(
          shownSignOutState(DONE, { signedIn: true, running: false })
        ).toEqual({ status: "idle" });
        expect(
          shownSignOutState(DONE, { signedIn: false, running: false })
        ).toBe(DONE);
      });
    });

    it("leaves the @login out when it is already the name", () => {
      expect(
        accountLines(
          view({
            session: signedIn({ name: null, login: "t", image: null }),
          })
        )
      ).toEqual({ primary: "t", line: null });
    });

    describe("leftoversText", () => {
      it("counts what stayed, and says nothing when nothing did", () => {
        expect(leftoversText(0)).toBeNull();
        expect(leftoversText(1)).toBe(
          "1 project stayed in this browser because it wasn't saved to your account."
        );
        expect(leftoversText(3)).toBe(
          "3 projects stayed in this browser because they weren't saved to your account."
        );
      });
    });

    describe("formatBalance", () => {
      it("waits with an ellipsis rather than claiming zero, unit kept", () => {
        expect(formatBalance(null)).toBe("… SOL");
        expect(formatBalance(0)).toBe("0.00 SOL");
      });
    });

    describe("clusterLabel", () => {
      it("says down in words, not by colour alone", () => {
        expect(clusterLabel(UP, "Cluster: ")).toBe("Cluster: devnet");
        expect(
          clusterLabel(
            { name: "devnet", down: true },
            "Change cluster, currently "
          )
        ).toBe("Change cluster, currently devnet, down");
      });
    });

    it.each([
      [false, null, true],
      [false, undefined, true],
      [true, true, true],
      [undefined, true, true],
      // Answers again after a failure that left the slot check at `null`
      [true, null, false],
      [true, false, false],
      [undefined, undefined, false],
      // Playnet before it has started: not asked yet
      [null, null, false],
    ] as const)(
      "clusterIsDown({ isConnected: %s, slotStalled: %s }) is %s",
      (isConnected, slotStalled, expected) => {
        expect(clusterIsDown({ isConnected, slotStalled })).toBe(expected);
      }
    );
  });
}
