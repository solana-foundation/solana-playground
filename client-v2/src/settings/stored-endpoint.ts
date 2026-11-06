// Loaded by `utils/settings.ts` before everything else, so this file only
// imports modules whose own imports end at `shared/config/client-env`, which
// imports nothing.
import type {
  ClusterKey,
  Clusters,
  ClusterSelection,
} from "../entities/cluster/model/clusters";
import { CLUSTERS, offeredOf } from "../entities/cluster/model/clusters";
import { SERVER_URL } from "../shared/config/client-env";
import {
  FOUNDATION_ENDPOINT,
  LOCAL_ENDPOINT,
  throughRoute,
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
 * The first entry for a key is what the key reads back as; the first entry
 * for an address is the key it is stored under. So the offered networks come
 * first, each under its own key (the cluster, or `surfpool`), and a profile
 * on a public URL or under a platform key the network list no longer offers
 * reads back as the offered network.
 *
 * @param clusters every endpoint of ours ({@link CLUSTERS})
 * @param configuredServer the build server `REACT_APP_SERVER_URL` names, if
 * any -- ours too, so it follows the env like the rest
 */
export const buildEndpointOptions = (
  clusters: Clusters,
  configuredServer?: string
): EndpointOptions => {
  const offered = offeredOf(clusters);
  // The chips a platform RPC can take: Mainnet, Devnet and Testnet
  const remote = offered.filter((c) => c.cluster !== "localnet");
  return {
    "connection.endpoint": [
      ...offered.map((c) => ({ key: c.key, url: c.url })),
      // The public URLs, stored under the offered network's key
      ...remote.map((c) => ({ key: c.key, url: c.publicUrl })),
      // Keys the platform options were stored under before HOO-2488
      ...remote.map((c) => ({ key: `${c.key}-platform`, url: c.url })),
      // Not offered, still keyed: code paths set Playnet
      ...Object.values(clusters)
        .filter((c) => !c.isOffered)
        .map((c) => ({ key: c.key, url: c.url })),
    ],
    "server.endpoint": [
      // First, so a profile on the configured server follows the env even
      // when the env names a listed one -- production sets it to the
      // Foundation's (`Dockerfile`). A listed option picked by hand that
      // equals it follows the env too; it was the default anyway.
      ...(configuredServer
        ? [{ key: "configured", url: configuredServer }]
        : []),
      { key: "foundation", url: FOUNDATION_ENDPOINT },
      { key: "local", url: LOCAL_ENDPOINT },
      // No `solpg` (api.solpg.io): a profile stored under that key reads as
      // the default, like any key whose option is gone (`fromStoredEndpoints`)
    ],
  };
};

const ENDPOINT_OPTIONS = buildEndpointOptions(
  CLUSTERS,
  throughRoute(SERVER_URL)
);

const isClusterKey = (key: string): key is ClusterKey =>
  Object.hasOwn(CLUSTERS, key);

/**
 * What a connection endpoint is stored as: the key of the first entry with
 * its address, where that key reads back as the same address. An address
 * whose key reads back as another one is custom: the public Devnet picked as
 * a custom RPC beside Devnet on a platform RPC (HOO-2690) must stay the
 * public one after a reload.
 */
const selectionOfWith =
  (options: ReadonlyArray<EndpointOption>) =>
  (url: string): ClusterSelection => {
    const known = options.find((o) => o.url === url);
    const readsBack =
      known && options.find((o) => o.key === known.key)?.url === url;
    return readsBack && isClusterKey(known.key)
      ? { key: known.key }
      : { cluster: "custom", url };
  };

/** What a build server is stored as, by the same reads-back rule */
const storedServerWith =
  (options: ReadonlyArray<EndpointOption>) =>
  (url: string): StoredEndpoint => {
    const known = options.find((o) => o.url === url);
    const readsBack =
      known && options.find((o) => o.key === known.key)?.url === url;
    return readsBack ? { option: known.key } : { option: "custom", url };
  };

type State = Record<string, unknown>;

/** Whether a parsed value is a plain object, the shape every settings group has */
const isRecord = (value: unknown): value is State =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Replace one setting's value, if the state has it */
const mapSetting = <T extends State>(
  state: T,
  id: EndpointSettingId,
  map: (value: unknown) => unknown
): T => {
  const [group, field] = id.split(".");
  const inner = state[group];
  // `in` throws on a primitive, and a stored group can be anything
  if (!isRecord(inner) || !(field in inner)) return state;

  return { ...state, [group]: { ...inner, [field]: map(inner[field]) } };
};

const defaultOf = (defaults: State, id: EndpointSettingId) => {
  const [group, field] = id.split(".");
  return (defaults[group] as State | undefined)?.[field];
};

/**
 * Whether a stored custom value can be handed to a connection. Keep it in
 * step with `PgCommon.isUrl`, which the custom field's `parse` applies when
 * the user types the value and which this file cannot import: a value the
 * field accepts must never read back as the default.
 */
const isAddress = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    new URL(value);
    return true;
  } catch {
    // Not an address: the caller falls back to the default
    return false;
  }
};

