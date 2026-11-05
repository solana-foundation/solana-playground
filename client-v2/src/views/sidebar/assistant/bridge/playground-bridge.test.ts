import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PATH = "/project/src/lib.rs";

/** The Monaco model of the file, which the user types into */
const { model, explorer } = vi.hoisted(() => {
  const buffer = {
    uri: { path: "/project/src/lib.rs" },
    text: "",
    getValue: () => buffer.text,
    setValue: (text: string) => {
      buffer.text = text;
    },
  };
  const pgExplorer = {
    convertToFullPath: (path: string) => path,
    getFileContent: vi.fn(),
    createItem: vi.fn(),
    onDidDeleteItem: vi.fn(),
    onDidMoveItem: vi.fn(),
    editorBuffers: {
      read: (path: string) =>
        path === "/project/src/lib.rs" ? buffer.text : undefined,
      write: () => {},
      discard: () => {},
    },
  };
  return { model: buffer, explorer: pgExplorer };
});

vi.mock("monaco-editor", () => ({
  editor: { getModels: () => [model] },
}));

const mocks = vi.hoisted(() => ({
  cluster: "devnet" as string | undefined,
  deployState: "ready",
  execute: vi.fn(),
  wallet: undefined as undefined | { isPg?: boolean },
}));

vi.mock("../../../../utils", () => ({
  PgBlockExplorer: {},
  PgCommand: { deploy: { execute: mocks.execute } },
  PgConnection: {
    get cluster() {
      return mocks.cluster;
    },
  },
  PgExplorer: explorer,
  PgGlobal: {
    get deployState() {
      return mocks.deployState;
    },
  },
  PgProgramInfo: {},
  PgWallet: {
    get current() {
      return mocks.wallet;
    },
  },
}));
vi.mock("../../../../commands/deploy/estimate", () => ({
  estimateDeployCostWithin: async () => 1_420_000_000,
}));
vi.mock("./build-output", () => ({
  PgBuildOutput: {},
  stripKnownNoise: (s: string) => s,
}));

import { realBridge } from "./playground-bridge";

describe("realBridge", () => {
  /** What the explorer holds, which autosave updates about 500 ms after typing */
  let saved: string | undefined;

  beforeEach(() => {
    saved = "fn saved() {}";
    model.text = saved;
    explorer.getFileContent.mockImplementation(() => saved);
    explorer.createItem.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("readFile", () => {
    it("reads what the user typed before autosave has it", () => {
      model.text = "fn typed() {}";

      expect(realBridge.readFile(PATH)).toBe("fn typed() {}");
    });

    it("reads no file for a path the explorer no longer holds", () => {
      saved = undefined;

      expect(realBridge.readFile(PATH)).toBeNull();
    });
  });

  describe("applyPatch", () => {
    /** Stands in for the write, during which the user types `typed` */
    const typingDuringWrite = (typed: string) =>
      explorer.createItem.mockImplementation(async () => {
        model.text = typed;
      });

    it("puts the patch in the editor", async () => {
      explorer.createItem.mockResolvedValue(undefined);

      await realBridge.applyPatch({ path: PATH, content: "patched" });

      expect(model.text).toBe("patched");
    });

    it("folds in a line typed during the write", async () => {
      model.text = "one\ntwo\nthree\nfour\nfive";
      typingDuringWrite("one\ntwo\nthree\nfour\nfive typed");

      await realBridge.applyPatch({
        path: PATH,
        content: "ONE\ntwo\nthree\nfour\nfive",
      });

      expect(model.text).toBe("ONE\ntwo\nthree\nfour\nfive typed");
    });

    it("keeps the typing when it overlaps the patch", async () => {
      model.text = "one";
      typingDuringWrite("one typed");

      await realBridge.applyPatch({ path: PATH, content: "patched" });

      expect(model.text).toBe("one typed");
    });
  });
});

describe("realBridge.quoteDeploy", () => {
  beforeEach(() => {
    mocks.cluster = "devnet";
    mocks.wallet = undefined;
  });

  it.each([
    {
      label: "no wallet yet, so the Playground wallet will be made and pay",
      wallet: undefined,
      expected: true,
    },
    { label: "the Playground wallet", wallet: { isPg: true }, expected: true },
    { label: "a connected wallet", wallet: { isPg: false }, expected: false },
  ])("says the Playground wallet pays with $label", async (row) => {
    mocks.wallet = row.wallet;
    expect((await realBridge.quoteDeploy()).playground).toBe(row.expected);
  });

  it.each([
    ["devnet", "devnet"],
    ["mainnet-beta", "mainnet"],
    [undefined, undefined],
  ])("names %s as %s", async (cluster, network) => {
    mocks.cluster = cluster;
    expect(await realBridge.quoteDeploy()).toEqual({
      network,
      cost: 1_420_000_000,
      playground: true,
    });
  });
});

describe("realBridge.deploy", () => {
  beforeEach(() => {
    mocks.deployState = "ready";
    mocks.execute.mockReset();
  });

  it("refuses while another deploy runs, without pausing it", async () => {
    mocks.deployState = "loading";

    await expect(realBridge.deploy()).rejects.toThrow("nothing was deployed");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("calls a run that deployed nothing a failure", async () => {
    mocks.execute.mockResolvedValue(undefined);

    await expect(realBridge.deploy()).rejects.toThrow("nothing was deployed");
  });
});
