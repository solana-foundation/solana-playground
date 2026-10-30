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
  canFund: fields.canFund ?? false,
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

it("shows the login and the wallet on the account row", () => {
  draw({
    account: view({
      session: {
        status: "signed-in",
        user: { name: "Tester", login: "t", image: null },
      },
      wallet: {
        address: "7Hq5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXk2P",
        balance: 2.4,
        name: null,
      },
    }),
  });
  const row = screen.getByRole("button", { name: "Account: t" });
  expect(row.textContent).toContain("t");
  expect(row.textContent).toContain("7Hq5…Xk2P · 2.40 SOL");
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

it("keeps the wallet under a failed sign-in", () => {
  draw({
    account: view({
      session: {
        status: "failed",
        reason: "popup-blocked",
        message: "Allow popups for this site to sign in.",
      },
      wallet: {
        address: "7Hq5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXk2P",
        balance: 2.4,
        name: null,
      },
    }),
  });
  const row = screen.getByRole("button", { name: "Account, signed out" });
  expect(row.textContent).toContain("Couldn't sign in");
  expect(row.textContent).toContain("7Hq5…Xk2P · 2.40 SOL");
});

it("says nothing under the row of a sign-in the user cancelled", () => {
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
});

it("offers Cancel beside the row while signing in", async () => {
  const onCancelSignIn = vi.fn();
  draw({ account: view({ session: { status: "pending" } }), onCancelSignIn });
  expect(screen.getByText("Signing in...")).toBeTruthy();
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
