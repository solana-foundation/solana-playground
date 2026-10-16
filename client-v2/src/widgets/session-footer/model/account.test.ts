import { describe, expect, it } from "vitest";

import {
  accountLabel,
  accountLines,
  accountUser,
  clusterLabel,
  formatBalance,
  lineText,
  profileName,
  shortAddress,
} from "./account";
import type { AccountSession, AccountView } from "./account";

const UP = { name: "devnet", down: false };
const IDLE = { status: "idle" } as const;

/** Every field named: an explicit copy, not a spread over a base */
const view = (fields: Partial<AccountView>): AccountView => ({
  session: fields.session ?? IDLE,
  wallet: fields.wallet ?? null,
  cluster: fields.cluster ?? UP,
  sending: fields.sending ?? false,
});

const TESTER = { name: "Tester", login: "t", image: null };
const NAME_ONLY = { name: "Tester", login: null, image: null };
const NAMELESS = { name: null, login: null, image: null };
const signedIn = (user: typeof TESTER | typeof NAME_ONLY): AccountSession => ({
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
    expect(accountUser(view({ session: { status: "pending" } }))).toBeNull();
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
    expect(accountLines(view({}))).toEqual({ primary: "Sign in", lines: [] });
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
        { kind: "wallet", address: WALLET.address, balance: 2.4, name: null },
      ],
    });
  });

  it("falls back to the name for an account with no login", () => {
    expect(accountLines(view({ session: signedIn(NAME_ONLY) })).primary).toBe(
      "Tester"
    );
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
    expect(lineText({ kind: "failed", message: "x" })).toBe("Couldn't sign in");
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
      clusterLabel({ name: "devnet", down: true }, "Change cluster, currently ")
    ).toBe("Change cluster, currently devnet, down");
  });
});
