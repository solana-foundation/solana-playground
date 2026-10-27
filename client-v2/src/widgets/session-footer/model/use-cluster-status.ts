import { useRenderOnChange } from "../../../hooks";
import { PgConnection } from "../../../utils";
import { clusterIsDown } from "./account";

/** The current cluster's name and whether it is down */
export interface ClusterStatus {
  /** `"unknown"` until the connection has a cluster */
  name: string;
  /** Not answering, or answering with a slot that does not move
   * (`clusterIsDown`) */
  down: boolean;
}

/**
 * The cluster status the footer's row and the rail's dot show,
 * re-rendering when any part changes
 */
export const useClusterStatus = (): ClusterStatus => {
  const cluster = useRenderOnChange(PgConnection.onDidChangeCluster);
  const isConnected = useRenderOnChange(PgConnection.onDidChangeIsConnected);
  const slotStalled = useRenderOnChange(PgConnection.onDidChangeIsClusterDown);
  return {
    name: cluster ?? "unknown",
    down: clusterIsDown({ isConnected, slotStalled }),
  };
};
