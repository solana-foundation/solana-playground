import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { DropdownMenu, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import type { AccountView } from "../model/account";
import BaseAccountMenu from "./BaseAccountMenu";

const UP = { name: "devnet", down: false };
const TESTER = { name: "Tester", login: "t", image: null };
const WALLET = {
  address: "7Hq5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXk2P",
  balance: 2.4,
  name: null,
};

/** Every field named: an explicit copy, not a spread over a base */
const view = (fields: Partial<AccountView>): AccountView => ({
  session: fields.session ?? { status: "idle" },
  wallet: fields.wallet ?? null,
  cluster: fields.cluster ?? UP,
  sending: fields.sending ?? false,
  canFund: fields.canFund ?? false,
});

const open = async (account: AccountView, onPick = vi.fn()) => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <BaseAccountMenu
        account={account}
        feedback={<div role="menuitem">Report a bug</div>}
        side="top"
        settingsShortcut="⌘,"
        onPick={onPick}
      />
    </DropdownMenu>
  );
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  return onPick;
};

const items = () =>
  screen
    .getAllByRole("menuitem")
    .map((item) => item.textContent?.replace(/\s+/g, ""));

it("offers sign-in, settings, docs, feedback and the wallet when signed out", async () => {
  await open(view({}));
  expect(items()).toEqual([
    "SigninwithGitHub",
    "Settings⌘,",
    "Docs",
    "Reportabug",
    "Connectwallet",
  ]);
});

it("offers the profile and Sign out when signed in, with no Proposal group", async () => {
  await open(view({ session: { status: "signed-in", user: TESTER } }));
  expect(screen.getByText("Tester")).toBeTruthy();
  expect(screen.getByText("@t")).toBeTruthy();
  expect(items().slice(0, 2)).toEqual(["OpenGitHubprofile", "Signout"]);
  expect(screen.queryByText("Proposal")).toBeNull();
});

it("leaves out the profile link for an account with no login", async () => {
  await open(
    view({
      session: {
        status: "signed-in",
        user: { name: "Tester", login: null, image: null },
      },
    })
  );
  expect(
    screen.queryByRole("menuitem", { name: "Open GitHub profile" })
  ).toBeNull();
  expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
});

it("says why a sign-in failed above Sign in with GitHub, for the rail too", async () => {
  await open(
    view({
      session: {
        status: "failed",
        reason: "popup-blocked",
        message: "Allow popups for this site to sign in.",
      },
    })
  );
  expect(
    screen.getByText("Allow popups for this site to sign in.")
  ).toBeTruthy();
  expect(items()[0]).toBe("SigninwithGitHub");
});

it("names an account with neither a name nor a login", async () => {
  await open(
    view({
      session: {
        status: "signed-in",
        user: { name: null, login: null, image: null },
      },
    })
  );
  expect(screen.getByText("Account")).toBeTruthy();
});

it("offers Cancel while a sign-in waits", async () => {
  const onPick = await open(view({ session: { status: "pending" } }));
  expect(screen.getByText("Signing in...")).toBeTruthy();
  await userEvent.click(screen.getByRole("menuitem", { name: "Cancel" }));
  expect(onPick).toHaveBeenCalledExactlyOnceWith("cancel-sign-in");
});

it("shows a connected wallet and offers to disconnect it", async () => {
  const onPick = await open(view({ wallet: WALLET }));
  expect(
    screen.getByRole("menuitem", { name: "Disconnect wallet" })
  ).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "Connect wallet" })).toBeNull();
  await userEvent.click(screen.getByRole("menuitem", { name: /7Hq5…Xk2P/ }));
  expect(onPick).toHaveBeenCalledExactlyOnceWith("wallet");
});

it("names the extension wallet it disconnects, which hands back to the Playground wallet", async () => {
  await open(
    view({
      wallet: {
        address: "7Hq5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXk2P",
        balance: 1,
        name: "Phantom",
      },
    })
  );
  expect(
    screen.getByRole("menuitem", { name: "Disconnect Phantom" })
  ).toBeTruthy();
  expect(
    screen.queryByRole("menuitem", { name: "Disconnect wallet" })
  ).toBeNull();
});

it("puts a cluster that is down first, as the way to the network settings", async () => {
  const onPick = await open(view({ cluster: { name: "devnet", down: true } }));
  const first = screen.getAllByRole("menuitem")[0];
  expect(first.textContent).toContain("devnet is not answering");
  expect(first.hasAttribute("data-settings-trigger")).toBe(true);
  await userEvent.click(first);
  expect(onPick).toHaveBeenCalledExactlyOnceWith("cluster-down");
});

it("marks Settings as a settings trigger, as tests find it", async () => {
  const onPick = await open(view({}));
  const settings = screen.getByRole("menuitem", { name: /Settings/ });
  expect(settings.hasAttribute("data-settings-trigger")).toBe(true);
  await userEvent.click(settings);
  expect(onPick).toHaveBeenCalledExactlyOnceWith("settings");
});

it.each([
  ["Settings", view({})],
  [
    "devnet is not answering",
    view({ cluster: { name: "devnet", down: true } }),
  ],
] as const)(
  "leaves focus where %s put it, not back on the menu's trigger",
  async (name, account) => {
    const panel = document.createElement("button");
    document.body.append(panel);
    // The settings page focuses itself as it opens;
    // while the menu is mounted, its focus trap would pull focus back
    await open(
      account,
      vi.fn(() => panel.focus())
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: new RegExp(name) })
    );
    expect(document.activeElement).toBe(panel);
    panel.remove();
  }
);

it("returns focus to the menu's trigger after any other pick", async () => {
  await open(view({}));
  await userEvent.click(
    screen.getByRole("menuitem", { name: "Connect wallet" })
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Open" })
  );
});

it("opens Docs and the profile in a new tab and reports the pick", async () => {
  const onPick = await open(
    view({ session: { status: "signed-in", user: TESTER } })
  );
  const docs = screen.getByRole("menuitem", { name: "Docs" });
  expect(docs.getAttribute("href")).toBe("https://solana.com/docs");
  expect(docs.getAttribute("target")).toBe("_blank");
  expect(docs.getAttribute("rel")).toBe("noopener noreferrer");
  const profile = screen.getByRole("menuitem", {
    name: "Open GitHub profile",
  });
  expect(profile.getAttribute("href")).toBe("https://github.com/t");
  await userEvent.click(docs);
  expect(onPick).toHaveBeenCalledExactlyOnceWith("docs");
});

it("offers funding in the wallet group once a Playground wallet exists", async () => {
  const onPick = await open(view({ wallet: WALLET, canFund: true }));

  await userEvent.click(
    screen.getByRole("menuitem", { name: "Fund from a wallet" })
  );

  expect(onPick).toHaveBeenCalledExactlyOnceWith("fund-wallet");
});

it("offers no funding before the Playground wallet is set up", async () => {
  await open(view({ canFund: false }));

  expect(
    screen.queryByRole("menuitem", { name: "Fund from a wallet" })
  ).toBeNull();
});
