import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
// The band's wiring, tested without a rendered tree. Mocked at the
// module boundary the same way the other lesson tests mock `../../../utils`
// -- importing it for real reaches generated globals that only exist
// once the app has booted.
vi.mock("../../../utils", () => ({
  PgCommand: {
    build: { execute: vi.fn() },
    connect: { execute: vi.fn() },
    airdrop: { execute: vi.fn() },
  },
  PgSettings: { connection: { endpoint: "http://localhost:8899" } },
  PgTerminal: {
    println: vi.fn(),
    error: (text: string) => `ERROR: ${text}`,
  },
}));

vi.mock("../../../constants", () => ({
  DEFAULT_ENDPOINT: "https://devnet.example/rpc",
}));

// The outcomes a user chose: a sign-in they cancelled or a popup they
// blocked, and a wallet setup they closed
const { knownSignIn, dismissedSetup } = vi.hoisted(() => ({
  knownSignIn: new Error("popup blocked"),
  dismissedSetup: new Error("setup rejected"),
}));
vi.mock("../../../features/auth", () => ({
  PgSession: { signIn: vi.fn() },
  isSignInFailure: (error: unknown) => error === knownSignIn,
}));
vi.mock("@/commands/connect/setup-rejected", () => ({
  isSetupRejected: (error: unknown) => error === dismissedSetup,
}));

// Each `reportButtonFailure` call: the action that did not happen, the error
// it got, and whether it was marked as already shown (logged, not toasted)
const told = vi.hoisted(
  () => [] as { action: string; error: unknown; shown: boolean }[]
);
const shown = vi.hoisted(() => new Set<unknown>());
vi.mock("@/shared/lib/report-button-failure", () => ({
  markFailureShown: (error: unknown) => shown.add(error),
  reportButtonFailure: (action: string) => (error: unknown) => {
    told.push({ action, error, shown: shown.has(error) });
  },
}));

import { remedy } from "./readiness-remedy";
import { PgSession } from "../../../features/auth";
import { PgCommand, PgSettings, PgTerminal } from "../../../utils";

const signIn = PgSession.signIn as Mock;
const println = PgTerminal.println as Mock;

/** Let the rejection handler attached inside the remedy run */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  told.length = 0;
  for (const command of [
    PgCommand.build,
    PgCommand.connect,
    PgCommand.airdrop,
  ]) {
    (command.execute as Mock).mockResolvedValue(undefined);
  }
  signIn.mockResolvedValue(undefined);
  PgSettings.connection.endpoint = "http://localhost:8899";
});

describe("remedy", () => {
  it("runs the same build the stage button runs", () => {
    remedy({ kind: "needs-build", running: false })();
    expect(PgCommand.build.execute).toHaveBeenCalledTimes(1);
  });

  it("rebuilds through the same command a first build uses", () => {
    remedy({ kind: "needs-rebuild" })();
    expect(PgCommand.build.execute).toHaveBeenCalledTimes(1);
  });

  it("runs the same connect the account menu's Connect wallet runs", () => {
    remedy({ kind: "needs-wallet" })();
    expect(PgCommand.connect.execute).toHaveBeenCalledTimes(1);
  });

  it("switches to the deployment's own devnet, not the public one", () => {
    // A deployment that configures a platform RPC must not have its
    // learners bounced onto the rate-limited public devnet
    remedy({ kind: "needs-cluster", cluster: "localnet" })();
    expect(PgSettings.connection.endpoint).toBe("https://devnet.example/rpc");
  });

  it("airdrops when the learner is already signed in", () => {
    remedy({ kind: "needs-sol", signedIn: true })();
    expect(PgCommand.airdrop.execute).toHaveBeenCalledTimes(1);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("signs in first when the airdrop still needs it", () => {
    remedy({ kind: "needs-sol", signedIn: false })();
    expect(signIn).toHaveBeenCalledTimes(1);
    // One click, one step of the chain: the copy says "sign in, then
    // airdrop", and the airdrop is the learner's next click
    expect(PgCommand.airdrop.execute).not.toHaveBeenCalled();
  });

  // With no terminal mounted a command cannot run at all; the click
  // must say so rather than leave an unhandled rejection
  it.each([
    [{ kind: "needs-build", running: false }, "build", "build"],
    [{ kind: "needs-rebuild" }, "build", "build"],
    [{ kind: "needs-wallet" }, "connect", "connect a wallet"],
    [{ kind: "needs-sol", signedIn: true }, "airdrop", "airdrop"],
  ] as const)(
    "tells the user when %o fails",
    async (blocker, command, action) => {
      const failure = new Error("The terminal is not open.");
      (PgCommand[command].execute as Mock).mockRejectedValue(failure);

      remedy(blocker)();
      await flush();

      expect(told).toEqual([{ action, error: failure, shown: false }]);
    }
  );

  it("tells the user when sign-in fails", async () => {
    // Without this the click would do nothing visible at all, which is the
    // unlabelled click one level down. Not in the terminal: one that is
    // folded or not mounted shows it to nobody
    const failure = new Error("network down");
    signIn.mockRejectedValue(failure);
    remedy({ kind: "needs-sol", signedIn: false })();
    await flush();

    expect(told).toEqual([{ action: "sign in", error: failure, shown: false }]);
    expect(println).not.toHaveBeenCalled();
  });

  // `PgSession.signInState` holds a known failure and the account row shows
  // it: logged as a failed click, never toasted a second time
  it("leaves a cancelled or blocked sign-in to the account row", async () => {
    signIn.mockRejectedValue(knownSignIn);
    remedy({ kind: "needs-sol", signedIn: false })();
    await flush();

    expect(told).toEqual([
      { action: "sign in", error: knownSignIn, shown: true },
    ]);
  });

  it("does not toast a wallet setup the user closed", async () => {
    (PgCommand.connect.execute as Mock).mockRejectedValue(dismissedSetup);
    remedy({ kind: "needs-wallet" })();
    await flush();

    expect(told).toEqual([
      { action: "connect a wallet", error: dismissedSetup, shown: true },
    ]);
  });
});
