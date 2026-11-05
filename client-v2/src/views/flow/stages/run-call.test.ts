import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
// How one Interact call becomes an outcome: sent and confirmed, failed on
// chain, refused in preflight, or never sent; and what reaches the history.
const h = vi.hoisted(() => ({
  test: vi.fn(),
  confirm: vi.fn(),
  getTransaction: vi.fn(),
  println: vi.fn(() => Promise.resolve()),
  pk: "P" as string | null,
  cluster: "devnet" as string | null,
}));

vi.mock("../../../utils", () => ({
  PgCommand: { solana: { execute: vi.fn(() => Promise.resolve()) } },
  PgCommon: {
    transition: (p: Promise<unknown>) => p,
    sleep: () => Promise.resolve(),
  },
  PgConnection: {
    current: { getTransaction: h.getTransaction },
    get cluster() {
      return h.cluster;
    },
  },
  PgProgramInfo: { getPkStr: () => h.pk },
  PgSettings: { testUi: { showTxDetailsInTerminal: false } },
  PgTerminal: {
    println: h.println,
    info: (s: string) => s,
    success: (s: string) => s,
    error: (s: string) => s,
  },
  PgTx: { confirm: h.confirm },
}));
vi.mock("../../../utils/program-interaction", () => ({
  PgProgramInteraction: { test: h.test },
}));

import { PgCallHistory } from "../state/call-history";
import { runCall, useCallInFlight } from "./run-call";

const IX = { name: "increment" } as Parameters<typeof runCall>[0];
const ERROR_LINE = "Program log: Error Code: AccountNotInitialized.";

beforeEach(() => {
  localStorage.clear();
  h.test.mockReset();
  h.confirm.mockReset();
  h.getTransaction.mockReset();
  h.println.mockClear();
  h.pk = "P";
  h.cluster = "devnet";
});

describe("runCall", () => {
  // A form remounts on a chip or stage switch, so the call's "in flight" lives
  // here: a returning form must not offer the same call twice
  it("reads as in flight until the call settles", async () => {
    let answer: (signature: string) => void = () => {};
    h.test.mockReturnValue(
      new Promise<string>((resolve) => {
        answer = resolve;
      })
    );
    h.confirm.mockResolvedValue(undefined);
    h.getTransaction.mockResolvedValue({ meta: { logMessages: [] } });
    const { result } = renderHook(useCallInFlight);
    expect(result.current).toBe(false);

    let call: Promise<unknown> = Promise.resolve();
    act(() => {
      call = runCall(IX);
    });
    expect(result.current).toBe(true);

    await act(async () => {
      answer("sig");
      await call;
    });
    expect(result.current).toBe(false);
  });

  it("a confirmed call succeeds with its logs, prints and joins the history", async () => {
    h.test.mockResolvedValue("sig");
    h.confirm.mockResolvedValue(undefined);
    h.getTransaction.mockResolvedValue({
      meta: { logMessages: ["Program log: Instruction: Increment"] },
    });

    const outcome = await runCall(IX);

    expect(outcome).toEqual({
      instruction: "increment",
      ok: true,
      signature: "sig",
      logs: ["Program log: Instruction: Increment"],
      failingLine: undefined,
    });
    expect(h.println).toHaveBeenCalledWith("Call succeeded.");
    expect(PgCallHistory.list("P", "devnet")).toHaveLength(1);
  });

  it("asks once more for logs an RPC has not indexed yet", async () => {
    h.test.mockResolvedValue("sig");
    h.confirm.mockResolvedValue(undefined);
    h.getTransaction
      // eslint-disable-next-line unicorn/no-null -- an RPC answers `null` for a transaction it has not indexed
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ meta: { logMessages: ["late"] } });

    expect((await runCall(IX)).logs).toEqual(["late"]);
  });

  it("a call the program rejects fails on its error line", async () => {
    h.test.mockResolvedValue("sig");
    h.confirm.mockResolvedValue({ err: { InstructionError: [0, {}] } });
    h.getTransaction.mockResolvedValue({
      meta: { logMessages: ["Program X invoke [1]", ERROR_LINE] },
    });

    const outcome = await runCall(IX);

    expect(outcome.ok).toBe(false);
    expect(outcome.failingLine).toBe(ERROR_LINE);
    expect(PgCallHistory.list("P", "devnet")[0].failingLine).toBe(ERROR_LINE);
  });

  it("a preflight refusal uses the simulation's logs", async () => {
    h.test.mockRejectedValue(
      Object.assign(new Error("Simulation failed"), {
        logs: ["Program X invoke [1]", ERROR_LINE],
      })
    );

    const outcome = await runCall(IX);

    expect(outcome).toMatchObject({
      ok: false,
      signature: undefined,
      failingLine: ERROR_LINE,
    });
  });

  it("a call that never reached the network shows the error, translated", async () => {
    h.test.mockRejectedValue(new Error("unable to infer src variant"));

    const outcome = await runCall(IX);

    expect(outcome).toMatchObject({
      ok: false,
      signature: undefined,
      logs: [],
      failingLine: "Enum variant not found",
    });
  });

  it("a sent call whose confirmation fails says it is unconfirmed", async () => {
    h.test.mockResolvedValue("sig");
    h.confirm.mockRejectedValue(new Error("timeout"));

    const outcome = await runCall(IX);

    expect(outcome).toMatchObject({
      ok: false,
      signature: "sig",
      failingLine: "Could not confirm the call: timeout",
    });
  });

  it("records nothing without a program or a network, and still resolves", async () => {
    // eslint-disable-next-line unicorn/no-null -- `PgProgramInfo.getPkStr()` answers `null` without a program
    h.pk = null;
    h.test.mockResolvedValue("sig");
    h.confirm.mockResolvedValue(undefined);
    h.getTransaction.mockResolvedValue({ meta: { logMessages: [] } });

    await expect(runCall(IX)).resolves.toMatchObject({ ok: true });
    expect(PgCallHistory.list("P", "devnet")).toEqual([]);
  });

  it("records under the program and network the call went to", async () => {
    h.test.mockImplementation(async () => {
      // The person switches network while the call is in flight
      h.cluster = "testnet";
      return "sig";
    });
    h.confirm.mockResolvedValue(undefined);
    h.getTransaction.mockResolvedValue({ meta: { logMessages: [] } });

    await runCall(IX);

    expect(PgCallHistory.list("P", "devnet")).toHaveLength(1);
    expect(PgCallHistory.list("P", "testnet")).toHaveLength(0);
  });
});
