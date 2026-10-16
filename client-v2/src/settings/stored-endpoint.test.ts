import { Endpoint } from "../constants/connection";
import {
  FOUNDATION_ENDPOINT,
  LOCAL_ENDPOINT,
  SERVER_ENDPOINT_OPTIONS,
  SOLPG_ENDPOINT,
} from "./server/default-endpoint";
import {
  buildEndpointOptions,
  fromStoredEndpoints,
  toStoredEndpoints,
} from "./stored-endpoint";

const PLATFORM_DEVNET = "https://devnet.rpc.test/?api-key=old";

const options = buildEndpointOptions([
  { name: "Devnet (Platform)", value: PLATFORM_DEVNET, cluster: "devnet" },
]);

const defaults = {
  connection: { endpoint: Endpoint.DEVNET as string, commitment: "confirmed" },
  server: { endpoint: FOUNDATION_ENDPOINT },
  ui: { theme: "Solana" },
};

const state = (connection: string, server: string) => ({
  ...defaults,
  connection: { ...defaults.connection, endpoint: connection },
  server: { endpoint: server },
});

/** One setting's value in a stored state, e.g. `at(s, "server.endpoint")` */
const at = (s: Record<string, unknown>, id: string) => {
  const [group, field] = id.split(".");
  return (s[group] as Record<string, unknown>)[field];
};

/** Write, then read back, as `utils/settings.ts` storage does */
const roundTrip = (s: typeof defaults, opts = options) =>
  fromStoredEndpoints(
    JSON.parse(JSON.stringify(toStoredEndpoints(s, opts))),
    defaults,
    opts
  );

