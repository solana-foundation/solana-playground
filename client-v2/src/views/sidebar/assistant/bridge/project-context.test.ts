import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { afterEach, describe, expect, it, vi } from "vitest";

/** A custom RPC whose URL carries an API key, as providers hand them out */
const RPC_KEY = "k3y-0f-the-rpc-provider";
const KEYED_RPC = `https://rpc.provider.test/v1/?api-key=${RPC_KEY}`;

const state = vi.hoisted(() => ({
  endpoint: "",
  cluster: null as string | null,
  clusterIsStale: false,
  accounts: [] as { kp: number[]; name: string }[],
  currentIndex: -1,
  current: null as unknown,
  standardWallets: [] as unknown[],
}));

vi.mock("../../../../utils", async () => {
  const { Keypair: Kp } = await import("@solana/web3.js");
  return {
    PgBlockExplorer: {},
    PgCommand: {},
    PgConnection: {
      get current() {
        return { rpcEndpoint: state.endpoint };
      },
      get cluster() {
        return state.cluster;
      },
      get clusterIsStale() {
        return state.clusterIsStale;
      },
    },
    PgExplorer: {
      currentWorkspaceName: "counter",
      currentFilePath: undefined,
      tabs: [],
      getAllFiles: () => [],
      onDidDeleteItem: () => {},
      onDidMoveItem: () => {},
    },
    PgGlobal: { deployState: "ready" },
    PgProgramInfo: { getPkStr: () => undefined, readIdl: () => undefined, callableIdl: () => undefined },
    PgWallet: {
      get accounts() {
        return state.accounts;
      },
      get currentIndex() {
        return state.currentIndex;
      },
      get current() {
        return state.current;
      },
      getConnectedStandardWallets: () => state.standardWallets,
      create: (account: { kp: number[]; name: string }) => {
        const keypair = Kp.fromSecretKey(Uint8Array.from(account.kp));
        return { isPg: true, keypair, publicKey: keypair.publicKey };
      },
    },
  };
});
vi.mock("./build-output", () => ({
  PgBuildOutput: { latest: undefined },
  stripKnownNoise: (s: string) => s,
}));
// `prompt.ts` reads the store for skills and servers; none matter here
vi.mock("../store", () => ({
  PgAssistant: { enabledSkills: [], mcpServers: [] },
}));

import { describeProjectWith } from "../model/prompt";
import { realBridge } from "./playground-bridge";

const playground = Keypair.generate();
const external = Keypair.generate();

/** A wallet connected through ConnectorKit, as `PgWallet` holds it */
const standardWallet = {
  isPg: false,
  connected: true,
  publicKey: external.publicKey,
};

/** Every spelling of the Playground secret key a payload could carry */
const secretSpellings = () => {
  const secret = playground.secretKey;
  return [
    bs58.encode(secret),
    Buffer.from(secret).toString("base64"),
    Buffer.from(secret).toString("hex"),
    JSON.stringify(Array.from(secret)),
    Array.from(secret).join(","),
    // The private half alone, which is what signs
    bs58.encode(secret.slice(0, 32)),
    Buffer.from(secret.slice(0, 32)).toString("hex"),
  ];
};

/** Everything of the project that reaches the model, both as data and as the prompt text */
const payload = () =>
  `${JSON.stringify(realBridge.getProjectContext())}\n${describeProjectWith(
    realBridge
  )}`;

const onPlaygroundWallet = () => {
  state.accounts = [{ kp: Array.from(playground.secretKey), name: "Wallet 1" }];
  state.currentIndex = 0;
  state.current = {
    isPg: true,
    keypair: playground,
    publicKey: playground.publicKey,
  };
  state.standardWallets = [];
};

const onConnectedWallet = () => {
  onPlaygroundWallet();
  state.current = standardWallet;
  state.standardWallets = [standardWallet];
};

