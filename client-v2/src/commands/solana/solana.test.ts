// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, and the tests replay the Rust CLI's recorded RPC traffic
// through a stubbed `fetch` (AGENTS.md).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getBase64Encoder } from "@solana/kit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TerminalLineError } from "../../utils/terminal/line-error";
import {
  type BufferCloser,
  closeBuffersWith,
  fetchBuffersWith,
  formatBuffersTable,
} from "./buffers";
import { toBytes } from "./bytes";
import { createClientWith } from "./client";
import { confirmVerboseWith, confirmWith } from "./confirm";
import { normalizeToUrlIfMoniker } from "./url";

interface RecordedCall {
  url: string;
  request: { method: string; params: unknown[] };
  response: unknown;
}

interface Fixture {
  command: string;
  settings: { endpoint: string; commitment: string };
  rpc: RecordedCall[];
  output: string;
  outputParts: string[];
}

const FIXTURES_DIR = join(__dirname, "__fixtures__");

const readFixture = (name: string) =>
  JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a recorded case of the fixtures folder
    readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf8")
  ) as Fixture;

// eslint-disable-next-line security/detect-non-literal-fs-filename -- the fixtures folder
const fixtureNames = readdirSync(FIXTURES_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replace(/\.json$/, ""));

/**
 * The height `getBlockHeight` answers: the Rust CLI never asked it, so the
 * recordings hold no answer, and any height below the blockhash's last valid
 * one says the transaction has not expired
 */
const UNEXPIRED_HEIGHT = 1;

/**
 * Answer every `fetch` with the next recorded response, failing when the
 * method asked is not the recorded one.
 */
const replay = (calls: readonly RecordedCall[]) => {
  const queue = calls.slice();
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        method: string;
        params: unknown[];
      };
      const json = (value: unknown) => new Response(JSON.stringify(value));
      if (body.method === "getBlockHeight") {
        return json({ jsonrpc: "2.0", id: 0, result: UNEXPIRED_HEIGHT });
      }

      const next = queue.shift();
      if (!next) throw new Error(`Unrecorded call: ${body.method}`);
      expect(body.method).toBe(next.request.method);
      return json(next.response);
    });

  return { fetchMock, remaining: () => queue.length };
};

/** The cluster URL a recording was made against, as the CLI printed it in its banner */
// eslint-disable-next-line no-restricted-syntax -- the recordings were made against Devnet and print its URL
const URL_OF_RECORDING = "https://api.devnet.solana.com";

/** The words a recorded `command` was typed as, without `solana` */
const wordsOf = (fixture: Fixture) => fixture.command.split(" ").slice(1);

/** The URL `-u` named in a recorded `command`, or the endpoint the app had selected */
const urlOf = (fixture: Fixture) => {
  const words = wordsOf(fixture);
  const at = words.indexOf("-u");
  return at === -1
    ? fixture.settings.endpoint
    : normalizeToUrlIfMoniker(words[at + 1]);
};

