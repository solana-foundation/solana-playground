// Loaded by `utils/settings.ts` before everything else, so this file only
// imports modules whose own imports end at `shared/config/client-env`, which
// imports nothing.
import { Endpoint, PLATFORM_ENDPOINTS } from "../constants/connection";
import type { PlatformEndpoint } from "../constants/connection";
import { SERVER_URL } from "../shared/config/client-env";
import {
  FOUNDATION_ENDPOINT,
  LOCAL_ENDPOINT,
  SOLPG_ENDPOINT,
} from "./server/default-endpoint";

/** The settings whose value is an address */
const ENDPOINT_SETTINGS = ["connection.endpoint", "server.endpoint"] as const;

type EndpointSettingId = typeof ENDPOINT_SETTINGS[number];

/** An address we provide, under a key that does not change with it */
interface EndpointOption {
  key: string;
  url: string;
}

export type EndpointOptions = Record<
  EndpointSettingId,
  ReadonlyArray<EndpointOption>
>;

/**
 * An endpoint as `localStorage` holds it: the option's key for an address
 * we provide, the address itself only for a custom one.
 */
type StoredEndpoint = { option: string } | { option: "custom"; url: string };

/**
 * Every address we provide, keyed.
 *
 * @param platform the platform RPC endpoints the env configures
 * @param configuredServer the build server `REACT_APP_SERVER_URL` names, if
 * any -- ours too, so it follows the env like the rest
 */
export const buildEndpointOptions = (
  platform: ReadonlyArray<PlatformEndpoint>,
  configuredServer?: string
): EndpointOptions => ({
  "connection.endpoint": [
    { key: "playnet", url: Endpoint.PLAYNET },
    { key: "localnet", url: Endpoint.LOCALNET },
    { key: "devnet", url: Endpoint.DEVNET },
    { key: "testnet", url: Endpoint.TESTNET },
    { key: "mainnet-beta", url: Endpoint.MAINNET_BETA },
    ...platform.map((p) => ({ key: `${p.cluster}-platform`, url: p.value })),
  ],
  "server.endpoint": [
    // First, so a profile on the configured server follows the env even
    // when the env names a listed one -- production sets it to the
    // Foundation's (`Dockerfile`). A listed option picked by hand that
    // equals it follows the env too; it was the default anyway.
    ...(configuredServer ? [{ key: "configured", url: configuredServer }] : []),
    { key: "foundation", url: FOUNDATION_ENDPOINT },
    { key: "local", url: LOCAL_ENDPOINT },
    { key: "solpg", url: SOLPG_ENDPOINT },
  ],
});

const ENDPOINT_OPTIONS = buildEndpointOptions(PLATFORM_ENDPOINTS, SERVER_URL);

type State = Record<string, unknown>;

/** Replace one setting's value, if the state has it */
const mapSetting = <T extends State>(
  state: T,
  id: EndpointSettingId,
  map: (value: unknown) => unknown
): T => {
  const [group, field] = id.split(".");
  const inner = state[group] as State | undefined;
  if (!inner || !(field in inner)) return state;

  return { ...state, [group]: { ...inner, [field]: map(inner[field]) } };
};

const defaultOf = (defaults: State, id: EndpointSettingId) => {
  const [group, field] = id.split(".");
  return (defaults[group] as State | undefined)?.[field];
};

/**
 * Settings as they go into `localStorage`: an address we provide becomes
 * its option's key, so rotating it in the env reaches every profile.
 *
 * @param state the settings in memory
 * @param options the addresses we provide
 */
export const toStoredEndpoints = (
  state: State,
  options: EndpointOptions = ENDPOINT_OPTIONS
): State =>
  ENDPOINT_SETTINGS.reduce(
    (acc, id) =>
      mapSetting(acc, id, (url): StoredEndpoint => {
        const known = options[id].find((o) => o.url === url);
        return known
          ? { option: known.key }
          : { option: "custom", url: url as string };
      }),
    state
  );

/**
 * Settings as they come out of `localStorage`, with every endpoint an
 * address again.
 *
 * A key resolves to the address the env provides now; a key whose option
 * is gone falls back to the default. A custom address, and a plain string
 * written before endpoints were stored as keys, come back untouched -- a
 * custom address may carry the user's own API token.
 *
 * @param stored the settings `localStorage` holds
 * @param defaults the default settings
 * @param options the addresses we provide
 */
export const fromStoredEndpoints = <T extends State>(
  stored: T,
  defaults: State,
  options: EndpointOptions = ENDPOINT_OPTIONS
): T =>
  ENDPOINT_SETTINGS.reduce(
    (acc, id) =>
      mapSetting(acc, id, (value) => {
        if (typeof value === "string") return value;

        const { option, url } = (value ?? {}) as {
          option?: string;
          url?: string;
        };
        if (option === "custom" && typeof url === "string") return url;

        const known = options[id].find((o) => o.key === option);
        return known ? known.url : defaultOf(defaults, id);
      }),
    stored
  );

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;
  describe("settings/stored-endpoint", () => {
    let SERVER_ENDPOINT_OPTIONS: typeof import("./server/default-endpoint").SERVER_ENDPOINT_OPTIONS;
    beforeAll(async () => {
      ({ SERVER_ENDPOINT_OPTIONS } = await import("./server/default-endpoint"));
    });
    const PLATFORM_DEVNET = "https://devnet.rpc.test/?api-key=old";

    const options = buildEndpointOptions([
      { name: "Devnet (Platform)", value: PLATFORM_DEVNET, cluster: "devnet" },
    ]);

    const defaults = {
      connection: {
        endpoint: Endpoint.DEVNET as string,
        commitment: "confirmed",
      },
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
          expect(roundTrip(state(Endpoint.DEVNET, url)).server.endpoint).toBe(
            url
          );
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
        expect(
          fromStoredEndpoints(stored, defaults, moved).server.endpoint
        ).toBe("https://build.test/b");
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
        expect(
          fromStoredEndpoints(stored, defaults, moved).server.endpoint
        ).toBe("https://build.test/new");
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
        expect(fromStoredEndpoints(partial, defaults, options)).toEqual(
          partial
        );
      });
    });
  });
}