describe("what the assistant learns of the connection", () => {
  afterEach(() => {
    state.endpoint = "";
    state.cluster = null;
    state.clusterIsStale = false;
  });

  it.each([
    ["https://api.devnet.solana.com", "devnet"],
    ["https://api.mainnet-beta.solana.com", "mainnet-beta"],
    ["https://api.testnet.solana.com", "testnet"],
    ["http://localhost:8899", "localnet"],
  ])("names the cluster of %s as %s", (endpoint, cluster) => {
    state.endpoint = endpoint;
    expect(realBridge.getProjectContext().cluster).toBe(cluster);
  });

  it("names the cluster a custom RPC's genesis hash resolved to", () => {
    state.endpoint = KEYED_RPC;
    state.cluster = "devnet";
    expect(realBridge.getProjectContext().cluster).toBe("devnet");
  });

  it("calls a custom RPC on no known cluster custom", () => {
    state.endpoint = KEYED_RPC;
    state.cluster = null;
    expect(realBridge.getProjectContext().cluster).toBe("custom");
  });

  it("calls a custom RPC still being read custom, not the previous cluster", () => {
    state.endpoint = KEYED_RPC;
    state.cluster = "mainnet-beta";
    state.clusterIsStale = true;
    expect(realBridge.getProjectContext().cluster).toBe("custom");
  });

  it.each([
    ["on a known cluster", "devnet"],
    ["on no known cluster", null],
  ])(
    "never sends the address of a custom RPC or its key, %s",
    (_, cluster) => {
      state.endpoint = KEYED_RPC;
      state.cluster = cluster;
      onPlaygroundWallet();
      const sent = payload();
      expect(sent).not.toContain(RPC_KEY);
      expect(sent).not.toContain("rpc.provider.test");
    }
  );

  it("says in the prompt which cluster the app is on", () => {
    state.endpoint = KEYED_RPC;
    state.cluster = "devnet";
    expect(describeProjectWith(realBridge)).toContain("Cluster: devnet");
  });
});

describe("what the assistant learns of the wallets", () => {
  it("knows the Playground wallet's public key, which signs", () => {
    onPlaygroundWallet();
    const prompt = describeProjectWith(realBridge);
    expect(prompt).toContain(
      `Playground wallet: ${playground.publicKey.toBase58()}`
    );
    expect(prompt).toContain("Connected wallet: none");
    expect(prompt).toContain(
      `Signing wallet: ${playground.publicKey.toBase58()} (the Playground wallet)`
    );
  });

  it("knows the address of a wallet connected through ConnectorKit, which then signs", () => {
    onConnectedWallet();
    const prompt = describeProjectWith(realBridge);
    expect(prompt).toContain(
      `Playground wallet: ${playground.publicKey.toBase58()}`
    );
    expect(prompt).toContain(
      `Connected wallet: ${external.publicKey.toBase58()}`
    );
    expect(prompt).toContain(
      `Signing wallet: ${external.publicKey.toBase58()} (the connected wallet)`
    );
  });

  it("says no wallet signs while none is connected", () => {
    state.accounts = [];
    state.currentIndex = -1;
    state.current = null;
    state.standardWallets = [];
    const prompt = describeProjectWith(realBridge);
    expect(prompt).toContain("Playground wallet: none");
    expect(prompt).toContain("Signing wallet: none");
  });

  it.each([
    ["the Playground wallet signs", onPlaygroundWallet],
    ["a connected wallet signs", onConnectedWallet],
  ])("never sends a secret key while %s", (_, setUp) => {
    setUp();
    const sent = payload();
    for (const spelling of secretSpellings()) {
      expect(sent).not.toContain(spelling);
    }
  });

  it("hands over the keys as strings, never a wallet or key object", () => {
    onConnectedWallet();
    const { wallets } = realBridge.getProjectContext();
    expect(wallets).toEqual({
      playground: playground.publicKey.toBase58(),
      connected: [external.publicKey.toBase58()],
      signing: external.publicKey.toBase58(),
    });
  });
});
