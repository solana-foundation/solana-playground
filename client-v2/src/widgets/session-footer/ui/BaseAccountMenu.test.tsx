import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { DropdownMenu, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import type { AccountView, SignOutState } from "../model/account";
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
  online: fields.online ?? true,
});

const IDLE: SignOutState = { status: "idle" };

const open = async (
  account: AccountView,
  onPick = vi.fn(),
  signOut: {
    state?: SignOutState;
    onConfirm?: () => Promise<void>;
    onCancel?: () => void;
  } = {}
) => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <BaseAccountMenu
        account={account}
        feedback={<div role="menuitem">Report a bug</div>}
        side="top"
        settingsShortcut="⌘,"
        onPick={onPick}
        signOut={signOut.state ?? IDLE}
        onSignOutConfirm={signOut.onConfirm ?? vi.fn(async () => {})}
        onSignOutCancel={signOut.onCancel ?? vi.fn()}
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
  expect(items()[0]).toBe("Tryagain");
});

it("retries a failed sign-in from Try again", async () => {
  const onPick = await open(
    view({
      session: {
        status: "failed",
        reason: "request-failed",
        message: "Sign-in isn't available. Your work is saved in this browser.",
      },
    })
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "Try again" }));
  expect(onPick).toHaveBeenCalledExactlyOnceWith("sign-in");
});

it("turns sign-in off while offline, and says why", async () => {
  await open(view({ online: false }));
  const item = screen.getByRole("menuitem", { name: "You're offline" });
  expect(item.getAttribute("aria-disabled")).toBe("true");
  expect(
    screen.queryByRole("menuitem", { name: "Sign in with GitHub" })
  ).toBeNull();
});

it("asks in the menu when Sign out is picked, keeping it open", async () => {
  const onPick = await open(
    view({ session: { status: "signed-in", user: TESTER } })
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
  expect(onPick).toHaveBeenCalledExactlyOnceWith("sign-out");
  expect(screen.getByRole("menu")).toBeTruthy();
});

const signedIn = view({ session: { status: "signed-in", user: TESTER } });

it("asks Sign out of Playground? in place, focus on Cancel", async () => {
  const onCancel = vi.fn();
  await open(signedIn, vi.fn(), { state: { status: "asking" }, onCancel });
  expect(screen.getByText("Sign out of Playground?")).toBeTruthy();
  expect(
    screen.getByText(
      "Projects saved to your account leave this browser. Anything not saved stays here."
    )
  ).toBeTruthy();
  // Only the question's two items: the rest of the menu waits behind it
  expect(items()).toEqual(["Cancel", "Signout"]);
  const cancel = screen.getByRole("menuitem", { name: "Cancel" });
  await waitFor(() => expect(document.activeElement).toBe(cancel));

  await userEvent.click(cancel);
  expect(onCancel).toHaveBeenCalledOnce();
  expect(screen.getByRole("menu")).toBeTruthy();
});

it("stays open and busy while the sign-out runs", async () => {
  let finish: () => void = () => {};
  const onConfirm = vi.fn(
    () => new Promise<void>((resolve) => (finish = resolve))
  );
  await open(signedIn, vi.fn(), { state: { status: "asking" }, onConfirm });
  const confirm = screen.getByRole("menuitem", { name: /Sign out/ });
  await userEvent.click(confirm);
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(screen.getByRole("menu")).toBeTruthy();
  expect(confirm.getAttribute("aria-busy")).toBe("true");

  // A second press while it runs starts nothing
  await userEvent.click(confirm);
  expect(onConfirm).toHaveBeenCalledOnce();
  finish();
});

it("says how many projects stayed after signing out", async () => {
  await open(view({}), vi.fn(), { state: { status: "done", kept: 2 } });
  expect(
    screen.getByText(
      "2 projects stayed in this browser because they weren't saved to your account."
    )
  ).toBeTruthy();
});

it("says nothing more after a sign-out that left nothing behind", async () => {
  await open(view({}), vi.fn(), { state: { status: "done", kept: 0 } });
  expect(screen.queryByText(/stayed in this browser/)).toBeNull();
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

it("offers Cancel sign-in while a sign-in waits", async () => {
  const onPick = await open(view({ session: { status: "pending" } }));
  expect(screen.getByText("Waiting for GitHub…")).toBeTruthy();
  await userEvent.click(
    screen.getByRole("menuitem", { name: "Cancel sign-in" })
  );
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

const openPage = async (account: AccountView, onPick = vi.fn()) => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <BaseAccountMenu
        page
        account={account}
        feedback={<div role="menuitem">Report a bug</div>}
        side="top"
        settingsShortcut="⌘,"
        onPick={onPick}
        signOut={IDLE}
        onSignOutConfirm={vi.fn(async () => {})}
        onSignOutCancel={vi.fn()}
      />
    </DropdownMenu>
  );
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  return onPick;
};

it("as a phone's page, is titled Account and closes from its bar", async () => {
  await openPage(view({}));
  expect(screen.getByRole("menu")).toBeTruthy();
  expect(screen.getByText("Account", { selector: "h2" })).toBeTruthy();
  await userEvent.click(screen.getByRole("menuitem", { name: "Close" }));
  expect(screen.queryByRole("menu")).toBeNull();
});

it("as a phone's page, signed out, pins Sign in with GitHub at its foot with what it is for", async () => {
  const onPick = await openPage(view({}));
  expect(
    screen.getByText(
      "Keep your projects and conversations on every device, and request devnet SOL."
    )
  ).toBeTruthy();
  const signIns = screen.getAllByRole("menuitem", {
    name: "Sign in with GitHub",
  });
  expect(signIns).toHaveLength(1);
  expect(signIns[0].closest("[data-account-foot]")).toBeTruthy();
  await userEvent.click(signIns[0]);
  expect(onPick).toHaveBeenCalledWith("sign-in");
});

it("as a phone's page, signed in, has no foot", async () => {
  await openPage(view({ session: { status: "signed-in", user: TESTER } }));
  expect(document.querySelector("[data-account-foot]")).toBeNull();
});

it("as a phone's page, does not sign in on the release of the press that opened it", async () => {
  const onPick = await openPage(view({}));
  // The page covers the account row, so the finger that opened it lifts over
  // the foot's button: a release with no press on it
  const signIn = screen.getByRole("menuitem", { name: "Sign in with GitHub" });
  fireEvent.pointerUp(signIn, { pointerType: "touch" });
  expect(onPick).not.toHaveBeenCalled();
  expect(screen.getByRole("menu")).toBeTruthy();
});
