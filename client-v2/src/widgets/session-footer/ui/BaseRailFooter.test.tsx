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
import BaseRailFooter from "./BaseRailFooter";

// The rail's tooltips measure themselves with a `ResizeObserver` on hover
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// The stock Sidebar reads the viewport through `matchMedia`, which jsdom lacks
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
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
  canFund: fields.canFund ?? false,
});

const MENU = (
  <DropdownMenuContent>
    <DropdownMenuItem>Item</DropdownMenuItem>
  </DropdownMenuContent>
);

const draw = (props: {
  account: AccountView;
  onMenuOpenChange?: (open: boolean) => void;
}) =>
  render(
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <BaseRailFooter
          account={props.account}
          status={<li>status dots</li>}
          onMenuOpenChange={props.onMenuOpenChange ?? vi.fn()}
          menu={MENU}
        />
      </SidebarProvider>
    </TooltipProvider>
  );

it("draws the status dots over the account", () => {
  draw({ account: view({}) });
  const status = screen.getByText("status dots");
  const account = screen.getByRole("button", { name: "Account, signed out" });
  expect(
    status.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});

it("opens the account menu from Account, not the navigation", async () => {
  const onMenuOpenChange = vi.fn();
  draw({ account: view({}), onMenuOpenChange });
  await userEvent.click(
    screen.getByRole("button", { name: "Account, signed out" })
  );
  expect(screen.getByRole("menuitem", { name: "Item" })).toBeTruthy();
  expect(onMenuOpenChange).toHaveBeenCalledWith(true);
});

it("shows a send in flight on Account, with the labelled spinner", () => {
  draw({ account: view({ sending: true }) });
  expect(screen.getByRole("status", { name: "Sending feedback" })).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Account, signed out" })
      .getAttribute("aria-busy")
  ).toBe("true");
});

it("draws a signed out account as a plain user glyph, with no circle around it", () => {
  draw({ account: view({}) });
  const glyph = screen
    .getByRole("button", { name: "Account, signed out" })
    .querySelector("svg");
  expect(glyph?.getAttribute("data-glyph")).toBe("user");
});
