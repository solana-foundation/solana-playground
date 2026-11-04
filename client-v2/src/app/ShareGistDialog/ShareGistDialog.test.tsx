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
// The account widget's entry draws the whole footer; the dialog takes its mark
vi.mock("@/widgets/session-footer", async () => ({
  GithubMark: (await import("@/widgets/session-footer/ui/GithubMark")).default,
}));

/** A cancel the user made is a quiet line, never an error callout */
const expectQuietCancel = () => {
  const line = screen.getByText("Sign-in cancelled.");
  expect(line.closest('[data-slot="callout"]')).toBeNull();
};

const USER: SessionUser = {
  id: "u1",
  name: "Ada",
  // eslint-disable-next-line unicorn/no-null -- `SessionUser.image` is `null` for an account without an avatar
  image: null,
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
    const signIn = vi
      .spyOn(PgSession, "signIn")
      .mockImplementation(() => PgSession.refreshWith(USER));
    await open();

    const cancel = vi.spyOn(PgSession, "cancelSignIn");
    await press("Sign in with GitHub");

    expect(cancel).not.toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("heading", { name: "Share to GitHub" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Share to GitHub" })
    ).toBeTruthy();
    expect(readFiles).not.toHaveBeenCalled();
    expect(gistRequests()).toEqual([]);
  });

  it("gist-sharing: Signed in, no prompt", async () => {
    await PgSession.refreshWith(USER);
    await open();

    expect(
      screen.getByRole("heading", { name: "Share to GitHub" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Sign in to share" })
    ).toBeNull();
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

    await press(/^Cancel$/);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(PgView.getOpenModals()).toEqual([]);
    expect(gistRequests()).toEqual([]);
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
    const signIn = vi.spyOn(PgSession, "signIn");
    await open();

    await press("Cancel");

    expect(PgView.getOpenModals()).toEqual([]);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("shows and reports a sign-in error that is not a known failure", async () => {
    vi.spyOn(PgSession, "signIn").mockRejectedValue(new Error("boom"));
    await open();

    await press("Sign in with GitHub");

    expect(screen.getByText("boom")).toBeTruthy();
    expect(reported()).toHaveLength(1);
  });

  it("says it could not sign in when the failure carries no words", async () => {
    vi.spyOn(PgSession, "signIn").mockRejectedValue(new Error(""));
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

    expect(screen.getByText("Could not start sign-in")).toBeTruthy();
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

    vi.spyOn(PgSession, "signIn").mockImplementation(() =>
      PgSession.refreshWith(USER)
    );
    await press("Sign in with GitHub");

    expect(screen.queryByText("Sign-in cancelled.")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Share to GitHub" })
    ).toBeTruthy();
  });

  it("keeps the share dialog when the session ends while it is open", async () => {
    await PgSession.refreshWith(USER);
    await open();

    await act(async () => {
      // eslint-disable-next-line unicorn/no-null -- `refreshWith` takes `null` for "signed out"
      await PgSession.refreshWith(null);
    });

    expect(
      screen.getByRole("heading", { name: "Share to GitHub" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Sign in to share" })
    ).toBeNull();
  });

  it("moves on to sharing when a sign-in finishes elsewhere", async () => {
    await open();

    await act(async () => {
      await PgSession.refreshWith(USER);
    });

    expect(
      screen.getByRole("heading", { name: "Share to GitHub" })
    ).toBeTruthy();
  });
});
