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
  | "disconnect-wallet"
  | "fund-wallet";

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
  /**
   * A Playground account exists to receive SOL, so the menu offers "Fund from
   * a wallet" (`features/fund-wallet`); false before the wallet's setup
   */
  canFund: boolean;
}

/** The line under the account's name */
export type AccountLine =
  | { kind: "signing-in" }
  | { kind: "failed"; message: string }
  | ({ kind: "wallet" } & AccountWallet);

export const DOCS_URL = "https://solana.com/docs";

export const githubProfileUrl = (login: string) =>
  `https://github.com/${login}`;

export const shortAddress = (address: string) =>
  `${address.slice(0, 4)}…${address.slice(-4)}`;

export const formatBalance = (balance: number | null) =>
  balance === null ? "…" : `${balance.toFixed(2)} SOL`;

export const accountUser = ({ session }: AccountView) =>
  session.status === "signed-in" ? session.user : null;

/** The short name on the account row: the handle first */
const displayName = (user: AccountUser) => user.login ?? user.name ?? "Account";

/** The name at the head of the menu: the display name first, never empty */
export const profileName = (user: AccountUser) =>
  user.name ?? user.login ?? "Account";

/** The account controls' name: the visible text alone would not say what they open */
export const accountLabel = (view: AccountView) => {
  const user = accountUser(view);
  return user ? `Account: ${displayName(user)}` : "Account, signed out";
};

const sessionLine = (session: AccountSession): AccountLine | null => {
  if (session.status === "pending") return { kind: "signing-in" };
  // The user chose to stop; there is nothing to report
  if (session.status === "failed" && session.reason !== "cancelled") {
    return { kind: "failed", message: session.message };
  }
  return null;
};

/**
 * The account row's name, and the lines under it: where a sign-in stands,
 * then the wallet. Both show: a failed sign-in stays failed in `PgSession`
 * until the next attempt, and must not hide a wallet connected meanwhile
 */
export const accountLines = (
  view: AccountView
): { primary: string; lines: AccountLine[] } => {
  const user = accountUser(view);
  const lines: AccountLine[] = [];
  const fromSession = sessionLine(view.session);
  if (fromSession) lines.push(fromSession);
  if (view.wallet) {
    lines.push({
      kind: "wallet",
      address: view.wallet.address,
      balance: view.wallet.balance,
      name: view.wallet.name,
    });
  }
  return { primary: user ? displayName(user) : "Sign in", lines };
};

/** A line, in words */
export const lineText = (line: AccountLine) => {
  switch (line.kind) {
    case "signing-in":
      return "Signing in...";
    case "failed":
      return "Couldn't sign in";
    case "wallet":
      return `${shortAddress(line.address)} · ${formatBalance(line.balance)}`;
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
      canFund: fields.canFund ?? false,
    });

    const TESTER = { name: "Tester", login: "t", image: null };
    const NAME_ONLY = { name: "Tester", login: null, image: null };
    const NAMELESS = { name: null, login: null, image: null };
    const signedIn = (
      user: typeof TESTER | typeof NAME_ONLY
    ): AccountSession => ({
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

      it("asks to sign in with nothing under it", () => {
        expect(accountLines(view({}))).toEqual({
          primary: "Sign in",
          lines: [],
        });
      });

      it("says a sign-in is under way", () => {
        expect(
          accountLines(view({ session: { status: "pending" } })).lines
        ).toEqual([{ kind: "signing-in" }]);
      });

      it("says a sign-in failed, with its reason", () => {
        expect(accountLines(view({ session: FAILED })).lines).toEqual([
          { kind: "failed", message: "Allow popups for this site to sign in." },
        ]);
      });

      it("says nothing of a sign-in the user cancelled", () => {
        expect(
          accountLines(
            view({
              session: {
                status: "failed",
                reason: "cancelled",
                message: "Sign-in cancelled.",
              },
            })
          ).lines
        ).toEqual([]);
      });

      it("keeps the wallet under a failed sign-in, not instead of it", () => {
        expect(
          accountLines(view({ session: FAILED, wallet: WALLET })).lines
        ).toEqual([
          { kind: "failed", message: "Allow popups for this site to sign in." },
          {
            kind: "wallet",
            address: WALLET.address,
            balance: 2.4,
            name: null,
          },
        ]);
      });

      it("shows the login and the wallet once signed in", () => {
        expect(
          accountLines(view({ session: signedIn(TESTER), wallet: WALLET }))
        ).toEqual({
          primary: "t",
          lines: [
            {
              kind: "wallet",
              address: WALLET.address,
              balance: 2.4,
              name: null,
            },
          ],
        });
      });

      it("falls back to the name for an account with no login", () => {
        expect(
          accountLines(view({ session: signedIn(NAME_ONLY) })).primary
        ).toBe("Tester");
      });

      it("shows a wallet while signed out too", () => {
        expect(accountLines(view({ wallet: WALLET })).lines[0]?.kind).toBe(
          "wallet"
        );
      });
    });

    describe("lineText", () => {
      it("says each line in words", () => {
        expect(lineText({ kind: "signing-in" })).toBe("Signing in...");
        expect(lineText({ kind: "failed", message: "x" })).toBe(
          "Couldn't sign in"
        );
        expect(
          lineText({
            kind: "wallet",
            address: WALLET.address,
            balance: 2.4,
            name: null,
          })
        ).toBe("7Hq5…Xk2P · 2.40 SOL");
      });
    });

    describe("formatBalance", () => {
      it("waits with an ellipsis rather than claiming zero", () => {
        expect(formatBalance(null)).toBe("…");
        expect(formatBalance(0)).toBe("0.00 SOL");
      });
    });

    describe("shortAddress", () => {
      it("keeps four characters at each end", () => {
        expect(shortAddress(WALLET.address)).toBe("7Hq5…Xk2P");
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
