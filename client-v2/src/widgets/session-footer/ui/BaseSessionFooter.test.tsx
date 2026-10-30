import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/shared/ui/dropdown-menu";
import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";
import type { AccountView } from "../model/account";
import BaseSessionFooter from "./BaseSessionFooter";

// The stock Sidebar reads the viewport through `matchMedia`, which jsdom lacks
beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** Every field named: an explicit copy, not a spread over a base */
const view = (fields: Partial<AccountView>): AccountView => ({
  session: fields.session ?? { status: "idle" },
  wallet: fields.wallet ?? null,
  cluster: fields.cluster ?? { name: "devnet", down: false },
  sending: fields.sending ?? false,
  online: fields.online ?? true,
});

const MENU = (
  <DropdownMenuContent>
    <DropdownMenuItem>Item</DropdownMenuItem>
  </DropdownMenuContent>
);

const draw = (props: {
  account: AccountView;
  onOpenCluster?: () => void;
  onCancelSignIn?: () => void;
  onMenuOpenChange?: (open: boolean) => void;
}) =>
  render(
    <TooltipProvider>
      <SidebarProvider>
        <BaseSessionFooter
          account={props.account}
          settingsOpen={false}
          onOpenCluster={props.onOpenCluster ?? vi.fn()}
          onCancelSignIn={props.onCancelSignIn ?? vi.fn()}
          onMenuOpenChange={props.onMenuOpenChange ?? vi.fn()}
          menu={MENU}
        />
      </SidebarProvider>
    </TooltipProvider>
  );

it("opens the settings on the cluster from the cluster row", async () => {
  const onOpenCluster = vi.fn();
  draw({ account: view({}), onOpenCluster });
  const row = screen.getByRole("button", {
    name: "Change cluster, currently devnet",
  });
  expect(row.hasAttribute("data-settings-trigger")).toBe(true);
  await userEvent.click(row);
  expect(onOpenCluster).toHaveBeenCalledOnce();
});

it("names a cluster that is down and colours its dot", () => {
  draw({ account: view({ cluster: { name: "devnet", down: true } }) });
  const row = screen.getByRole("button", {
    name: "Change cluster, currently devnet, down",
  });
  expect(
    row.querySelector('[data-slot="status-dot"]')?.getAttribute("data-variant")
  ).toBe("error");
});

it("opens the account menu from the account row and reports it", async () => {
  const onMenuOpenChange = vi.fn();
  draw({ account: view({}), onMenuOpenChange });
  await userEvent.click(
    screen.getByRole("button", { name: "Account, signed out" })
  );
  expect(screen.getByRole("menuitem", { name: "Item" })).toBeTruthy();
  expect(onMenuOpenChange).toHaveBeenCalledWith(true);
});

const WALLET = {
  address: "7Hq5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXk2P",
  balance: 2.4,
  name: null,
};

it("shows the name over the @login on the account row, and no wallet", () => {
  draw({
    account: view({
      session: {
        status: "signed-in",
        user: { name: "Tester", login: "t", image: null },
      },
      wallet: WALLET,
    }),
  });
  const row = screen.getByRole("button", { name: "Account: t" });
  expect(row.textContent).toBe("Tester@t");
});

it("says signed-out work is saved in this browser, with a wallet or without", () => {
  draw({ account: view({ wallet: WALLET }) });
  const row = screen.getByRole("button", { name: "Account, signed out" });
  expect(row.textContent).toBe("Sign inSaved in this browser");
});

it("says signed-in work saves here while offline", () => {
  draw({
    account: view({
      session: {
        status: "signed-in",
        user: { name: "Tester", login: "t", image: null },
      },
      online: false,
    }),
  });
  expect(screen.getByRole("button", { name: "Account: t" }).textContent).toBe(
    "TesterOffline · saving here"
  );
});

it("announces Couldn't sign in under the row after a failure, the reason on hover", () => {
  draw({
    account: view({
      session: {
        status: "failed",
        reason: "popup-blocked",
        message: "Allow popups for this site to sign in.",
      },
    }),
  });
  const line = screen.getByRole("status");
  expect(line.textContent).toBe("Couldn't sign in");
  expect(line.getAttribute("title")).toBe(
    "Allow popups for this site to sign in."
  );
});

it("goes back to where work is saved after a cancelled sign-in", () => {
  draw({
    account: view({
      session: {
        status: "failed",
        reason: "cancelled",
        message: "Sign-in cancelled.",
      },
    }),
  });
  expect(screen.queryByText("Couldn't sign in")).toBeNull();
  expect(screen.getByText("Saved in this browser")).toBeTruthy();
});

it("offers Cancel beside the row while signing in", async () => {
  const onCancelSignIn = vi.fn();
  draw({ account: view({ session: { status: "pending" } }), onCancelSignIn });
  expect(screen.getByText("Signing in…")).toBeTruthy();
  expect(screen.getByText("Waiting for GitHub…")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancelSignIn).toHaveBeenCalledOnce();
});

it("shows a send in flight on the account row", () => {
  draw({ account: view({ sending: true }) });
  const row = screen.getByRole("button", { name: "Account, signed out" });
  expect(row.getAttribute("aria-busy")).toBe("true");
  expect(row.querySelector('[data-slot="feedback-pulse"]')).toBeTruthy();
  expect(screen.getByRole("status", { name: "Sending feedback" })).toBeTruthy();
});
