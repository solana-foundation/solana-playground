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

import { SETUP_REJECTED } from "@/commands/connect/setup-rejected";
import { PgSession } from "@/features/auth";
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
import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { PgView } from "@/utils/view";

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
const connectWallet = vi.hoisted(() => vi.fn());
const walletWindow = vi.hoisted(() => ({
  show: false,
  accounts: [] as unknown[],
}));
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
vi.mock("@/commands/connect/connect-wallet", () => ({ connectWallet }));
vi.mock("@/utils", () => ({
  PgCommon: { getOS: () => "MacOS" },
  PgExplorer: explorer,
  PgWallet: walletWindow,
  PgView: { setToast },
}));
// The Fund dialog has its own tests; here only the menu item that opens it counts
const openFundDialog = vi.hoisted(() => vi.fn());
vi.mock("@/features/fund-wallet", () => ({ openFundDialog }));
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
  connectWallet.mockResolvedValue(undefined);
});
afterEach(() => {
  resetTelemetry();
  resetLogger();
  vi.restoreAllMocks();
  connectWallet.mockReset();
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
        <Footer status={null} onToggleSettings={onToggleSettings} />
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

it("opens the one Fund dialog from the menu's Fund from a wallet", async () => {
  walletWindow.accounts = [{}];
  draw("footer");

  await pick("Fund from a wallet…");

  expect(openFundDialog).toHaveBeenCalledWith("account-menu");
  walletWindow.accounts = [];
});

it.each(["footer", "rail"] as const)(
  "reports that the %s opened the menu",
  async (which) => {
    draw(which);
    await openMenu();
    expect(eventsNamed("session_account_menu_opened")).toEqual([
      { via: which },
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
  PgSession.refreshWith({
    id: "u1",
    name: "Tester",
    image: undefined,
    login: "t",
  });

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
    message: "Allow pop-ups for this site to sign in with GitHub.",
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
  expect(connectWallet).toHaveBeenCalledOnce();
});

it("logs, reports and tells the user of a wallet connect that fails, and the menu still opens", async () => {
  const logged = logMemory();
  initLogger({ providers: [logged] });
  const failure = new Error("Failed to confirm wallet connection state");
  connectWallet.mockRejectedValueOnce(failure);
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
  connectWallet.mockRejectedValueOnce(new Error(SETUP_REJECTED));
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
  expect(connectWallet).toHaveBeenCalledOnce();
});

it("counts a pick of the privacy policy, signed out", async () => {
  draw("footer");
  await pick("Privacy policy");
  expect(eventsNamed("session_account_item_picked")).toEqual([
    { item: "privacy-policy" },
  ]);
});

const deleteQuestion = () =>
  screen.findByText("Delete your Playground account?");

/** The question's destructive item, its spinner's label aside */
const confirmDelete = () =>
  userEvent.click(screen.getByRole("menuitem", { name: /^Delete account/ }));

it("asks before deleting the account, and counts the pick and a cancel", async () => {
  await signInAsTester();
  const deleteAccount = vi.spyOn(PgSession, "deleteAccount");
  draw("footer");

  await pick("Delete account");
  await deleteQuestion();
  await userEvent.click(screen.getByRole("menuitem", { name: "Cancel" }));

  expect(
    await screen.findByRole("menuitem", { name: "Delete account" })
  ).toBeTruthy();
  expect(screen.queryByText("Delete your Playground account?")).toBeNull();
  expect(deleteAccount).not.toHaveBeenCalled();
  expect(eventsNamed("session_account_item_picked")).toEqual([
    { item: "delete-account" },
  ]);
  expect(eventsNamed("session_delete_account_ended")).toEqual([
    { outcome: "cancelled" },
  ]);
});

it("counts a menu closed over the deletion question as a cancel", async () => {
  await signInAsTester();
  draw("footer");

  await pick("Delete account");
  await deleteQuestion();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

  expect(eventsNamed("session_delete_account_ended")).toEqual([
    { outcome: "cancelled" },
  ]);
  // The next opening is on the items
  await openMenu();
  expect(
    await screen.findByRole("menuitem", { name: "Delete account" })
  ).toBeTruthy();
});

it("deletes on the confirmation, says so with the GitHub line, and counts ok once", async () => {
  await signInAsTester();
  const deleteAccount = vi
    .spyOn(PgSession, "deleteAccount")
    .mockImplementation(async () => {
      PgSession.reset();
      return { githubRevoked: false };
    });
  draw("footer");

  await pick("Delete account");
  await deleteQuestion();
  await confirmDelete();

  expect(await screen.findByText("Your account was deleted.")).toBeTruthy();
  expect(
    screen
      .getByRole("link", {
        name: "Remove Playground from your GitHub settings too.",
      })
      .getAttribute("href")
  ).toBe("https://github.com/settings/applications");
  expect(
    screen.getByRole("menuitem", { name: "Sign in with GitHub" })
  ).toBeTruthy();
  expect(deleteAccount).toHaveBeenCalledOnce();
  expect(eventsNamed("session_delete_account_ended")).toEqual([
    { outcome: "ok" },
  ]);

  // Said once: closing the menu that deleted counts nothing more
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await openMenu();
  await screen.findByRole("menu");
  expect(screen.queryByText("Your account was deleted.")).toBeNull();
  expect(eventsNamed("session_delete_account_ended")).toHaveLength(1);
});

it("leaves the GitHub line out when GitHub revoked the grant", async () => {
  await signInAsTester();
  vi.spyOn(PgSession, "deleteAccount").mockImplementation(async () => {
    PgSession.reset();
    return { githubRevoked: true };
  });
  draw("footer");

  await pick("Delete account");
  await deleteQuestion();
  await confirmDelete();

  expect(await screen.findByText("Your account was deleted.")).toBeTruthy();
  expect(screen.queryByText(/GitHub settings/)).toBeNull();
});

it("keeps the question after a refused deletion, with the reason, and counts nothing", async () => {
  await signInAsTester();
  const deleteAccount = vi
    .spyOn(PgSession, "deleteAccount")
    .mockRejectedValue(new Error("Try again."));
  draw("footer");

  await pick("Delete account");
  await deleteQuestion();
  await confirmDelete();

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Couldn't delete your account. Try again."
  );
  expect(screen.getByText("Delete your Playground account?")).toBeTruthy();
  expect(eventsNamed("session_delete_account_ended")).toEqual([]);
  expect(PgSession.get()?.id).toBe("u1");

  // A retry the server accepts
  deleteAccount.mockImplementation(async () => {
    PgSession.reset();
    return { githubRevoked: true };
  });
  await confirmDelete();
  expect(await screen.findByText("Your account was deleted.")).toBeTruthy();
  expect(eventsNamed("session_delete_account_ended")).toEqual([
    { outcome: "ok" },
  ]);
});

it("keeps the deletion busy so it cannot run twice, and counts a close while it runs as ok", async () => {
  await signInAsTester();
  let finish: () => void = () => {};
  const deleteAccount = vi.spyOn(PgSession, "deleteAccount").mockReturnValue(
    new Promise((resolve) => {
      finish = () => {
        PgSession.reset();
        resolve({ githubRevoked: true });
      };
    })
  );
  draw("footer");

  await pick("Delete account");
  await deleteQuestion();
  await confirmDelete();
  const confirm = screen.getByRole("menuitem", { name: /^Delete account/ });
  await waitFor(() => expect(confirm.getAttribute("aria-busy")).toBe("true"));
  await userEvent.click(confirm);
  expect(deleteAccount).toHaveBeenCalledOnce();

  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(eventsNamed("session_delete_account_ended")).toEqual([]);
  finish();

  await waitFor(() =>
    expect(eventsNamed("session_delete_account_ended")).toEqual([
      { outcome: "ok" },
    ])
  );
  // Settled into a closed menu: the next one opens on its items
  await openMenu();
  expect(
    await screen.findByRole("menuitem", { name: "Sign in with GitHub" })
  ).toBeTruthy();
  expect(screen.queryByText("Your account was deleted.")).toBeNull();
});

describe("a deletion that settles after the menu closed", () => {
  /**
   * Starts a deletion that waits, closes the menu over it, and returns how to
   * settle it
   */
  const deleteThenClose = async () => {
    let settle: (
      outcome: () => Promise<{ githubRevoked: boolean }>
    ) => void = () => {};
    vi.spyOn(PgSession, "deleteAccount").mockReturnValue(
      new Promise((resolve, reject) => {
        settle = (outcome) => {
          outcome().then(resolve, reject);
        };
      })
    );
    draw("footer");
    await pick("Delete account");
    await deleteQuestion();
    await confirmDelete();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    return settle;
  };

  /** The one toast's body, drawn */
  const drawnToast = (toast: typeof setToast) => {
    const [Body] = toast.mock.calls[0] as [() => React.JSX.Element];
    render(<Body />);
  };

  it("toasts the GitHub line with its link when GitHub kept the grant", async () => {
    await signInAsTester();
    const settle = await deleteThenClose();

    settle(async () => {
      PgSession.reset();
      return { githubRevoked: false };
    });

    await waitFor(() => expect(setToast).toHaveBeenCalledTimes(1));
    drawnToast(setToast);
    expect(screen.getByText("Your account was deleted.")).toBeTruthy();
    expect(
      screen
        .getByRole("link", {
          name: "Remove Playground from your GitHub settings too.",
        })
        .getAttribute("href")
    ).toBe("https://github.com/settings/applications");
  });

  it("toasts nothing when GitHub revoked the grant", async () => {
    await signInAsTester();
    const settle = await deleteThenClose();

    settle(async () => {
      PgSession.reset();
      return { githubRevoked: true };
    });

    await waitFor(() =>
      expect(eventsNamed("session_delete_account_ended")).toEqual([
        { outcome: "ok" },
      ])
    );
    expect(setToast).not.toHaveBeenCalled();
  });

  it("toasts the failure with its reason", async () => {
    await signInAsTester();
    const settle = await deleteThenClose();

    settle(async () => {
      throw new Error("The server did not answer.");
    });

    await waitFor(() => expect(setToast).toHaveBeenCalledTimes(1));
    drawnToast(setToast);
    expect(
      screen.getByText("Couldn't delete your account.").parentElement
        ?.textContent
    ).toBe("Couldn't delete your account. The server did not answer.");
    expect(PgSession.get()?.id).toBe("u1");
  });
});
