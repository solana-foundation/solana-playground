import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";

import { PgSession } from "@/features/auth";
import { PgView } from "@/utils/view";
import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";
import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { SETUP_REJECTED } from "@/commands/connect/setup-rejected";
import RailFooter from "./RailFooter";
import SessionFooter from "./SessionFooter";

const status = vi.hoisted(() => ({ name: "devnet", down: false }));
const wallet = vi.hoisted(() => ({
  current: null as null | {
    publicKey: { toBase58: () => string };
    isPg?: boolean;
    name?: string;
  },
}));
const connect = vi.hoisted(() => ({ execute: vi.fn() }));
const walletWindow = vi.hoisted(() => ({ show: false }));
const balance = vi.hoisted(() => ({ current: 2.4 as number | undefined }));
const setToast = vi.hoisted(() => vi.fn());
const explorer = vi.hoisted(() => ({
  allWorkspaceNames: [] as string[] | null,
}));

vi.mock("../model/use-cluster-status", () => ({
  useClusterStatus: () => status,
}));
// The hooks and utils barrels read generated globals that exist only in the built app
vi.mock("@/hooks", () => ({
  useRenderOnChange: () => undefined,
  useWallet: () => wallet.current,
  useBalance: () => balance.current,
}));
vi.mock("@/utils", () => ({
  PgCommand: { connect },
  PgCommon: { getOS: () => "MacOS" },
  PgExplorer: explorer,
  PgWallet: walletWindow,
  PgView: { setToast },
}));
vi.mock("@/features/feedback", () => ({
  FeedbackMenuItems: () => null,
  useFeedbackSend: () => ({ sending: false, triggerRef: { current: null } }),
}));

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

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  connect.execute.mockResolvedValue(undefined);
});
afterEach(() => {
  resetTelemetry();
  resetLogger();
  vi.restoreAllMocks();
  connect.execute.mockReset();
  status.down = false;
  wallet.current = null;
  walletWindow.show = false;
  balance.current = 2.4;
  setToast.mockReset();
  explorer.allWorkspaceNames = [];
  PgSession.reset();
});

const ADDRESS = "7Hq5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXk2P";

const draw = (which: "footer" | "rail", onToggleSettings = vi.fn()) => {
  const Footer = which === "footer" ? SessionFooter : RailFooter;
  render(
    <TooltipProvider>
      <SidebarProvider defaultOpen={which === "footer"}>
        <Footer settingsOpen={false} onToggleSettings={onToggleSettings} />
      </SidebarProvider>
    </TooltipProvider>
  );
  return onToggleSettings;
};

const openMenu = () =>
  userEvent.click(screen.getByRole("button", { name: /^Account/ }));

const pick = async (name: string | RegExp) => {
  await openMenu();
  await userEvent.click(await screen.findByRole("menuitem", { name }));
};

const eventsNamed = (name: string) =>
  sent.events.filter((event) => event.name === name).map((e) => e.params);

it("opens the settings on the cluster from the footer's cluster row", async () => {
  const fromRow = draw("footer");
  await userEvent.click(
    screen.getByRole("button", { name: "Change cluster, currently devnet" })
  );
  expect(fromRow).toHaveBeenCalledExactlyOnceWith({
    from: "cluster",
    focus: "network",
  });
});

it("opens the settings on the cluster from the rail's dot", async () => {
  const fromDot = draw("rail");
  await userEvent.click(
    screen.getByRole("button", { name: "Cluster: devnet" })
  );
  expect(fromDot).toHaveBeenCalledExactlyOnceWith({
    from: "rail",
    focus: "network",
  });
});

it.each(["footer", "rail"] as const)(
  "reports that the %s opened the menu",
  async (which) => {
    draw(which);
    await openMenu();
    expect(eventsNamed("session_account_menu_opened")).toEqual([
      { from: which },
    ]);
  }
);

it("starts a sign-in from the menu", async () => {
  const signIn = vi.spyOn(PgSession, "signIn").mockResolvedValue();
  draw("footer");
  await pick("Sign in with GitHub");
  expect(signIn).toHaveBeenCalledOnce();
  expect(eventsNamed("session_account_item_picked")).toEqual([
    { item: "sign-in" },
  ]);
});

