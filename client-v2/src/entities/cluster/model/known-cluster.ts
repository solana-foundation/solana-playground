import { createLogger } from "@/shared/lib/logger";

import type { Cluster } from "./clusters";
import { CLUSTERS, Endpoint, findClusterWith } from "./clusters";

const log = createLogger("connection:cluster");

/** Hosts a local validator answers on */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Whether `endpoint` points at this machine; an unparsable URL is not local */
const isLocalEndpoint = (endpoint: string) => {
  try {
    return LOCAL_HOSTS.has(new URL(endpoint).hostname);
  } catch {
    // Not a URL, so not local: the caller goes on to the genesis hash,
    // which fails loudly with the endpoint
    log.debug("endpoint is not a URL; not read as local");
    return false;
  }
};

const findCluster = findClusterWith(CLUSTERS);

/** The cluster of `endpoint` when it is known without a request; a custom endpoint gives `undefined` */
export const getKnownCluster = (endpoint: string): Cluster | undefined => {
  if (endpoint.startsWith(Endpoint.PLAYNET)) return "playnet";

  // Local: Localnet and Surfpool, on any port. The host is compared, not
  // the URL text, since a local endpoint opens the airdrop's sign-in gate
  // (`isAirdropSignInGated`) and `https://localhost.example.com` is remote
  if (isLocalEndpoint(endpoint)) return "localnet";

  // Public and platform URLs declare their cluster, sparing the genesis hash round trip
  return findCluster(endpoint);
};
