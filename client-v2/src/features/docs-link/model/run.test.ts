// `@types/mocha` also declares a global `it`, without `each`
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocsLink } from "../lib/link";

type Finish = (
  result: { ok: unknown; err?: never } | { err: Error; ok?: never }
) => void;

const utils = vi.hoisted(() => {
  const handlers: {
    start: Array<(input: string | null) => void>;
    finish: Array<Finish>;
    switchWorkspace: Array<() => void>;
  } = { start: [], finish: [], switchWorkspace: [] };
  const address = { toBase58: () => "Wa11et" };
  return {
    handlers,
    lamports: 0,
    balanceError: undefined as Error | undefined,
    /** Runs while the balance read is in flight, before it answers */
    duringBalance: undefined as (() => void) | undefined,
    PgCommand: {
      run: {
        onDidStart: (cb: (input: string | null) => void) => {
          handlers.start.push(cb);
          return { dispose: () => {} };
        },
        onDidFinish: (cb: Finish) => {
          handlers.finish.push(cb);
          return { dispose: () => {} };
        },
        execute: vi.fn(async () => undefined),
      },
      connect: { execute: vi.fn(async () => undefined) },
    },
    PgWallet: {
      state: "pg" as string,
      current: { publicKey: address, isPg: true } as unknown,
    },
    PgExplorer: {
      onDidSwitchWorkspace: (cb: () => void) => {
        handlers.switchWorkspace.push(cb);
        return { dispose: () => {} };
      },
    },
  };
});

// Runs `connect` with or without a terminal; its own tests cover which
vi.mock("@/commands/connect/connect-wallet", () => ({
  connectWallet: () => utils.PgCommand.connect.execute(),
}));
vi.mock("@/utils", () => ({
  PgCommand: utils.PgCommand,
  PgWallet: utils.PgWallet,
  PgExplorer: utils.PgExplorer,
  PgConnection: {
    current: {
      getBalance: async () => {
        utils.duringBalance?.();
        if (utils.balanceError) throw utils.balanceError;
        return utils.lamports;
      },
    },
  },
  PgWeb3: { lamportsToSol: (lamports: number) => lamports / 1e9 },
}));

const QUICKSTART: DocsLink = {
  name: "quickstart.ts",
  code: "console.log(1)",
  title: "Quickstart",
  from: "https://solana.com/docs/quickstart",
  sol: 0.02,
};

let sent: { events: Array<{ name: string; params: object }> };
let resetTelemetry = () => {};

/**
 * A fresh store and link, as on a page load. Telemetry is loaded after the
 * reset too, so the store and the test share one collector.
 */
const load = async () => {
  vi.resetModules();
  utils.handlers.start.length = 0;
  utils.handlers.finish.length = 0;
  utils.handlers.switchWorkspace.length = 0;
  const telemetry = await import("@/shared/lib/telemetry");
  const provider = telemetry.memoryProvider();
  telemetry.initTelemetry({ providers: [provider] });
  sent = provider;
  resetTelemetry = telemetry.resetTelemetry;
  const { PgClientRun } = await import("./run");
  const { PgDocsLink } = await import("./opened");
  const states: string[] = [];
  PgClientRun.onDidChange((state) => states.push(state.kind));
  return { PgClientRun, PgDocsLink, states };
};

const startRun = () => utils.handlers.start.forEach((cb) => cb("run"));
const finishRun = (result: Parameters<Finish>[0]) =>
  utils.handlers.finish.forEach((cb) => cb(result));
const switchWorkspace = () =>
  utils.handlers.switchWorkspace.forEach((cb) => cb());

beforeEach(() => {
  utils.lamports = 0;
  utils.balanceError = undefined;
  utils.duringBalance = undefined;
  utils.PgWallet.state = "pg";
  utils.PgCommand.run.execute.mockClear();
  utils.PgCommand.connect.execute.mockClear();
});

afterEach(() => {
  resetTelemetry();
  vi.useRealTimers();
});

