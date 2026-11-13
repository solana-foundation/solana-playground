// @vitest-environment node
// Signing a web3.js transaction fails under jsdom, whose `Uint8Array` is another realm's
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { address, none, unwrapOption } from "@solana/kit";
import { VersionedTransaction } from "@solana/web3.js";
import {
  Compression,
  DataSource,
  Encoding,
  findCanonicalPda,
  findNonCanonicalPda,
  Format,
  getInitializeInstructionDataDecoder,
  getMetadataEncoder,
  INITIALIZE_DISCRIMINATOR,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
  unpackDirectData,
} from "@solana-program/program-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  initLogger,
  memoryProvider as logMemoryProvider,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

import {
  connectionOf,
  deployedBy,
  instructionsFor,
  OTHER_WALLET,
  pricesOf,
  PROGRAM,
  type StubAccount,
  stubRpc,
  WALLET,
  walletOf,
} from "./__fixtures__/chain";
import {
  uploadNonCanonicalProjectIdlWith,
  uploadProjectIdl,
  uploadProjectIdlWith,
} from "./project-idl";
import type { IdlSource } from "./upload";

const idlAddress = async () => {
  const [metadata] = await findCanonicalPda({ program: PROGRAM, seed: "idl" });
  return metadata;
};

/** A canonical Program Metadata account that already holds two bytes of IDL */
const earlierIdl = (): StubAccount => ({
  owner: PROGRAM_METADATA_PROGRAM_ADDRESS,
  executable: false,
  data: getMetadataEncoder().encode({
    program: PROGRAM,
    authority: none(),
    mutable: true,
    canonical: true,
    seed: "idl",
    encoding: Encoding.Utf8,
    compression: Compression.Zlib,
    format: Format.Json,
    dataSource: DataSource.Direct,
    dataLength: 2,
    data: new Uint8Array([1, 2]),
  }),
});

/** An Anchor 0.30+ IDL; a long `description` makes it larger than one transaction */
const idlWith = (description: string) => ({
  address: PROGRAM,
  metadata: { name: "counter", version: "0.1.0", spec: "0.1.0", description },
  instructions: [],
});

/** The small IDL as a file holds it: indented and ended by a newline, so the text serialised again differs from it */
const FILE_TEXT = `${JSON.stringify(idlWith("A counter"), undefined, 2)}\n`;

/** An Anchor 0.30+ IDL the Playground cannot map to the 0.29 shape: an argument of an unbound generic type */
const UNMAPPABLE_IDL = {
  address: PROGRAM,
  metadata: { name: "counter", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "set",
      discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
      accounts: [],
      args: [{ name: "value", type: { generic: "T" } }],
    },
  ],
};

/** A file of the entity's `anchor-cli` fixtures, which Anchor 1.1.2 uploads */
const anchorFixture = (name: string) =>
  readFileSync(
    join(
      __dirname,
      "../../../entities/idl/model/anchor-cli/__fixtures__",
      name
    ),
    "utf8"
  );

/** Text that zlib cannot shrink much, the same on every run */
const noise = (length: number) => {
  let state = 1;
  return Array.from({ length }, () => {
    state = (state * 48_271) % 2_147_483_647;
    return (state % 36).toString(36);
  }).join("");
};

/** An Anchor 0.29 IDL */
const LEGACY_IDL = { name: "counter", version: "0.1.0", instructions: [] };

const projectIdl = (idl: object | undefined): IdlSource => ({
  kind: "project",
  idl,
});

const fileIdl = (filepath: string, text: string | undefined): IdlSource => ({
  kind: "file",
  filepath,
  text,
});

interface Setup {
  source: IdlSource;
  accounts: Map<string, StubAccount>;
  wallet: ReturnType<typeof walletOf>;
  connection: ReturnType<typeof connectionOf>;
  upload: typeof uploadProjectIdl;
}

