import { TerminalLineError } from "@/utils/terminal/line-error";

/**
 * Mainnet sends from the Playground wallet, whose key is kept in the browser,
 * are refused in the beta: program deploys (HOO-2728, `processDeploy`) and the
 * terminal's `anchor idl` writes (HOO-2737). The beta sends to devnet, testnet
 * and local networks only. Mainnet stays selectable for reading and Interact;
 * its deploys go through the CLI deploy guide, from the user's own machine.
 */

/** The Deploy stage's line on mainnet */
export const MAINNET_DEPLOY_BLOCKED_LINE =
  "Deploys to mainnet are not available in the beta.";

/** The stage toast's way on, completing "Can't deploy here: …" */
export const MAINNET_DEPLOY_WAY_OUT =
  "on mainnet, deploy from your machine with the Solana CLI or Anchor";

/** The `deploy` command's refusal on mainnet */
export const MAINNET_DEPLOY_BLOCKED = `${MAINNET_DEPLOY_BLOCKED_LINE} Deploy from your own machine with the Solana CLI or Anchor: Deploy stage › Deploy from your machine.`;

/**
 * The refusal of a deploy to mainnet-beta: a rule of the beta, not a failed
 * deploy, so the stage sends no `deploy_failed` for it
 */
export class MainnetDeployRefusedError extends TerminalLineError {
  name = "MainnetDeployRefusedError";

  constructor() {
    super(MAINNET_DEPLOY_BLOCKED);
  }
}

/**
 * Whether a send from the Playground wallet to `cluster` is refused: the
 * Deploy stage's switch to the CLI guide, and the hard stop of `deploy` and
 * `anchor idl` writes. `null` (not read yet) does not block.
 */
export const isDeployBlocked = (cluster: string | null) =>
  cluster === "mainnet-beta";

/**
 * The `deploy` command's refusal when the endpoint did not say which network
 * it is: a custom RPC that is down or refuses the genesis read could be
 * mainnet, so nothing is sent on a guess
 */
export const DEPLOY_NETWORK_UNREAD =
  "Could not read which network the endpoint serves, so nothing was deployed. Check the RPC in Settings › Network and try again.";

/** The `anchor idl` writes' refusal on mainnet */
export const MAINNET_IDL_BLOCKED =
  "Writing an IDL to mainnet is not available in the beta. Run `anchor idl` from your own machine: Deploy stage › Deploy from your machine.";

/** The `anchor idl` writes' refusal when the endpoint did not say its network */
export const IDL_NETWORK_UNREAD =
  "Could not read which network the endpoint serves, so nothing was sent. Check the RPC in Settings › Network and try again.";

/**
 * How a mainnet send is refused. `blocked` makes an error rather than holding
 * a line: the deploy's is an identifiable subclass, which the Deploy stage
 * tells apart from a failed deploy.
 */
export interface MainnetRefusal {
  /** Names the send in the log of an unread network */
  readonly send: string;
  /** The error thrown on mainnet-beta */
  readonly blocked: () => TerminalLineError;
  /** The line when the endpoint did not say which network it serves */
  readonly unread: string;
}

/** A program deploy's refusal */
export const DEPLOY_REFUSAL: MainnetRefusal = Object.freeze({
  send: "deploy",
  blocked: () => new MainnetDeployRefusedError(),
  unread: DEPLOY_NETWORK_UNREAD,
});

/**
 * An `anchor idl` write's refusal. Deploy's and Interact's "Upload IDL" button
 * needs none: it loads a file into this browser and writes nothing on chain.
 */
export const IDL_REFUSAL: MainnetRefusal = Object.freeze({
  send: "anchor idl write",
  blocked: () => new TerminalLineError(MAINNET_IDL_BLOCKED),
  unread: IDL_NETWORK_UNREAD,
});