describe("PgClientRun", () => {
  it("reads a run that ends well as done, with its time", async () => {
    vi.useFakeTimers();
    const { PgClientRun, states } = await load();
    startRun();
    vi.advanceTimersByTime(12_400);
    finishRun({ ok: { ok: true } });

    expect(PgClientRun.state).toEqual({ kind: "done", ms: 12_400 });
    expect(states).toEqual(["idle", "running", "done"]);
  });

  it("sends no docs link event for a run no docs link opened", async () => {
    const { states } = await load();
    startRun();
    finishRun({ err: new Error("boom") });

    expect(states).toEqual(["idle", "running", "failed"]);
    expect(
      sent.events.filter((event) => event.name.startsWith("docs_link_"))
    ).toEqual([]);
  });

  it("measures a run in the project a docs link opened", async () => {
    vi.useFakeTimers();
    const { PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    startRun();
    vi.advanceTimersByTime(12_400);
    finishRun({ ok: { ok: true } });

    expect(sent.events).toEqual([
      expect.objectContaining({
        name: "docs_link_run_started",
        params: { via: "link" },
      }),
      expect.objectContaining({
        name: "docs_link_run_finished",
        params: { via: "link", outcome: "done", seconds: 12 },
      }),
    ]);
  });

  it("reads a script's uncaught error as failed", async () => {
    const { PgClientRun } = await load();
    startRun();
    finishRun({ ok: { ok: false, error: "fetch failed" } });

    expect(PgClientRun.state).toEqual({
      kind: "failed",
      message: "fetch failed",
    });
  });

  it("reads an import Playground lacks as a missing package", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    startRun();
    finishRun({
      err: new Error("Package `@solana-program/memo` is not available."),
    });

    expect(PgClientRun.state).toEqual({
      kind: "missing-package",
      pkg: "@solana-program/memo",
    });
    expect(sent.events.at(-1)?.params).toMatchObject({
      outcome: "missing-package",
    });
  });

  it("reads a missing package the script reported as a missing package", async () => {
    const { PgClientRun } = await load();
    startRun();
    finishRun({
      ok: {
        ok: false,
        error: "Package `@solana-program/memo` is not available.",
      },
    });

    expect(PgClientRun.state).toEqual({
      kind: "missing-package",
      pkg: "@solana-program/memo",
    });
  });

  it("shows no run for `run --help`, which never finishes", async () => {
    const { PgClientRun } = await load();
    utils.handlers.start.forEach((cb) => cb("run --help"));
    expect(PgClientRun.state.kind).toBe("idle");
    await PgClientRun.start();
    expect(utils.PgCommand.run.execute).toHaveBeenCalledTimes(1);
  });

  it("shows a run whose -h comes after a path, which runs", async () => {
    const { PgClientRun } = await load();
    utils.handlers.start.forEach((cb) => cb("run a.ts -h"));
    expect(PgClientRun.state.kind).toBe("running");
  });

  it("shows a run typed in the terminal", async () => {
    const { PgClientRun } = await load();
    startRun();
    expect(PgClientRun.state.kind).toBe("running");
  });

  it("asks for SOL before running a link that needs it", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);

    await PgClientRun.start();

    expect(utils.PgCommand.run.execute).not.toHaveBeenCalled();
    expect(PgClientRun.state).toEqual({
      kind: "funding",
      address: "Wa11et",
      balance: 0,
      needed: 0.02,
      previous: { kind: "idle" },
    });
    expect(sent.events.at(-1)).toMatchObject({
      name: "docs_link_run_funding_shown",
      params: { funding_state: "existing" },
    });
  });

  it("runs once Check again finds the SOL", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    await PgClientRun.start();

    utils.lamports = 0.5e9;
    await PgClientRun.checkAgain();

    expect(utils.PgCommand.run.execute).toHaveBeenCalledTimes(1);
  });

  it("goes back from the funding card on Not now", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    await PgClientRun.start();

    PgClientRun.dismissFunding();

    expect(PgClientRun.state.kind).toBe("idle");
  });

  it("sets a new wallet up before checking its SOL", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    utils.PgWallet.state = "setup";

    await PgClientRun.start();

    expect(utils.PgCommand.connect.execute).toHaveBeenCalledTimes(1);
    expect(sent.events.at(-1)?.params).toEqual({ funding_state: "new" });
  });

  it("runs a project from no link without asking for SOL", async () => {
    const { PgClientRun } = await load();
    await PgClientRun.start();
    expect(utils.PgCommand.run.execute).toHaveBeenCalledTimes(1);
  });

  it("runs when the wallet holds exactly what the link needs", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    utils.lamports = 0.02e9;
    await PgClientRun.start();
    expect(utils.PgCommand.run.execute).toHaveBeenCalledTimes(1);
  });

  it("stays on the funding card while the wallet is still short", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    await PgClientRun.start();

    utils.lamports = 0.01e9;
    await PgClientRun.checkAgain();

    expect(utils.PgCommand.run.execute).not.toHaveBeenCalled();
    expect(PgClientRun.state).toMatchObject({ kind: "funding", balance: 0.01 });
  });

  it("starts one run for a double press", async () => {
    const { PgClientRun } = await load();
    await Promise.all([PgClientRun.start(), PgClientRun.start()]);
    expect(utils.PgCommand.run.execute).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the wallet setup is closed", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    utils.PgWallet.state = "setup";
    // As `connect` does when the user closes the setup modal
    utils.PgCommand.connect.execute.mockRejectedValueOnce(
      new Error("Setup rejected.")
    );

    await expect(PgClientRun.start()).resolves.toBeUndefined();

    expect(utils.PgCommand.run.execute).not.toHaveBeenCalled();
    expect(PgClientRun.state.kind).toBe("idle");
  });

  it("says so when connect ends with no wallet", async () => {
    const { PgClientRun } = await load();
    utils.PgWallet.state = "disconnected";
    const wallet = utils.PgWallet.current;
    utils.PgWallet.current = undefined;

    await PgClientRun.start();

    utils.PgWallet.current = wallet;
    expect(PgClientRun.state).toMatchObject({ kind: "failed" });
    expect(utils.PgCommand.run.execute).not.toHaveBeenCalled();
  });

  it("runs nothing when another project opens while Run reads the balance", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    utils.lamports = 0.5e9;
    utils.duringBalance = switchWorkspace;

    await PgClientRun.start();

    expect(utils.PgCommand.run.execute).not.toHaveBeenCalled();
    expect(PgClientRun.state.kind).toBe("idle");
  });

  it("shows no funding card for a project left while Run read the balance", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    utils.duringBalance = switchWorkspace;

    await PgClientRun.start();

    expect(PgClientRun.state.kind).toBe("idle");
  });

  it("runs nothing when another project opens while Check again reads the balance", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    await PgClientRun.start();
    expect(PgClientRun.state.kind).toBe("funding");
    utils.lamports = 0.5e9;
    utils.duringBalance = switchWorkspace;

    await PgClientRun.checkAgain();

    expect(utils.PgCommand.run.execute).not.toHaveBeenCalled();
  });

  it("leaves a run typed in the terminal while Run read the balance", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    utils.lamports = 0.5e9;
    // The terminal's run starts while the balance read is in flight
    utils.PgCommand.connect.execute.mockImplementationOnce(async () => {
      startRun();
      return undefined;
    });
    utils.PgWallet.state = "disconnected";

    await PgClientRun.start();

    expect(utils.PgCommand.run.execute).not.toHaveBeenCalled();
    expect(PgClientRun.state.kind).toBe("running");
  });

  it("keeps the last run's end showing while it runs again", async () => {
    const { PgClientRun } = await load();
    startRun();
    finishRun({ ok: { ok: false, error: "fetch failed" } });
    startRun();
    expect(PgClientRun.state).toMatchObject({
      kind: "running",
      previous: { kind: "failed", message: "fetch failed" },
    });
  });

  it("connects a disconnected wallet before checking its SOL", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    utils.PgWallet.state = "disconnected";

    await PgClientRun.start();

    expect(utils.PgCommand.connect.execute).toHaveBeenCalledTimes(1);
    expect(sent.events.at(-1)?.params).toEqual({ funding_state: "existing" });
  });

  it("checks no SOL on a browser wallet", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    const wallet = utils.PgWallet.current;
    utils.PgWallet.current = { publicKey: { toBase58: () => "Ph4ntom" } };

    await PgClientRun.start();

    utils.PgWallet.current = wallet;
    expect(utils.PgCommand.run.execute).toHaveBeenCalledTimes(1);
  });

  it("lets Run start again after the balance read fails", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    utils.balanceError = new Error("fetch failed");
    await expect(PgClientRun.start()).rejects.toThrow("fetch failed");
    expect(PgClientRun.state.kind).toBe("idle");

    utils.balanceError = undefined;
    utils.lamports = 0.5e9;
    await PgClientRun.start();

    expect(utils.PgCommand.run.execute).toHaveBeenCalledTimes(1);
  });

  it("goes back past a short Check again to the run before the card", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    startRun();
    finishRun({ ok: { ok: false, error: "fetch failed" } });
    await PgClientRun.start();
    await PgClientRun.checkAgain();

    PgClientRun.dismissFunding();

    expect(PgClientRun.state).toEqual({
      kind: "failed",
      message: "fetch failed",
    });
  });

  it("starts another project from a clean callout", async () => {
    const { PgClientRun } = await load();
    startRun();
    finishRun({ ok: { ok: true } });
    switchWorkspace();
    expect(PgClientRun.state.kind).toBe("idle");
  });

  it("keeps a run going when another project opens", async () => {
    const { PgClientRun } = await load();
    startRun();
    switchWorkspace();
    expect(PgClientRun.state.kind).toBe("running");
  });

  it("shows a run the command refused before it started", async () => {
    const { PgClientRun } = await load();
    utils.PgCommand.run.execute.mockRejectedValueOnce(
      new Error("Client is already running!")
    );
    await PgClientRun.start();
    expect(PgClientRun.state).toEqual({
      kind: "failed",
      message: "Client is already running!",
    });
  });

  it("keeps what a run that started and threw finished with", async () => {
    const { PgClientRun } = await load();
    const error = new Error("Package `@solana-program/memo` is not available.");
    // As `PgCommandManager.execute` does: finish the run, then rethrow
    utils.PgCommand.run.execute.mockImplementationOnce(async () => {
      startRun();
      finishRun({ err: error });
      throw error;
    });
    await PgClientRun.start();
    expect(PgClientRun.state).toEqual({
      kind: "missing-package",
      pkg: "@solana-program/memo",
    });
  });

  it("keeps a run going when another link opens", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    startRun();
    PgDocsLink.open(QUICKSTART);
    expect(PgClientRun.state.kind).toBe("running");
  });

  it("sends no docs link event for a run a link opened only after it started", async () => {
    const { PgDocsLink, states } = await load();
    startRun();
    PgDocsLink.open(QUICKSTART);
    finishRun({ ok: { ok: true } });

    expect(states).toEqual(["idle", "running", "done"]);
    expect(
      sent.events.filter((event) => event.name.startsWith("docs_link_"))
    ).toEqual([]);
  });

  it("sends both docs link run events when the link clears mid-run", async () => {
    const { PgDocsLink } = await load();
    PgDocsLink.open(QUICKSTART);
    startRun();
    PgDocsLink.clear();
    finishRun({ ok: { ok: true } });
    expect(sent.events.map((event) => event.name)).toEqual([
      "docs_link_run_started",
      "docs_link_run_finished",
    ]);
  });

  it("reads a thrown non-Error as its text", async () => {
    const { PgClientRun } = await load();
    startRun();
    finishRun({ err: "boom" as unknown as Error });
    expect(PgClientRun.state).toEqual({ kind: "failed", message: "boom" });
  });

  it("starts a new link from a clean callout", async () => {
    const { PgClientRun, PgDocsLink } = await load();
    startRun();
    finishRun({ ok: { ok: true } });
    PgDocsLink.open(QUICKSTART);
    expect(PgClientRun.state.kind).toBe("idle");
  });
});
