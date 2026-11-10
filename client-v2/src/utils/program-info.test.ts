import { initLogger, memoryProvider, resetLogger } from "../shared/lib/logger";
import { PgExplorer } from "./explorer";
import { writeWorkspaceFile } from "./explorer/workspace-file";
import { PgProgramInfo } from "./program-info";
import { PgWeb3 } from "./web3";

// `settings.ts`, reached through the connection module, reads a global that
// only exists once the app has booted
vi.hoisted(() => {
  vi.stubGlobal("GLOBAL_SETTINGS", { default: {} });
});

// The wasm packages are built separately and absent from a plain checkout
vi.mock("./package", () => ({ PgPackage: {} }));

// Only their change events are read, to refetch the on-chain data
vi.mock("./command", () => ({
  PgCommand: { deploy: { onDidFinish: () => ({ dispose: () => {} }) } },
}));
// `fetch` reads the program through `current`; each test sets the answers
const rpc = vi.hoisted(() => ({ getAccountInfo: vi.fn() }));
vi.mock("./connection", () => ({
  PgConnection: {
    onDidChange: () => ({ dispose: () => {} }),
    current: rpc,
    isReady: () => true,
  },
}));

// Its own tests cover when it flushes and which folders it creates
vi.mock("./explorer/workspace-file", () => ({
  writeWorkspaceFile: vi.fn(async () => {}),
}));

describe("PgProgramInfo storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves through writeWorkspaceFile, which keeps a new file across a reload", async () => {
    vi.spyOn(PgExplorer, "isInitialized", "get").mockReturnValue(true);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("w");
    vi.spyOn(PgExplorer.fs, "readToJSON").mockRejectedValue(new Error("none"));
    const write = vi.mocked(writeWorkspaceFile);

    const init = await PgProgramInfo.init();
    try {
      await PgProgramInfo.refresh();
      write.mockClear();

      PgProgramInfo.uuid = "build-1";
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    } finally {
      init.dispose();
    }

    expect(write.mock.calls[0][0]).toBe(".workspace/program-info.json");
    expect(JSON.parse(write.mock.calls[0][1]).uuid).toBe("build-1");
  });

  it("reports a write that fails rather than leaving it unhandled", async () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    vi.spyOn(PgExplorer, "isInitialized", "get").mockReturnValue(true);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("w");
    vi.spyOn(PgExplorer.fs, "readToJSON").mockRejectedValue(new Error("none"));
    const write = vi.mocked(writeWorkspaceFile);

    const init = await PgProgramInfo.init();
    try {
      await PgProgramInfo.refresh();
      write.mockClear();
      write.mockRejectedValueOnce(new Error("disk full"));

      // `updatable` calls `storage.write` without awaiting it, so a failure
      // must be caught and logged inside it, or it is an unhandled rejection
      PgProgramInfo.uuid = "build-1";
      await vi.waitFor(() => expect(write).toHaveBeenCalled());
      await vi.waitFor(() => expect(logged.entries).toHaveLength(1));
      expect(logged.entries[0].ns).toBe("program-info:storage");
      expect(logged.entries[0].error?.message).toBe("disk full");
      expect(logged.entries[0].report).toBe(true);
    } finally {
      init.dispose();
      resetLogger();
    }
  });
});

