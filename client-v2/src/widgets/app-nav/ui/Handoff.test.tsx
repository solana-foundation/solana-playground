import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLogs,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

// A session the test moves by hand: who is signed in, and its listeners
const session = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state: { user: { login: string } | null } = { user: null };
  return {
    get user() {
      return state.user;
    },
    set user(user: { login: string } | null) {
      state.user = user;
    },
    listeners,
    get: vi.fn(() => state.user),
    signIn: vi.fn(() => Promise.resolve()),
    signInState: vi.fn((): { status: string; message?: string } => ({
      status: "idle",
    })),
    onDidChange: vi.fn((cb: () => void) => {
      listeners.add(cb);
      return { dispose: () => listeners.delete(cb) };
    }),
  };
});
const known = vi.hoisted(() => ({ failure: vi.fn(() => false) }));
vi.mock("@/features/auth", () => ({
  PgSession: session,
  isSignInFailure: known.failure,
}));
// The toast needs a booted app; what matters here is that a failure reaches it
const reported = vi.hoisted(() => ({ actions: [] as string[] }));
vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: (action: string) => () => {
    reported.actions.push(action);
  },
}));

import Handoff from "./Handoff";

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
const writeText = vi.fn();
beforeEach(() => {
  session.user = null;
  session.signIn.mockReset().mockResolvedValue(undefined);
  session.signInState.mockReset().mockReturnValue({ status: "idle" });
  known.failure.mockReset().mockReturnValue(false);
  reported.actions.length = 0;
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {
    clipboard: { writeText },
    share: vi.fn(),
    userAgent: "test",
  });
  window.history.replaceState(null, "", "/tutorials/hello-solana");
});
afterEach(() => {
  resetTelemetry();
  resetLogger();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const names = () => sent.events.map((event) => event.name);

const open = () => {
  render(<Handoff />);
  fireEvent.click(screen.getByTestId("handoff-open"));
};

it("gives the app's address and the current path", () => {
  open();
  expect(screen.getByTestId("handoff-link").textContent).toBe(
    `${window.location.origin}/tutorials/hello-solana`
  );
});

it("reads the page's path when the sheet opens, not when it mounted", () => {
  render(<Handoff />);
  window.history.replaceState(null, "", "/tutorials/another");
  fireEvent.click(screen.getByTestId("handoff-open"));
  expect(screen.getByTestId("handoff-link").textContent).toBe(
    `${window.location.origin}/tutorials/another`
  );
});

it("counts an opening signed out", () => {
  open();
  expect(sent.events).toEqual([
    expect.objectContaining({
      name: "nav_handoff_opened",
      params: { signedIn: false },
    }),
  ]);
});

it("counts an opening signed in", () => {
  session.user = { login: "ada" };
  open();
  expect(sent.events).toEqual([
    expect.objectContaining({
      name: "nav_handoff_opened",
      params: { signedIn: true },
    }),
  ]);
});

it("copies the link and counts it", async () => {
  open();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  });
  expect(writeText).toHaveBeenCalledWith(
    `${window.location.origin}/tutorials/hello-solana`
  );
  expect(sent.events.at(-1)).toEqual(
    expect.objectContaining({ name: "nav_handoff_link_copied", params: {} })
  );
});

it("reports a refused copy and counts nothing", async () => {
  writeText.mockRejectedValueOnce(new Error("denied"));
  open();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  });
  expect(reported.actions).toEqual(["copy the link"]);
  expect(names()).not.toContain("nav_handoff_link_copied");
  expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
});

it("reports a copy where the browser has no clipboard", async () => {
  vi.stubGlobal("navigator", { share: vi.fn(), userAgent: "test" });
  open();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  });
  expect(reported.actions).toEqual(["copy the link"]);
  expect(names()).not.toContain("nav_handoff_link_copied");
});

it("counts a share, and a cancelled one is neither counted nor reported", async () => {
  const share = navigator.share as ReturnType<typeof vi.fn>;
  share.mockRejectedValueOnce(new DOMException("closed", "AbortError"));
  open();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
  });
  expect(names()).not.toContain("nav_handoff_link_shared");
  expect(logged.entries).toEqual([]);

  share.mockResolvedValueOnce(undefined);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
  });
  expect(share).toHaveBeenLastCalledWith({
    title: "Continue on a computer",
    url: `${window.location.origin}/tutorials/hello-solana`,
  });
  expect(sent.events.at(-1)).toEqual(
    expect.objectContaining({ name: "nav_handoff_link_shared", params: {} })
  );
});

it("reports a share that failed for another reason, and counts nothing", async () => {
  const share = navigator.share as ReturnType<typeof vi.fn>;
  share.mockRejectedValueOnce(new DOMException("no", "NotAllowedError"));
  open();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
  });
  expect(reported.actions).toEqual(["share the link"]);
  expect(names()).not.toContain("nav_handoff_link_shared");
});

it("draws no Share where the browser has no share sheet", () => {
  vi.stubGlobal("navigator", { clipboard: { writeText }, userAgent: "test" });
  open();
  expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
});

it("shows a known sign-in failure in the sheet, logged but not reported", async () => {
  const failure = new Error("closed");
  session.signIn.mockRejectedValueOnce(failure);
  known.failure.mockReturnValue(true);
  open();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with GitHub" })
    );
  });
  act(() => {
    session.signInState.mockReturnValue({
      status: "failed",
      message: "The sign-in window was closed.",
    });
    session.listeners.forEach((cb) => cb());
  });
  expect(screen.getByRole("alert").textContent).toBe(
    "The sign-in window was closed."
  );
  expect(logged.entries.map((entry) => entry.level)).toEqual(["info"]);
  expect(reported.actions).toEqual([]);
});

it("reports an unknown sign-in failure to the team and the user", async () => {
  session.signIn.mockRejectedValueOnce(new Error("boom"));
  open();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with GitHub" })
    );
  });
  expect(reported.actions).toEqual(["sign in with GitHub"]);
});

it("turns to the signed-in words once the sign-in lands", () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
  expect(session.signIn).toHaveBeenCalledTimes(1);
  act(() => {
    session.user = { login: "ada" };
    session.listeners.forEach((cb) => cb());
  });
  expect(screen.getByText(/@ada/)).toBeTruthy();
});
