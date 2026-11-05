import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/features/auth";
import { PgSession } from "@/features/auth";
import {
  initLogger,
  memoryProvider as memoryLog,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { PgView } from "@/utils/view";
import { ModalHost } from "@/widgets/overlays";

import { openShareGistDialogFor } from "./ShareGistDialog";

// The barrels reach the build's generated globals; the dialog needs one hook
// from them, and the gist feature's import side (`PgExplorer`) is not run here
vi.mock("@/hooks", async () => ({
  useRenderOnChange: (await import("@/hooks/useRenderOnChange"))
    .useRenderOnChange,
}));
vi.mock("@/utils", () => ({}));

/** A cancel the user made is a quiet line, never an error callout */
const expectQuietCancel = () => {
  const line = screen.getByText("Sign-in cancelled.");
  expect(line.closest('[data-slot="callout"]')).toBeNull();
};

const USER: SessionUser = {
  id: "u1",
  name: "Ada",
  image: undefined,
  login: "ada",
};

const PROMPT_LINE = "Your project goes to a gist on your GitHub account.";

let logs: ReturnType<typeof memoryLog>;
let fetchSpy: ReturnType<typeof vi.spyOn>;
const readFiles = vi.fn(async () => ({ "src/lib.rs": "x" }));

/** jsdom has no ResizeObserver, which the visibility radios measure with */
class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoResizeObserver);
  initTelemetry({ providers: [memoryTelemetry()] });
  logs = memoryLog();
  initLogger({ providers: [logs] });
  PgSession.reset();
  readFiles.mockClear();
  // A sign-in the test does not stub must not reach the network
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("unexpected fetch"));
});