describe("commands/solana", () => {
  let previousTimezone: string | undefined;
  beforeAll(() => {
    // The recordings were made with TZ=UTC: the block time prints in the local zone
    previousTimezone = process.env.TZ;
    process.env.TZ = "UTC";
    return () => {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("confirm", () => {
    const confirmFixtures = fixtureNames.filter((name) =>
      name.startsWith("confirm-")
    );

    // eslint-disable-next-line jest/valid-title -- one test per recorded case
    it.each(confirmFixtures)(
      "prints what the Rust CLI printed: %s",
      async (name) => {
        const fixture = readFixture(name);
        const words = wordsOf(fixture);
        const signature = words.find((word) => word.length > 60) ?? "";
        const client = createClientWith(fixture.settings.commitment)(
          urlOf(fixture)
        );
        const { remaining } = replay(fixture.rpc);

        const confirm = words.includes("-v")
          ? confirmVerboseWith(client)
          : confirmWith(client);
        const parts = await confirm(signature);

        expect(parts).toEqual(fixture.outputParts);
        expect(parts.join("\n")).toBe(fixture.output);
        expect(remaining()).toBe(0);
      }
    );

    it("reads the cluster -u names, not the selected endpoint", async () => {
      const fixture = readFixture("confirm-verbose-success-legacy-u-d");
      const { fetchMock } = replay(fixture.rpc);

      await confirmVerboseWith(
        createClientWith(fixture.settings.commitment)(
          normalizeToUrlIfMoniker("d")
        )
      )(wordsOf(fixture).at(-1) ?? "");

      expect(fixture.settings.endpoint).toContain("testnet");
      for (const [input] of fetchMock.mock.calls) {
        expect(String(input)).toBe(URL_OF_RECORDING);
      }
    });

    it("refuses a signature that is not one without asking the cluster", async () => {
      const { fetchMock } = replay([]);
      const client = createClientWith("confirmed")(URL_OF_RECORDING);

      await expect(confirmWith(client)("not-a-signature")).rejects.toThrow(
        new TerminalLineError("Parse error: Bad parameter: Invalid signature")
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("prints a blank line before Not found when verbose", async () => {
      const fixture = readFixture("confirm-unknown");
      replay(fixture.rpc);
      const signature = wordsOf(fixture).at(-1) ?? "";

      const parts = await confirmVerboseWith(
        createClientWith("confirmed")(URL_OF_RECORDING)
      )(signature);

      expect(parts).toEqual([
        // eslint-disable-next-line no-restricted-syntax -- the recorded banner names Devnet
        "RPC URL: https://api.devnet.solana.com\nDefault Signer: Playground Wallet\nCommitment: confirmed",
        "\nNot found",
      ]);
    });

    it("says the transaction is not final when it is not and cannot be read", async () => {
      const fixture = readFixture("confirm-success");
      const signature = wordsOf(fixture).at(-1) ?? "";
      const status = fixture.rpc[0].response as {
        result: { value: { confirmationStatus: string }[] };
      };
      status.result.value[0].confirmationStatus = "confirmed";
      replay([
        fixture.rpc[0],
        {
          url: URL_OF_RECORDING,
          request: { method: "getTransaction", params: [] },
          // eslint-disable-next-line unicorn/no-null -- the wire payload for a transaction the cluster does not have
          response: { jsonrpc: "2.0", id: 0, result: null },
        },
      ]);

      const parts = await confirmVerboseWith(
        createClientWith("confirmed")(URL_OF_RECORDING)
      )(signature);

      expect(parts[1]).toBe(
        "\nUnable to get finalized transaction details: not yet finalized\n\nConfirmed"
      );
    });

    it("reports a cluster that cannot be asked", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("slow down", { status: 429 })
      );
      const signature = wordsOf(readFixture("confirm-success")).at(-1) ?? "";

      await expect(
        confirmWith(createClientWith("confirmed")(URL_OF_RECORDING))(signature)
      ).rejects.toThrow(/^Unable to confirm: /);
    });
  });

  describe("program show --buffers", () => {
    const showFixtures = fixtureNames.filter((name) =>
      name.startsWith("program-show-buffers-")
    );

    // eslint-disable-next-line jest/valid-title -- one test per recorded case
    it.each(showFixtures)(
      "prints what the Rust CLI printed: %s",
      async (name) => {
        const fixture = readFixture(name);
        const authority = (
          fixture.rpc[0].request.params[1] as {
            filters: { memcmp: { bytes: string } }[];
          }
        ).filters[2].memcmp.bytes;
        const client = createClientWith(fixture.settings.commitment)(
          urlOf(fixture)
        );
        const { remaining } = replay(fixture.rpc);

        const buffers = await fetchBuffersWith(client)(authority);

        expect(formatBuffersTable(buffers)).toBe(fixture.output);
        expect(remaining()).toBe(0);
      }
    );

    it("asks with the Rust CLI's filters", async () => {
      const fixture = readFixture("program-show-buffers-none");
      const { fetchMock } = replay(fixture.rpc);
      const recorded = fixture.rpc[0].request.params[1] as {
        filters: { memcmp: { bytes: string; offset: number } }[];
      };

      await fetchBuffersWith(createClientWith("confirmed")(URL_OF_RECORDING))(
        recorded.filters[2].memcmp.bytes
      );

      const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
        params: [
          string,
          typeof recorded & { dataSlice: unknown; encoding: string }
        ];
      };
      expect(sent.params[0]).toBe(fixture.rpc[0].request.params[0]);
      expect(sent.params[1].dataSlice).toEqual({ offset: 0, length: 37 });
      expect(sent.params[1].encoding).toBe("base64");
      expect(
        sent.params[1].filters.map(({ memcmp }) => [
          memcmp.offset,
          memcmp.bytes,
        ])
      ).toEqual(
        recorded.filters.map(({ memcmp }) => [memcmp.offset, memcmp.bytes])
      );
    });

    it("fails when the buffers cannot be listed, instead of printing an empty table", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("slow down", { status: 429 })
      );

      await expect(
        fetchBuffersWith(createClientWith("confirmed")(URL_OF_RECORDING))(
          "399rcrEWr3hVAhVy3moRPm5UKy8RmZpAFTZDDu3kksfT"
        )
      ).rejects.toThrow();
    });
  });

  describe("program close --buffers", () => {
    const closeFixtures = fixtureNames.filter((name) =>
      name.startsWith("program-close-buffers-")
    );

    /** A wallet that signs by handing back the transaction the Rust CLI sent, once the one built here has the same message */
    const closerReplaying = (fixture: Fixture): BufferCloser => {
      const recorded = fixture.rpc.find(
        (call) => call.request.method === "sendTransaction"
      );
      const wire = recorded
        ? Uint8Array.from(
            toBytes(
              getBase64Encoder().encode(recorded.request.params[0] as string)
            )
          )
        : new Uint8Array();
      const authority = (
        fixture.rpc[0].request.params[1] as {
          filters: { memcmp: { bytes: string } }[];
        }
      ).filters[2].memcmp.bytes;

      return {
        address: authority,
        sign: async (built) => {
          // [signature count][signature][message]: the signature is the wallet's to add
          expect(Array.from(built.slice(65))).toEqual(
            Array.from(wire.slice(65))
          );
          return wire;
        },
      };
    };

    // eslint-disable-next-line jest/valid-title -- one test per recorded case
    it.each(closeFixtures)(
      "prints what the Rust CLI printed: %s",
      async (name) => {
        const fixture = readFixture(name);
        const client = createClientWith(fixture.settings.commitment)(
          urlOf(fixture)
        );
        const wait = vi.fn(async () => {});
        const { remaining } = replay(fixture.rpc);

        const { closed, skipped } = await closeBuffersWith(client)(wait)(
          closerReplaying(fixture)
        );

        expect(formatBuffersTable(closed)).toBe(fixture.output);
        expect(skipped).toEqual([]);
        expect(remaining()).toBe(0);
      }
    );

    it("polls the status until the cluster has the transaction", async () => {
      const fixture = readFixture("program-close-buffers-one");
      const wait = vi.fn(async () => {});
      replay(fixture.rpc);

      await closeBuffersWith(
        createClientWith(fixture.settings.commitment)(URL_OF_RECORDING)
      )(wait)(closerReplaying(fixture));

      // The recording has the status unknown once, then finalized
      expect(wait).toHaveBeenCalledTimes(1);
    });

    it("skips a buffer whose close fails and says why", async () => {
      const fixture = readFixture("program-close-buffers-one");
      const failedSend: RecordedCall = {
        url: URL_OF_RECORDING,
        request: { method: "sendTransaction", params: [] },
        response: {
          jsonrpc: "2.0",
          id: 0,
          error: {
            code: -32005,
            message: "Node is behind",
            data: { numSlotsBehind: 100 },
          },
        },
      };
      replay([fixture.rpc[0], fixture.rpc[1], failedSend]);

      const { closed, skipped } = await closeBuffersWith(
        createClientWith(fixture.settings.commitment)(URL_OF_RECORDING)
      )(vi.fn(async () => {}))(closerReplaying(fixture));

      expect(closed).toEqual([]);
      expect(skipped).toHaveLength(1);
      expect(skipped[0].buffer.address).toBe(
        "FYiqAhbb7vi4m77FZJrbjLbt5DoVJEmdjJbNgXkkUNKj"
      );
      expect(skipped[0].reason).toContain(
        "Node is unhealthy; behind by 100 slots"
      );
    });

    it("skips a buffer whose transaction failed on the cluster", async () => {
      const fixture = readFixture("program-close-buffers-one");
      const failedStatus: RecordedCall = {
        url: URL_OF_RECORDING,
        request: { method: "getSignatureStatuses", params: [] },
        response: {
          jsonrpc: "2.0",
          id: 0,
          result: {
            context: { slot: 1 },
            value: [
              {
                confirmationStatus: "confirmed",
                confirmations: 1,
                err: { InstructionError: [0, "IncorrectAuthority"] },
                slot: 1,
                status: {
                  Err: { InstructionError: [0, "IncorrectAuthority"] },
                },
              },
            ],
          },
        },
      };
      replay([fixture.rpc[0], fixture.rpc[1], fixture.rpc[2], failedStatus]);

      const { closed, skipped } = await closeBuffersWith(
        createClientWith(fixture.settings.commitment)(URL_OF_RECORDING)
      )(vi.fn(async () => {}))(closerReplaying(fixture));

      expect(closed).toEqual([]);
      expect(skipped[0].reason).toBe(
        "Error processing Instruction 0: Incorrect authority provided"
      );
    });

    it("fails when the buffers cannot be listed, instead of closing none", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("slow down", { status: 429 })
      );

      await expect(
        closeBuffersWith(createClientWith("confirmed")(URL_OF_RECORDING))(
          vi.fn(async () => {})
        )({
          address: "399rcrEWr3hVAhVy3moRPm5UKy8RmZpAFTZDDu3kksfT",
          sign: async (wire) => wire,
        })
      ).rejects.toThrow();
    });
  });
});
