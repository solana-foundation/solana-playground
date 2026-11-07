import { UnknownClusterError } from "@/entities/cluster";
import { createLogger } from "@/shared/lib/logger";

import type { Cluster } from "../../utils";
import { PgConnection, TerminalLineError } from "../../utils";
import {
  blocksDeploy,
  DEPLOY_NETWORK_UNREAD,
  MAINNET_DEPLOY_BLOCKED,
} from "./mainnet-block";

const log = createLogger("commands:deploy");

/** How long a custom RPC's genesis read may take before the deploy is refused */
const CLUSTER_READ_MS = 15_000;

/** `read`, or a rejection once `ms` passed: a hung RPC holds no deploy */
const within = <T>(read: Promise<T>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer in ${ms / 1000} s`)),
      ms
    );
  });
  return Promise.race([read, timedOut]).finally(() => clearTimeout(timer));
};

/**
 * Refuse a deploy to mainnet-beta. The cluster is read from `endpoint`, not
 * `PgConnection.cluster`, which is derived asynchronously and can still name
 * the previous network; a custom RPC is resolved by its genesis hash. A
 * genesis hash that names no known cluster passes: that network is not
 * mainnet. An endpoint that does not answer within 15 s, is rate-limited or
 * refuses the method is refused: it could be mainnet.
 *
 * @returns the cluster read, `null` for a network of its own
 * @throws {TerminalLineError} on mainnet-beta, or when the network is unread
 */
export const refuseMainnet = async (
  endpoint: string
): Promise<Cluster | null> => {
  let cluster: Cluster;
  try {
    cluster = await within(PgConnection.getCluster(endpoint), CLUSTER_READ_MS);
  } catch (error) {
    // eslint-disable-next-line unicorn/no-null -- `DeployResult.cluster` is `null` for a network of its own
    if (error instanceof UnknownClusterError) return null;
    log.warn("could not read the deploy's network; deploy refused", {
      context: { error: String(error) },
    });
    throw new TerminalLineError(DEPLOY_NETWORK_UNREAD);
  }
  if (blocksDeploy(cluster)) {
    throw new TerminalLineError(MAINNET_DEPLOY_BLOCKED);
  }
  return cluster;
};

/**
 * The `deploy` command's first pre-check: the early refusal, before the
 * wallet question. `processDeploy` checks its own connection again before
 * any send, since the network can change while the question waits.
 */
export const checkNotMainnet = async () => {
  await refuseMainnet(PgConnection.current.rpcEndpoint);
};
