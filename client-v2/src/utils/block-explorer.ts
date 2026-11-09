import type { Cluster } from "./connection";
import { createDerivable, declareDecorator, derivable } from "./decorators";
import { PgSettings } from "./settings";

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
   * @returns a function taking the last path value and the network the link
   * opens (the selected network when `undefined`)
   */
  getCommonUrl?(
    path: string
  ): (value: string, cluster: Cluster | null | undefined) => string;
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

/**
 * The `blockExplorer.name` setting's default, and the explorer links open
 * when the stored one is no longer offered
 */
export const DEFAULT_BLOCK_EXPLORER = "Solana Explorer";

/**
 * The explorer named `name`, or the default when `name` is no longer offered:
 * a dropped explorer (Solana FM) stays in a user's stored settings.
 *
 * @param all the offered explorers
 * @param name the name the settings hold
 */
export const findBlockExplorer = (all: BlockExplorer[], name: string) => {
  const explorer =
    all.find((be) => be.name === name) ??
    all.find((be) => be.name === DEFAULT_BLOCK_EXPLORER);
  if (!explorer) {
    throw new Error(`"${DEFAULT_BLOCK_EXPLORER}" is not a block explorer`);
  }
  return explorer;
};

/**
 * The explorer links open for the stored `name`. A fallback is stored too, so
 * the settings page shows the explorer links open; storing it runs this again
 * with a name that is offered, which writes nothing.
 *
 * @param name the name the settings hold
 */
export const resolveBlockExplorer = (name: string) => {
  const explorer = findBlockExplorer(_PgBlockExplorer.all, name);
  if (explorer.name !== name) PgSettings.blockExplorer.name = explorer.name;
  return explorer;
};

const derive = () => ({
  /** The current block explorer based on user's block explorer setting */
  current: createDerivable({
    derive: resolveBlockExplorer,
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
    const getCommonUrl =
      b.getCommonUrl ??
      ((p: string) => (v: string, cluster: Cluster | null | undefined) =>
        b.url + "/" + p + "/" + v + b.getClusterParam(cluster));
    b.getAddressUrl ??= getCommonUrl("address");
    b.getTxUrl ??= getCommonUrl("tx");

    const opens = (cluster: Cluster | null) =>
      cluster === "mainnet-beta" || b.getClusterParam(cluster) !== "";
    return Object.assign(b, { opens }) as BlockExplorer;
  }
}

export const PgBlockExplorer = declareDecorator(_PgBlockExplorer, {
  derivable: derive,
});