/**
 * Settings as they go into `localStorage`: an address we provide becomes
 * its option's key, so rotating it in the env reaches every profile; a
 * connection endpoint goes through its {@link ClusterSelection}, so only a
 * custom RPC stores a URL.
 *
 * @param state the settings in memory
 * @param options the addresses we provide
 */
export const toStoredEndpoints = (
  state: State,
  options: EndpointOptions = ENDPOINT_OPTIONS
): State => {
  const selectionOf = selectionOfWith(options["connection.endpoint"]);
  const withConnection = mapSetting(
    state,
    "connection.endpoint",
    (url): StoredEndpoint => {
      const selection = selectionOf(url as string);
      return "url" in selection
        ? { option: "custom", url: selection.url }
        : { option: selection.key };
    }
  );
  return mapSetting(withConnection, "server.endpoint", (url) =>
    storedServerWith(options["server.endpoint"])(url as string)
  );
};

/**
 * Settings as they come out of `localStorage`, with every endpoint an
 * address again.
 *
 * A key resolves to the address the env provides now; a key whose option
 * is gone falls back to the default. A plain string written before
 * endpoints were stored as keys resolves the same way when it is one of our
 * addresses; a custom address that parses comes back untouched -- it may
 * carry the user's own API token. Anything that is not an address (a
 * corrupted entry, a custom one whose URL does not parse) falls back to the
 * default too: the offered Devnet for the RPC, the default build server for
 * the server, so a broken profile still lands somewhere that works. The
 * Foundation's server's own host, which now refuses the browser, is read as
 * the route in front of it, whether stored as a string or a custom address.
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
        const moved = (url: string) =>
          id === "server.endpoint" ? throughRoute(url) : url;
        if (typeof value === "string") {
          // A plain string is either one of our addresses, read back as its
          // key resolves now (a public URL moves to the offered network), or
          // a custom one, kept as is when it parses as a URL
          const url = moved(value);
          const ours = options[id].find((o) => o.url === url);
          if (ours) {
            return options[id].find((o) => o.key === ours.key)?.url ?? url;
          }
          return url !== value || isAddress(url)
            ? url
            : defaultOf(defaults, id);
        }

        const { option, url } = (isRecord(value) ? value : {}) as {
          option?: unknown;
          url?: unknown;
        };
        if (option === "custom") {
          return isAddress(url) ? moved(url) : defaultOf(defaults, id);
        }

        const known = options[id].find((o) => o.key === option);
        return known ? known.url : defaultOf(defaults, id);
      }),
    stored
  );

/**
 * The `settings` entry of `localStorage` as an object, or the reason it is
 * not one. An entry that does not parse, or parses to something other than
 * an object, must not stop the app from starting: the caller logs the error
 * and loads the defaults.
 *
 * @param raw the entry as `localStorage` holds it
 */
