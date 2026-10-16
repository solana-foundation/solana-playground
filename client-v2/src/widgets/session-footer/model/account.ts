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