afterEach(() => {
  act(() => {
    while (PgView.getOpenModals().length) PgView.closeTopModal();
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  PgSession.reset();
  resetTelemetry();
  resetLogger();
});

/** Opens the share dialog for "counter" over a mounted host */
const open = async () => {
  // The app's root provides the tooltips the visibility help tip needs
  render(
    <TooltipProvider>
      <ModalHost />
    </TooltipProvider>
  );
  await act(async () => {
    void openShareGistDialogFor("project_menu")(readFiles, "counter");
  });
};

const press = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

const gistRequests = () =>
  fetchSpy.mock.calls.filter(([url]: unknown[]) =>
    String(url).includes("/api/gists")
  );

const reported = () => logs.entries.filter((entry) => entry.report);

/** The share dialog's sign-in, `PgSession.signInFor("share")`, runs `run` */
const shareSignIn = (run: () => Promise<void>) => {
  const signIn = vi.fn<(scopes: string[]) => Promise<void>>(run);
  vi.spyOn(PgSession, "signInFor").mockReturnValue(signIn);
  return signIn;
};

describe("app/ShareGistDialog", () => {
  it("gist-sharing: Signed out, the prompt comes first", async () => {
    await open();

    expect(
      screen.getByRole("heading", { name: "Sign in to share" })
    ).toBeTruthy();
    expect(screen.getByText(PROMPT_LINE)).toBeTruthy();
    const signIn = screen.getByRole("button", { name: "Sign in with GitHub" });
    expect(signIn.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(gistRequests()).toEqual([]);
  });

  it("gist-sharing: Signed out, then signed in", async () => {
    const signIn = shareSignIn(() => PgSession.refreshWith(USER));
    await open();

    const cancel = vi.spyOn(PgSession, "cancelSignIn");
    await press("Sign in with GitHub");

    expect(cancel).not.toHaveBeenCalled();
    // From the share origin, so the session effect keeps the open project
    expect(PgSession.signInFor).toHaveBeenCalledWith("share");
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("heading", { name: "Share counter as a gist" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create secret gist" })
    ).toBeTruthy();
    // The share dialog reads the project for its file list, and sends nothing
    expect(gistRequests()).toEqual([]);
  });

  it("gist-sharing: Signed in, no prompt", async () => {
    await PgSession.refreshWith(USER);
    await open();

    expect(
      screen.getByRole("heading", { name: "Share counter as a gist" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Sign in to share" })
    ).toBeNull();
  });

  it("asks for gist access from the share origin", async () => {
    await PgSession.refreshWith(USER);
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ reason: "needs-gist-scope" }),
    } as Response);
    const signIn = shareSignIn(() => Promise.resolve());
    await open();

    await press("Create secret gist");
    await press("Allow gists on GitHub");

    // The body's sign-ins keep the open project as the prompt's does
    expect(PgSession.signInFor).toHaveBeenCalledWith("share");
    expect(signIn).toHaveBeenCalledWith(["gist"]);
  });

  it("reports a grant that fails unexpectedly, beside saying so", async () => {
    await PgSession.refreshWith(USER);
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ reason: "needs-gist-scope" }),
    } as Response);
    shareSignIn(() => Promise.reject(new Error("boom")));
    await open();

    await press("Create secret gist");
    await press("Allow gists on GitHub");

    expect(screen.getByText("boom")).toBeTruthy();
    expect(reported()).toHaveLength(1);
  });

  it("reports nothing for a grant the user cancelled", async () => {
    await PgSession.refreshWith(USER);
    fetchSpy.mockImplementation(async (url: unknown) =>
      String(url).includes("/api/gists")
        ? ({
            ok: false,
            status: 403,
            json: async () => ({ reason: "needs-gist-scope" }),
          } as Response)
        : ({ ok: true, json: async () => ({ url: "https://x/" }) } as Response)
    );
    PgSession.setOpenChannel(() => ({
      receive: async () => ({
        delivered: false as const,
        reason: "cancelled" as const,
      }),
      cancel: () => {},
    }));
    await open();

    await press("Create secret gist");
    await press("Allow gists on GitHub");

    expectQuietCancel();
    expect(reported()).toEqual([]);
  });

  it("reports an unreadable project and says so in a toast", async () => {
    await PgSession.refreshWith(USER);
    const setToast = vi.spyOn(PgView, "setToast").mockImplementation(vi.fn());
    readFiles
      .mockRejectedValueOnce(new Error("store unreadable"))
      .mockRejectedValueOnce(new Error("store unreadable"));
    await open();

    await press("Create secret gist");

    expect(reported()).toHaveLength(1);
    expect(setToast).toHaveBeenCalledTimes(1);
    expect(gistRequests()).toEqual([]);
  });

  it("makes a sign-in already waiting the share's, so it keeps the open project", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://x/" }),
    } as Response);
    PgSession.setOpenChannel(() => ({
      receive: () => new Promise<never>(() => {}),
      cancel: () => {},
    }));
    // The account menu's sign-in, its popup still open
    void PgSession.signIn().catch(() => {});

    await open();

    expect(PgSession.signingInFrom).toBe("share");
    // Still the account menu's to end
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: /Waiting for GitHub/,
      }).disabled
    ).toBe(true);
  });

  it("reports a grant whose sign-in could not start", async () => {
    await PgSession.refreshWith(USER);
    fetchSpy.mockImplementation(async (url: unknown) =>
      String(url).includes("/api/gists")
        ? ({
            ok: false,
            status: 403,
            json: async () => ({ reason: "needs-gist-scope" }),
          } as Response)
        : ({ ok: false, status: 500, json: async () => ({}) } as Response)
    );
    await open();

    await press("Create secret gist");
    await press("Allow gists on GitHub");

    expect(
      screen.getByText(
        "Sign-in isn't available. Your work is saved in this browser."
      )
    ).toBeTruthy();
    expect(reported()).toHaveLength(1);
  });

  it("shows why a sign-in ended, and keeps the prompt", async () => {
    // The authorize URL, then a popup that answers it was cancelled
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://x/" }),
    } as Response);
    PgSession.setOpenChannel(() => ({
      receive: async () => ({
        delivered: false as const,
        reason: "cancelled" as const,
      }),
      cancel: () => {},
    }));
    await open();

    await press("Sign in with GitHub");

    expect(
      screen.getByRole("heading", { name: "Sign in to share" })
    ).toBeTruthy();
    expectQuietCancel();
    expect(reported()).toEqual([]);
    expect(gistRequests()).toEqual([]);
  });

  it("gist-sharing: Sign-in cancelled", async () => {
    // A popup that answers only when the sign-in is cancelled: the channel
    // cannot see a popup the user closed, so Cancel is the way out
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://x/" }),
    } as Response);
    const cancel = vi.fn();
    let answer: (receipt: {
      delivered: false;
      reason: "cancelled";
    }) => void = () => {};
    PgSession.setOpenChannel(() => ({
      receive: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      cancel: () => {
        cancel();
        answer({ delivered: false, reason: "cancelled" });
      },
    }));
    await open();

    await press("Sign in with GitHub");

    // The submit itself is the cancel while the popup waits
    await press("Cancel sign-in");

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("heading", { name: "Sign in to share" })
    ).toBeTruthy();
    expectQuietCancel();
    expect(
      screen.getByRole("button", { name: "Sign in with GitHub" })
    ).toBeTruthy();
    expect(reported()).toEqual([]);
    expect(gistRequests()).toEqual([]);
  });

  it("gist-sharing: Closing the dialog while sign-in waits", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://x/" }),
    } as Response);
    const cancel = vi.fn();
    PgSession.setOpenChannel(() => ({
      receive: () => new Promise(() => {}),
      cancel,
    }));
    await open();
    await press("Sign in with GitHub");

    // One cancel while the popup waits: the head's Close is the way out
    expect(screen.queryByRole("button", { name: /^Cancel$/ })).toBeNull();
    await press(/^Close$/);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(PgView.getOpenModals()).toEqual([]);
    expect(gistRequests()).toEqual([]);
  });

  it("cancels the gist grant and publishes nothing when the dialog closes while it waits", async () => {
    await PgSession.refreshWith(USER);
    fetchSpy.mockImplementation(async (url: unknown) => {
      const path = String(url);
      if (path.includes("/api/gists"))
        return new Response(JSON.stringify({ reason: "needs-gist-scope" }), {
          status: 403,
        });
      if (path.includes("/api/auth/sign-in/social"))
        return { ok: true, json: async () => ({ url: "https://x/" }) };
      return { ok: true, json: async () => ({ user: USER }) };
    });
    let approve = () => {};
    const cancel = vi.fn();
    PgSession.setOpenChannel(() => ({
      receive: () =>
        new Promise((resolve) => {
          approve = () => resolve({ delivered: true as const, data: {} });
        }),
      cancel,
    }));
    await open();
    await press("Create secret gist");
    await press(/Allow gists on GitHub/);

    await press(/^Close$/);
    // The user approves on GitHub anyway, in the popup the dialog left open
    await act(async () => approve());

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(PgView.getOpenModals()).toEqual([]);
    expect(gistRequests()).toHaveLength(1);
  });

  it("leaves alone a sign-in it did not start", async () => {
    // A sign-in from the account menu, still waiting when Share opens
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://x/" }),
    } as Response);
    const cancel = vi.fn();
    PgSession.setOpenChannel(() => ({
      receive: () => new Promise(() => {}),
      cancel,
    }));
    void PgSession.signIn().catch(() => {
      // Never answered: the popup waits for the whole test, and the reset
      // after it drops the flow; nothing here may reject it
    });
    await open();

    await press("Cancel");

    expect(PgView.getOpenModals()).toEqual([]);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("offers no Cancel sign-in for a sign-in it did not start", async () => {
    // A sign-in from the account menu, still waiting when Share opens
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://x/" }),
    } as Response);
    const cancel = vi.fn();
    PgSession.setOpenChannel(() => ({
      receive: () => new Promise(() => {}),
      cancel,
    }));
    void PgSession.signIn().catch(() => {
      // Never answered: the reset after the test drops the flow
    });
    await open();

    const waiting = screen.getByRole("button", { name: "Waiting for GitHub…" });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Cancel sign-in" })).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("gist-sharing: Cancel leaves without signing in", async () => {
    const signIn = vi.spyOn(PgSession, "signInFor");
    await open();

    await press("Cancel");

    expect(PgView.getOpenModals()).toEqual([]);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("shows and reports a sign-in error that is not a known failure", async () => {
    shareSignIn(() => Promise.reject(new Error("boom")));
    await open();

    await press("Sign in with GitHub");

    expect(screen.getByText("boom")).toBeTruthy();
    expect(reported()).toHaveLength(1);
  });

  it("says it could not sign in when the failure carries no words", async () => {
    shareSignIn(() => Promise.reject(new Error("")));
    await open();

    await press("Sign in with GitHub");

    // Spec 08 ACCT-03
    expect(screen.getByText("Could not sign in.")).toBeTruthy();
  });

  it("reports a sign-in that could not start, beside saying so", async () => {
    // The server could not hand out an authorize URL: ours to fix, not the user's
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    await open();

    await press("Sign in with GitHub");

    expect(
      screen.getByText(
        "Sign-in isn't available. Your work is saved in this browser."
      )
    ).toBeTruthy();
    expect(reported()).toHaveLength(1);
  });

  it("clears a failure when the next sign-in succeeds", async () => {
    // First a popup the user closed
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://x/" }),
    } as Response);
    PgSession.setOpenChannel(() => ({
      receive: async () => ({
        delivered: false as const,
        reason: "cancelled" as const,
      }),
      cancel: () => {},
    }));
    await open();
    await press("Sign in with GitHub");
    expectQuietCancel();

    shareSignIn(() => PgSession.refreshWith(USER));
    await press("Sign in with GitHub");

    expect(screen.queryByText("Sign-in cancelled.")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Share counter as a gist" })
    ).toBeTruthy();
  });

  it("keeps the share dialog when the session ends while it is open", async () => {
    await PgSession.refreshWith(USER);
    await open();

    await act(async () => {
      await PgSession.refreshWith(undefined);
    });

    expect(
      screen.getByRole("heading", { name: "Share counter as a gist" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Sign in to share" })
    ).toBeNull();
  });

  it("puts Copy link in the footer once the gist exists, with no Cancel", async () => {
    await PgSession.refreshWith(USER);
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ url: "https://gist.github.com/ada/abc", id: "abc" }),
        { status: 201 }
      )
    );
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.spyOn(PgView, "setToast").mockImplementation(vi.fn());
    await open();

    await press("Create secret gist");

    expect(
      screen.getByRole("heading", { name: "Shared as a secret gist" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await press("Copy link");

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/gist/abc`
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("offers only Close when GitHub refused the gist", async () => {
    await PgSession.refreshWith(USER);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ reason: "rejected" }), { status: 422 })
    );
    await open();

    await press("Create secret gist");

    expect(
      screen.getByText("GitHub refused the gist. Nothing was published.")
    ).toBeTruthy();
    // The footer's, beside the head's own Close
    const close = screen
      .getAllByRole("button", { name: "Close" })
      .find((button) => button.getAttribute("type") === "submit");
    if (!close) throw new Error("no footer Close");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await act(async () => fireEvent.click(close));
    expect(PgView.getOpenModals()).toEqual([]);
  });

  it("moves on to sharing when a sign-in finishes elsewhere", async () => {
    await open();

    await act(async () => {
      await PgSession.refreshWith(USER);
    });

    expect(
      screen.getByRole("heading", { name: "Share counter as a gist" })
    ).toBeTruthy();
  });
});
