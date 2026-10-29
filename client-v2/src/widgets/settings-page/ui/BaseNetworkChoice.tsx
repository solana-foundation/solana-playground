import { Endpoint, PLATFORM_ENDPOINTS } from "@/constants";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";

// `string`, not `Endpoint`: platform endpoints are build-time URLs, not enum
// members.
const NETWORKS: ReadonlyArray<{ label: string; endpoint: string }> = [
  { label: "Devnet", endpoint: Endpoint.DEVNET },
  { label: "Testnet", endpoint: Endpoint.TESTNET },
  { label: "Localnet", endpoint: Endpoint.LOCALNET },
  ...PLATFORM_ENDPOINTS.map(({ name, value }) => ({
    label: name,
    endpoint: value,
  })),
];

/**
 * The network chips. An endpoint no chip lists (Playnet, Mainnet Beta, a
 * custom URL) leaves none checked.
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
  const listed = NETWORKS.some((n) => n.endpoint === endpoint);
  return (
    <Segmented
      variant="chips"
      aria-label="Network"
      value={listed ? endpoint : ""}
      onValueChange={(e) => {
        onPick(e);
        onChoose?.(e);
      }}
    >
      {NETWORKS.map((n) => (
        <SegmentedItem
          key={n.endpoint}
          value={n.endpoint}
          // A fingertip tall on a phone, as the prototype's network chips
          className="max-md:h-12 max-md:px-4 max-md:text-control"
          onClick={() => {
            if (n.endpoint === endpoint) onChoose?.(n.endpoint);
          }}
        >
          {n.label}
        </SegmentedItem>
      ))}
    </Segmented>
  );
};

export default BaseNetworkChoice;