describe("PgProgramInfo.fetch", () => {
  const programId = PgWeb3.Keypair.generate().publicKey;
  const programDataPk = PgWeb3.Keypair.generate().publicKey;
  const authority = PgWeb3.Keypair.generate().publicKey;

  /** The upgradeable loader's program account: a tag, then the data's address */
  const programAccount = {
    owner: PgWeb3.BpfLoaderUpgradeableProgram.programId,
    data: Buffer.concat([Buffer.from([2, 0, 0, 0]), programDataPk.toBuffer()]),
  };

  /** The program data's header: tag, slot, then the authority as an option */
  const header = Buffer.concat([
    Buffer.from([3, 0, 0, 0]),
    Buffer.alloc(8),
    Buffer.from([1]),
    authority.toBuffer(),
  ]);

  afterEach(() => {
    rpc.getAccountInfo.mockReset();
  });

  it("reads only the program data's header and takes its length from the RPC's space", async () => {
    rpc.getAccountInfo
      .mockResolvedValueOnce(programAccount)
      .mockResolvedValueOnce({ data: header, space: 6_987_853 });

    const onChain = await PgProgramInfo.fetch(programId);

    expect(rpc.getAccountInfo).toHaveBeenCalledTimes(2);
    expect(rpc.getAccountInfo.mock.calls[1]).toEqual([
      programDataPk,
      { dataSlice: { offset: 0, length: 45 } },
    ]);
    expect(onChain).toEqual({
      deployed: true,
      upgradable: true,
      authority,
      programDataLen: 6_987_853,
    });
  });

  it("reads the whole program data when the RPC sends no space", async () => {
    const whole = Buffer.concat([header, Buffer.alloc(100)]);
    rpc.getAccountInfo
      .mockResolvedValueOnce(programAccount)
      .mockResolvedValueOnce({ data: header })
      .mockResolvedValueOnce({ data: whole });

    const onChain = await PgProgramInfo.fetch(programId);

    expect(rpc.getAccountInfo.mock.calls[2]).toEqual([programDataPk]);
    expect(onChain).toEqual({
      deployed: true,
      upgradable: true,
      authority,
      programDataLen: whole.length,
    });
  });
});

describe("PgProgramInfo.fetch, edge cases", () => {
  const programId = PgWeb3.Keypair.generate().publicKey;
  const programDataPk = PgWeb3.Keypair.generate().publicKey;
  const authority = PgWeb3.Keypair.generate().publicKey;
  const programAccount = {
    owner: PgWeb3.BpfLoaderUpgradeableProgram.programId,
    data: Buffer.concat([Buffer.from([2, 0, 0, 0]), programDataPk.toBuffer()]),
  };
  /** The program data's header with the authority option set to `tag` */
  const headerWith = (tag: number) =>
    Buffer.concat([
      Buffer.from([3, 0, 0, 0]),
      Buffer.alloc(8),
      Buffer.from([tag]),
      authority.toBuffer(),
    ]);

  afterEach(() => {
    rpc.getAccountInfo.mockReset();
  });

  it("reads a program with no authority as not upgradable, with one read of its data", async () => {
    rpc.getAccountInfo
      .mockResolvedValueOnce(programAccount)
      .mockResolvedValueOnce({ data: headerWith(0), space: 1000 });

    const onChain = await PgProgramInfo.fetch(programId);

    expect(onChain).toEqual({ deployed: true, upgradable: false });
    expect(rpc.getAccountInfo).toHaveBeenCalledTimes(2);
  });

  it("answers as for no program data when the account closes between the reads", async () => {
    rpc.getAccountInfo
      .mockResolvedValueOnce(programAccount)
      .mockResolvedValueOnce({ data: headerWith(1) })
      // eslint-disable-next-line unicorn/no-null -- web3.js answers a missing account with null
      .mockResolvedValueOnce(null);

    const onChain = await PgProgramInfo.fetch(programId);

    expect(onChain).toEqual({ deployed: true, upgradable: true });
  });

  it("reads the whole program data when the RPC's space is not a usable length", async () => {
    const whole = Buffer.concat([headerWith(1), Buffer.alloc(10)]);
    for (const space of ["123", 0]) {
      rpc.getAccountInfo
        .mockReset()
        .mockResolvedValueOnce(programAccount)
        .mockResolvedValueOnce({ data: headerWith(1), space })
        .mockResolvedValueOnce({ data: whole });

      const onChain = await PgProgramInfo.fetch(programId);

      expect(onChain).toEqual({
        deployed: true,
        upgradable: true,
        authority,
        programDataLen: whole.length,
      });
    }
  });
});

describe("PgProgramInfo.onChain", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays unknown, not failed, while there is no program id", async () => {
    vi.spyOn(PgExplorer, "isInitialized", "get").mockReturnValue(true);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("w");
    vi.spyOn(PgExplorer.fs, "readToJSON").mockRejectedValue(new Error("none"));

    const init = await PgProgramInfo.init();
    try {
      await PgProgramInfo.refresh();
      // A failed fetch is `null`, which Interact reads as "can't reach the
      // network"; with no id there was nothing to fetch. The wait lets the
      // derivation, which runs on a zero-delay debounce, settle first
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(PgProgramInfo.pk).toBeFalsy();
      expect(PgProgramInfo.onChain).toBeUndefined();
    } finally {
      init.dispose();
    }
  });
});
