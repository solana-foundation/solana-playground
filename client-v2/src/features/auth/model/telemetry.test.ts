// `@types/mocha` also declares a global `it`, without `each`
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import type { PopupReceipt } from "../lib/popup-channel";
import { PgSession } from "./session";

/** Sign-in starts (or is refused); the session read afterwards finds `user` */
const startsSignIn = (ok = true, user: { id: string } | null = { id: "u1" }) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input) =>
      ({
        ok,
        json: async () =>
          input === "/api/auth/get-session"
            ? { user }
            : { url: "https://github.com/login/oauth/x" },
      } as Response)
  );

const popupAnswers = (receipt: PopupReceipt | undefined) =>
  PgSession.setOpenChannel(
    () => receipt && { receive: async () => receipt, cancel: () => {} }
  );

let sent: ReturnType<typeof memoryProvider>;

beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});

afterEach(() => {
  PgSession.reset();
  resetTelemetry();
  resetLogger();
});

const names = () => sent.events.map((event) => event.name);

describe("auth telemetry", () => {
  it("should track a start and a success for a completed sign-in", async () => {
    startsSignIn();
    popupAnswers({ delivered: true, data: {} });

    await PgSession.signIn();

    expect(names()).toEqual(["auth_sign_in_started", "auth_signed_in"]);
  });

  it.each([
    [
      "request-failed",
      "the server refuses to start",
      () => startsSignIn(false),
    ],
    [
      "request-failed",
      "the request does not reach the server",
      () =>
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline")),
    ],
    [
      "request-failed",
      "the answer is not JSON",
      () =>
        vi.spyOn(globalThis, "fetch").mockResolvedValue({
          ok: true,
          json: async () => {
            throw new SyntaxError("Unexpected token <");
          },
        } as unknown as Response),
    ],
    [
      "request-failed",
      "the session cannot be read after the popup",
      () => {
        startsSignIn(true, null);
        popupAnswers({ delivered: true, data: {} });
      },
    ],
    [
      "popup-blocked",
      "the popup is blocked",
      () => {
        startsSignIn();
        popupAnswers(undefined);
      },
    ],
    [
      "cancelled",
      "the user closes the popup",
      () => {
        startsSignIn();
        popupAnswers({ delivered: false, reason: "cancelled" });
      },
    ],
    [
      "expired",
      "the popup never answers",
      () => {
        startsSignIn();
        popupAnswers({ delivered: false, reason: "expired" });
      },
    ],
  ])("should track failure reason %s when %s", async (reason, _, arrange) => {
    arrange();

    await expect(PgSession.signIn()).rejects.toThrow();

    expect(sent.events).toEqual([
      { name: "auth_sign_in_started", params: {} },
      { name: "auth_sign_in_failed", params: { reason } },
    ]);
  });

  it("should track a sign-out the server accepted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);

    await PgSession.signOut();

    expect(names()).toEqual(["auth_signed_out"]);
  });

  it.each([
    [
      "is refused",
      () =>
        vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue({ ok: false, status: 500 } as Response),
    ],
    [
      "fails on the network",
      () =>
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline")),
    ],
  ])("should not track a sign-out when the request %s", async (_, arrange) => {
    arrange();

    await expect(PgSession.signOut()).rejects.toThrow();

    expect(names()).toEqual([]);
  });

  it("should report a failed flush before sign-out", async () => {
    const logged = logMemory();
    initLogger({ providers: [logged] });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    const failure = new Error("push rejected");
    PgSession.setOnSignOut(async () => {
      throw failure;
    });

    await PgSession.signOut();

    expect(logged.entries).toEqual([
      expect.objectContaining({
        ns: "auth:session",
        level: "error",
        error: failure,
        report: true,
      }),
    ]);
    expect(names()).toEqual(["auth_signed_out"]);
  });
});
