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

/** A chip's value in the group: its name and its URL, unique among the chips */
export const chipKey = (name: string, url: string) => `${name}\n${url}`;

const keyOf = (chip: Chip) => chipKey(chip.label, chip.endpoint);

const chipsOf = (custom: ReadonlyArray<CustomRpc>): Chip[] => [
  ...NETWORKS,
  ...custom.map((rpc) => ({ label: rpc.name, endpoint: rpc.url })),
];

/** Which chip to check: the endpoint, and the chip picked last (`chipKey`) */
interface Pick {
  endpoint: string;
  chosen?: string;
}

/** The chip checked: `chosen` while `endpoint` is its URL, else the first on it */
const pickedOf = (chips: ReadonlyArray<Chip>, { endpoint, chosen }: Pick) =>
  chips.find((n) => keyOf(n) === chosen && n.endpoint === endpoint) ??
  chips.find((n) => n.endpoint === endpoint);

/**
 * The key (`chipKey`) of the chip `BaseNetworkChoice` checks for these
 * props, or `undefined` when none lists the endpoint
 */
export const checkedChipKey = (
  custom: ReadonlyArray<CustomRpc>,
  pick: Pick
): string | undefined => {
  const picked = pickedOf(chipsOf(custom), pick);
  return picked && keyOf(picked);
};

/**
 * The network chips: the offered networks, then each saved custom RPC under
 * its name, with the checked network's line under them. An endpoint no chip
 * lists (Playnet, or a URL not saved yet) leaves none checked.
 *
 * Chips may share a URL (HOO-2690). One is checked: `chosen` while the
 * endpoint is still its URL, else the first listing the endpoint.
 */
const BaseNetworkChoice = ({
  endpoint,
  custom = [],
  chosen,
  onPick,
}: {
  endpoint: string;
  /** The saved custom RPCs, in the order they were saved */
  custom?: ReadonlyArray<CustomRpc>;
  /** The chip picked last (`chipKey`), checked over another on its URL */
  chosen?: string;
  /** A chip was picked: its URL, and its key for `chosen` */
  onPick: (endpoint: string, key: string) => void;
}) => {
  const chips = chipsOf(custom);
  const picked = pickedOf(chips, { endpoint, chosen });
  const handleChange = (key: string) => {
    const chip = chips.find((n) => keyOf(n) === key);
    if (chip) onPick(chip.endpoint, key);
  };
  const lineId = useId();
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        variant="chips"
        aria-label="Network"
        aria-describedby={picked?.line ? lineId : undefined}
        value={picked ? keyOf(picked) : ""}
        onValueChange={handleChange}
      >
        {chips.map((n) => (
          <SegmentedItem
            key={keyOf(n)}
            value={keyOf(n)}
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