const signInAsTester = () =>
  PgSession.refreshWith({ id: "u1", name: "Tester", image: null, login: "t" });

const question = () => screen.findByText("Sign out of Playground?");

it("asks in the menu before signing out, and counts a cancel", async () => {
  await signInAsTester();
  const signOut = vi.spyOn(PgSession, "signOut").mockResolvedValue();
  draw("footer");

  await pick("Sign out");
  await question();
  await userEvent.click(screen.getByRole("menuitem", { name: "Cancel" }));
  // The menu's items come back, and nothing was signed out
  expect(
    await screen.findByRole("menuitem", { name: "Sign out" })
  ).toBeTruthy();
  expect(signOut).not.toHaveBeenCalled();
  expect(eventsNamed("session_sign_out_ended")).toEqual([
    { outcome: "cancelled" },
  ]);
});

it("counts a menu closed over the question as a cancel", async () => {
  await signInAsTester();
  draw("footer");

  await pick("Sign out");
  await question();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(eventsNamed("session_sign_out_ended")).toEqual([
    { outcome: "cancelled" },
  ]);
});

it("signs out on the confirmation and says how many projects stayed", async () => {
  await signInAsTester();
  explorer.allWorkspaceNames = ["counter", "voting"];
  const signOut = vi
    .spyOn(PgSession, "signOut")
    .mockImplementation(async () => {
      PgSession.reset();
    });
  draw("footer");

  await pick("Sign out");
  await question();
  await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

  expect(
    await screen.findByText(
      "2 projects stayed in this browser because they weren't saved to your account."
    )
  ).toBeTruthy();
  expect(signOut).toHaveBeenCalledOnce();
  expect(eventsNamed("session_sign_out_ended")).toEqual([
    { outcome: "ok", items_kept: 2 },
  ]);
});

it("counts what is left after the sign-out released the account's projects", async () => {
  await signInAsTester();
  explorer.allWorkspaceNames = ["counter", "voting", "local"];
  vi.spyOn(PgSession, "signOut").mockImplementation(async () => {
    // The release runs inside the sign-out, before it settles
    explorer.allWorkspaceNames = ["local"];
    PgSession.reset();
  });
  draw("footer");

  await pick("Sign out");
  await question();
  await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

  expect(
    await screen.findByText(
      "1 project stayed in this browser because it wasn't saved to your account."
    )
  ).toBeTruthy();
  expect(eventsNamed("session_sign_out_ended")).toEqual([
    { outcome: "ok", items_kept: 1 },
  ]);
});

it("says nothing more after a sign-out that left nothing, and counts zero", async () => {
  await signInAsTester();
  explorer.allWorkspaceNames = [];
  vi.spyOn(PgSession, "signOut").mockImplementation(async () => {
    PgSession.reset();
  });
  draw("footer");

  await pick("Sign out");
  await question();
  await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

  await waitFor(() =>
    expect(eventsNamed("session_sign_out_ended")).toEqual([
      { outcome: "ok", items_kept: 0 },
    ])
  );
  expect(screen.queryByText(/stayed in this browser/)).toBeNull();
});

it("says the leftovers once: the next opening of the menu has no note", async () => {
  await signInAsTester();
  explorer.allWorkspaceNames = ["local"];
  vi.spyOn(PgSession, "signOut").mockImplementation(async () => {
    PgSession.reset();
  });
  draw("footer");

  await pick("Sign out");
  await question();
  await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
  await screen.findByText(/stayed in this browser/);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

  await openMenu();
  await screen.findByRole("menu");
  expect(screen.queryByText(/stayed in this browser/)).toBeNull();
});

it("counts a sign-out closed over while it runs once, as ok, not as a cancel", async () => {
  await signInAsTester();
  let finish = () => {};
  vi.spyOn(PgSession, "signOut").mockReturnValue(
    new Promise<void>((resolve) => (finish = resolve))
  );
  draw("footer");

  await pick("Sign out");
  await question();
  await userEvent.click(screen.getByRole("menuitem", { name: /^Sign out/ }));
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  finish();

  await waitFor(() =>
    expect(eventsNamed("session_sign_out_ended")).toEqual([
      { outcome: "ok", items_kept: 0 },
    ])
  );
  // Settled into a closed menu: the next one opens on its items
  await openMenu();
  expect(
    await screen.findByRole("menuitem", { name: /^Settings/ })
  ).toBeTruthy();
  expect(screen.queryByText("Sign out of Playground?")).toBeNull();
});

