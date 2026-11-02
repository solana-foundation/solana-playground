import { useId } from "react";

import { NETWORKS as OFFERED } from "@/constants";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";

const REAL_SOL = "Deploys with real SOL";

// `line` says how a network deploys; only Mainnet has one so far.
const NETWORKS: ReadonlyArray<{
  label: string;
  endpoint: string;
  line?: string;
}> = OFFERED.map(({ name, value, cluster }) => ({
  label: name,
  endpoint: value,
  line: cluster === "mainnet-beta" ? REAL_SOL : undefined,
}));

/**
 * The network chips, Devnet and Mainnet, with the checked network's line
 * under them. An endpoint no chip lists (Localnet, Testnet, Playnet, a custom
 * URL) leaves none checked.
 */
const BaseNetworkChoice = ({
  endpoint,
  onPick,
}: {
  endpoint: string;
  onPick: (endpoint: string) => void;
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
        onValueChange={onPick}
      >
        {NETWORKS.map((n) => (
          <SegmentedItem
            key={n.endpoint}
            value={n.endpoint}
            // A fingertip tall on a phone, as the prototype's network chips
            className="max-md:h-12 max-md:px-4 max-md:text-control"
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