describe("stored endpoints", () => {
  it("stores an address we provide as the option's key, not the address", () => {
    const stored = toStoredEndpoints(
      state(PLATFORM_DEVNET, FOUNDATION_ENDPOINT),
      options
    );

    expect(at(stored, "connection.endpoint")).toEqual({
      option: "devnet-platform",
    });
    expect(at(stored, "server.endpoint")).toEqual({ option: "foundation" });
    expect(JSON.stringify(stored)).not.toContain("api-key");
  });

  it("round-trips every option we provide", () => {
    for (const { url } of options["connection.endpoint"]) {
      expect(
        roundTrip(state(url, FOUNDATION_ENDPOINT)).connection.endpoint
      ).toBe(url);
    }
    for (const { url } of options["server.endpoint"]) {
      expect(roundTrip(state(Endpoint.DEVNET, url)).server.endpoint).toBe(url);
    }
  });

  it("resolves a stored option to the address the env provides now", () => {
    const stored = JSON.parse(
      JSON.stringify(
        toStoredEndpoints(state(PLATFORM_DEVNET, SOLPG_ENDPOINT), options)
      )
    );
    const rotated = buildEndpointOptions([
      {
        name: "Devnet (Platform)",
        value: "https://devnet.rpc.test/?api-key=new",
        cluster: "devnet",
      },
    ]);

    expect(
      fromStoredEndpoints(stored, defaults, rotated).connection.endpoint
    ).toBe("https://devnet.rpc.test/?api-key=new");
  });

  it("keys the build server the env configures, and follows it", () => {
    const configured = buildEndpointOptions([], "https://build.test/a");
    const stored = JSON.parse(
      JSON.stringify(
        toStoredEndpoints(
          state(Endpoint.DEVNET, "https://build.test/a"),
          configured
        )
      )
    );

    expect(at(stored, "server.endpoint")).toEqual({ option: "configured" });
    const moved = buildEndpointOptions([], "https://build.test/b");
    expect(fromStoredEndpoints(stored, defaults, moved).server.endpoint).toBe(
      "https://build.test/b"
    );
  });

  it("keys every address the pickers offer, so none is stored as custom", () => {
    const keyed = (id: keyof typeof options, url: string) =>
      options[id].some((o) => o.url === url);

    for (const url of Object.values(Endpoint)) {
      expect(keyed("connection.endpoint", url)).toBe(true);
    }
    expect(keyed("connection.endpoint", PLATFORM_DEVNET)).toBe(true);
    for (const { value } of SERVER_ENDPOINT_OPTIONS) {
      expect(keyed("server.endpoint", value)).toBe(true);
    }
  });

  it("stores the configured build server as `configured` even when it is a listed one", () => {
    // Production sets REACT_APP_SERVER_URL to the Foundation's server
    // (`Dockerfile`); a profile on it must follow the env when it moves
    const configured = buildEndpointOptions([], FOUNDATION_ENDPOINT);
    const stored = JSON.parse(
      JSON.stringify(
        toStoredEndpoints(
          state(Endpoint.DEVNET, FOUNDATION_ENDPOINT),
          configured
        )
      )
    );

    expect(at(stored, "server.endpoint")).toEqual({ option: "configured" });
    const moved = buildEndpointOptions([], "https://build.test/new");
    expect(fromStoredEndpoints(stored, defaults, moved).server.endpoint).toBe(
      "https://build.test/new"
    );
  });

  it("falls back to the default build server when its stored option is gone", () => {
    const configured = buildEndpointOptions([], "https://build.test/a");
    const stored = JSON.parse(
      JSON.stringify(
        toStoredEndpoints(
          state(Endpoint.DEVNET, "https://build.test/a"),
          configured
        )
      )
    );

    const unconfigured = buildEndpointOptions([]);
    expect(
      fromStoredEndpoints(stored, defaults, unconfigured).server.endpoint
    ).toBe(defaults.server.endpoint);
  });

  it("re-keys a legacy string that is one of our addresses, keeps an unknown one custom", () => {
    const legacy = state(PLATFORM_DEVNET, "https://unknown.test/");
    const stored = toStoredEndpoints(
      fromStoredEndpoints(legacy, defaults, options),
      options
    );

    expect(at(stored, "connection.endpoint")).toEqual({
      option: "devnet-platform",
    });
    expect(at(stored, "server.endpoint")).toEqual({
      option: "custom",
      url: "https://unknown.test/",
    });
  });

  it("falls back to the default when a stored option is gone", () => {
    const stored = JSON.parse(
      JSON.stringify(
        toStoredEndpoints(state(PLATFORM_DEVNET, LOCAL_ENDPOINT), options)
      )
    );
    const withoutPlatform = buildEndpointOptions([]);

    const read = fromStoredEndpoints(stored, defaults, withoutPlatform);
    expect(read.connection.endpoint).toBe(defaults.connection.endpoint);
    expect(read.server.endpoint).toBe(LOCAL_ENDPOINT);
  });

  it("keeps a custom address byte for byte, token and all", () => {
    const custom = "https://my.rpc.test/v1/?token=s3cr3t&x=%20y";
    const stored = toStoredEndpoints(
      state(custom, "http://10.0.0.5:8080"),
      options
    );

    expect(at(stored, "connection.endpoint")).toEqual({
      option: "custom",
      url: custom,
    });
    expect(
      roundTrip(state(custom, "http://10.0.0.5:8080")).connection.endpoint
    ).toBe(custom);
    expect(
      roundTrip(state(custom, "http://10.0.0.5:8080")).server.endpoint
    ).toBe("http://10.0.0.5:8080");
  });

  it("reads an address stored as a plain string as a custom one", () => {
    // What a profile written before this change holds; not migrated
    const legacy = state(PLATFORM_DEVNET, LOCAL_ENDPOINT);

    const read = fromStoredEndpoints(legacy, defaults, options);
    expect(read.connection.endpoint).toBe(PLATFORM_DEVNET);
    expect(read.server.endpoint).toBe(LOCAL_ENDPOINT);
  });

  it("leaves every other setting alone", () => {
    const s = state(Endpoint.MAINNET_BETA, FOUNDATION_ENDPOINT);
    const stored = toStoredEndpoints(s, options);

    expect(stored.ui).toEqual(s.ui);
    expect(at(stored, "connection.commitment")).toBe("confirmed");
    expect(roundTrip(s)).toEqual(s);
  });

  it("passes a state without these settings through untouched", () => {
    const partial = { ui: { theme: "Solana" } };

    expect(toStoredEndpoints(partial, options)).toEqual(partial);
    expect(fromStoredEndpoints(partial, defaults, options)).toEqual(partial);
  });
});
