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

vi.mock("../../../features/auth", () => ({
  PgSession: { signIn: vi.fn() },
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

  it("runs the same connect the header chip runs", () => {
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

  it("says so in the terminal when sign-in fails", async () => {
    // A blocked popup rejects; without this the click would do nothing
    // visible at all, which is the unlabelled click one level down
    signIn.mockRejectedValue(new Error("Allow popups for this site"));
    remedy({ kind: "needs-sol", signedIn: false })();
    await flush();

    expect(println).toHaveBeenCalledTimes(1);
    expect(println.mock.calls[0][0]).toContain("Allow popups for this site");
    expect(println.mock.calls[0][0]).toContain("Sign-in failed");
  });

  it("survives a rejection that is not an Error", async () => {
    signIn.mockRejectedValue("nope");
    remedy({ kind: "needs-sol", signedIn: false })();
    await flush();

    expect(println.mock.calls[0][0]).toContain("nope");
  });
});
