import { useId } from "react";

import { Endpoint, PLATFORM_ENDPOINTS } from "@/constants";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";

const REAL_SOL = "Deploys with real SOL";

// `string`, not `Endpoint`: platform endpoints are build-time URLs, not enum
// members. `line` says how a network deploys; only mainnet has one so far.
const NETWORKS: ReadonlyArray<{
  label: string;
  endpoint: string;
  line?: string;
}> = [
  { label: "Devnet", endpoint: Endpoint.DEVNET },
  { label: "Testnet", endpoint: Endpoint.TESTNET },
  { label: "Localnet", endpoint: Endpoint.LOCALNET },
  ...PLATFORM_ENDPOINTS.map(({ name, value, cluster }) => ({
    label: name,
    endpoint: value,
    line: cluster === "mainnet-beta" ? REAL_SOL : undefined,
  })),
  { label: "Mainnet Beta", endpoint: Endpoint.MAINNET_BETA, line: REAL_SOL },
];

/**
 * The network chips, with the checked network's line under them. An endpoint
 * no chip lists (Playnet, a custom URL) leaves none checked.
 */
const BaseNetworkChoice = ({
  endpoint,
  onPick,
  onChoose,
}: {
  endpoint: string;
  onPick: (endpoint: string) => void;
  /**
   * Any pick, the network already chosen included, which changes nothing and
   * so fires no `onPick`: "Choose a network" counts it
   */
  onChoose?: (endpoint: string) => void;
}) => {
  const picked = NETWORKS.find((n) => n.endpoint === endpoint);
  const lineId = useId();
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        variant="chips"
        aria-label="Network"
        aria-describedby={picked?.line ? lineId : undefined}
        value={picked ? endpoint : ""}
        onValueChange={(e) => {
          onPick(e);
          onChoose?.(e);
        }}
      >
        {NETWORKS.map((n) => (
          <SegmentedItem
            key={n.endpoint}
            value={n.endpoint}
            className="font-mono"
            onClick={() => {
              if (n.endpoint === endpoint) onChoose?.(n.endpoint);
            }}
          >
            {n.label}
          </SegmentedItem>
        ))}
      </Segmented>
      {picked?.line && (
        <span id={lineId} className="text-xs text-muted-foreground">
          {picked.line}
        </span>
      )}
    </div>
  );
};

export default BaseNetworkChoice;