export const parseStoredSettings = (raw: string): State | Error => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Handed back, not swallowed: the caller logs it
    return error instanceof Error ? error : new Error(String(error));
  }
  if (!isRecord(parsed)) {
    return new Error("The stored settings are not an object");
  }
  return parsed;
};

/**
 * Whether a stored value can stand where the defaults hold a value that is
 * not an object: `null` only where the default is `null`, and an object or
 * array only as an array in place of an array
 */
const canReplaceDefault = (fallback: unknown, value: unknown): boolean => {
  // eslint-disable-next-line unicorn/no-null -- `null` is what parsed JSON holds
  if (value === null) return fallback === null;
  if (typeof value !== "object") return true;
  return Array.isArray(fallback) && Array.isArray(value);
};

/**
 * Stored settings without the values that would break loading them, at any
 * depth: a non-object where the defaults hold an object, a `null` where the
 * default is not `null` (`setMissingDefaults` in `updatable` reads into it
 * and throws), and an object or array where the default is a primitive
 * (`handleFields` in `updatable` writes its keys onto the primitive and
 * throws). Dropped, a setting loads its default, Devnet included. A key
 * the defaults do not hold is kept as it is, for the migrations.
 *
 * Endpoints are stored as objects over string defaults, so this runs on
 * settings `fromStoredEndpoints` has already turned back into addresses.
 *
 * @param defaults the default settings
 * @param stored the settings `localStorage` holds, endpoints resolved
 */