/** A small IDL the project holds, the program deployed by the wallet, no earlier IDL, a wallet that approves, and the canonical upload */
const arrange = async (): Promise<Setup> => ({
  source: projectIdl(idlWith("A counter")),
  accounts: await deployedBy(WALLET.publicKey.toBase58()),
  wallet: walletOf(WALLET),
  connection: connectionOf(),
  upload: uploadProjectIdl,
});

const run = ({ source, accounts, wallet, connection, upload }: Setup) => {
  stubRpc(accounts);
  return upload({ source, programId: PROGRAM, connection, wallet });
};

describe("features/program-idl/model/project-idl", () => {
  let tracked: ReturnType<typeof memoryProvider>;

  beforeEach(() => {
    tracked = memoryProvider();
    initTelemetry({ providers: [tracked] });
    initLogger({ providers: [logMemoryProvider()] });
  });

  afterEach(() => {
    resetTelemetry();
    resetLogger();
  });

  it.each([
    {
      reason: "not_found",
      label: "a project without an IDL",
      change: (setup: Setup) => {
        setup.source = projectIdl(undefined);
      },
      line: "The project has no IDL to upload.",
      sent: 0,
    },
    {
      reason: "not_found",
      label: "an IDL file the project does not hold, which the line names",
      change: (setup: Setup) => {
        setup.source = fileIdl("idl/none.json", undefined);
      },
      line: "The project has no IDL file at idl/none.json.",
      sent: 0,
    },
    {
      reason: "invalid",
      label: "an Anchor 0.29 IDL",
      change: (setup: Setup) => {
        setup.source = projectIdl(LEGACY_IDL);
      },
      line: "The project's IDL is not in the Anchor 0.30+ format.",
      sent: 0,
    },
    {
      reason: "invalid",
      label: "an Anchor 0.29 IDL in a file, which the line names",
      change: (setup: Setup) => {
        setup.source = fileIdl("idl/legacy.json", JSON.stringify(LEGACY_IDL));
      },
      line: "The IDL in idl/legacy.json is not in the Anchor 0.30+ format.",
      sent: 0,
    },
    {
      reason: "invalid",
      label:
        "a file that is not JSON, which the line names with the parser's reason",
      change: (setup: Setup) => {
        setup.source = fileIdl("idl/broken.json", "{");
      },
      line: "idl/broken.json is not valid JSON: ",
      sent: 0,
    },
    {
      reason: "not_deployed",
      label: "a program id that holds no account",
      change: (setup: Setup) => {
        setup.accounts.clear();
      },
      line: `Program ${PROGRAM} is not deployed on the selected network.`,
      sent: 0,
    },
    {
      reason: "not_deployed",
      label: "a non-canonical upload to a program id that holds no account",
      change: (setup: Setup) => {
        setup.accounts.clear();
        setup.upload = uploadNonCanonicalProjectIdlWith(0n);
      },
      line: `Program ${PROGRAM} is not deployed on the selected network.`,
      sent: 0,
    },
    {
      reason: "not_deployed",
      label: "a program id that holds a wallet's account",
      change: (setup: Setup) => {
        setup.accounts.set(PROGRAM, {
          owner: "11111111111111111111111111111111",
          executable: false,
          data: new Uint8Array(),
        });
      },
      line: `Program ${PROGRAM} is not deployed on the selected network.`,
      sent: 0,
    },
    {
      reason: "authority",
      label: "a wallet that is not the upgrade authority, which the line names",
      change: async (setup: Setup) => {
        setup.accounts = await deployedBy(OTHER_WALLET);
      },
      line: `The program's upgrade authority is ${OTHER_WALLET}. Connect that wallet to upload the IDL.`,
      sent: 0,
    },
    {
      reason: "authority",
      label: "a program with no upgrade authority",
      change: async (setup: Setup) => {
        setup.accounts = await deployedBy(undefined);
      },
      line: "The program has no upgrade authority, so no wallet can upload its IDL.",
      sent: 0,
    },
    {
      reason: "authority",
      label: "a non-canonical upload by the program's upgrade authority",
      change: (setup: Setup) => {
        setup.upload = uploadNonCanonicalProjectIdlWith(0n);
      },
      line: "The connected wallet is the program's upgrade authority, so its IDL goes to the canonical account. Run the command without `--non-canonical`.",
      sent: 0,
    },
    {
      reason: "rejected",
      label: "an approval the wallet declines",
      change: (setup: Setup) => {
        setup.wallet.signAllTransactions = () =>
          Promise.reject(new Error("User rejected the request."));
      },
      line: "The wallet did not approve the IDL upload, so nothing was sent.",
      sent: 0,
    },
    {
      reason: "rpc",
      label: "a wallet that fails to sign for a reason other than the user's",
      change: (setup: Setup) => {
        setup.wallet.signAllTransactions = () =>
          Promise.reject(new Error("Ledger device disconnected"));
      },
      line: "Ledger device disconnected",
      sent: 0,
    },
    {
      reason: "rpc",
      label: "a wallet that returns fewer transactions than it was given",
      change: (setup: Setup) => {
        setup.wallet.signAllTransactions = async () => [];
      },
      line: "The wallet returned 0 of 1 signed transactions, so nothing was sent.",
      sent: 0,
    },
    {
      reason: "send_failed",
      label: "a transaction the cluster fails",
      change: (setup: Setup) => {
        setup.connection.confirmTransaction = async () => ({
          value: { err: { InstructionError: [1, "Custom"] } },
        });
      },
      line: 'IDL upload transaction signature-1 failed: {"InstructionError":[1,"Custom"]}',
      sent: 1,
    },
  ])("reports $reason for $label", async ({ reason, change, line, sent }) => {
    const setup = await arrange();
    await change(setup);

    await expect(run(setup)).rejects.toThrow(line);

    expect(tracked.events).toEqual([
      {
        name: "idl_upload_started",
        params: { target: "metadata", cluster: "devnet" },
      },
      {
        name: "idl_upload_failed",
        params: { target: "metadata", cluster: "devnet", reason },
      },
    ]);
    expect(setup.connection.sent).toHaveLength(sent);
  });

  it("names the cluster custom for an endpoint that is not one of the Playground's own", async () => {
    const setup = await arrange();
    setup.source = projectIdl(undefined);
    setup.connection.rpcEndpoint = "https://devnet.custom-rpc.test";

    await expect(run(setup)).rejects.toThrow(
      "The project has no IDL to upload."
    );

    expect(tracked.events).toEqual([
      {
        name: "idl_upload_started",
        params: { target: "metadata", cluster: "custom" },
      },
      {
        name: "idl_upload_failed",
        params: { target: "metadata", cluster: "custom", reason: "not_found" },
      },
    ]);
  });

  it.each([
    {
      label: "the IDL the project holds, serialised",
      source: projectIdl(idlWith("A counter")),
      content: JSON.stringify(idlWith("A counter")),
    },
    {
      label: "the text of an IDL file, byte for byte",
      source: fileIdl("idl/counter.json", FILE_TEXT),
      content: FILE_TEXT,
    },
    {
      label:
        "an Anchor 0.30+ IDL the project holds that the Playground cannot call",
      source: projectIdl(UNMAPPABLE_IDL),
      content: JSON.stringify(UNMAPPABLE_IDL),
    },
  ])(
    "uploads $label, and reports the start, then the upload",
    async ({ source, content }) => {
      const setup = await arrange();
      setup.source = source;

      const result = await run(setup);

      expect(result).toEqual({
        metadata: await idlAddress(),
        action: "created",
      });
      expect(tracked.events).toEqual([
        {
          name: "idl_upload_started",
          params: { target: "metadata", cluster: "devnet" },
        },
        {
          name: "idl_uploaded",
          params: { target: "metadata", cluster: "devnet" },
        },
      ]);
      const { message } = VersionedTransaction.deserialize(
        setup.connection.sent[0]
      );
      const written = message.compiledInstructions
        .filter(
          ({ programIdIndex }) =>
            message.staticAccountKeys[programIdIndex].toBase58() ===
            PROGRAM_METADATA_PROGRAM_ADDRESS
        )
        .map(({ data }) => getInitializeInstructionDataDecoder().decode(data))
        .map(({ data, compression, encoding }) =>
          unpackDirectData({
            data: unwrapOption(data, () => new Uint8Array()),
            compression,
            encoding,
          })
        );
      expect(written).toEqual([content]);
    }
  );

  it.each(["current.json", "current-full.json"])(
    "uploads the Anchor 1.1.2 fixture %s from a file",
    async (name) => {
      const setup = await arrange();
      setup.source = fileIdl(`idl/${name}`, anchorFixture(name));

      const result = await run(setup);

      expect(result).toEqual({
        metadata: await idlAddress(),
        action: "created",
      });
      expect(tracked.events.map(({ name: event }) => event)).toEqual([
        "idl_upload_started",
        "idl_uploaded",
      ]);
    }
  );

  it("replaces a large IDL with one approval, every transaction fully signed and sent in stage order", async () => {
    const setup = await arrange();
    setup.source = projectIdl(idlWith(noise(2500)));
    setup.accounts.set(await idlAddress(), earlierIdl());

    const result = await run(setup);

    expect(result.action).toBe("replaced");
    expect(setup.wallet.requests).toHaveLength(1);
    const signatures = setup.connection.sent.map(
      (raw) => VersionedTransaction.deserialize(raw).signatures
    );
    expect(signatures).toHaveLength(setup.wallet.requests[0].length);
    // The transaction that creates the buffer account carries its keypair's signature beside the wallet's
    expect(signatures.map((of) => of.length)).toContain(2);
    const unsigned = signatures
      .flat()
      .filter((signature) => signature.every((byte) => byte === 0));
    expect(unsigned).toHaveLength(0);
    expect(setup.connection.steps.slice(0, 2)).toEqual(["send", "confirm"]);
    expect(setup.connection.steps.slice(-2)).toEqual(["send", "confirm"]);
  });

  it("writes the wallet's own account, with no program data account, for a wallet that is not the upgrade authority", async () => {
    const setup = await arrange();
    setup.accounts = await deployedBy(OTHER_WALLET);
    setup.upload = uploadNonCanonicalProjectIdlWith(0n);
    const [own] = await findNonCanonicalPda({
      program: PROGRAM,
      authority: address(WALLET.publicKey.toBase58()),
      seed: "idl",
    });

    const result = await run(setup);

    expect(result).toEqual({ metadata: own, action: "created" });
    expect(tracked.events).toEqual([
      {
        name: "idl_upload_started",
        params: { target: "metadata", cluster: "devnet" },
      },
      {
        name: "idl_uploaded",
        params: { target: "metadata", cluster: "devnet" },
      },
    ]);
    const [initialize] = instructionsFor(PROGRAM_METADATA_PROGRAM_ADDRESS)(
      setup.connection.sent[0]
    ).filter(({ data }) => data[0] === INITIALIZE_DISCRIMINATOR);
    // The Program Metadata program's own address stands for an account an instruction leaves out
    expect(initialize.accounts).toEqual([
      own,
      WALLET.publicKey.toBase58(),
      PROGRAM,
      PROGRAM_METADATA_PROGRAM_ADDRESS,
      "11111111111111111111111111111111",
    ]);
  });

  it.each([
    {
      label: "the given price",
      upload: uploadProjectIdlWith(7n),
      price: 7n,
    },
    {
      label: "no price for a price of zero",
      upload: uploadProjectIdlWith(0n),
      price: undefined,
    },
    {
      label:
        "the default of the command-line client Anchor runs when no price is given",
      upload: uploadProjectIdl,
      price: 100_000n,
    },
  ])(
    "sets $label in every transaction of an upload",
    async ({ upload, price }) => {
      const setup = await arrange();
      setup.source = projectIdl(idlWith(noise(2500)));
      setup.upload = upload;

      await run(setup);

      expect(setup.connection.sent.length).toBeGreaterThan(1);
      expect(pricesOf(setup.connection.sent)).toEqual(
        setup.connection.sent.map(() => price)
      );
    }
  );
});
