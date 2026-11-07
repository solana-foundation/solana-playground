import { clusterName } from "@/constants";
import { useSelectedConnection } from "@/entities/cluster";

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
 * The cluster status the account menu's warning reads,
 * re-rendering when any part changes
 */
export const useClusterStatus = (): ClusterStatus => {
  const { cluster, isConnected, isClusterDown } = useSelectedConnection();
  return {
    name: cluster ? clusterName(cluster) : "unknown",
    down: clusterIsDown({ isConnected, slotStalled: isClusterDown }),
  };
};