export const dropBrokenSettingsFor =
  (defaults: State) =>
  (stored: State): State =>
    Object.fromEntries(
      Object.entries(stored).flatMap(([key, value]) => {
        const fallback = defaults[key];
        // No default: a setting since renamed, which a migration still reads
        // (`other.blockExplorer`); `removeExtraProperties` drops it after
        if (!Object.hasOwn(defaults, key)) return [[key, value]];
        if (isRecord(fallback)) {
          return isRecord(value)
            ? [[key, dropBrokenSettingsFor(fallback)(value)]]
            : [];
        }
        return canReplaceDefault(fallback, value) ? [[key, value]] : [];
      })
    );

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;
  describe("settings/stored-endpoint", () => {
    let SERVER_ENDPOINT_OPTIONS: typeof import("./server/default-endpoint").SERVER_ENDPOINT_OPTIONS;
    let FOUNDATION_DIRECT_ENDPOINT: typeof import("./server/default-endpoint").FOUNDATION_DIRECT_ENDPOINT;
    let clustersFor: typeof import("../entities/cluster/model/clusters").clustersFor;
    let options: EndpointOptions;
    let onPublicTestnet: EndpointOptions;
    beforeAll(async () => {
      ({ SERVER_ENDPOINT_OPTIONS, FOUNDATION_DIRECT_ENDPOINT } = await import(
        "./server/default-endpoint"
      ));
      ({ clustersFor } = await import("../entities/cluster/model/clusters"));
      options = buildEndpointOptions(
        networks({
          devnet: PLATFORM_DEVNET,
          mainnet: PLATFORM_MAINNET,
          testnet: PLATFORM_TESTNET,
        })
      );
      onPublicTestnet = buildEndpointOptions(
        networks({
          devnet: PLATFORM_DEVNET,
          mainnet: PLATFORM_MAINNET,
          testnet: Endpoint.TESTNET,
        })
      );
    });
    const PLATFORM_DEVNET = "https://devnet.rpc.test/?api-key=old";
    const PLATFORM_MAINNET = "https://mainnet.rpc.test/?api-key=old";
    const PLATFORM_TESTNET = "https://testnet.rpc.test/?api-key=old";

    /** Each endpoint's public URL, which no env changes */
    const Endpoint = {
      PLAYNET: CLUSTERS.playnet.publicUrl,
      LOCALNET: CLUSTERS.localnet.publicUrl,
      SURFPOOL: CLUSTERS.surfpool.publicUrl,
      DEVNET: CLUSTERS.devnet.publicUrl,
      TESTNET: CLUSTERS.testnet.publicUrl,
      MAINNET_BETA: CLUSTERS["mainnet-beta"].publicUrl,
    };

    /** Every endpoint of ours, the remote ones on the given URLs */
    const networks = (urls: {
      devnet?: string;
      mainnet?: string;
      testnet?: string;
    }) =>
      clustersFor({
        devnet: { rpcUrl: urls.devnet },
        "mainnet-beta": { rpcUrl: urls.mainnet },
        testnet: { rpcUrl: urls.testnet },
      });

    /** An entry that is both its key's reading and its address's key */
    const canonical = (id: keyof EndpointOptions) =>
      options[id].filter(
        (o) =>
          options[id].find((x) => x.key === o.key) === o &&
          options[id].find((x) => x.url === o.url) === o
      );

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
          option: "devnet",
        });
        expect(at(stored, "server.endpoint")).toEqual({ option: "foundation" });
        expect(JSON.stringify(stored)).not.toContain("api-key");
      });

      it("round-trips every option we provide", () => {
        for (const { url } of canonical("connection.endpoint")) {
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
            toStoredEndpoints(state(PLATFORM_DEVNET, LOCAL_ENDPOINT), options)
          )
        );
        const rotated = buildEndpointOptions(
          networks({
            devnet: "https://devnet.rpc.test/?api-key=new",
            mainnet: PLATFORM_MAINNET,
          })
        );

        expect(
          fromStoredEndpoints(stored, defaults, rotated).connection.endpoint
        ).toBe("https://devnet.rpc.test/?api-key=new");
      });

      it("keys the build server the env configures, and follows it", () => {
        const configured = buildEndpointOptions(
          networks({}),
          "https://build.test/a"
        );
        const stored = JSON.parse(
          JSON.stringify(
            toStoredEndpoints(
              state(Endpoint.DEVNET, "https://build.test/a"),
              configured
            )
          )
        );

        expect(at(stored, "server.endpoint")).toEqual({ option: "configured" });
        const moved = buildEndpointOptions(
          networks({}),
          "https://build.test/b"
        );
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
        const configured = buildEndpointOptions(
          networks({}),
          FOUNDATION_ENDPOINT
        );
        const stored = JSON.parse(
          JSON.stringify(
            toStoredEndpoints(
              state(Endpoint.DEVNET, FOUNDATION_ENDPOINT),
              configured
            )
          )
        );

        expect(at(stored, "server.endpoint")).toEqual({ option: "configured" });
        const moved = buildEndpointOptions(
          networks({}),
          "https://build.test/new"
        );
        expect(
          fromStoredEndpoints(stored, defaults, moved).server.endpoint
        ).toBe("https://build.test/new");
      });

      it("falls back to the default build server when its stored option is gone", () => {
        const configured = buildEndpointOptions(
          networks({}),
          "https://build.test/a"
        );
        const stored = JSON.parse(
          JSON.stringify(
            toStoredEndpoints(
              state(Endpoint.DEVNET, "https://build.test/a"),
              configured
            )
          )
        );

        const unconfigured = buildEndpointOptions(networks({}));
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
          option: "devnet",
        });
        expect(at(stored, "server.endpoint")).toEqual({
          option: "custom",
          url: "https://unknown.test/",
        });
      });

      it("moves the Foundation's own host, stored either way, onto the route", () => {
        for (const value of [
          FOUNDATION_DIRECT_ENDPOINT,
          { option: "custom", url: `${FOUNDATION_DIRECT_ENDPOINT}/` },
        ]) {
          const stored = {
            connection: defaults.connection,
            server: { endpoint: value },
            ui: defaults.ui,
          };
          const read = fromStoredEndpoints(stored, defaults, options);
          expect(read.server.endpoint).toBe(FOUNDATION_ENDPOINT);
        }
      });

      it("falls back to the default when a stored option is gone", () => {
        const stored = {
          connection: { endpoint: { option: "gone" } },
          server: { endpoint: { option: "local" } },
        };

        const read = fromStoredEndpoints(stored, defaults, options);
        expect(read.connection.endpoint).toBe(defaults.connection.endpoint);
        expect(read.server.endpoint).toBe(LOCAL_ENDPOINT);
      });

      it.each([
        ["a custom address that is not a URL", { option: "custom", url: "x" }],
        ["a custom option with no address", { option: "custom" }],
        ["a legacy plain string that is not a URL", "not a url"],
        ["an empty string", ""],
        ["a number", 42],
        ["an array", ["devnet"]],
        // eslint-disable-next-line unicorn/no-null -- stored JSON can hold null; this is what it reads back as
        ["null", null],
        ["an option that is not a string", { option: 5 }],
        [
          "a custom option with a null address",
          // eslint-disable-next-line unicorn/no-null -- stored JSON can hold null; this is what it reads back as
          { option: "custom", url: null },
        ],
        ["a custom option with a number address", { option: "custom", url: 5 }],
      ])("lands on Devnet when the stored endpoint is %s", (_, endpoint) => {
        const stored = {
          connection: { endpoint },
          server: { endpoint },
        };

        const read = fromStoredEndpoints(stored, defaults, options);
        expect(read.connection.endpoint).toBe(Endpoint.DEVNET);
        expect(read.server.endpoint).toBe(defaults.server.endpoint);
      });

      it.each([
        ["not JSON", "{not json"],
        ["JSON null", "null"],
        ["a JSON number", "42"],
        ["a JSON array", "[]"],
      ])("reports stored settings that are %s as unreadable", (_, raw) => {
        expect(parseStoredSettings(raw)).toBeInstanceOf(Error);
      });

      it("tells a value that is not an object apart from text that is not JSON", () => {
        const notObject = parseStoredSettings("[]");
        const notJson = parseStoredSettings("{not json");

        expect(notObject).toBeInstanceOf(Error);
        expect(notJson).toBeInstanceOf(SyntaxError);
        expect((notObject as Error).message).not.toBe(
          (notJson as Error).message
        );
      });

      it.each([
        ["a string", "x"],
        ["a number", 5],
        // eslint-disable-next-line unicorn/no-null -- stored JSON can hold null; this is what it reads back as
        ["null", null],
        ["an array", ["devnet"]],
      ])("drops a stored group that is %s", (_, group) => {
        const stored = { connection: group, ui: { theme: "Dark" } };

        expect(dropBrokenSettingsFor(defaults)(stored)).toEqual({
          ui: { theme: "Dark" },
        });
      });

      it("reads a connection group that is not an object without throwing", () => {
        // Endpoints resolve before `dropBrokenSettingsFor` drops the group
        expect(
          fromStoredEndpoints({ connection: "x" }, defaults, options)
        ).toEqual({ connection: "x" });
      });

      it("keeps a stored option once it resolves, which the filter alone would drop", () => {
        const stored = { connection: { endpoint: { option: "devnet" } } };

        expect(
          dropBrokenSettingsFor(defaults)(
            fromStoredEndpoints(stored, defaults, options)
          )
        ).toEqual({ connection: { endpoint: PLATFORM_DEVNET } });
        expect(dropBrokenSettingsFor(defaults)(stored)).toEqual({
          connection: {},
        });
      });

      describe("below the top level", () => {
        const nested = {
          build: { flags: { noDocs: true } },
          ui: { theme: "Solana" },
        };

        it("drops a nested value that should be an object and is not", () => {
          expect(
            dropBrokenSettingsFor(nested)({ build: { flags: "x" } })
          ).toEqual({ build: {} });
        });

        it("drops a stored null whose default is not null", () => {
          const stored = JSON.parse('{"ui":{"theme":null}}');

          expect(dropBrokenSettingsFor(nested)(stored)).toEqual({ ui: {} });
        });

        it.each([
          ["an object", { x: 1 }],
          ["an array", ["a"]],
        ])("drops %s stored where the default is a string", (_, value) => {
          expect(
            dropBrokenSettingsFor(nested)({ ui: { theme: value } })
          ).toEqual({ ui: {} });
        });

        it("keeps an array stored where the default is an array", () => {
          const withList = { recent: ["a"] };

          expect(dropBrokenSettingsFor(withList)({ recent: ["b"] })).toEqual({
            recent: ["b"],
          });
        });

        it("keeps nested values that fit the defaults", () => {
          const stored = {
            build: { flags: { noDocs: false } },
            ui: { theme: "Dark" },
          };

          expect(dropBrokenSettingsFor(nested)(stored)).toEqual(stored);
        });
      });

      it("keeps a group the defaults no longer hold, for its migration", () => {
        const stored = { other: { blockExplorer: "Solscan" } };

        expect(dropBrokenSettingsFor(defaults)(stored)).toEqual(stored);
      });

      it("keeps groups the defaults do not hold as objects", () => {
        const stored = { connection: { endpoint: "x" }, extra: 5 };

        expect(dropBrokenSettingsFor(defaults)(stored)).toEqual(stored);
      });

      it.each([
        "https://my.rpc.test/?api-key=s3cr3t",
        "http://localhost:8899",
        "http://10.0.0.5:8080",
      ])("keeps the valid custom address %s", (url) => {
        const stored = { connection: { endpoint: { option: "custom", url } } };

        expect(
          fromStoredEndpoints(stored, defaults, options).connection.endpoint
        ).toBe(url);
      });

      it("reads stored settings that are an object", () => {
        expect(
          parseStoredSettings('{"connection":{"endpoint":{"option":"devnet"}}}')
        ).toEqual({ connection: { endpoint: { option: "devnet" } } });
      });

      it("reads the dropped SolPg build server as the default", () => {
        // A profile that picked upstream's server when the picker offered it
        const stored = { server: { endpoint: { option: "solpg" } } };

        expect(
          fromStoredEndpoints(stored, defaults, options).server.endpoint
        ).toBe(defaults.server.endpoint);
      });

      it("keeps api.solpg.io as a custom address, legacy string included", () => {
        const solpg = "https://api.solpg.io";

        expect(
          at(
            toStoredEndpoints(state(Endpoint.DEVNET, solpg), options),
            "server.endpoint"
          )
        ).toEqual({ option: "custom", url: solpg });
        expect(roundTrip(state(Endpoint.DEVNET, solpg)).server.endpoint).toBe(
          solpg
        );
        // Written as a plain string before endpoints were stored as keys
        expect(
          fromStoredEndpoints(state(Endpoint.DEVNET, solpg), defaults, options)
            .server.endpoint
        ).toBe(solpg);
      });

      it.each([
        ["devnet", PLATFORM_DEVNET],
        ["mainnet-beta", PLATFORM_MAINNET],
        ["devnet-platform", PLATFORM_DEVNET],
        ["mainnet-beta-platform", PLATFORM_MAINNET],
      ])(
        "reads the pre-HOO-2488 key %s as the offered network",
        (option, url) => {
          const stored = { connection: { endpoint: { option } } };
          expect(
            fromStoredEndpoints(stored, defaults, options).connection.endpoint
          ).toBe(url);
        }
      );

      it("stores a public URL picked beside the offered network as custom", () => {
        // HOO-2690: the public Devnet saved as a custom RPC while Devnet is
        // on a platform RPC; its key would read back as the platform one
        for (const url of [
          Endpoint.DEVNET,
          Endpoint.MAINNET_BETA,
          Endpoint.TESTNET,
        ]) {
          expect(
            at(
              toStoredEndpoints(state(url, LOCAL_ENDPOINT), options),
              "connection.endpoint"
            )
          ).toEqual({ option: "custom", url });
        }
      });

      it("keeps a public URL saved as a custom RPC, slash and all, across a reload", () => {
        // A saved RPC holds its URL normalised, as `PgCustomRpcs` stores it
        const picked = new URL(Endpoint.DEVNET).href;
        expect(
          roundTrip(state(picked, LOCAL_ENDPOINT)).connection.endpoint
        ).toBe(picked);
      });

      it("keeps a profile on a public URL there across a reload", () => {
        expect(
          roundTrip(state(Endpoint.DEVNET, LOCAL_ENDPOINT)).connection.endpoint
        ).toBe(Endpoint.DEVNET);
        expect(
          roundTrip(state(Endpoint.MAINNET_BETA, LOCAL_ENDPOINT)).connection
            .endpoint
        ).toBe(Endpoint.MAINNET_BETA);
      });

      it("moves a profile that stored a public URL as a plain string to the offered network", () => {
        // Written before endpoints were stored as keys, and never saved since
        const legacy = state(Endpoint.DEVNET, LOCAL_ENDPOINT);

        const read = fromStoredEndpoints(legacy, defaults, options);
        expect(read.connection.endpoint).toBe(PLATFORM_DEVNET);
        expect(read.server.endpoint).toBe(LOCAL_ENDPOINT);
      });

      it.each(["testnet", "testnet-platform"])(
        "reads the key %s as the offered Testnet, on its platform RPC",
        (option) => {
          const stored = { connection: { endpoint: { option } } };
          expect(
            fromStoredEndpoints(stored, defaults, options).connection.endpoint
          ).toBe(PLATFORM_TESTNET);
        }
      );

      it("stores the public Testnet under its key while the env sets no Testnet RPC", () => {
        expect(
          at(
            toStoredEndpoints(
              state(Endpoint.TESTNET, LOCAL_ENDPOINT),
              onPublicTestnet
            ),
            "connection.endpoint"
          )
        ).toEqual({ option: "testnet" });
      });

      it("invents no platform keys for the local networks", () => {
        const keys = options["connection.endpoint"].map((o) => o.key);
        expect(keys).not.toContain("localnet-platform");
        expect(keys).not.toContain("surfpool-platform");
      });

      it("stores Localnet and Surfpool under keys of their own, though they share a cluster", () => {
        expect(
          at(
            toStoredEndpoints(
              state(Endpoint.SURFPOOL, LOCAL_ENDPOINT),
              options
            ),
            "connection.endpoint"
          )
        ).toEqual({ option: "surfpool" });
        expect(
          at(
            toStoredEndpoints(
              state(Endpoint.LOCALNET, LOCAL_ENDPOINT),
              options
            ),
            "connection.endpoint"
          )
        ).toEqual({ option: "localnet" });
      });

      it("keeps Testnet, Localnet, Surfpool and Playnet on their own addresses", () => {
        for (const url of [
          Endpoint.TESTNET,
          Endpoint.LOCALNET,
          Endpoint.SURFPOOL,
          Endpoint.PLAYNET,
        ]) {
          expect(
            roundTrip(state(url, LOCAL_ENDPOINT)).connection.endpoint
          ).toBe(url);
        }
      });

      it("offers the public URLs under the same keys when the env sets none", () => {
        const publicOnly = buildEndpointOptions(
          networks({ devnet: Endpoint.DEVNET, mainnet: Endpoint.MAINNET_BETA })
        );
        expect(
          roundTrip(state(Endpoint.MAINNET_BETA, LOCAL_ENDPOINT), publicOnly)
            .connection.endpoint
        ).toBe(Endpoint.MAINNET_BETA);
        expect(
          at(
            toStoredEndpoints(
              state(Endpoint.MAINNET_BETA, LOCAL_ENDPOINT),
              publicOnly
            ),
            "connection.endpoint"
          )
        ).toEqual({ option: "mainnet-beta" });
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

      it("reads an address of ours stored as a plain string as its key's address", () => {
        // What a profile written before endpoints were stored as keys holds
        const legacy = state(PLATFORM_DEVNET, LOCAL_ENDPOINT);

        const read = fromStoredEndpoints(legacy, defaults, options);
        expect(read.connection.endpoint).toBe(PLATFORM_DEVNET);
        expect(read.server.endpoint).toBe(LOCAL_ENDPOINT);
      });

      it("leaves every other setting alone", () => {
        const s = state(PLATFORM_MAINNET, FOUNDATION_ENDPOINT);
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
