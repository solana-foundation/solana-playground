import { beforeEach, describe, expect, it, vi } from "vitest";

// The utils barrel needs build-time globals the unit runner does not define;
// the call act reads the deployed IDL from `PgProgramInfo`, builds the
// instruction fresh and sends through the Call panel's interaction, loaded on
// demand
const idl = vi.hoisted(() => ({
  instructions: [{ name: "chopTree", accounts: [], args: [] }],
}));
const interaction = vi.hoisted(() => ({
  getAnchorProgram: vi.fn(() => ({})),
  test: vi.fn(async () => undefined),
}));

const finished = vi.hoisted(() => ({
  cb: undefined as undefined | ((r: unknown) => void),
}));
vi.mock("../../../../utils", async () => ({
  PgCommand: {
    run: {
      execute: vi.fn(),
      onDidFinish: (cb: (r: unknown) => void) => {
        finished.cb = cb;
        return { dispose: () => {} };
      },
    },
  },
  PgConnection: {
    cluster: "devnet",
    current: {
      rpcEndpoint: (await import("@/test-utils/endpoints.mjs")).TEST_ENDPOINT
        .DEVNET,
    },
  },
  PgExplorer: { currentWorkspaceName: undefined },
  PgProgramInfo: { callableIdl: () => idl, pk: undefined },
  PgTerminal: { println: vi.fn() },
  PgTx: { confirm: vi.fn() },
  PgWallet: { current: undefined },
  PgWeb3: { Connection: { prototype: {} } },
}));
vi.mock("../../../../utils/program-interaction", () => ({
  PgProgramInteraction: interaction,
}));
vi.mock("../../../../utils/program-interaction/instruction", () => ({
  createGeneratableInstruction: (ix: { name: string }) => ({
    name: ix.name,
    values: { accounts: [], args: [] },
  }),
}));
// Sends are not captured here: an error thrown inside comes back as the
// result's `error`, as `captureSends` returns it
vi.mock("./capture", () => ({
  // eslint-disable-next-line layers/curry-order -- the order `captureSends` takes
  captureSends: async (_sender: unknown, send: () => Promise<void>) => {
    try {
      await send();
      return { error: undefined, captured: [] };
    } catch (error) {
      return { error, captured: [] };
    }
  },
}));

import { PgCommand } from "../../../../utils";
import type { FundingChain } from "./fund";
import { realClientRunWatch, realRunPort } from "./real-run";

const port = realRunPort({} as FundingChain, 1);
// `refusal` first, as `runOrCall` asks it: it captures the target `send` checks
const call = (instruction: string) => {
  expect(port.refusal()).toBeNull();
  return port.send("call", {
    beatId: "s3.chop",
    call: { instruction, args: {} },
  } as never);
};

describe("realRunPort's call act", () => {
  beforeEach(() => {
    interaction.test.mockClear();
  });

  // A definition names it as Rust does, an Anchor 0.29 IDL in camelCase
  it("sends an instruction the IDL spells in camelCase", async () => {
    const { error } = await call("chop_tree");
    expect(error).toBeUndefined();
    expect(interaction.test).toHaveBeenCalledTimes(1);
  });

  it("refuses an instruction the deployed program does not have", async () => {
    const { error } = await call("plant_tree");
    expect(String(error)).toContain("has no `plant_tree`");
    expect(interaction.test).not.toHaveBeenCalled();
  });
});

// HOO-2806 review: `run` reports a script that threw as a result, not a
// throw, so a run whose transaction landed before the throw passed its step
describe("a client.ts that threw", () => {
  it("is the run act's error", async () => {
    vi.mocked(PgCommand.run.execute).mockResolvedValueOnce({
      ok: false,
      error: "x is undefined",
    } as never);
    expect(port.refusal()).toBeNull();
    const { error } = await port.send("run", { beatId: "s3.run" } as never);
    expect(String(error)).toContain("x is undefined");
  });

  it("is the error of a run outside the card", () => {
    const seen: unknown[] = [];
    realClientRunWatch({} as FundingChain, 1).onDidFinish((r) => seen.push(r));
    finished.cb?.({ ok: { ok: false, error: "x is undefined" } });
    finished.cb?.({ ok: { ok: true } });
    expect(String((seen[0] as { err: unknown }).err)).toContain(
      "x is undefined"
    );
    expect(seen[1]).toEqual({});
  });
});
