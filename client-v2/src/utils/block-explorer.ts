import { createDerivable, declareDecorator, derivable } from "./decorators";
import { PgSettings } from "./settings";
import type { Cluster } from "./connection";

/** Block explorer creation parameter */
interface BlockExplorerParam {
  /** Name of the block explorer */
  name: string;
  /** Base URL of the explorer website */
  url: string;
  /**
   * Get the cluster URL parameter to add to the explorer URLs.
   *
   * @param cluster the network the link opens; the selected network when omitted
   * @returns the cluster URL parameter
   */
  getClusterParam(cluster?: Cluster | null): string;
  /**
   * Get the common URL i.e. a URL that follows simple enough `path` and
   * `value` in order to be able to derive the full URLs.
   *
   * @param path URL path
   * @param value last path value
   * @param cluster the network the link opens; the selected network when omitted
   */
  getCommonUrl?(path: string, value: string, cluster?: Cluster | null): string;
  /**
   * Get address URL for the configured explorer.
   *
   * @param address public key
   * @param cluster the network the link opens; the selected network when omitted
   * @returns the address URL
   */
  getAddressUrl?(address: string, cluster?: Cluster | null): string;
  /**
   * Get transaction URL for the configured explorer.
   *
   * @param txHash transaction signature
   * @param cluster the network the link opens; the selected network when omitted
   * @returns the transaction URL
   */
  getTxUrl?(txHash: string, cluster?: Cluster | null): string;
}

type BlockExplorer = Omit<
  Required<BlockExplorerParam>,
  "getClusterParam" | "getCommonUrl"
> & {
  /**
   * Whether a link can open `cluster`: mainnet needs no parameter, and a
   * cluster the explorer has none for would otherwise open mainnet
   */
  opens(cluster: Cluster | null): boolean;
};

const derive = () => ({
  /** The current block explorer based on user's block explorer setting */
  current: createDerivable({
    derive: (name) => _PgBlockExplorer.all.find((be) => be.name === name)!,
    onChange: PgSettings.onDidChangeBlockExplorerName,
    infallible: true,
  }),
});

@derivable(derive)
class _PgBlockExplorer {
  /** All block explorers */
  static all: BlockExplorer[];

  /**
   * Create a block explorer.
   *
   * @param b block explorer implementation
   * @returns the created block explorer
   */
  static create(b: BlockExplorerParam): BlockExplorer {
    b.getCommonUrl ??= (p, v, cluster) =>
      b.url + "/" + p + "/" + v + b.getClusterParam(cluster);
    b.getAddressUrl ??= (address, cluster) =>
      b.getCommonUrl!("address", address, cluster);
    b.getTxUrl ??= (txHash, cluster) => b.getCommonUrl!("tx", txHash, cluster);

    const opens = (cluster: Cluster | null) =>
      cluster === "mainnet-beta" || b.getClusterParam(cluster) !== "";
    return Object.assign(b, { opens }) as BlockExplorer;
  }
}

export const PgBlockExplorer = declareDecorator(_PgBlockExplorer, {
  derivable: derive,
});
