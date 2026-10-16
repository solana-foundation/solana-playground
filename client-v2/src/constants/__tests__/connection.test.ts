import {
  buildPlatformEndpoints,
  Endpoint,
  resolveDefaultEndpoint,
} from "../connection";
import type { PlatformEndpoint } from "../connection";

describe("buildPlatformEndpoints", () => {
  it("yields no entries when nothing is configured", () => {
    expect(buildPlatformEndpoints({})).toEqual([]);
  });

  // Sourcing an env file leaves unfilled keys as "", which is not nullish.
  it("skips empty strings", () => {
    expect(
      buildPlatformEndpoints({ devnet: "", testnet: "", mainnet: "" })
    ).toEqual([]);
  });

  it("yields one labelled entry per configured cluster, in cluster order", () => {
    expect(
      buildPlatformEndpoints({
        mainnet: "https://mainnet.example.com",
        devnet: "https://devnet.example.com",
      })
    ).toEqual([
      {
        name: "Devnet (Platform)",
        value: "https://devnet.example.com",
        cluster: "devnet",
      },
      {
        name: "Mainnet Beta (Platform)",
        value: "https://mainnet.example.com",
        cluster: "mainnet-beta",
      },
    ]);
  });

  // A duplicate URL collides on the React key and leaves `aria-checked` true
  // on two options at once.
  it("skips a URL that a native endpoint already covers", () => {
    expect(
      buildPlatformEndpoints({
        devnet: "https://devnet.example.com",
        testnet: Endpoint.TESTNET,
      })
    ).toEqual([
      {
        name: "Devnet (Platform)",
        value: "https://devnet.example.com",
        cluster: "devnet",
      },
    ]);
  });

  it("skips a URL another platform entry already used", () => {
    expect(
      buildPlatformEndpoints({
        devnet: "https://same.example.com",
        mainnet: "https://same.example.com",
      })
    ).toEqual([
      {
        name: "Devnet (Platform)",
        value: "https://same.example.com",
        cluster: "devnet",
      },
    ]);
  });

  it("keeps the native endpoints out of the list", () => {
    const values = buildPlatformEndpoints({
      devnet: "https://devnet.example.com",
    }).map((e) => e.value);
    expect(values).not.toContain(Endpoint.DEVNET);
  });
});

// Guards the `process.env` var names, which nothing else would catch: a typo
// there just yields an empty list.
describe("env wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads REACT_APP_<CLUSTER>_RPC_URL", async () => {
    vi.stubEnv("REACT_APP_DEVNET_RPC_URL", "https://devnet.example.com");
    vi.stubEnv("REACT_APP_TESTNET_RPC_URL", "https://testnet.example.com");
    vi.stubEnv("REACT_APP_MAINNET_RPC_URL", "https://mainnet.example.com");

    vi.resetModules();
    const mod = await import("../connection");

    expect(
      mod.PLATFORM_ENDPOINTS.map((e: PlatformEndpoint) => e.value)
    ).toEqual([
      "https://devnet.example.com",
      "https://testnet.example.com",
      "https://mainnet.example.com",
    ]);
    expect(mod.DEFAULT_ENDPOINT).toBe("https://devnet.example.com");
  });

  it("adds nothing and keeps the native default when unset", async () => {
    vi.stubEnv("REACT_APP_DEVNET_RPC_URL", undefined);
    vi.stubEnv("REACT_APP_TESTNET_RPC_URL", undefined);
    vi.stubEnv("REACT_APP_MAINNET_RPC_URL", undefined);

    vi.resetModules();
    const mod = await import("../connection");

    expect(mod.PLATFORM_ENDPOINTS).toEqual([]);
    expect(mod.DEFAULT_ENDPOINT).toBe(Endpoint.DEVNET);
  });
});

describe("resolveDefaultEndpoint", () => {
  it("falls back to the native devnet endpoint", () => {
    expect(resolveDefaultEndpoint(undefined)).toBe(Endpoint.DEVNET);
    expect(resolveDefaultEndpoint("")).toBe(Endpoint.DEVNET);
  });

  it("prefers the platform devnet endpoint", () => {
    expect(resolveDefaultEndpoint("https://devnet.example.com")).toBe(
      "https://devnet.example.com"
    );
  });
});
