import type { ReactNode } from "react";
import { useId } from "react";

import { NETWORKS as OFFERED } from "@/constants";
import type { CustomRpc } from "@/entities/custom-rpc";
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
  foot?: { line: string; realSol: boolean };
}

const NETWORKS: ReadonlyArray<Chip> = OFFERED.map(
  ({ name, value, cluster }) => ({
    label: name,
    endpoint: value,
    foot:
      cluster === "mainnet-beta"
        ? { line: "Deploys with real SOL", realSol: true }
        : { line: "Deploys with free devnet SOL", realSol: false },
  })
);

/**
 * The network card's rows: the chips, Devnet and Mainnet, then each saved
 * custom RPC under its name; then `children` (the saved RPCs' list); then
 * the card's foot, how a deploy works on the checked network. An endpoint no
 * chip lists (Playnet, or a URL not saved yet) leaves none checked and no
 * foot. Render it directly inside BaseSettingsCard: the rows are a fragment,
 * so the card's divide-y draws the hairlines between them.
 */
const BaseNetworkChoice = ({
  endpoint,
  custom = [],
  onPick,
  children,
}: {
  endpoint: string;
  /** The saved custom RPCs, in the order they were saved */
  custom?: ReadonlyArray<CustomRpc>;
  onPick: (endpoint: string) => void;
  /** A row between the chips and the foot */
  children?: ReactNode;
}) => {
  const chips: Chip[] = [
    ...NETWORKS,
    ...custom.map((rpc) => ({ label: rpc.name, endpoint: rpc.url })),
  ];
  const picked = chips.find((n) => n.endpoint === endpoint);
  const footId = useId();
  return (
    <>
      <div className="px-4 py-4">
        <Segmented
          variant="chips"
          aria-label="Network"
          aria-describedby={picked?.foot ? footId : undefined}
          value={picked ? endpoint : ""}
          // Segmented picks on arrow-key focus, as a radio group does
          onValueChange={onPick}
        >
          {chips.map((n) => (
            <SegmentedItem
              key={n.endpoint}
              value={n.endpoint}
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
          <StatusDot variant={picked.foot.realSol ? "warning" : "success"} />
          {picked.foot.line}
        </p>
      )}
    </>
  );
};

export default BaseNetworkChoice;