it("opens on the items, not the question, after a sign-out that failed behind a closed menu", async () => {
  await signInAsTester();
  vi.spyOn(PgView, "setToast").mockImplementation(() => {});
  let fail: (e: Error) => void = () => {};
  vi.spyOn(PgSession, "signOut").mockReturnValue(
    new Promise<void>((_, reject) => (fail = reject))
  );
  draw("footer");

  await pick("Sign out");
  await question();
  await userEvent.click(screen.getByRole("menuitem", { name: /^Sign out/ }));
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  fail(new Error("offline"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  await openMenu();
  expect(
    await screen.findByRole("menuitem", { name: "Sign out" })
  ).toBeTruthy();
  expect(screen.queryByText("Sign out of Playground?")).toBeNull();
});

it("drops a question whose session another tab ended", async () => {
  await signInAsTester();
  draw("footer");

  await pick("Sign out");
  await question();
  // Another tab signed out; this one hears it and re-renders
  PgSession.reset();
  await userEvent.keyboard("{Escape}");
  await openMenu();
  expect(
    await screen.findByRole("menuitem", { name: "Sign in with GitHub" })
  ).toBeTruthy();
  expect(screen.queryByText("Sign out of Playground?")).toBeNull();
});

it("counts nothing when a menu with no question closes", async () => {
  draw("footer");
  await openMenu();
  await screen.findByRole("menu");
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(eventsNamed("session_sign_out_ended")).toEqual([]);
});

it("keeps the question busy while signing out, so it cannot run twice", async () => {
  await signInAsTester();
  let finish = () => {};
  const signOut = vi
    .spyOn(PgSession, "signOut")
    .mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
  draw("footer");

  await pick("Sign out");
  await question();
  const confirm = screen.getByRole("menuitem", { name: /^Sign out/ });
  await userEvent.click(confirm);
  expect(confirm.getAttribute("aria-busy")).toBe("true");
  await userEvent.click(confirm);
  expect(signOut).toHaveBeenCalledOnce();

  finish();
  await waitFor(() =>
    expect(eventsNamed("session_sign_out_ended")).toHaveLength(1)
  );
});

it("logs, reports and tells a sign-out that fails, and keeps the question", async () => {
  await signInAsTester();
  const logged = logMemory();
  initLogger({ providers: [logged] });
  const toast = vi.spyOn(PgView, "setToast").mockImplementation(() => {});
  const failure = new Error("flush threw");
  vi.spyOn(PgSession, "signOut").mockRejectedValue(failure);
  draw("footer");

  await pick("Sign out");
  await question();
  await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  expect(logged.entries).toEqual([
    expect.objectContaining({
      ns: "session-footer:account",
      level: "error",
      error: failure,
      report: true,
    }),
    expect.objectContaining({ ns: "ui:button", error: failure }),
  ]);
  // Still signed in and still asked: the user can try again
  expect(screen.getByText("Sign out of Playground?")).toBeTruthy();
  expect(eventsNamed("session_sign_out_ended")).toEqual([]);
});

it("shows a signed-in user, not a sign-in that failed before the session arrived", async () => {
  vi.spyOn(PgSession, "signInState").mockReturnValue({
    status: "failed",
    reason: "popup-blocked",
    message: "Allow popups for this site to sign in.",
  });
  await signInAsTester();
  draw("footer");

  expect(screen.getByRole("button", { name: "Account: t" })).toBeTruthy();
  expect(screen.queryByText("Couldn't sign in")).toBeNull();
});

it("reports a sign-in that failed for no known reason", async () => {
  const logged = logMemory();
  initLogger({ providers: [logged] });
  const failure = new TypeError("fetch failed");
  vi.spyOn(PgSession, "signIn").mockRejectedValue(failure);
  draw("footer");

  await pick("Sign in with GitHub");

  await waitFor(() =>
    expect(logged.entries).toEqual([
      expect.objectContaining({
        ns: "session-footer:account",
        level: "error",
        error: failure,
        report: true,
      }),
    ])
  );
});

it("cancels a waiting sign-in from the row's Cancel", async () => {
  vi.spyOn(PgSession, "signInState").mockReturnValue({ status: "pending" });
  const cancel = vi
    .spyOn(PgSession, "cancelSignIn")
    .mockImplementation(() => {});
  draw("footer");

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(cancel).toHaveBeenCalledOnce();
  expect(eventsNamed("session_account_item_picked")).toEqual([
    { item: "cancel-sign-in" },
  ]);
});

it("opens the settings from the menu's Settings, showing ⌘, on a Mac", async () => {
  const onToggleSettings = draw("footer");
  await openMenu();
  const settings = await screen.findByRole("menuitem", { name: /^Settings/ });
  expect(settings.textContent).toContain("⌘,");
  await userEvent.click(settings);
  // The item unmounts with its menu: focus is to come back to the trigger
  expect(onToggleSettings).toHaveBeenCalledExactlyOnceWith({
    from: "menu",
    focus: "page",
    returnTo: screen.getByRole("button", { name: /^Account/ }),
  });
});

it("connects a wallet through the connect command", async () => {
  draw("footer");
  await pick("Connect wallet");
  expect(connect.execute).toHaveBeenCalledOnce();
});

it("logs, reports and tells the user of a wallet connect that fails, and the menu still opens", async () => {
  const logged = logMemory();
  initLogger({ providers: [logged] });
  const failure = new Error("Failed to confirm wallet connection state");
  connect.execute.mockRejectedValueOnce(failure);
  draw("footer");

  await pick("Connect wallet");

  await waitFor(() =>
    expect(logged.entries).toEqual([
      expect.objectContaining({
        ns: "session-footer:account",
        level: "error",
        error: failure,
        report: true,
      }),
    ])
  );
  expect(setToast).toHaveBeenCalledOnce();
  await openMenu();
  expect(
    await screen.findByRole("menuitem", { name: "Connect wallet" })
  ).toBeTruthy();
});

it("neither reports nor warns of a wallet setup the user dismissed", async () => {
  const logged = logMemory();
  initLogger({ providers: [logged] });
  connect.execute.mockRejectedValueOnce(new Error(SETUP_REJECTED));
  draw("footer");

  await pick("Connect wallet");

  await waitFor(() => expect(logged.entries).toHaveLength(1));
  expect(logged.entries[0]).toEqual(
    expect.objectContaining({ level: "info", report: false })
  );
  expect(setToast).not.toHaveBeenCalled();
});

it("waits for a balance that has not loaded rather than showing zero", async () => {
  wallet.current = { publicKey: { toBase58: () => ADDRESS }, isPg: true };
  balance.current = undefined;
  draw("footer");
  await openMenu();
  expect(
    (await screen.findByRole("menuitem", { name: /7Hq5…Xk2P/ })).textContent
  ).toContain("… SOL");
});

it("keeps a connected wallet off the row and opens its window from the menu", async () => {
  wallet.current = { publicKey: { toBase58: () => ADDRESS }, isPg: true };
  draw("footer");
  expect(screen.getByRole("button", { name: /^Account/ }).textContent).toBe(
    "Sign inSaved in this browser"
  );
  await pick(/7Hq5…Xk2P/);
  expect(walletWindow.show).toBe(true);
});

it("says signed-in work saves here while the browser is offline", async () => {
  await signInAsTester();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  draw("footer");
  expect(
    screen.getByRole("button", { name: "Account: t" }).textContent
  ).toContain("Offline · saving here");
});

it("names an extension wallet in the menu, not a Playground one", async () => {
  wallet.current = {
    publicKey: { toBase58: () => ADDRESS },
    isPg: false,
    name: "Phantom",
  };
  draw("footer");
  await openMenu();
  expect(
    await screen.findByRole("menuitem", { name: "Disconnect Phantom" })
  ).toBeTruthy();
});

it("disconnects a wallet through the same command", async () => {
  wallet.current = { publicKey: { toBase58: () => ADDRESS }, isPg: true };
  draw("footer");
  await pick("Disconnect wallet");
  expect(connect.execute).toHaveBeenCalledOnce();
});
