// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, and it mocks modules, so it stays out of the modules
// (AGENTS.md)
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const getTerminal = vi.hoisted(() => vi.fn());
const connectTo = vi.hoisted(() => vi.fn());

vi.mock("../../utils", async () => {
  const { isTerminalUnmounted } = await import("../../utils/terminal/terminal");
  return {
    PgCommand: { connect: { execute } },
    PgTerminal: { get: getTerminal },
    isTerminalUnmounted,
  };
});
vi.mock("./connect", () => ({ connectTo }));

import { PgTerminal } from "../../utils/terminal/terminal";
import { connectWallet, toggleWallet } from "./connect-wallet";

/** What asking for the terminal really fails with while none is mounted */
const unmounted = () => PgTerminal.get().catch((error: unknown) => error);

beforeEach(() => {
  execute.mockReset().mockResolvedValue(undefined);
  getTerminal.mockReset().mockResolvedValue({});
  connectTo.mockReset().mockResolvedValue(undefined);
});

describe("commands/connect/connect-wallet", () => {
  it("runs `connect` in the terminal while one is mounted", async () => {
    await connectWallet();

    expect(execute).toHaveBeenCalledExactlyOnceWith();
    expect(connectTo).not.toHaveBeenCalled();
  });

  it("passes a standard wallet's name to the command", async () => {
    await toggleWallet("phantom");

    expect(execute).toHaveBeenCalledExactlyOnceWith("phantom");
  });

  it("runs `connect` without a terminal while none is mounted, as under Home", async () => {
    getTerminal.mockRejectedValue(await unmounted());

    await toggleWallet("phantom");

    expect(connectTo).toHaveBeenCalledExactlyOnceWith("phantom");
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes the failure on, such as the user closing the setup", async () => {
    const rejected = new Error("Setup rejected.");
    getTerminal.mockRejectedValue(await unmounted());
    connectTo.mockRejectedValue(rejected);

    await expect(connectWallet()).rejects.toBe(rejected);
  });

  // `connectTo` toggles, so a second run would undo the first
  it("does not run `connect` twice when the command fails", async () => {
    execute.mockRejectedValue(await unmounted());

    await expect(connectWallet()).rejects.toSatisfy(Boolean);
    expect(connectTo).not.toHaveBeenCalled();
  });
});
