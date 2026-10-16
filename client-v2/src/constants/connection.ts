import { PLATFORM_RPC_URLS } from "../shared/config/client-env";

/** RPC endpoint */
export enum Endpoint {
  PLAYNET = "http://playnet",
  LOCALNET = "http://localhost:8899",
  DEVNET = "https://api.devnet.solana.com",
  TESTNET = "https://api.testnet.solana.com",
  MAINNET_BETA = "https://api.mainnet-beta.solana.com",
}

/** Cluster moniker a platform endpoint talks to */
type PlatformCluster = "devnet" | "testnet" | "mainnet-beta";

/** RPC endpoint the deployment provides in addition to {@link Endpoint} */
export interface PlatformEndpoint {
  name: string;
  value: string;
  cluster: PlatformCluster;
}

/** Configured platform RPC URLs, keyed by cluster */
interface PlatformRpcUrls {
  devnet?: string;
  testnet?: string;
  mainnet?: string;
}

/** Build the platform endpoint list, dropping clusters that have no URL. */
export const buildPlatformEndpoints = (
  urls: PlatformRpcUrls
): PlatformEndpoint[] => {
  const candidates: ReadonlyArray<
    [string | undefined, string, PlatformCluster]
  > = [
    [urls.devnet, "Devnet (Platform)", "devnet"],
    [urls.testnet, "Testnet (Platform)", "testnet"],
    [urls.mainnet, "Mainnet Beta (Platform)", "mainnet-beta"],
  ];

  // Skipping URLs already listed keeps the endpoint the unique identity of an
  // option: a duplicate would collide on the React key and leave `aria-checked`
  // true on two entries at once.
  const seen = new Set<string>(Object.values(Endpoint));

  // `!value` rather than a nullish check: sourcing an env file leaves unfilled
  // keys as "".
  return candidates.flatMap(([value, name, cluster]) => {
    if (!value || seen.has(value)) return [];
    seen.add(value);
    return [{ name, value, cluster }];
  });
};

/** Resolve the endpoint a fresh profile starts on. */
export const resolveDefaultEndpoint = (platformDevnet?: string): string =>
  // `||` not `??`: sourcing an env file leaves unfilled keys as "", which is
  // not nullish and would win.
  platformDevnet || Endpoint.DEVNET;

/** Platform-provided RPC endpoints; empty when the deployment configures none. */
export const PLATFORM_ENDPOINTS = buildPlatformEndpoints(PLATFORM_RPC_URLS);

/** Default RPC endpoint, preferring the platform's devnet over the public one. */
export const DEFAULT_ENDPOINT = resolveDefaultEndpoint(
  PLATFORM_RPC_URLS.devnet
);
