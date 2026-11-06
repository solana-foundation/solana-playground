import { useId } from "react";

import { NETWORKS as OFFERED } from "@/constants";
import type { CustomRpc } from "@/entities/custom-rpc";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";

const REAL_SOL = "Deploys with real SOL";

/** A chip; `line` says how its network deploys, only Mainnet has one so far */
interface Chip {
  label: string;
  endpoint: string;
  line?: string;
}

const NETWORKS: ReadonlyArray<Chip> = OFFERED.map(
  ({ name, value, cluster }) => ({
    label: name,
    endpoint: value,
    line: cluster === "mainnet-beta" ? REAL_SOL : undefined,
  })
);

/**
 * The network chips: Devnet and Mainnet, then each saved custom RPC under its
 * name, with the checked network's line under them. An endpoint no chip
 * lists (Playnet, or a URL not saved yet) leaves none checked.
 */
const BaseNetworkChoice = ({
  endpoint,
  custom = [],
  onPick,
}: {
  endpoint: string;
  /** The saved custom RPCs, in the order they were saved */
  custom?: ReadonlyArray<CustomRpc>;
  onPick: (endpoint: string) => void;
}) => {
  const chips: Chip[] = [
    ...NETWORKS,
    ...custom.map((rpc) => ({ label: rpc.name, endpoint: rpc.url })),
  ];
  const picked = chips.find((n) => n.endpoint === endpoint);
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
        {chips.map((n) => (
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
