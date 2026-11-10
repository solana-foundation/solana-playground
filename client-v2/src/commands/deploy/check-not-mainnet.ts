import { UnknownClusterError } from "@/entities/cluster";
import { createLogger } from "@/shared/lib/logger";

import type { Cluster } from "../../utils";
import { PgConnection, PgGlobal, TerminalLineError } from "../../utils";
import {
  DEPLOY_NETWORK_UNREAD,
  isDeployBlocked,
  MainnetDeployRefusedError,
} from "./mainnet-block";

const log = createLogger("commands:deploy");

/** How long a custom RPC's genesis read may take before the deploy is refused */
const CLUSTER_READ_MS = 15_000;

/** `read`, or a rejection once `ms` passed: a hung RPC holds no deploy */
const withinFor =
  (ms: number) =>
  <T>(read: Promise<T>) => {
    let timer: number | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = window.setTimeout(
        () => reject(new Error(`no answer in ${ms / 1000} s`)),
        ms
      );
    });
    return Promise.race([read, timedOut]).finally(() =>
      window.clearTimeout(timer)
    );
  };

const withinClusterRead = withinFor(CLUSTER_READ_MS);

/**
 * Refuse a deploy to mainnet-beta. The cluster is read from `endpoint`, not
 * `PgConnection.cluster`, which is derived asynchronously and can still name
 * the previous network; a custom RPC is resolved by its genesis hash. A
 * genesis hash that names no known cluster passes: that network is not
 * mainnet. An endpoint that does not answer within 15 s, is rate-limited or
 * refuses the method is refused: it could be mainnet.
 *
 * @returns the cluster read, `null` for a network of its own
 * @throws {MainnetDeployRefusedError} on mainnet-beta
 * @throws {TerminalLineError} when the network is unread
 */
export const refuseMainnet = async (
  endpoint: string
): Promise<Cluster | null> => {
  let cluster: Cluster;
  try {
    cluster = await withinClusterRead(PgConnection.getCluster(endpoint));
  } catch (error) {
    // eslint-disable-next-line unicorn/no-null -- `DeployResult.cluster` is `null` for a network of its own
    if (error instanceof UnknownClusterError) return null;
    log.warn("could not read the deploy's network; deploy refused", {
      context: { error: String(error) },
    });
    throw new TerminalLineError(DEPLOY_NETWORK_UNREAD);
  }
  if (isDeployBlocked(cluster)) throw new MainnetDeployRefusedError();
  return cluster;
};

/**
 * The `deploy` command's first pre-check: the early refusal, before the
 * wallet question. `processDeploy` checks its own connection again before
 * any send, since the network can change while the question waits. Only a
 * fresh start reads the network: the same command pauses and resumes a run
 * under way, which a stalled RPC must not hold for the read's 15 s.
 */
export const checkNotMainnet = async () => {
  if (PgGlobal.deployState !== "ready") return;
  await refuseMainnet(PgConnection.current.rpcEndpoint);
};
