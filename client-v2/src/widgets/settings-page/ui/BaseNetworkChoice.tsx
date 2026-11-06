import type { ReactNode } from "react";
import { useId } from "react";

import { NETWORKS as OFFERED } from "@/constants";
import type { CustomRpc } from "@/entities/cluster";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";
import { StatusDot } from "@/shared/ui/status-dot";

/**
 * A chip. An offered network says how a deploy works there (free SOL only on
 * devnet, following Spec 03) and whether that spends real SOL (an amber dot);
 * a saved custom RPC says neither, since its cluster is unknown.
 */
interface Chip {
  label: string;
  endpoint: string;
  foot?: { line: string; isRealSol: boolean };
}

const NETWORKS: ReadonlyArray<Chip> = OFFERED.map(
  ({ name, value, cluster }) => ({
    label: name,
    endpoint: value,
    foot:
      cluster === "mainnet-beta"
        ? { line: "Deploys with real SOL", isRealSol: true }
        : { line: "Deploys with free devnet SOL", isRealSol: false },
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
 * The network card's rows: the chips, Devnet and Mainnet, then each saved
 * custom RPC under its name; then `children` (the saved RPCs' list); then
 * the card's foot, how a deploy works on the checked network. An endpoint no
 * chip lists (Playnet, or a URL not saved yet) leaves none checked and no
 * foot. Render it directly inside BaseSettingsCard: the rows are a fragment,
 * so the card's divide-y draws the hairlines between them.
 *
 * Chips may share a URL (HOO-2690). One is checked: `chosen` while the
 * endpoint is still its URL, else the first listing the endpoint.
 */
const BaseNetworkChoice = ({
  endpoint,
  custom = [],
  chosen,
  onPick,
  children,
}: {
  endpoint: string;
  /** The saved custom RPCs, in the order they were saved */
  custom?: ReadonlyArray<CustomRpc>;
  /** The chip picked last (`chipKey`), checked over another on its URL */
  chosen?: string;
  /** A chip was picked: its URL, and its key for `chosen` */
  onPick: (endpoint: string, key: string) => void;
  /** A row between the chips and the foot */
  children?: ReactNode;
}) => {
  const chips = chipsOf(custom);
  const picked = pickedOf(chips, { endpoint, chosen });
  const handleChange = (key: string) => {
    const chip = chips.find((n) => keyOf(n) === key);
    if (chip) onPick(chip.endpoint, key);
  };
  const footId = useId();
  return (
    <>
      <div className="px-4 py-4">
        <Segmented
          variant="chips"
          aria-label="Network"
          aria-describedby={picked?.foot ? footId : undefined}
          value={picked ? keyOf(picked) : ""}
          // Segmented picks on arrow-key focus, as a radio group does
          onValueChange={handleChange}
        >
          {chips.map((n) => (
            <SegmentedItem
              key={keyOf(n)}
              value={keyOf(n)}
              // A fingertip tall on a phone, at the h-11 of the Settings design's chips (DES-128)
              className="max-md:h-11 max-md:px-4 max-md:text-control"
            >
              {n.label}
            </SegmentedItem>
          ))}
        </Segmented>
      </div>
      {children}
      {picked?.foot && (
        // The card's foot: how a deploy works here, amber where SOL is real
        <p
          id={footId}
          className="flex items-center gap-2 bg-surface-raised/50 px-4 py-2.5 text-xs text-muted-foreground max-md:text-caption max-md:font-read"
        >
          <StatusDot variant={picked.foot.isRealSol ? "warning" : "success"} />
          {picked.foot.line}
        </p>
      )}
    </>
  );
};

export default BaseNetworkChoice;
