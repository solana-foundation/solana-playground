// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, so its tests stay out of the modules (AGENTS.md)
import { afterEach, describe, expect, it, vi } from "vitest";

import { PgTerminal } from "../../utils";
import { setting } from "./setting";

const READ_BUFFER = "https://read-buffer.test/";
const ID = "connection.readBufferEndpoint";

const env = vi.hoisted(() => ({
  selected: { rpcEndpoint: "https://api.devnet.solana.com" },
  /** What `PgConnection.getReadBufferConnection` answers; the selected connection when unset */
  readBuffer: undefined as { rpcEndpoint: string } | undefined,
}));
const getReadBufferConnection = vi.hoisted(() =>
  vi.fn(<T>(connection: T) => env.readBuffer ?? connection)
);
const setValue = vi.hoisted(() => vi.fn());

vi.mock("../../utils", async () => {
  const { TonedLineError } = await vi.importActual<
    typeof import("../../utils/terminal/line-error")
  >("../../utils/terminal/line-error");
  return {
    PgCommon: { callIfNeeded: <T>(value: T) => value },
    PgConnection: {
      current: env.selected,
      getReadBufferConnection,
    },
    PgSettings: {
      all: [
        "blockExplorer.name",
        "connection.endpoint",
        "connection.priorityFee",
        "editor.fontSize",
      ].map((id) => ({ id, getValue: vi.fn(), setValue })),
    },
    PgTerminal: { println: vi.fn() },
    TonedLineError,
  };
});

const subcommandOf = (name: string) => {
  const found = setting.subcommands?.find((subcmd) => subcmd.name === name);
  if (!found) throw new Error(`No \`setting ${name}\``);
  return found;
};

const get = subcommandOf("get");
const set = subcommandOf("set");

/** Run `subcmd` as the terminal does once the tokens are validated */
const runWith = (subcmd: typeof get) => (args: Record<string, unknown>) =>
  subcmd.handle({ args } as never);

describe("commands/setting", () => {
  afterEach(() => {
    env.readBuffer = undefined;
    vi.clearAllMocks();
  });

  it("lists the read-buffer key among the connection keys", () => {
    const [idArg] = get.args;

    expect(idArg.values()).toEqual([
      "blockExplorer.name",
      "connection.endpoint",
      "connection.priorityFee",
      ID,
      "editor.fontSize",
    ]);
  });

  it.each([
    { label: "the env's read-buffer RPC", readBuffer: READ_BUFFER },
    { label: "the selected endpoint when the env sets none", readBuffer: "" },
  ])("get prints $label", ({ readBuffer }) => {
    env.readBuffer = readBuffer ? { rpcEndpoint: readBuffer } : undefined;

    runWith(get)({ id: ID });

    expect(getReadBufferConnection).toHaveBeenCalledWith(env.selected);
    expect(PgTerminal.println).toHaveBeenCalledWith(
      readBuffer || env.selected.rpcEndpoint
    );
  });

  it("set refuses any value and stores nothing", () => {
    const tokens = ["setting", "set", ID, READ_BUFFER];
    const [, valueArg] = set.args;

    expect(valueArg.values(READ_BUFFER, tokens)).toEqual([READ_BUFFER]);
    const value = valueArg.parse(READ_BUFFER, tokens);
    expect(() => runWith(set)({ id: ID, value })).toThrow(
      "`connection.readBufferEndpoint` comes from the environment and can't be set here."
    );
    expect(setValue).not.toHaveBeenCalled();
  });
});
