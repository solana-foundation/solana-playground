import { PgConnection, TerminalLineError } from "../../utils";
import { blocksDeploy, MAINNET_DEPLOY_BLOCKED } from "./mainnet-block";

/**
 * The `deploy` command's first pre-check. The cluster is read from the
 * endpoint, not `PgConnection.cluster`, which is derived asynchronously and
 * can still name the previous network; a custom RPC is resolved by its
 * genesis hash. An endpoint that cannot be read passes: the deploy's own
 * reads fail on it before any transaction.
 *
 * @throws {TerminalLineError} on mainnet-beta
 */
export const checkNotMainnet = async () => {
  let cluster: string;
  try {
    cluster = await PgConnection.getCluster(PgConnection.current.rpcEndpoint);
  } catch {
    return;
  }
  if (blocksDeploy(cluster)) {
    throw new TerminalLineError(MAINNET_DEPLOY_BLOCKED);
  }
};
