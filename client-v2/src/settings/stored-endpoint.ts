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
